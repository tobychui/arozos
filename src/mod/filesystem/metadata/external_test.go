package metadata

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image/jpeg"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

// renderingFS is a local abstraction that also renders thumbnails itself,
// the way cluster:/ does, and counts how often it is asked to.
type renderingFS struct {
	localfs.LocalFileSystemAbstraction
	keys   map[string]string //path -> content key
	images map[string][]byte //path -> thumbnail, missing = ErrNoThumbnail
	delay  time.Duration
	calls  int32
}

func (r *renderingFS) ThumbnailKey(p string) (string, error) {
	key, ok := r.keys[p]
	if !ok {
		return "", os.ErrNotExist
	}
	return key, nil
}

func (r *renderingFS) RenderThumbnail(p string) ([]byte, error) {
	atomic.AddInt32(&r.calls, 1)
	time.Sleep(r.delay)
	img, ok := r.images[p]
	if !ok {
		return nil, arozfs.ErrNoThumbnail
	}
	return img, nil
}

// newRenderingFSH returns a drive backed by renderingFS, with the external
// cache in a temporary folder for the length of the test.
func newRenderingFSH(t *testing.T) (*filesystem.FileSystemHandler, *renderingFS, string) {
	t.Helper()
	dir := t.TempDir()
	previous := ExternalCacheDir()
	SetExternalCacheDir(filepath.Join(t.TempDir(), "thumbs"))
	t.Cleanup(func() { SetExternalCacheDir(previous) })

	abs := &renderingFS{
		LocalFileSystemAbstraction: localfs.NewLocalFileSystemAbstraction("REMOTE", dir+"/", "public", false),
		keys:                       map[string]string{},
		images:                     map[string][]byte{},
	}
	fsh := &filesystem.FileSystemHandler{
		Name:                  "remote",
		UUID:                  "REMOTE",
		Path:                  dir + "/",
		Hierarchy:             "public",
		RequireBuffer:         true,
		InitiationTime:        time.Now().Unix(),
		FileSystemAbstraction: abs,
		Filesystem:            "cluster",
	}
	return fsh, abs, dir
}

func TestThumbnailSupportedAndFeature(t *testing.T) {
	testcases := []struct {
		name      string
		supported bool
		feature   string
	}{
		{"photo.JPG", true, ""},
		{"photo.webp", true, ""},
		{"raw.CR2", true, ""},
		{"song.mp3", true, ""},
		{"clip.mp4", true, "ffmpeg"},
		{"clip.MKV", true, "ffmpeg"},
		{"model.stl", true, ""},
		{"print.gcode", true, ""},
		{"art.psd", true, ""},
		{"logo.svg", true, ""},
		{"notes.txt", false, ""},
		{"noextension", false, ""},
	}
	for _, tc := range testcases {
		if got := ThumbnailSupported(tc.name); got != tc.supported {
			t.Errorf("ThumbnailSupported(%q) = %v, wanted %v", tc.name, got, tc.supported)
		}
		if got := ThumbnailFeature(tc.name); got != tc.feature {
			t.Errorf("ThumbnailFeature(%q) = %q, wanted %q", tc.name, got, tc.feature)
		}
	}
}

func TestRenderLocalFile(t *testing.T) {
	dir := t.TempDir()
	png := createSmallPNG(t, dir, "pic.png")
	txt := filepath.Join(dir, "notes.txt")
	os.WriteFile(txt, []byte("hello"), 0644)

	data, err := RenderLocalFile(png)
	if err != nil {
		t.Fatalf("RenderLocalFile(png) failed: %v", err)
	}
	img, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("thumbnail is not a JPEG: %v", err)
	}
	if b := img.Bounds(); b.Dx() != 480 || b.Dy() != 480 {
		t.Errorf("thumbnail is %dx%d, wanted 480x480", b.Dx(), b.Dy())
	}

	//The renderers work in a scratch folder, never next to the file
	if _, err := os.Stat(filepath.Join(dir, ".metadata")); !os.IsNotExist(err) {
		t.Errorf("RenderLocalFile left a .metadata folder next to the file")
	}

	testcases := []struct {
		name   string
		path   string
		noThmb bool
	}{
		{"unsupported format", txt, true},
		{"folder", dir, true},
		{"missing file", filepath.Join(dir, "missing.png"), false},
	}
	for _, tc := range testcases {
		_, err := RenderLocalFile(tc.path)
		if err == nil {
			t.Errorf("%s: expected an error", tc.name)
			continue
		}
		if errors.Is(err, arozfs.ErrNoThumbnail) != tc.noThmb {
			t.Errorf("%s: ErrNoThumbnail = %v, wanted %v (%v)", tc.name, !tc.noThmb, tc.noThmb, err)
		}
	}
}

