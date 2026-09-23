package clusterfs

import (
	"bytes"
	"errors"
	"io"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"testing"

	"imuslab.com/arozos/mod/filesystem/arozfs"
)

// fakeBackend is an in-memory namespace.
type fakeBackend struct {
	mu    sync.Mutex
	files map[string][]byte // path -> content, nil value = directory
	ready bool
}

func newFake() *fakeBackend {
	return &fakeBackend{files: map[string][]byte{"/": nil}, ready: true}
}

func (f *fakeBackend) Ready() bool { return f.ready }

func (f *fakeBackend) Stat(p string) (Info, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.files[p]
	if !ok {
		return Info{}, os.ErrNotExist
	}
	return Info{Path: p, IsDir: c == nil, Size: int64(len(c)), ModTime: 1}, nil
}

func (f *fakeBackend) List(p string) ([]Info, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if c, ok := f.files[p]; !ok || c != nil {
		return nil, os.ErrNotExist
	}
	out := []Info{}
	for k, c := range f.files {
		if k != "/" && path.Dir(k) == p {
			out = append(out, Info{Path: k, IsDir: c == nil, Size: int64(len(c)), ModTime: 1})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Path < out[j].Path })
	return out, nil
}

func (f *fakeBackend) Mkdir(p string, owner string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	for cur := p; cur != "/"; cur = path.Dir(cur) {
		if _, ok := f.files[cur]; !ok {
			f.files[cur] = nil
		}
	}
	return nil
}

func (f *fakeBackend) Remove(p string, recursive bool) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	if _, ok := f.files[p]; !ok {
		return os.ErrNotExist
	}
	for k := range f.files {
		if k == p || (recursive && strings.HasPrefix(k, p+"/")) {
			delete(f.files, k)
		}
	}
	return nil
}

func (f *fakeBackend) Rename(o, n string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	moved := map[string][]byte{}
	for k, c := range f.files {
		if k == o || strings.HasPrefix(k, o+"/") {
			moved[n+k[len(o):]] = c
			delete(f.files, k)
		}
	}
	for k, c := range moved {
		f.files[k] = c
	}
	return nil
}

func (f *fakeBackend) OpenRead(p string) (io.ReadCloser, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	c, ok := f.files[p]
	if !ok || c == nil {
		return nil, os.ErrNotExist
	}
	return io.NopCloser(bytes.NewReader(c)), nil
}

func (f *fakeBackend) Write(p string, r io.Reader, owner string) error {
	data, err := io.ReadAll(r)
	if err != nil {
		return err
	}
	f.Mkdir(path.Dir(p), owner)
	f.mu.Lock()
	defer f.mu.Unlock()
	f.files[p] = data
	return nil
}

func TestNormalize(t *testing.T) {
	tests := map[string]string{
		"cluster:/a/../b": "/b",
		"cluster:a\\b":    "/a/b",
		"":                "/",
		"/x/":             "/x",
		"y/z":             "/y/z",
	}
	for in, want := range tests {
		if got := normalize(in); got != want {
			t.Errorf("normalize(%q)=%q want %q", in, got, want)
		}
	}
}

