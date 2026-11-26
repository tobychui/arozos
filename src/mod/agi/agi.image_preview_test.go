package agi

import (
	"bytes"
	"encoding/binary"
	"hash/crc32"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

// jpegOfSize encodes a w x h picture whose left half is red and right half blue
func jpegOfSize(t *testing.T, w, h int) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := color.RGBA{R: 220, A: 255}
			if x >= w/2 {
				c = color.RGBA{B: 220, A: 255}
			}
			img.Set(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 95}); err != nil {
		t.Fatalf("jpeg encode: %v", err)
	}
	return buf.Bytes()
}

// withExifOrientation puts an APP1 Exif segment holding only the Orientation
// tag right after the SOI marker of a JPEG
func withExifOrientation(jpg []byte, orientation uint16) []byte {
	tiff := []byte{'I', 'I', 42, 0, 8, 0, 0, 0} //little endian, IFD0 at 8
	ifd := make([]byte, 2+12+4)
	binary.LittleEndian.PutUint16(ifd[0:], 1)      //one entry
	binary.LittleEndian.PutUint16(ifd[2:], 0x0112) //Orientation
	binary.LittleEndian.PutUint16(ifd[4:], 3)      //SHORT
	binary.LittleEndian.PutUint32(ifd[6:], 1)      //count
	binary.LittleEndian.PutUint16(ifd[10:], orientation)
	payload := append([]byte("Exif\x00\x00"), append(tiff, ifd...)...)

	seg := []byte{0xFF, 0xE1, 0, 0}
	binary.BigEndian.PutUint16(seg[2:], uint16(len(payload)+2))
	seg = append(seg, payload...)

	out := append([]byte{}, jpg[:2]...)
	out = append(out, seg...)
	return append(out, jpg[2:]...)
}

// pngClaimingSize returns a PNG whose header says w x h (the pixel data is
// that of a 1 x 1 picture, so only DecodeConfig can read it)
func pngClaimingSize(t *testing.T, w, h uint32) []byte {
	t.Helper()
	var buf bytes.Buffer
	if err := png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 1, 1))); err != nil {
		t.Fatalf("png encode: %v", err)
	}
	data := buf.Bytes()
	//IHDR data starts after the 8 byte signature, 4 byte length and "IHDR"
	binary.BigEndian.PutUint32(data[16:], w)
	binary.BigEndian.PutUint32(data[20:], h)
	binary.BigEndian.PutUint32(data[29:], crc32.ChecksumIEEE(data[12:29]))
	return data
}

func TestFitPreview(t *testing.T) {
	tests := []struct {
		name         string
		w, h         int
		maxW, maxH   int
		wantW, wantH int
	}{
		{"landscape fits the width", 1200, 800, 600, 1200, 600, 400},
		{"portrait fits the width", 800, 1200, 400, 1200, 400, 600},
		{"tall picture fits the height", 200, 2000, 600, 1000, 100, 1000},
		{"small picture is kept", 300, 200, 600, 1200, 300, 200},
		{"no height limit", 1200, 2400, 600, 0, 600, 1200},
		{"no limits", 640, 480, 0, 0, 640, 480},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := fitPreview(image.NewRGBA(image.Rect(0, 0, tc.w, tc.h)), tc.maxW, tc.maxH)
			if b := got.Bounds(); b.Dx() != tc.wantW || b.Dy() != tc.wantH {
				t.Errorf("got %dx%d, want %dx%d", b.Dx(), b.Dy(), tc.wantW, tc.wantH)
			}
		})
	}
}

func TestDecodePreviewSourceOrientation(t *testing.T) {
	src := jpegOfSize(t, 40, 20)
	tests := []struct {
		name         string
		orientation  uint16
		wantW, wantH int
	}{
		{"no exif", 0, 40, 20},
		{"upright", 1, 40, 20},
		{"rotated 180", 3, 40, 20},
		{"rotated 90 clockwise", 6, 20, 40},
		{"rotated 90 counter clockwise", 8, 20, 40},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			data := src
			if tc.orientation > 0 {
				data = withExifOrientation(src, tc.orientation)
			}
			img, err := decodePreviewSource(data, ".jpg")
			if err != nil {
				t.Fatalf("decode: %v", err)
			}
			if b := img.Bounds(); b.Dx() != tc.wantW || b.Dy() != tc.wantH {
				t.Errorf("got %dx%d, want %dx%d", b.Dx(), b.Dy(), tc.wantW, tc.wantH)
			}
		})
	}

	t.Run("rotated 90 clockwise puts the left edge on top", func(t *testing.T) {
		img, err := decodePreviewSource(withExifOrientation(src, 6), ".jpg")
		if err != nil {
			t.Fatalf("decode: %v", err)
		}
		r, _, b, _ := img.At(10, 2).RGBA()
		if r < b {
			t.Errorf("top of the upright picture should be red (the old left half), got r=%d b=%d", r>>8, b>>8)
		}
	})
}

