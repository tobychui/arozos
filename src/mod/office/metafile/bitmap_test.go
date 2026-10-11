package metafile

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"testing"

	"golang.org/x/image/tiff"
	"imuslab.com/arozos/mod/office/internal/officetest"
)

func TestDIBToPNG(t *testing.T) {
	dib := officetest.Dib24(4, 2, officetest.Quadrants(4, 2))
	out, err := DIBToPNG(dib)
	if err != nil {
		t.Fatalf("DIBToPNG: %v", err)
	}
	img, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("result is not a PNG: %v", err)
	}
	if b := img.Bounds(); b.Dx() != 4 || b.Dy() != 2 {
		t.Fatalf("size %v, want 4x2", b)
	}
	// top-left quadrant is red, bottom-right white (the DIB is bottom-up)
	if c := color.NRGBAModel.Convert(img.At(0, 0)).(color.NRGBA); c != officetest.MfRed {
		t.Errorf("top-left = %v, want red", c)
	}
	if c := color.NRGBAModel.Convert(img.At(3, 1)).(color.NRGBA); c != officetest.MfWhite {
		t.Errorf("bottom-right = %v, want white", c)
	}
	if _, err := DIBToPNG([]byte{1, 2, 3}); err == nil {
		t.Error("a truncated DIB should fail")
	}
}

func TestTIFFBecomesPNG(t *testing.T) {
	src := image.NewNRGBA(image.Rect(0, 0, 3, 3))
	src.Set(1, 1, color.NRGBA{0, 0, 255, 255})
	var buf bytes.Buffer
	if err := tiff.Encode(&buf, src, nil); err != nil {
		t.Fatal(err)
	}
	out, ext, ok := BrowserPicture(buf.Bytes(), "tiff")
	if !ok || ext != "png" {
		t.Fatalf("BrowserPicture(tiff) = %q, %v; want png", ext, ok)
	}
	img, err := png.Decode(bytes.NewReader(out))
	if err != nil {
		t.Fatalf("not a PNG: %v", err)
	}
	if c := color.NRGBAModel.Convert(img.At(1, 1)).(color.NRGBA); c.B != 255 || c.R != 0 {
		t.Errorf("centre pixel = %v, want blue", c)
	}
	if _, _, ok := BrowserPicture([]byte("not a tiff"), "tif"); ok {
		t.Error("a broken TIFF should report !ok")
	}
	// a format the browser draws passes through untouched
	pngIn := officetest.PngBytes(t)
	if out, ext, ok := BrowserPicture(pngIn, "png"); !ok || ext != "png" || !bytes.Equal(out, pngIn) {
		t.Error("PNG should pass through")
	}
}
