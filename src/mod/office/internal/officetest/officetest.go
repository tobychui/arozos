// Package officetest holds fixtures the tests of several office packages
// share: small pictures, zip helpers and WMF / EMF builders. It is only
// imported from _test.go files.
package officetest

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/png"
	"io"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/info/logger"
)

// tiny real PNG with a known non-4:3 aspect (100x25)
func MakePngDataURL(t *testing.T, w, h int) string {
	if logger.IsDebug() {
		logger.Debugf("office/internal/officetest", "MakePngDataURL: w=%d h=%d", w, h)
	}
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{R: 200, G: 30, B: 30, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png encode: %v", err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func PngBytes(t *testing.T) []byte {
	logger.Debug("office/internal/officetest", "PngBytes")
	t.Helper()
	b, err := base64.StdEncoding.DecodeString(strings.SplitN(PngDataURL, ",", 2)[1])
	if err != nil {
		t.Fatal("test picture does not decode")
	}
	return b
}

// 1x1 red PNG for image round-trip tests
const PngDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

// unzipParts reads every text part of a docx/odt package
func UnzipParts(t *testing.T, data []byte) map[string]string {
	logger.Debug("office/internal/officetest", "UnzipParts")
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("output is not a valid zip: %v", err)
	}
	out := map[string]string{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			continue
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		out[f.Name] = string(b)
	}
	return out
}

func ZipPart(t *testing.T, data []byte, name string) []byte {
	if logger.IsDebug() {
		logger.Debugf("office/internal/officetest", "ZipPart: name=%.120q", name)
	}
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("output is not a zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name == name {
			rc, err := f.Open()
			if err != nil {
				t.Fatalf("open %s: %v", name, err)
			}
			defer rc.Close()
			b, err := io.ReadAll(rc)
			if err != nil {
				t.Fatalf("read %s: %v", name, err)
			}
			return b
		}
	}
	return nil
}