func TestClusterFileSystemRoundTrip(t *testing.T) {
	fb := newFake()
	c := New("cluster", fb)

	if c.Name() != "cluster" || c.Heartbeat() != nil {
		t.Errorf("name/heartbeat wrong")
	}
	if err := c.WriteStream("cluster:/docs/a.txt", strings.NewReader("hello"), 0644); err != nil {
		t.Fatalf("WriteStream: %v", err)
	}
	if err := c.WriteFile("/docs/sub/b.txt", []byte("bee"), 0644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	if !c.FileExists("/docs/a.txt") || c.FileExists("/docs/none") || !c.IsDir("/docs") || c.IsDir("/docs/a.txt") {
		t.Errorf("exists/isdir wrong")
	}
	if c.GetFileSize("/docs/a.txt") != 5 {
		t.Errorf("size wrong")
	}
	if mt, err := c.GetModTime("/docs/a.txt"); err != nil || mt != 1 {
		t.Errorf("modtime wrong: %d %v", mt, err)
	}
	data, err := c.ReadFile("/docs/a.txt")
	if err != nil || string(data) != "hello" {
		t.Errorf("ReadFile: %q %v", data, err)
	}
	r, err := c.ReadStream("/docs/sub/b.txt")
	if err != nil {
		t.Fatalf("ReadStream: %v", err)
	}
	got, _ := io.ReadAll(r)
	r.Close()
	if string(got) != "bee" {
		t.Errorf("ReadStream content wrong")
	}

	fi, err := c.Stat("/docs")
	if err != nil || !fi.IsDir() || fi.Name() != "docs" || fi.Mode()&os.ModeDir == 0 {
		t.Errorf("Stat dir: %+v %v", fi, err)
	}
	entries, err := c.ReadDir("/docs")
	if err != nil || len(entries) != 2 || entries[0].Name() != "a.txt" || !entries[1].IsDir() {
		t.Errorf("ReadDir: %+v %v", entries, err)
	}
	info, _ := entries[0].Info()
	if info.Size() != 5 {
		t.Errorf("DirEntry.Info wrong")
	}

	//Glob
	matches, err := c.Glob("/docs/*.txt")
	if err != nil || len(matches) != 1 || matches[0] != "/docs/a.txt" {
		t.Errorf("Glob: %v %v", matches, err)
	}
	matches, _ = c.Glob("/docs/*/*.txt")
	if len(matches) != 1 || matches[0] != "/docs/sub/b.txt" {
		t.Errorf("nested Glob: %v", matches)
	}

	//Walk
	seen := []string{}
	c.Walk("/docs", func(p string, fi os.FileInfo, err error) error {
		seen = append(seen, p)
		return nil
	})
	if len(seen) != 4 {
		t.Errorf("Walk visited %v", seen)
	}

	//Rename / Mkdir / Remove
	if err := c.Rename("/docs/a.txt", "/docs/c.txt"); err != nil || c.FileExists("/docs/a.txt") || !c.FileExists("/docs/c.txt") {
		t.Errorf("Rename failed: %v", err)
	}
	if err := c.MkdirAll("/deep/er/dir", 0755); err != nil || !c.IsDir("/deep/er") {
		t.Errorf("MkdirAll failed: %v", err)
	}
	if err := c.Remove("/docs/c.txt"); err != nil || c.FileExists("/docs/c.txt") {
		t.Errorf("Remove failed: %v", err)
	}
	if err := c.RemoveAll("/docs"); err != nil || c.FileExists("/docs/sub/b.txt") {
		t.Errorf("RemoveAll failed: %v", err)
	}

	//Virtual path translation
	if rp, _ := c.VirtualPathToRealPath("cluster:/photos/x.jpg", "toby"); rp != "/photos/x.jpg" {
		t.Errorf("VirtualPathToRealPath = %q", rp)
	}
	if vp, _ := c.RealPathToVirtualPath("/photos/x.jpg", "toby"); vp != "cluster:/photos/x.jpg" {
		t.Errorf("RealPathToVirtualPath = %q", vp)
	}
	if vp, _ := c.RealPathToVirtualPath(filepath.FromSlash("photos/y.jpg"), ""); vp != "cluster:/photos/y.jpg" {
		t.Errorf("RealPathToVirtualPath os-form = %q", vp)
	}

	//Unsupported handle operations
	if _, err := c.Open("/x"); err == nil {
		t.Errorf("Open should be unsupported")
	}
	if _, err := c.Create("/x"); err == nil {
		t.Errorf("Create should be unsupported")
	}
	fb.ready = false
	if c.Heartbeat() == nil {
		t.Errorf("Heartbeat should fail when backend not ready")
	}
}

/*
	Storage info

	A backend that can explain where a file is kept answers through the
	abstraction, so the File Manager properties dialog does not need to know
	that the cluster is involved. A backend that cannot say anything must
	fail cleanly instead of pretending the file is nowhere.
*/

// infoBackend is a fakeBackend that also reports where a file is kept.
type infoBackend struct {
	*fakeBackend
	info arozfs.StorageInfo
	err  error
	last string
}

func (i *infoBackend) StorageInfo(logical string) (arozfs.StorageInfo, error) {
	i.last = logical
	if i.err != nil {
		return arozfs.StorageInfo{}, i.err
	}
	return i.info, nil
}

func TestStorageInfoFromBackend(t *testing.T) {
	backend := &infoBackend{fakeBackend: newFake(), info: arozfs.StorageInfo{
		Type:  "cluster",
		Title: "Cluster",
		Items: []arozfs.StorageInfoItem{{Title: "NodeA", State: arozfs.StorageStateOK}},
	}}
	c := New("cluster", backend)

	//Any path form the file system accepts has to reach the backend as a
	//plain namespace path
	testcases := []struct{ given, wanted string }{
		{"cluster:/photos/a.jpg", "/photos/a.jpg"},
		{"/photos/a.jpg", "/photos/a.jpg"},
		{"photos/a.jpg", "/photos/a.jpg"},
		{"cluster:/", "/"},
	}
	for _, tc := range testcases {
		info, err := c.StorageInfo(tc.given)
		if err != nil {
			t.Fatalf("StorageInfo(%q) returned an error: %v", tc.given, err)
		}
		if backend.last != tc.wanted {
			t.Errorf("StorageInfo(%q) asked the backend for %q, wanted %q", tc.given, backend.last, tc.wanted)
		}
		if info.Type != "cluster" || len(info.Items) != 1 {
			t.Errorf("StorageInfo(%q) did not pass the backend answer through: %+v", tc.given, info)
		}
	}
}

func TestStorageInfoErrors(t *testing.T) {
	//A backend that cannot resolve the file passes its error on
	failing := &infoBackend{fakeBackend: newFake(), err: errors.New("no such record")}
	if _, err := New("cluster", failing).StorageInfo("/photos/a.jpg"); err == nil {
		t.Error("Expected the backend error to be returned")
	}

	//A backend with no idea where files are kept is not an error case worth
	//guessing at: it simply has nothing to report
	if _, err := New("cluster", newFake()).StorageInfo("/photos/a.jpg"); err == nil {
		t.Error("Expected an error from a backend that does not report storage info")
	}
}

// thumbBackend is a fakeBackend whose files have thumbnails.
type thumbBackend struct {
	*fakeBackend
	keys map[string]string
	last string
}

func (b *thumbBackend) ThumbnailKey(logical string) (string, error) {
	b.last = logical
	key, ok := b.keys[logical]
	if !ok {
		return "", errors.New("no such record")
	}
	return key, nil
}

func (b *thumbBackend) RenderThumbnail(logical string) ([]byte, error) {
	b.last = logical
	if _, ok := b.keys[logical]; !ok {
		return nil, arozfs.ErrNoThumbnail
	}
	return []byte("image of " + logical), nil
}

func TestThumbnailFromBackend(t *testing.T) {
	backend := &thumbBackend{fakeBackend: newFake(), keys: map[string]string{"/v/a.mp4": "sha-a"}}
	var c interface{} = New("cluster", backend)
	r, ok := c.(arozfs.ThumbnailRenderer)
	if !ok {
		t.Fatal("ClusterFileSystem should be an arozfs.ThumbnailRenderer")
	}

	testcases := []struct {
		given   string
		wantKey string
		wantErr bool
	}{
		{"cluster:/v/a.mp4", "sha-a", false},
		{"/v/a.mp4", "sha-a", false},
		{"v/a.mp4", "sha-a", false},
		{"/v/missing.mp4", "", true},
	}
	for _, tc := range testcases {
		key, err := r.ThumbnailKey(tc.given)
		if (err != nil) != tc.wantErr || key != tc.wantKey {
			t.Errorf("ThumbnailKey(%q) = %q, %v; wanted %q (error %v)", tc.given, key, err, tc.wantKey, tc.wantErr)
		}
		data, err := r.RenderThumbnail(tc.given)
		if tc.wantErr {
			if !errors.Is(err, arozfs.ErrNoThumbnail) {
				t.Errorf("RenderThumbnail(%q) should report ErrNoThumbnail, got %v", tc.given, err)
			}
			continue
		}
		if err != nil || string(data) != "image of /v/a.mp4" {
			t.Errorf("RenderThumbnail(%q) = %q, %v", tc.given, data, err)
		}
		if backend.last != "/v/a.mp4" {
			t.Errorf("RenderThumbnail(%q) asked the backend for %q", tc.given, backend.last)
		}
	}
}

func TestThumbnailWithoutBackendSupport(t *testing.T) {
	c := New("cluster", newFake())
	if _, err := c.ThumbnailKey("/v/a.mp4"); !errors.Is(err, arozfs.ErrNoThumbnail) {
		t.Errorf("ThumbnailKey on a plain backend should report ErrNoThumbnail, got %v", err)
	}
	if _, err := c.RenderThumbnail("/v/a.mp4"); !errors.Is(err, arozfs.ErrNoThumbnail) {
		t.Errorf("RenderThumbnail on a plain backend should report ErrNoThumbnail, got %v", err)
	}
}
