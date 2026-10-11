package media

import (
	"testing"

	"imuslab.com/arozos/mod/office/internal/officetest"
)

func TestDecodeDataURL(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		wantOk  bool
		wantExt string
	}{
		{"png", officetest.PngDataURL, true, "png"},
		{"jpeg", "data:image/jpeg;base64,aGVsbG8=", true, "jpeg"},
		{"not data url", "https://example.com/x.png", false, ""},
		{"no base64 marker", "data:image/png,rawdata", false, ""},
		{"bad base64", "data:image/png;base64,!!!!", false, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, ext, ok := DecodeDataURL(tc.in)
			if ok != tc.wantOk {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOk)
			}
			if ok && ext != tc.wantExt {
				t.Errorf("ext = %q, want %q", ext, tc.wantExt)
			}
		})
	}
}

func TestImageSrcBytes(t *testing.T) {
	png := officetest.PngBytes(t)
	read := func(vp string) ([]byte, error) {
		if vp == "user:/x.png" {
			return png, nil
		}
		return []byte("<svg/>"), nil
	}
	cases := []struct {
		src  string
		read func(string) ([]byte, error)
		ok   bool
	}{
		{officetest.PngDataURL, nil, true},
		{"../../media?file=user%3A%2Fx.png", read, true},
		{"../../media?file=user%3A%2Fx.png", nil, false},
		{"../../media?file=user%3A%2Fchart.svg", read, false},
		{"https://example.test/a.png", read, false},
	}
	for _, c := range cases {
		_, ext, ok := ImageSrcBytes(c.src, c.read)
		if ok != c.ok || (ok && ext != "png") {
			t.Errorf("imageSrcBytes(%q) = %s, %v", c.src, ext, ok)
		}
	}
}
