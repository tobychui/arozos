package service

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

// pngDataURL renders a w x h PNG as a data URL
func pngDataURL(t *testing.T, w int, h int) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	img.Set(0, 0, color.RGBA{R: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("unable to encode test png: %v", err)
	}
	return pngDataURLPrefix + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestDecodeCustomIcon(t *testing.T) {
	var jpgBuf bytes.Buffer
	if err := jpeg.Encode(&jpgBuf, image.NewRGBA(image.Rect(0, 0, 64, 64)), nil); err != nil {
		t.Fatalf("unable to encode test jpeg: %v", err)
	}

	tests := []struct {
		name    string
		input   string
		wantErr string
	}{
		{"valid 128", pngDataURL(t, 128, 128), ""},
		{"valid min size", pngDataURL(t, minCustomIconSize, minCustomIconSize), ""},
		{"valid max size", pngDataURL(t, maxCustomIconSize, maxCustomIconSize), ""},
		{"not square", pngDataURL(t, 128, 64), "square"},
		{"too small", pngDataURL(t, 8, 8), "range"},
		{"too large", pngDataURL(t, 600, 600), "range"},
		{"jpeg with png prefix", pngDataURLPrefix + base64.StdEncoding.EncodeToString(jpgBuf.Bytes()), "corrupted"},
		{"jpeg data url", "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(jpgBuf.Bytes()), "PNG"},
		{"bad base64", pngDataURLPrefix + "!!!", "corrupted"},
		{"plain path", "img/icon.png", "PNG"},
		{"oversized payload", pngDataURLPrefix + strings.Repeat("A", maxCustomIconBytes*2), "too large"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := decodeCustomIcon(tc.input)
			if tc.wantErr != "" {
				if err == nil || !strings.Contains(err.Error(), tc.wantErr) {
					t.Fatalf("decodeCustomIcon error = %v, want one containing %q", err, tc.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("decodeCustomIcon returned unexpected error: %v", err)
			}
			if _, err := png.Decode(bytes.NewReader(got)); err != nil {
				t.Errorf("re-encoded icon is not a valid png: %v", err)
			}
		})
	}
}

func TestCustomIconFilename(t *testing.T) {
	a := customIconFilename([]byte("a"))
	b := customIconFilename([]byte("b"))
	tests := []struct {
		name string
		got  string
		want string
	}{
		{"stable", customIconFilename([]byte("a")), a},
		{"png extension", a[len(a)-4:], ".png"},
		{"hash length", a[:len(a)-4], a[:16]},
	}
	for _, tc := range tests {
		if tc.got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, tc.got, tc.want)
		}
	}
	if a == b {
		t.Errorf("different content produced the same name %q", a)
	}
}

func TestCustomIconVpathAndMediaURL(t *testing.T) {
	tests := []struct {
		shortcut  string
		wantVpath string
		wantURL   string
	}{
		{"user:/Desktop/App.shortcut", "user:/Desktop/.metadata/.sc_icon/x.png", "media/?file=user%3A%2FDesktop%2F.metadata%2F.sc_icon%2Fx.png"},
		{"user:/My Links/Site.shortcut", "user:/My Links/.metadata/.sc_icon/x.png", "media/?file=user%3A%2FMy+Links%2F.metadata%2F.sc_icon%2Fx.png"},
	}
	for _, tc := range tests {
		vpath := customIconVpath(tc.shortcut, "x.png")
		if vpath != tc.wantVpath {
			t.Errorf("customIconVpath(%q) = %q, want %q", tc.shortcut, vpath, tc.wantVpath)
		}
		if got := mediaURL(vpath); got != tc.wantURL {
			t.Errorf("mediaURL(%q) = %q, want %q", vpath, got, tc.wantURL)
		}
	}
}
