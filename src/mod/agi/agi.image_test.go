package agi

import (
	"bytes"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
)

// newImageTestFSH creates a FileSystemHandler backed by a temporary local
// directory for exercising the imagelib helpers.
func newImageTestFSH(t *testing.T) (*filesystem.FileSystemHandler, string) {
	t.Helper()
	dir := t.TempDir()
	abs := localfs.NewLocalFileSystemAbstraction("TEST", dir+"/", "public", false)
	fsh := &filesystem.FileSystemHandler{
		Name:                  "test",
		UUID:                  "TEST",
		Path:                  dir + "/",
		ReadOnly:              false,
		Hierarchy:             "public",
		InitiationTime:        time.Now().Unix(),
		FileSystemAbstraction: abs,
		Filesystem:            "ext4",
	}
	return fsh, dir
}

// smallJPEGBytes returns a small solid image encoded as JPEG. Written into a
// RAW-extension file it stands in for the embedded preview that real RAW photos
// carry, which is what convertRawToJPEG extracts.
func smallJPEGBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 32, 24))
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90}); err != nil {
		t.Fatalf("jpeg encode: %v", err)
	}
	return buf.Bytes()
}

func TestConvertRawToJPEG(t *testing.T) {
	jpegBytes := smallJPEGBytes(t)

	t.Run("RAW with embedded JPEG is converted", func(t *testing.T) {
		fsh, dir := newImageTestFSH(t)
		src := filepath.Join(dir, "photo.arw")
		if err := os.WriteFile(src, jpegBytes, 0644); err != nil {
			t.Fatalf("write src: %v", err)
		}
		dst := filepath.Join(dir, "photo.jpg")

		if err := convertRawToJPEG(fsh, src, fsh, dst); err != nil {
			t.Fatalf("convertRawToJPEG returned error: %v", err)
		}

		out, err := os.ReadFile(dst)
		if err != nil {
			t.Fatalf("output not written: %v", err)
		}
		img, format, err := image.Decode(bytes.NewReader(out))
		if err != nil {
			t.Fatalf("output is not a decodable image: %v", err)
		}
		if format != "jpeg" {
			t.Errorf("expected jpeg output, got %q", format)
		}
		if b := img.Bounds(); b.Dx() != 32 || b.Dy() != 24 {
			t.Errorf("unexpected output dimensions: %dx%d", b.Dx(), b.Dy())
		}
	})

	t.Run("non-RAW source is rejected", func(t *testing.T) {
		fsh, dir := newImageTestFSH(t)
		src := filepath.Join(dir, "photo.png")
		if err := os.WriteFile(src, jpegBytes, 0644); err != nil {
			t.Fatalf("write src: %v", err)
		}
		if err := convertRawToJPEG(fsh, src, fsh, filepath.Join(dir, "out.jpg")); err == nil {
			t.Errorf("expected error for non-RAW source, got nil")
		}
	})

	t.Run("non-JPEG output extension is rejected", func(t *testing.T) {
		fsh, dir := newImageTestFSH(t)
		src := filepath.Join(dir, "photo.arw")
		if err := os.WriteFile(src, jpegBytes, 0644); err != nil {
			t.Fatalf("write src: %v", err)
		}
		if err := convertRawToJPEG(fsh, src, fsh, filepath.Join(dir, "out.png")); err == nil {
			t.Errorf("expected error for non-JPEG output, got nil")
		}
	})

	t.Run("RAW without embedded JPEG fails cleanly", func(t *testing.T) {
		fsh, dir := newImageTestFSH(t)
		src := filepath.Join(dir, "garbage.cr2")
		if err := os.WriteFile(src, []byte("not a real raw file"), 0644); err != nil {
			t.Fatalf("write src: %v", err)
		}
		if err := convertRawToJPEG(fsh, src, fsh, filepath.Join(dir, "out.jpg")); err == nil {
			t.Errorf("expected error for RAW without embedded JPEG, got nil")
		}
	})
}
