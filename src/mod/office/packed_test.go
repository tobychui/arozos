package office

import (
	"strings"
	"testing"
)

func TestPackUnpackRoundtrip(t *testing.T) {
	envelope := `{"type":"arozos/office","app":"presentation","body":{"slides":[` +
		`{"objects":[{"type":"image","props":{"src":"` + testPngDataURL + `"}},` +
		`{"type":"image","props":{"src":"` + testPngDataURL + `"}},` +
		`{"type":"image","props":{"src":"../media?file=user%3A%2FPhoto%2Fcat.png"}},` +
		`{"type":"text","props":{"html":"hello data: not a url"}}]}]}}`

	reads := []string{}
	readVpath := func(vp string) ([]byte, error) {
		reads = append(reads, vp)
		return []byte("fake-image-bytes"), nil
	}

	packed, err := PackEnvelope(envelope, readVpath)
	if err != nil {
		t.Fatalf("PackEnvelope: %v", err)
	}
	if packed[0] != 'P' || packed[1] != 'K' {
		t.Fatalf("packed output is not a zip")
	}
	if len(reads) != 1 || reads[0] != "user:/Photo/cat.png" {
		t.Errorf("media link vpath resolution = %v, want [user:/Photo/cat.png]", reads)
	}

	// the packed json must not contain base64 blobs or media links
	mid, err := UnpackEnvelope(packed)
	if err != nil {
		t.Fatalf("UnpackEnvelope: %v", err)
	}
	if strings.Contains(mid, "asset://") {
		t.Errorf("unpacked JSON still contains asset refs")
	}
	if !strings.Contains(mid, "data:image/png;base64,") {
		t.Errorf("image data URL not restored")
	}
	if !strings.Contains(mid, "hello data: not a url") {
		t.Errorf("plain text mangled: %.200s", mid)
	}
	// media link became an embedded asset (portable)
	if strings.Contains(mid, "media?file=") {
		t.Errorf("legacy media link not embedded")
	}
}

func TestPackDedupe(t *testing.T) {
	envelope := `{"a":"` + testPngDataURL + `","b":"` + testPngDataURL + `"}`
	packed, err := PackEnvelope(envelope, nil)
	if err != nil {
		t.Fatalf("PackEnvelope: %v", err)
	}
	// identical media stored once: zip smaller than 2x the image
	if n := strings.Count(string(packed), "assets/"); n != 2 { // local + central dir entry
		t.Errorf("expected exactly 1 asset (2 zip mentions), got %d mentions", n)
	}
}

func TestUnpackEnvelopeToLinks(t *testing.T) {
	envelope := `{"app":"presentation","body":{"src":"` + testPngDataURL + `","txt":"plain"}}`
	packed, err := PackEnvelope(envelope, nil)
	if err != nil {
		t.Fatalf("PackEnvelope: %v", err)
	}
	saved := map[string][]byte{}
	out, err := UnpackEnvelopeToLinks(packed,
		func(name string, content []byte) error {
			saved[name] = content
			return nil
		},
		func(name string) string {
			return "../../media?file=user%3A%2F.appdata%2FOffice%2Fcache%2Fabc%2F" + name
		})
	if err != nil {
		t.Fatalf("UnpackEnvelopeToLinks: %v", err)
	}
	if len(saved) != 1 {
		t.Fatalf("expected 1 asset written, got %d", len(saved))
	}
	if strings.Contains(out, "data:image") || strings.Contains(out, "asset://") {
		t.Errorf("asset ref not rewritten to link: %.200s", out)
	}
	if !strings.Contains(out, "media?file=user%3A%2F.appdata") {
		t.Errorf("media link missing: %.200s", out)
	}
	if !strings.Contains(out, `"txt":"plain"`) {
		t.Errorf("plain values mangled: %.200s", out)
	}
	// legacy passthrough
	legacy := `{"a":1}`
	got, err := UnpackEnvelopeToLinks([]byte(legacy), nil, nil)
	if err != nil || got != legacy {
		t.Errorf("legacy passthrough broken: %q %v", got, err)
	}
}

func TestUnpackLegacyPassthrough(t *testing.T) {
	legacy := `{"type":"arozos/office","app":"document","body":{"html":"<p>old file</p>"}}`
	out, err := UnpackEnvelope([]byte(legacy))
	if err != nil {
		t.Fatalf("UnpackEnvelope legacy: %v", err)
	}
	if out != legacy {
		t.Errorf("legacy JSON must pass through unchanged")
	}
}

func TestPackErrors(t *testing.T) {
	if _, err := PackEnvelope("{not json", nil); err == nil {
		t.Errorf("invalid json: expected error")
	}
	if _, err := UnpackEnvelope([]byte("PK\x03\x04 garbage")); err == nil {
		t.Errorf("corrupt zip: expected error")
	}
}

func TestMediaLinkVpath(t *testing.T) {
	tests := []struct{ in, want string }{
		{"../media?file=user:/x.png", "user:/x.png"},
		{"../../media?file=user%3A%2Fa%20b.jpg", "user:/a b.jpg"},
		{"media/download/?file=user:/v.mp4", "user:/v.mp4"},
		{"https://example.com/x.png", ""},
		{"plain text", ""},
	}
	for _, tc := range tests {
		if got := mediaLinkVpath(tc.in); got != tc.want {
			t.Errorf("mediaLinkVpath(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}
