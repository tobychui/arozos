package mediaserver

import (
	"encoding/binary"
	"image/jpeg"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

// writeRawDNG writes a DNG holding only grey sensor data, no preview
func writeRawDNG(t *testing.T, path string, width, height int) {
	t.Helper()
	const entries = 10
	le := binary.LittleEndian
	dataOffset := uint32(8 + 2 + entries*12 + 4)

	out := []byte("II*\x00\x08\x00\x00\x00")
	out = le.AppendUint16(out, entries)
	for _, e := range [entries][4]uint32{
		{256, 4, 1, uint32(width)},
		{257, 4, 1, uint32(height)},
		{258, 3, 1, 16},
		{259, 3, 1, 1},
		{262, 3, 1, 32803},
		{273, 4, 1, dataOffset},
		{279, 4, 1, uint32(width * height * 2)},
		{33421, 3, 2, 0x00020002},
		{33422, 1, 4, 0x02010100},
		{50706, 1, 4, 0x00000401},
	} {
		out = le.AppendUint16(out, uint16(e[0]))
		out = le.AppendUint16(out, uint16(e[1]))
		out = le.AppendUint32(out, e[2])
		out = le.AppendUint32(out, e[3])
	}
	out = le.AppendUint32(out, 0)
	for i := 0; i < width*height; i++ {
		out = le.AppendUint16(out, 2000)
	}
	if err := os.WriteFile(path, out, 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
}

func TestServeRAWAsJPEG(t *testing.T) {
	srv, fsh, dir := newHEICTestServer(t)
	src := filepath.Join(dir, "IMG_0001.DNG")
	writeRawDNG(t, src, 64, 48)
	broken := filepath.Join(dir, "broken.dng")
	os.WriteFile(broken, []byte("not a picture"), 0644)

	rec := httptest.NewRecorder()
	if !srv.serveRAWAsJPEG(rec, httptest.NewRequest("GET", "/media?file=x", nil), fsh, src) {
		t.Fatal("DNG was not served")
	}
	if ct := rec.Header().Get("Content-Type"); ct != "image/jpeg" {
		t.Errorf("Content-Type = %q, want image/jpeg", ct)
	}
	img, err := jpeg.Decode(rec.Body)
	if err != nil {
		t.Fatalf("body is not a JPEG: %v", err)
	}
	if img.Bounds().Dx() != 64 || img.Bounds().Dy() != 48 {
		t.Errorf("size = %v, want 64x48", img.Bounds())
	}
	etag := rec.Header().Get("ETag")
	if etag == "" {
		t.Fatal("expected an ETag")
	}

	tests := []struct {
		name    string
		file    string
		etag    string
		handled bool
		want    int
	}{
		{"same version is not rendered again", src, etag, true, http.StatusNotModified},
		{"stale tag gets the picture", src, `"0-0"`, true, http.StatusOK},
		{"unrenderable file is left to the caller", broken, "", false, http.StatusOK},
	}
	for _, tc := range tests {
		req := httptest.NewRequest("GET", "/media?file=x", nil)
		if tc.etag != "" {
			req.Header.Set("If-None-Match", tc.etag)
		}
		rec := httptest.NewRecorder()
		if handled := srv.serveRAWAsJPEG(rec, req, fsh, tc.file); handled != tc.handled {
			t.Errorf("%s: handled = %v, want %v", tc.name, handled, tc.handled)
		}
		if rec.Code != tc.want {
			t.Errorf("%s: status = %d, want %d", tc.name, rec.Code, tc.want)
		}
		if !tc.handled && (rec.Body.Len() != 0 || rec.Header().Get("ETag") != "") {
			t.Errorf("%s: something was written", tc.name)
		}
	}
}
