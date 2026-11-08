package aroz

import (
	"bytes"
	"crypto/rand"
	"errors"
	"io"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/storage/smbserver"
)

// bufferedFS behaves like S3 or FTP: no random access, only whole streams.
type bufferedFS struct {
	localfs.LocalFileSystemAbstraction
	mu         sync.Mutex
	chunkDelay time.Duration
	failUpload bool
	uploads    int
}

var errNoHandles = errors.New("this drive has no file handles")

func (b *bufferedFS) OpenFile(string, int, os.FileMode) (arozfs.File, error) {
	return nil, errNoHandles
}
func (b *bufferedFS) Open(string) (arozfs.File, error)   { return nil, errNoHandles }
func (b *bufferedFS) Create(string) (arozfs.File, error) { return nil, errNoHandles }

type slowReader struct {
	io.ReadCloser
	delay time.Duration
}

func (s *slowReader) Read(p []byte) (int, error) {
	if len(p) > 64<<10 {
		p = p[:64<<10]
	}
	time.Sleep(s.delay)
	return s.ReadCloser.Read(p)
}

// Chtimes fails as it does on WebDAV and FTP.
func (b *bufferedFS) Chtimes(string, time.Time, time.Time) error {
	return arozfs.ErrOperationNotSupported
}

func (b *bufferedFS) ReadStream(p string) (io.ReadCloser, error) {
	rc, err := b.LocalFileSystemAbstraction.ReadStream(p)
	if err != nil {
		return nil, err
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	return &slowReader{ReadCloser: rc, delay: b.chunkDelay}, nil
}

func (b *bufferedFS) WriteStream(p string, r io.Reader, mode os.FileMode) error {
	b.mu.Lock()
	fail := b.failUpload
	b.mu.Unlock()
	if fail {
		io.Copy(io.Discard, r)
		return errors.New("the remote refused the upload")
	}
	b.mu.Lock()
	b.uploads++
	b.mu.Unlock()
	return b.LocalFileSystemAbstraction.WriteStream(p, r, mode)
}

type stagedRig struct {
	fs    *bufferedFS
	share smbserver.Share
	root  string
	stage string
}

func newStagedRig(t *testing.T, limit int64) *stagedRig {
	t.Helper()
	root := t.TempDir()
	stage := filepath.Join(t.TempDir(), "stage")
	fs := &bufferedFS{LocalFileSystemAbstraction: localfs.NewLocalFileSystemAbstraction("cloud", root, "public", false)}
	fsh := &filesystem.FileSystemHandler{UUID: "cloud", Name: "Cloud", Hierarchy: "public", RequireBuffer: true, Filesystem: "webdav", FileSystemAbstraction: fs}
	account := &fakeAccount{fshs: []*filesystem.FileSystemHandler{fsh}, levels: map[string]string{"cloud": "rw"}}
	b, err := New(Options{
		Credentials: noCredentials{},
		LookupUser:  func(string) (Account, Quota, error) { return account, nil, nil },
		StageDir:    stage,
		StageLimit:  func() int64 { return limit },
	})
	if err != nil {
		t.Fatal(err)
	}
	v, err := b.Login("alice")
	if err != nil {
		t.Fatal(err)
	}
	shares := v.Shares()
	if len(shares) != 1 {
		t.Fatalf("a buffered drive must be shared, got %d shares", len(shares))
	}
	return &stagedRig{fs: fs, share: shares[0], root: root, stage: stage}
}

func randomData(t *testing.T, n int) []byte {
	t.Helper()
	b := make([]byte, n)
	rand.Read(b)
	return b
}

func stageFiles(t *testing.T, dir string) []string {
	t.Helper()
	out := []string{}
	filepath.Walk(dir, func(p string, info os.FileInfo, err error) error {
		if err == nil && !info.IsDir() {
			out = append(out, p)
		}
		return nil
	})
	return out
}

func TestStagedReadStartsBeforeTheDownloadEnds(t *testing.T) {
	r := newStagedRig(t, 0)
	data := randomData(t, 4<<20)
	os.WriteFile(filepath.Join(r.root, "big.bin"), data, 0644)
	r.fs.chunkDelay = 10 * time.Millisecond //64 chunks, so at least 640 ms for all

	f, err := r.share.Open("big.bin", os.O_RDONLY)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	started := time.Now()
	head := make([]byte, 4096)
	if _, err := f.ReadAt(head, 0); err != nil {
		t.Fatal(err)
	}
	if took := time.Since(started); took > 300*time.Millisecond {
		t.Errorf("the first read waited %v, it must not wait for the whole file", took)
	}
	if !bytes.Equal(head, data[:4096]) {
		t.Error("wrong data at the start")
	}

	tail := make([]byte, 4096)
	if _, err := f.ReadAt(tail, int64(len(data)-4096)); err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(tail, data[len(data)-4096:]) {
		t.Error("wrong data at the end")
	}
}

func TestStagedConcurrentReads(t *testing.T) {
	r := newStagedRig(t, 0)
	data := randomData(t, 3<<20+777)
	os.WriteFile(filepath.Join(r.root, "f.bin"), data, 0644)
	r.fs.chunkDelay = time.Millisecond

	f, err := r.share.Open("f.bin", os.O_RDONLY)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	//Reads arrive out of order, as pipelined SMB reads do
	var wg sync.WaitGroup
	errs := make(chan error, 64)
	for i := 47; i >= 0; i-- {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			off := int64(i) * 65536
			buf := make([]byte, 65536)
			n, err := f.ReadAt(buf, off)
			if err != nil && !errors.Is(err, io.EOF) {
				errs <- err
				return
			}
			end := off + int64(n)
			if !bytes.Equal(buf[:n], data[off:end]) {
				errs <- errors.New("a read returned the wrong bytes")
			}
		}(i)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		t.Error(err)
	}
}