func TestLoadCacheFromRenderingDrive(t *testing.T) {
	fsh, abs, dir := newRenderingFSH(t)
	rh := NewRenderHandler()
	file := filepath.ToSlash(filepath.Join(dir, "clip.mp4"))
	abs.keys[file] = "sha-1"
	abs.images[file] = []byte("frame one")

	//First load renders, the second is served from this host's cache
	for i := 0; i < 2; i++ {
		got, err := rh.LoadCache(fsh, file, false)
		if err != nil {
			t.Fatalf("LoadCache #%d failed: %v", i+1, err)
		}
		if decoded, _ := base64.StdEncoding.DecodeString(got); string(decoded) != "frame one" {
			t.Errorf("LoadCache #%d returned %q", i+1, decoded)
		}
	}
	if abs.calls != 1 {
		t.Errorf("rendered %d times, wanted once", abs.calls)
	}
	if !CacheExists(fsh, file) {
		t.Error("CacheExists should see the kept thumbnail")
	}

	//Nothing is written into the drive
	if _, err := os.Stat(filepath.Join(dir, ".metadata")); !os.IsNotExist(err) {
		t.Error("a .metadata folder was created inside the drive")
	}

	//New content, new key: rendered again rather than served stale
	abs.keys[file] = "sha-2"
	abs.images[file] = []byte("frame two")
	if CacheExists(fsh, file) {
		t.Error("CacheExists should not match a thumbnail of the old content")
	}
	got, err := rh.LoadCache(fsh, file, false)
	if decoded, _ := base64.StdEncoding.DecodeString(got); err != nil || string(decoded) != "frame two" {
		t.Errorf("after a content change got %q, %v", decoded, err)
	}

	//Cache path and removal do not apply to a drive cached by content
	if _, err := GetCacheFilePath(fsh, file); err == nil {
		t.Error("GetCacheFilePath should not hand out a host path for this drive")
	}
	if err := RemoveCache(fsh, file); err != nil {
		t.Errorf("RemoveCache should be a no-op, got %v", err)
	}

	//generateOnly renders but returns nothing
	other := filepath.ToSlash(filepath.Join(dir, "b.jpg"))
	abs.keys[other] = "sha-b"
	abs.images[other] = []byte("b")
	if got, err := rh.LoadCache(fsh, other, true); err != nil || got != "" {
		t.Errorf("generateOnly returned %q, %v", got, err)
	}
	if !CacheExists(fsh, other) {
		t.Error("generateOnly should still keep the thumbnail")
	}
}

func TestLoadCacheRenderingDriveFailures(t *testing.T) {
	fsh, abs, dir := newRenderingFSH(t)
	rh := NewRenderHandler()

	//Unsupported formats and folders never reach the renderer
	notes := filepath.ToSlash(filepath.Join(dir, "notes.txt"))
	abs.keys[notes] = "sha-notes"
	if _, err := rh.LoadCache(fsh, notes, false); err == nil {
		t.Error("expected an error for an unsupported format")
	}

	//A file with no thumbnail is not asked for again straight away
	song := filepath.ToSlash(filepath.Join(dir, "song.mp3"))
	abs.keys[song] = "sha-song"
	for i := 0; i < 3; i++ {
		if _, err := rh.LoadCache(fsh, song, false); err == nil {
			t.Errorf("LoadCache #%d of a file without thumbnail should fail", i+1)
		}
	}
	if abs.calls != 1 {
		t.Errorf("renderer asked %d times, wanted once", abs.calls)
	}

	//A file the drive has no key for fails without rendering
	if _, err := rh.LoadCache(fsh, filepath.ToSlash(filepath.Join(dir, "gone.png")), false); err == nil {
		t.Error("expected an error for a file without a content key")
	}
	if abs.calls != 1 {
		t.Errorf("renderer asked %d times, wanted once", abs.calls)
	}
}

func TestLoadCacheRenderingDriveRendersOnce(t *testing.T) {
	fsh, abs, dir := newRenderingFSH(t)
	abs.delay = 200 * time.Millisecond
	rh := NewRenderHandler()
	file := filepath.ToSlash(filepath.Join(dir, "clip.mp4"))
	abs.keys[file] = "sha-1"
	abs.images[file] = []byte("frame")

	//Several viewers opening the same folder wait for one render
	var wg sync.WaitGroup
	errs := make(chan error, 5)
	for i := 0; i < 5; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			got, err := rh.LoadCache(fsh, file, false)
			if err == nil && got == "" {
				err = errors.New("empty thumbnail")
			}
			errs <- err
		}()
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			t.Errorf("concurrent LoadCache failed: %v", err)
		}
	}
	if n := atomic.LoadInt32(&abs.calls); n != 1 {
		t.Errorf("rendered %d times for concurrent requests, wanted once", n)
	}
}

func TestPruneExternalCache(t *testing.T) {
	previous := ExternalCacheDir()
	SetExternalCacheDir(t.TempDir())
	t.Cleanup(func() { SetExternalCacheDir(previous) })

	oldPath := externalCachePath("old")
	newPath := externalCachePath("new")
	for _, p := range []string{oldPath, newPath} {
		if err := writeFileAtomic(p, []byte("x")); err != nil {
			t.Fatalf("writeFileAtomic: %v", err)
		}
	}
	past := time.Now().Add(-48 * time.Hour)
	os.Chtimes(oldPath, past, past)

	if removed := PruneExternalCache(24 * time.Hour); removed != 1 {
		t.Errorf("PruneExternalCache removed %d files, wanted 1", removed)
	}
	if _, err := os.Stat(oldPath); !os.IsNotExist(err) {
		t.Error("the unused thumbnail was kept")
	}
	if _, err := os.Stat(newPath); err != nil {
		t.Errorf("a recent thumbnail was removed: %v", err)
	}
}