func TestDecodePreviewSourceRefuses(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{"not a picture", []byte("hello world, not an image")},
		{"empty", []byte{}},
		{"too many pixels", pngClaimingSize(t, 20000, 20000)},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := decodePreviewSource(tc.data, ".png"); err == nil {
				t.Errorf("expected an error")
			}
		})
	}
}

func TestEncodePreview(t *testing.T) {
	clear := image.NewNRGBA(image.Rect(0, 0, 8, 8)) //fully transparent

	t.Run("jpeg turns transparency white", func(t *testing.T) {
		data, err := encodePreview(clear, "jpeg")
		if err != nil {
			t.Fatalf("encode: %v", err)
		}
		img, format, err := image.Decode(bytes.NewReader(data))
		if err != nil || format != "jpeg" {
			t.Fatalf("decode: %v (%s)", err, format)
		}
		r, g, b, _ := img.At(4, 4).RGBA()
		if r>>8 < 245 || g>>8 < 245 || b>>8 < 245 {
			t.Errorf("expected white, got %d,%d,%d", r>>8, g>>8, b>>8)
		}
	})

	t.Run("png keeps transparency", func(t *testing.T) {
		data, err := encodePreview(clear, "png")
		if err != nil {
			t.Fatalf("encode: %v", err)
		}
		img, format, err := image.Decode(bytes.NewReader(data))
		if err != nil || format != "png" {
			t.Fatalf("decode: %v (%s)", err, format)
		}
		if _, _, _, a := img.At(4, 4).RGBA(); a != 0 {
			t.Errorf("expected a transparent pixel, alpha %d", a)
		}
	})

	t.Run("unknown format", func(t *testing.T) {
		if _, err := encodePreview(clear, "gif"); err == nil {
			t.Errorf("expected an error")
		}
	})
}

func TestPreviewFormatOf(t *testing.T) {
	tests := []struct {
		dest    string
		want    string
		wantErr bool
	}{
		{"user:/a/b.jpg", "jpeg", false},
		{"user:/a/b.JPEG", "jpeg", false},
		{"user:/a/b.png", "png", false},
		{"user:/a/b.webp", "", true},
		{"user:/a/b", "", true},
	}
	for _, tc := range tests {
		t.Run(tc.dest, func(t *testing.T) {
			got, err := previewFormatOf(tc.dest)
			if (err != nil) != tc.wantErr || got != tc.want {
				t.Errorf("got %q, %v; want %q, error %v", got, err, tc.want, tc.wantErr)
			}
		})
	}
}

func TestRenderPreview(t *testing.T) {
	fsh, dir := newImageTestFSH(t)

	photo := filepath.Join(dir, "photo.jpg")
	if err := os.WriteFile(photo, withExifOrientation(jpegOfSize(t, 300, 200), 6), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	raw := filepath.Join(dir, "photo.arw")
	if err := os.WriteFile(raw, jpegOfSize(t, 300, 200), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}

	tests := []struct {
		name         string
		path         string
		wantW, wantH int
		wantErr      bool
	}{
		{"jpeg is upright and fitted", photo, 100, 150, false},
		{"raw uses its embedded jpeg", raw, 100, 66, false},
		{"missing file", filepath.Join(dir, "none.jpg"), 0, 0, true},
		{"folder", dir, 0, 0, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			data, w, h, err := renderPreview(fsh, tc.path, 100, 400, "jpeg")
			if tc.wantErr {
				if err == nil {
					t.Errorf("expected an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("renderPreview: %v", err)
			}
			if w != tc.wantW || h != tc.wantH {
				t.Errorf("reported %dx%d, want %dx%d", w, h, tc.wantW, tc.wantH)
			}
			cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
			if err != nil {
				t.Fatalf("output is not a jpeg: %v", err)
			}
			if cfg.Width != w || cfg.Height != h {
				t.Errorf("encoded %dx%d, reported %dx%d", cfg.Width, cfg.Height, w, h)
			}
		})
	}
}