func TestStagedWriteReachesTheDriveAtClose(t *testing.T) {
	r := newStagedRig(t, 0)
	os.WriteFile(filepath.Join(r.root, "doc.txt"), []byte("0123456789"), 0644)

	f, err := r.share.Open("doc.txt", os.O_RDWR)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.WriteAt([]byte("AB"), 2); err != nil {
		t.Fatal(err)
	}
	if got, _ := os.ReadFile(filepath.Join(r.root, "doc.txt")); string(got) != "0123456789" {
		t.Error("the drive must not change before the close")
	}
	if err := f.Close(); err != nil {
		t.Fatalf("close: %v", err)
	}
	if got, _ := os.ReadFile(filepath.Join(r.root, "doc.txt")); string(got) != "01AB456789" {
		t.Errorf("after close: %q", got)
	}
	if left := stageFiles(t, r.stage); len(left) != 0 {
		t.Errorf("staged copies left: %v", left)
	}
}

func TestStagedTruncate(t *testing.T) {
	r := newStagedRig(t, 0)
	os.WriteFile(filepath.Join(r.root, "doc.txt"), []byte("0123456789"), 0644)
	f, _ := r.share.Open("doc.txt", os.O_RDWR)
	if err := f.Truncate(4); err != nil {
		t.Fatal(err)
	}
	f.Close()
	if got, _ := os.ReadFile(filepath.Join(r.root, "doc.txt")); string(got) != "0123" {
		t.Errorf("after close: %q", got)
	}
}

func TestStagedNewFileExistsAtOnce(t *testing.T) {
	r := newStagedRig(t, 0)
	f, err := r.share.Open("new.txt", os.O_RDWR|os.O_CREATE)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(r.root, "new.txt")); err != nil {
		t.Errorf("a created file must be visible before it closes: %v", err)
	}
	f.WriteAt([]byte("hello"), 0)
	f.Close()
	if got, _ := os.ReadFile(filepath.Join(r.root, "new.txt")); string(got) != "hello" {
		t.Errorf("content %q", got)
	}
}

func TestStagedOverwriteStartsEmpty(t *testing.T) {
	r := newStagedRig(t, 0)
	os.WriteFile(filepath.Join(r.root, "doc.txt"), []byte("old content"), 0644)
	r.fs.chunkDelay = time.Hour //Any download would hang the test
	f, err := r.share.Open("doc.txt", os.O_RDWR|os.O_TRUNC)
	if err != nil {
		t.Fatal(err)
	}
	f.WriteAt([]byte("new"), 0)
	f.Close()
	if got, _ := os.ReadFile(filepath.Join(r.root, "doc.txt")); string(got) != "new" {
		t.Errorf("content %q", got)
	}
}

