package metadata

import (
	"archive/zip"
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"path/filepath"
	"testing"
)

// buildORA returns the bytes of an OpenRaster zip holding the given images
// (entry name -> solid colour of a 40 x 20 PNG)
func buildORA(t *testing.T, entries map[string]color.RGBA) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	w, err := zw.CreateHeader(&zip.FileHeader{Name: "mimetype", Method: zip.Store})
	if err != nil {
		t.Fatalf("mimetype entry: %v", err)
	}
	w.Write([]byte("image/openraster"))
	sw, _ := zw.Create("stack.xml")
	sw.Write([]byte(`<?xml version="1.0"?><image w="40" h="20"><stack/></image>`))
	for name, c := range entries {
		img := image.NewRGBA(image.Rect(0, 0, 40, 20))
		for y := 0; y < 20; y++ {
			for x := 0; x < 40; x++ {
				img.Set(x, y, c)
			}
		}
		fw, err := zw.Create(name)
		if err != nil {
			t.Fatalf("create %s: %v", name, err)
		}
		if err := png.Encode(fw, img); err != nil {
			t.Fatalf("encode %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

func TestOraPreview(t *testing.T) {
	red := color.RGBA{255, 0, 0, 255}
	blue := color.RGBA{0, 0, 255, 255}
	tests := []struct {
		name    string
		entries map[string]color.RGBA
		want    color.RGBA
		wantErr bool
	}{
		{"merged image preferred", map[string]color.RGBA{"mergedimage.png": red, "Thumbnails/thumbnail.png": blue}, red, false},
		{"thumbnail fallback", map[string]color.RGBA{"Thumbnails/thumbnail.png": blue}, blue, false},
		{"no preview", map[string]color.RGBA{"data/layer1.png": red}, color.RGBA{}, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			img, err := oraPreview(buildORA(t, tc.entries))
			if tc.wantErr {
				if err == nil {
					t.Fatalf("expected an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("oraPreview: %v", err)
			}
			r, g, b, _ := img.At(5, 5).RGBA()
			if uint8(r>>8) != tc.want.R || uint8(g>>8) != tc.want.G || uint8(b>>8) != tc.want.B {
				t.Errorf("preview colour = %d,%d,%d, want %v", r>>8, g>>8, b>>8, tc.want)
			}
		})
	}
}

func TestOraPreview_NotAZip(t *testing.T) {
	if _, err := oraPreview([]byte("not a zip file")); err == nil {
		t.Fatal("expected an error for non-zip data")
	}
}

func TestGenerateThumbnailForORA_WritesJpeg(t *testing.T) {
	fsh, dir := newTestFSH(t)
	cacheDir := filepath.Join(dir, "cache") + "/"
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	src := filepath.Join(dir, "art.ora")
	if err := os.WriteFile(src, buildORA(t, map[string]color.RGBA{"mergedimage.png": {0, 128, 0, 255}}), 0644); err != nil {
		t.Fatalf("write ora: %v", err)
	}

	b64, err := generateThumbnailForORA(fsh, cacheDir, src, false)
	if err != nil {
		t.Fatalf("generateThumbnailForORA: %v", err)
	}
	if b64 == "" {
		t.Error("expected the thumbnail as base64")
	}
	if _, err := os.Stat(filepath.Join(cacheDir, "art.ora.jpg")); err != nil {
		t.Errorf("thumbnail cache file missing: %v", err)
	}
}

func TestGenerateThumbnailForORA_SourceNotExists(t *testing.T) {
	fsh, dir := newTestFSH(t)
	cacheDir := filepath.Join(dir, "cache") + "/"
	if _, err := generateThumbnailForORA(fsh, cacheDir, filepath.Join(dir, "missing.ora"), false); err == nil {
		t.Error("expected an error for a missing file")
	}
}

func TestGenerateThumbnailForORA_RequireBuffer(t *testing.T) {
	fsh, dir := newTestFSH(t)
	fsh.RequireBuffer = true
	result, err := generateThumbnailForORA(fsh, dir+"/", filepath.Join(dir, "art.ora"), false)
	if err != nil {
		t.Fatalf("unexpected error for RequireBuffer: %v", err)
	}
	if result != "" {
		t.Errorf("expected an empty result for RequireBuffer")
	}
}

func TestWriteCroppedThumbnail_TransparentBecomesWhite(t *testing.T) {
	fsh, dir := newTestFSH(t)
	img := image.NewRGBA(image.Rect(0, 0, 600, 300)) // fully transparent
	out := filepath.Join(dir, "thumb.jpg")
	if err := writeCroppedThumbnail(fsh, img, out); err != nil {
		t.Fatalf("writeCroppedThumbnail: %v", err)
	}
	f, err := os.Open(out)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer f.Close()
	got, _, err := image.Decode(f)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if got.Bounds().Dx() != 480 || got.Bounds().Dy() != 480 {
		t.Errorf("thumbnail size = %v, want 480x480", got.Bounds())
	}
	r, g, b, _ := got.At(240, 240).RGBA()
	if r>>8 < 250 || g>>8 < 250 || b>>8 < 250 {
		t.Errorf("transparent area = %d,%d,%d, want white", r>>8, g>>8, b>>8)
	}
}

func TestThumbnailSupported_LayeredFormats(t *testing.T) {
	tests := []struct {
		name string
		want bool
	}{
		{"art.psd", true},
		{"poster.PSB", true},
		{"sketch.ora", true},
		{"notes.pxs", false},
	}
	for _, tc := range tests {
		if got := ThumbnailSupported(tc.name); got != tc.want {
			t.Errorf("ThumbnailSupported(%q) = %v, want %v", tc.name, got, tc.want)
		}
	}
}
