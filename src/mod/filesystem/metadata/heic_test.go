package metadata

import (
	"bytes"
	"image"
	"image/color"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"

	"github.com/gen2brain/h265/heic"
)

// writeHEIC encodes a w x h picture, red on the left half and blue on the
// right, as a HEIC file in dir and returns its path
func writeHEIC(t *testing.T, dir, name string, w, h int, opts heic.EncodeOptions) string {
	t.Helper()
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			c := color.NRGBA{220, 30, 30, 255}
			if x >= w/2 {
				c = color.NRGBA{30, 30, 220, 255}
			}
			img.SetNRGBA(x, y, c)
		}
	}
	var buf bytes.Buffer
	if err := heic.Encode(&buf, img, opts); err != nil {
		t.Fatalf("encode heic: %v", err)
	}
	p := filepath.Join(dir, name)
	if err := os.WriteFile(p, buf.Bytes(), 0644); err != nil {
		t.Fatalf("write heic: %v", err)
	}
	return p
}

func TestIsHEICImageFile(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"IMG_0001.HEIC", true},
		{"photo.heic", true},
		{"photo.heif", true},
		{"DSC0001.HIF", true},
		{"photo.jpg", false},
		{"heic", false},
		{"photo.heic.txt", false},
	}
	for _, tc := range tests {
		if got := IsHEICImageFile(tc.name); got != tc.want {
			t.Errorf("IsHEICImageFile(%q) = %v, want %v", tc.name, got, tc.want)
		}
		if got := ThumbnailSupported(tc.name); tc.want && !got {
			t.Errorf("ThumbnailSupported(%q) = false, want true", tc.name)
		}
	}
}

func TestGenerateThumbnailForHEIC(t *testing.T) {
	tests := []struct {
		name string
		w, h int
		opts heic.EncodeOptions
	}{
		{"landscape.heic", 640, 360, heic.EncodeOptions{Quality: 80}},
		{"portrait.HEIC", 300, 520, heic.EncodeOptions{Quality: 80}},
		//iPhone photos are a grid of 512 px tiles
		{"grid.heic", 700, 600, heic.EncodeOptions{Quality: 80, Tile: 256}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			fsh, dir := newTestFSH(t)
			cacheDir := filepath.Join(dir, "cache") + "/"
			if err := os.MkdirAll(cacheDir, 0755); err != nil {
				t.Fatalf("mkdir: %v", err)
			}
			src := writeHEIC(t, dir, tc.name, tc.w, tc.h, tc.opts)

			b64, err := renderThumbnail(fsh, cacheDir, src, false)
			if err != nil {
				t.Fatalf("renderThumbnail: %v", err)
			}
			if b64 == "" {
				t.Error("expected the thumbnail as base64")
			}
			f, err := os.Open(filepath.Join(cacheDir, tc.name+".jpg"))
			if err != nil {
				t.Fatalf("thumbnail cache file missing: %v", err)
			}
			defer f.Close()
			got, err := jpeg.Decode(f)
			if err != nil {
				t.Fatalf("decode thumbnail: %v", err)
			}
			if got.Bounds().Dx() != 480 || got.Bounds().Dy() != 480 {
				t.Errorf("thumbnail size = %v, want 480x480", got.Bounds())
			}
		})
	}
}

func TestRenderHEICImage(t *testing.T) {
	fsh, dir := newTestFSH(t)
	src := writeHEIC(t, dir, "photo.heic", 400, 240, heic.EncodeOptions{Quality: 90})

	data, err := RenderHEICImage(fsh, src)
	if err != nil {
		t.Fatalf("RenderHEICImage: %v", err)
	}
	img, err := jpeg.Decode(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("output is not a JPEG: %v", err)
	}
	if img.Bounds().Dx() != 400 || img.Bounds().Dy() != 240 {
		t.Fatalf("size = %v, want 400x240", img.Bounds())
	}
	//Colours survive: red on the left, blue on the right
	r, _, b, _ := img.At(50, 120).RGBA()
	if r>>8 < 150 || b>>8 > 100 {
		t.Errorf("left half = r%d b%d, want red", r>>8, b>>8)
	}
	r, _, b, _ = img.At(350, 120).RGBA()
	if b>>8 < 150 || r>>8 > 100 {
		t.Errorf("right half = r%d b%d, want blue", r>>8, b>>8)
	}
}

func TestRenderHEICImage_Errors(t *testing.T) {
	fsh, dir := newTestFSH(t)
	notHEIC := filepath.Join(dir, "fake.heic")
	if err := os.WriteFile(notHEIC, []byte("this is not a heic file"), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	truncated := writeHEIC(t, dir, "cut.heic", 200, 200, heic.EncodeOptions{})
	data, _ := os.ReadFile(truncated)
	os.WriteFile(truncated, data[:len(data)/2], 0644)

	tests := []struct {
		name string
		path string
	}{
		{"missing", filepath.Join(dir, "missing.heic")},
		{"not heic", notHEIC},
		{"truncated", truncated},
	}
	for _, tc := range tests {
		if _, err := RenderHEICImage(fsh, tc.path); err == nil {
			t.Errorf("%s: expected an error", tc.name)
		}
		if _, err := generateThumbnailForHEIC(fsh, dir+"/", tc.path, true); err == nil {
			t.Errorf("%s: expected a thumbnail error", tc.name)
		}
	}
}

func TestHEICRegisteredWithImageDecode(t *testing.T) {
	_, dir := newTestFSH(t)
	src := writeHEIC(t, dir, "photo.heic", 64, 48, heic.EncodeOptions{})
	f, err := os.Open(src)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer f.Close()
	_, format, err := image.Decode(f)
	if err != nil {
		t.Fatalf("image.Decode: %v", err)
	}
	if format != "heic" {
		t.Errorf("format = %q, want heic", format)
	}
}
