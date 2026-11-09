package s3fs

import (
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aws/aws-sdk-go-v2/feature/s3/manager"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

/*
	Tests against a real S3 compatible service. They run only when one is
	named, for example a local SeaweedFS or MinIO:

	S3FS_TEST_ENDPOINT=127.0.0.1:8333 S3FS_TEST_BUCKET=test \
	S3FS_TEST_KEY=key S3FS_TEST_SECRET=secret go test ./mod/filesystem/abstractions/s3fs/

	S3FS_TEST_SSL=1 uses https. Each run works under a prefix of its own and
	removes it at the end.
*/

// countingClient counts the requests the drive sends to the bucket.
type countingClient struct {
	inner s3.HTTPClient
	n     atomic.Int64
}

func (c *countingClient) Do(r *http.Request) (*http.Response, error) {
	c.n.Add(1)
	return c.inner.Do(r)
}

func bucketForTest(t *testing.T) (*S3FSAbstraction, *countingClient) {
	t.Helper()
	endpoint := os.Getenv("S3FS_TEST_ENDPOINT")
	bucket := os.Getenv("S3FS_TEST_BUCKET")
	if endpoint == "" || bucket == "" {
		t.Skip("S3FS_TEST_ENDPOINT and S3FS_TEST_BUCKET name no bucket to test against")
	}
	prefix := fmt.Sprintf("s3fs-test-%d", time.Now().UnixNano())
	a, err := NewS3FSAbstraction("s3test", "public", endpoint, bucket, prefix,
		os.Getenv("S3FS_TEST_KEY"), os.Getenv("S3FS_TEST_SECRET"), os.Getenv("S3FS_TEST_SSL") == "1")
	if err != nil {
		t.Fatalf("mount %s/%s: %v", endpoint, bucket, err)
	}
	counter := &countingClient{}
	a.client = s3.New(a.client.Options(), func(o *s3.Options) {
		counter.inner = o.HTTPClient
		o.HTTPClient = counter
	})
	a.uploader = manager.NewUploader(a.client)
	t.Cleanup(func() {
		if err := a.RemoveAll("/"); err != nil {
			t.Errorf("remove test prefix %s: %v", prefix, err)
		}
	})
	return a, counter
}

// requests runs f and returns how many requests it sent.
func requests(c *countingClient, f func()) int64 {
	before := c.n.Load()
	f()
	return c.n.Load() - before
}

func TestBucketMissingFileIsNotExist(t *testing.T) {
	a, counter := bucketForTest(t)
	if _, err := a.Stat("/new.txt"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Stat of a missing file = %v, want os.ErrNotExist", err)
	}
	if n := requests(counter, func() {
		if _, err := a.Stat("/new.txt"); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("second Stat of a missing file = %v", err)
		}
	}); n != 0 {
		t.Errorf("a repeated Stat of a missing file sent %d requests, want 0", n)
	}
	if _, err := a.ReadStream("/new.txt"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("ReadStream of a missing file = %v, want os.ErrNotExist", err)
	}
	if _, err := a.GetModTime("/new.txt"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("GetModTime of a missing file = %v, want os.ErrNotExist", err)
	}
}

func TestBucketWriteIsSeenAtOnce(t *testing.T) {
	a, _ := bucketForTest(t)
	if _, err := a.Stat("/new.txt"); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("Stat before the write = %v", err)
	}
	if err := a.WriteStream("/new.txt", strings.NewReader("hello"), 0644); err != nil {
		t.Fatalf("WriteStream: %v", err)
	}
	info, err := a.Stat("/new.txt")
	if err != nil || info.Size() != 5 || info.IsDir() {
		t.Fatalf("Stat right after the write = %v, %v, want a 5 byte file", info, err)
	}
	if err := a.WriteStream("/new.txt", strings.NewReader("hello world"), 0644); err != nil {
		t.Fatalf("second WriteStream: %v", err)
	}
	if size := a.GetFileSize("/new.txt"); size != 11 {
		t.Errorf("size after rewriting = %d, want 11", size)
	}
}

func TestBucketFileStatIsOneRequest(t *testing.T) {
	a, counter := bucketForTest(t)
	if err := a.WriteStream("/new.txt", strings.NewReader("hello"), 0644); err != nil {
		t.Fatalf("WriteStream: %v", err)
	}
	a.cache.clear()
	if n := requests(counter, func() {
		if _, err := a.Stat("/new.txt"); err != nil {
			t.Errorf("Stat: %v", err)
		}
	}); n != 1 {
		t.Errorf("Stat of a file sent %d requests, want 1", n)
	}
}

func TestBucketListingAnswersStat(t *testing.T) {
	a, counter := bucketForTest(t)
	for _, p := range []string{"/new.txt", "/photos/a.jpg"} {
		if err := a.WriteStream(p, strings.NewReader("abc"), 0644); err != nil {
			t.Fatalf("WriteStream %s: %v", p, err)
		}
	}
	if err := a.Mkdir("/empty", 0755); err != nil {
		t.Fatalf("Mkdir: %v", err)
	}
	a.cache.clear()
	if _, err := a.ReadDir("/"); err != nil {
		t.Fatalf("ReadDir /: %v", err)
	}
	if _, err := a.ReadDir("/photos"); err != nil {
		t.Fatalf("ReadDir /photos: %v", err)
	}

	n := requests(counter, func() {
		if info, err := a.Stat("/new.txt"); err != nil || info.Size() != 3 {
			t.Errorf("Stat /new.txt = %v, %v", info, err)
		}
		if !a.IsDir("/photos") || !a.IsDir("/empty") || !a.FileExists("/empty") {
			t.Errorf("a listed folder is not seen as one")
		}
		if size := a.GetFileSize("/photos/a.jpg"); size != 3 {
			t.Errorf("GetFileSize /photos/a.jpg = %d", size)
		}
		if _, err := a.Stat("/photos/desktop.ini"); !errors.Is(err, os.ErrNotExist) {
			t.Errorf("Stat of a name missing from the listing = %v", err)
		}
	})
	if n != 0 {
		t.Errorf("questions answered by two listings sent %d requests, want 0", n)
	}
}

func TestBucketRemoveAndRenameAreSeenAtOnce(t *testing.T) {
	a, _ := bucketForTest(t)
	for _, p := range []string{"/new.txt", "/photos/a.jpg"} {
		if err := a.WriteStream(p, strings.NewReader("abc"), 0644); err != nil {
			t.Fatalf("WriteStream %s: %v", p, err)
		}
	}
	if _, err := a.ReadDir("/photos"); err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if !a.IsDir("/photos") {
		t.Fatalf("/photos is not a folder")
	}

	if err := a.Remove("/photos/a.jpg"); err != nil {
		t.Fatalf("Remove: %v", err)
	}
	if _, err := a.Stat("/photos/a.jpg"); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("Stat after Remove = %v, want os.ErrNotExist", err)
	}
	if a.IsDir("/photos") {
		t.Errorf("/photos is still a folder after its only file was removed")
	}

	if err := a.Rename("/new.txt", "/renamed.txt"); err != nil {
		t.Fatalf("Rename: %v", err)
	}
	if a.FileExists("/new.txt") {
		t.Errorf("the old name exists after Rename")
	}
	if info, err := a.Stat("/renamed.txt"); err != nil || info.Size() != 3 {
		t.Errorf("Stat of the new name = %v, %v", info, err)
	}
}
