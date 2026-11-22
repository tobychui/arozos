package mediaserver

import (
	"bytes"
	"image"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/gen2brain/h265/heic"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/info/logger"
)

func newHEICTestServer(t *testing.T) (*Instance, *filesystem.FileSystemHandler, string) {
	t.Helper()
	dir := t.TempDir()
	lg, err := logger.NewTmpLogger()
	if err != nil {
		t.Fatalf("logger: %v", err)
	}
	fsh := &filesystem.FileSystemHandler{
		Name:                  "test",
		UUID:                  "TEST",
		Path:                  dir + "/",
		Hierarchy:             "public",
		InitiationTime:        time.Now().Unix(),
		FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction("TEST", dir+"/", "public", false),
		Filesystem:            "ext4",
	}
	return NewMediaServer(&Options{TmpDirectory: t.TempDir(), Logger: lg}), fsh, dir
}

func TestServeHEICAsJPEG(t *testing.T) {
	srv, fsh, dir := newHEICTestServer(t)
	var buf bytes.Buffer
	if err := heic.Encode(&buf, image.NewNRGBA(image.Rect(0, 0, 96, 64))); err != nil {
		t.Fatalf("encode: %v", err)
	}
	src := filepath.Join(dir, "IMG_0001.HEIC")
	if err := os.WriteFile(src, buf.Bytes(), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	notHEIC := filepath.Join(dir, "broken.heic")
	os.WriteFile(notHEIC, []byte("not a picture"), 0644)

	//First request: a JPEG with the ETag of the source file
	rec := httptest.NewRecorder()
	srv.serveHEICAsJPEG(rec, httptest.NewRequest("GET", "/media?file=x", nil), fsh, src)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Errorf("Content-Type = %q, want image/jpeg", ct)
	}
	img, err := jpeg.Decode(rec.Body)
	if err != nil {
		t.Fatalf("body is not a JPEG: %v", err)
	}
	if img.Bounds().Dx() != 96 || img.Bounds().Dy() != 64 {
		t.Errorf("size = %v, want 96x64", img.Bounds())
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("expected an ETag")
	}

	tests := []struct {
		name string
		file string
		etag string
		want int
	}{
		{"same version is not decoded again", src, etag, http.StatusNotModified},
		{"stale tag gets the picture", src, `"0-0"`, http.StatusOK},
		{"undecodable file", notHEIC, "", http.StatusInternalServerError},
	}
	for _, tc := range tests {
		req := httptest.NewRequest("GET", "/media?file=x", nil)
		if tc.etag != "" {
			req.Header.Set("If-None-Match", tc.etag)
		}
		rec := httptest.NewRecorder()
		srv.serveHEICAsJPEG(rec, req, fsh, tc.file)
		if rec.Code != tc.want {
			t.Errorf("%s: status = %d, want %d", tc.name, rec.Code, tc.want)
		}
	}
}
