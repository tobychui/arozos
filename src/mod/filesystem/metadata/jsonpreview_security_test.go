package metadata

import (
	"bytes"
	"encoding/base64"
	"image"
	"image/color"
	"image/gif"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

/*
	The "_ao_preview" field is written by whoever wrote the file and its
	thumbnail is shown to everyone who can see the file, so these tests try
	to get active content (SVG, HTML, script) through it.
*/

func b64(s string) string {
	return base64.StdEncoding.EncodeToString([]byte(s))
}

func encodeGIF(t *testing.T) string {
	t.Helper()
	img := image.NewPaletted(image.Rect(0, 0, 2, 2), []color.Color{color.Black, color.White})
	var buf bytes.Buffer
	if err := gif.Encode(&buf, img, nil); err != nil {
		t.Fatalf("could not encode test gif: %v", err)
	}
	return base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestJSONPreviewRefusesActiveContent(t *testing.T) {
	svg := `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(document.cookie)"><script>alert(1)</script></svg>`
	html := `<!DOCTYPE html><html><body><script>fetch('/system/users/list')</script></body></html>`

	tests := []struct {
		name    string
		preview string
	}{
		{"svg data url", "data:image/svg+xml;base64," + b64(svg)},
		{"svg data url not base64", "data:image/svg+xml," + svg},
		{"svg as bare base64", b64(svg)},
		{"svg declared as png", "data:image/png;base64," + b64(svg)},
		{"html data url", "data:text/html;base64," + b64(html)},
		{"html declared as jpeg", "data:image/jpeg;base64," + b64(html)},
		{"html as bare base64", b64(html)},
		{"javascript url", "javascript:alert(document.cookie)"},
		{"remote url", "https://attacker.example/x.png"},
		{"xml data url", "data:application/xml;base64," + b64(svg)},
		{"gif is not accepted", "data:image/png;base64," + encodeGIF(t)},
		{"gif data url", "data:image/gif;base64," + encodeGIF(t)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			doc := `{"_ao_preview":` + jsonString(tt.preview) + `,"format":"aopart"}`
			data, err := extractJSONPreview(strings.NewReader(doc))
			if err != nil {
				return // refused before decoding
			}
			if img, err := decodePreviewImage(data); err == nil {
				t.Fatalf("payload was accepted as a %dx%d picture", img.Bounds().Dx(), img.Bounds().Dy())
			}
		})
	}
}

// jsonString quotes s as a JSON string (the payloads hold quotes)
func jsonString(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `"`, `\"`)
	return `"` + r.Replace(s) + `"`
}

func TestGenerateThumbnailForJSONPreviewReencodesPolyglot(t *testing.T) {
	//A real JPEG with an HTML page appended: a valid picture that is also a page
	jpg, err := base64.StdEncoding.DecodeString(encodeJPEG(t, 32, 24, color.RGBA{30, 120, 200, 255}))
	if err != nil {
		t.Fatalf("decode test jpeg: %v", err)
	}
	attack := []byte(`<html><script>alert(document.cookie)</script></html>`)
	polyglot := append(append([]byte{}, jpg...), attack...)

	fsh, dir := newTestFSH(t)
	cacheDir := filepath.Join(dir, "cache") + "/"
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	src := filepath.Join(dir, "Bracket.aopart")
	doc := `{"_ao_preview":"data:image/jpeg;base64,` + base64.StdEncoding.EncodeToString(polyglot) + `","format":"aopart"}`
	if err := os.WriteFile(src, []byte(doc), 0644); err != nil {
		t.Fatalf("write part: %v", err)
	}

	encoded, err := generateThumbnailForJSONPreview(fsh, cacheDir, src, false)
	if err != nil {
		t.Fatalf("generateThumbnailForJSONPreview: %v", err)
	}
	out, err := os.ReadFile(filepath.Join(cacheDir, "Bracket.aopart.jpg"))
	if err != nil {
		t.Fatalf("thumbnail cache file missing: %v", err)
	}
	if bytes.Contains(out, []byte("<script")) || bytes.Contains(out, []byte("<html")) {
		t.Error("the appended HTML survived into the thumbnail")
	}
	if bytes.Equal(out, polyglot) || bytes.Equal(out, jpg) {
		t.Error("the thumbnail is the uploaded bytes, not a new encoding")
	}
	if ct, ok := SafeThumbnailContentType(out); !ok || ct != "image/jpeg" {
		t.Errorf("thumbnail is sent as %q (ok %v), want image/jpeg", ct, ok)
	}
	if sent, _ := base64.StdEncoding.DecodeString(encoded); !bytes.Equal(sent, out) {
		t.Error("the returned thumbnail differs from the cached one")
	}
}

func TestGenerateThumbnailForJSONPreviewWritesNothingForSVG(t *testing.T) {
	fsh, dir := newTestFSH(t)
	cacheDir := filepath.Join(dir, "cache") + "/"
	if err := os.MkdirAll(cacheDir, 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	src := filepath.Join(dir, "Evil.aoasm")
	svg := `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`
	if err := os.WriteFile(src, []byte(`{"_ao_preview":"data:image/svg+xml;base64,`+b64(svg)+`"}`), 0644); err != nil {
		t.Fatalf("write assembly: %v", err)
	}
	if _, err := generateThumbnailForJSONPreview(fsh, cacheDir, src, false); err == nil {
		t.Fatal("an SVG preview produced a thumbnail")
	}
	if entries, _ := os.ReadDir(cacheDir); len(entries) != 0 {
		t.Errorf("the cache folder holds %d files, want none", len(entries))
	}
}

func TestSafeThumbnailContentType(t *testing.T) {
	jpg, _ := base64.StdEncoding.DecodeString(encodeJPEG(t, 4, 4, color.White))
	png, _ := base64.StdEncoding.DecodeString(encodePNG(t, 4, 4, color.White))
	gifData, _ := base64.StdEncoding.DecodeString(encodeGIF(t))

	tests := []struct {
		name   string
		data   []byte
		want   string
		wantOK bool
	}{
		{"jpeg", jpg, "image/jpeg", true},
		{"png", png, "image/png", true},
		{"gif", gifData, "image/gif", true},
		{"html put into the cache by hand", []byte("<!DOCTYPE html><script>alert(1)</script>"), "", false},
		{"html without doctype", []byte("<html><body onload=alert(1)>"), "", false},
		{"svg", []byte(`<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`), "", false},
		{"svg without xml header", []byte(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>`), "", false},
		{"script text", []byte("alert(document.cookie)"), "", false},
		{"pdf", []byte("%PDF-1.7\n"), "", false},
		{"empty", nil, "", false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, ok := SafeThumbnailContentType(tt.data)
			if ok != tt.wantOK || got != tt.want {
				t.Errorf("SafeThumbnailContentType = %q, %v; want %q, %v", got, ok, tt.want, tt.wantOK)
			}
		})
	}
}