func TestStagedExclusiveCreate(t *testing.T) {
	r := newStagedRig(t, 0)
	os.WriteFile(filepath.Join(r.root, "doc.txt"), nil, 0644)
	if _, err := r.share.Open("doc.txt", os.O_RDWR|os.O_CREATE|os.O_EXCL); !errors.Is(err, os.ErrExist) {
		t.Errorf("err = %v", err)
	}
	if _, err := r.share.Open("missing.txt", os.O_RDONLY); !errors.Is(err, os.ErrNotExist) {
		t.Errorf("err = %v", err)
	}
}

func TestStagedReadOnlyCloseUploadsNothing(t *testing.T) {
	r := newStagedRig(t, 0)
	os.WriteFile(filepath.Join(r.root, "doc.txt"), randomData(t, 1<<20), 0644)
	r.fs.chunkDelay = 5 * time.Millisecond
	f, _ := r.share.Open("doc.txt", os.O_RDONLY)
	f.ReadAt(make([]byte, 10), 0)
	if err := f.Close(); err != nil {
		t.Fatal(err)
	}
	if r.fs.uploads != 0 {
		t.Errorf("%d uploads for a file that was only read", r.fs.uploads)
	}
	time.Sleep(50 * time.Millisecond)
	if left := stageFiles(t, r.stage); len(left) != 0 {
		t.Errorf("staged copies left: %v", left)
	}
}

func TestStagedFailedUploadKeepsTheData(t *testing.T) {
	r := newStagedRig(t, 0)
	os.WriteFile(filepath.Join(r.root, "doc.txt"), []byte("original"), 0644)
	f, _ := r.share.Open("doc.txt", os.O_RDWR)
	f.WriteAt([]byte("CHANGED!"), 0)

	r.fs.failUpload = true
	if err := f.Close(); err == nil {
		t.Fatal("a failed upload must be reported to the client")
	}
	kept := stageFiles(t, filepath.Join(r.stage, failedFolder))
	if len(kept) != 1 {
		t.Fatalf("kept = %v", kept)
	}
	if got, _ := os.ReadFile(kept[0]); string(got) != "CHANGED!" {
		t.Errorf("kept %q, the written data must survive", got)
	}
}

func TestStagedLimit(t *testing.T) {
	r := newStagedRig(t, 1000)
	os.WriteFile(filepath.Join(r.root, "big.bin"), make([]byte, 2000), 0644)
	if _, err := r.share.Open("big.bin", os.O_RDONLY); !errors.Is(err, smbserver.ErrFileTooLarge) {
		t.Errorf("err = %v", err)
	}
	//A new file is not refused for a size it does not have yet
	f, err := r.share.Open("new.bin", os.O_RDWR|os.O_CREATE)
	if err != nil {
		t.Fatal(err)
	}
	f.Close()
}

func TestStagedReadErrorIsReported(t *testing.T) {
	r := newStagedRig(t, 0)
	os.WriteFile(filepath.Join(r.root, "doc.txt"), []byte("x"), 0644)
	f, err := r.share.Open("doc.txt", os.O_RDONLY)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	os.Remove(filepath.Join(r.root, "doc.txt"))
	if _, err := f.ReadAt(make([]byte, 1), 0); err == nil {
		t.Error("a file that vanished before the download must give an error")
	}
}

func TestStagedPendingSize(t *testing.T) {
	r := newStagedRig(t, 0)
	os.WriteFile(filepath.Join(r.root, "doc.txt"), []byte("abc"), 0644)
	f, _ := r.share.Open("doc.txt", os.O_RDWR)
	pf, ok := f.(smbserver.PendingFile)
	if !ok {
		t.Fatal("a staged file must report its pending size")
	}
	if _, ok := pf.PendingSize(); ok {
		t.Error("an unchanged file has nothing pending")
	}
	f.WriteAt([]byte("0123456789"), 0)
	if size, ok := pf.PendingSize(); !ok || size != 10 {
		t.Errorf("pending = %d, %v", size, ok)
	}
	f.Close()
	if _, ok := pf.PendingSize(); ok {
		t.Error("nothing is pending after the upload")
	}
}

func TestTimesAreAcceptedOnDrivesWithoutThem(t *testing.T) {
	r := newStagedRig(t, 0)
	os.WriteFile(filepath.Join(r.root, "doc.txt"), []byte("abc"), 0644)
	if err := r.share.SetModTime("doc.txt", time.Now()); err != nil {
		t.Errorf("a drive that cannot keep times must not fail a copy: %v", err)
	}
}
