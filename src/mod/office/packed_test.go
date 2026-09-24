package office

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"io"
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

// A Docs body keeps its pictures inside one HTML string. Links in src and
// poster attributes are embedded; hyperlinks and unreadable files are not.
func TestPackEmbedsHTMLMediaLinks(t *testing.T) {
	body := `<h1>Hi</h1>` +
		`<p><img src="../../media?file=user%3A%2FPhoto%2Fcat.png" alt="cat"></p>` +
		`<p><img class="x" src='../../media?file=user:/Photo/cat.png&amp;nocache=1'></p>` +
		`<video poster="../../media?file=user%3A%2FPhoto%2Fdog.JPG"></video>` +
		`<a href="../../media?file=user%3A%2FDocs%2Fbig.zip">link</a>` +
		`<img src="../../media?file=user%3A%2Fsecret.png">` +
		`<img src="https://example.com/remote.png">` +
		`<p>ask about media?file=user:/x.png in text</p>`
	envelope, _ := json.Marshal(map[string]interface{}{
		"type": "arozos/office", "app": "document",
		"body": map[string]interface{}{"html": body},
	})

	reads := map[string]int{}
	readVpath := func(vp string) ([]byte, error) {
		reads[vp]++
		if vp == "user:/secret.png" {
			return nil, errors.New("read access denied")
		}
		return []byte("bytes of " + vp), nil
	}
	packed, err := PackEnvelope(string(envelope), readVpath)
	if err != nil {
		t.Fatalf("PackEnvelope: %v", err)
	}

	tests := []struct {
		name  string
		vpath string
		reads int
	}{
		{"same file read once for two links", "user:/Photo/cat.png", 1},
		{"poster embedded", "user:/Photo/dog.JPG", 1},
		{"href never read", "user:/Docs/big.zip", 0},
		{"unreadable file tried", "user:/secret.png", 1},
	}
	for _, tc := range tests {
		if got := reads[tc.vpath]; got != tc.reads {
			t.Errorf("%s: %s read %d times, want %d", tc.name, tc.vpath, got, tc.reads)
		}
	}

	// the stored document.json carries asset refs in the attributes
	doc := packedDocument(t, packed)
	if n := strings.Count(doc, "asset://"); n != 3 {
		t.Errorf("document.json has %d asset refs, want 3 (two cats + poster): %s", n, doc)
	}
	for _, keep := range []string{
		`href=\"../../media?file=user%3A%2FDocs%2Fbig.zip\"`,
		`src=\"../../media?file=user%3A%2Fsecret.png\"`,
		`src=\"https://example.com/remote.png\"`,
		`ask about media?file=user:/x.png in text`,
		`alt=\"cat\"`,
	} {
		if !strings.Contains(doc, keep) {
			t.Errorf("document.json lost %s: %s", keep, doc)
		}
	}

	// unpacking inlines them again, in place
	out, err := UnpackEnvelope(packed)
	if err != nil {
		t.Fatalf("UnpackEnvelope: %v", err)
	}
	if strings.Contains(out, "asset://") {
		t.Errorf("UnpackEnvelope left asset refs: %s", out)
	}
	if n := strings.Count(out, "data:image/png;base64,"); n != 2 {
		t.Errorf("UnpackEnvelope restored %d png data URLs, want 2", n)
	}
	if !strings.Contains(out, `poster=\"data:image/jpeg;base64,`) {
		t.Errorf("poster not restored as a jpeg data URL: %s", out)
	}

	// and the ArozOS load path turns them into cache links
	links, err := UnpackEnvelopeToLinks(packed,
		func(string, []byte) error { return nil },
		func(name string) string { return "../../media?file=cache%2F" + name })
	if err != nil {
		t.Fatalf("UnpackEnvelopeToLinks: %v", err)
	}
	if strings.Contains(links, "asset://") || strings.Count(links, "media?file=cache%2F") != 3 {
		t.Errorf("UnpackEnvelopeToLinks did not relink the attributes: %s", links)
	}
}

func TestResolveAssetRefs(t *testing.T) {
	known := map[string]string{"abc.png": "A", "x y.png": "SPACED"}
	resolve := func(name string) (string, bool) { v, ok := known[name]; return v, ok }
	tests := []struct{ in, want string }{
		{"asset://abc.png", "A"},
		{"asset://x y.png", "SPACED"}, // whole-string refs keep accepting any name
		{"asset://missing.png", "asset://missing.png"},
		{`<img src="asset://abc.png"><img src='asset://abc.png'>`, `<img src="A"><img src='A'>`},
		{`<img src="asset://missing.png">`, `<img src="asset://missing.png">`},
		{"no refs here", "no refs here"},
	}
	for _, tc := range tests {
		if got := resolveAssetRefs(tc.in, resolve); got != tc.want {
			t.Errorf("resolveAssetRefs(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestAssetExt(t *testing.T) {
	tests := []struct{ in, want string }{
		{"user:/a/cat.PNG", "png"},
		{"user:/a/clip.mp4", "mp4"},
		{"user:/a/noext", "bin"},
		{"user:/a/odd.j pg", "bin"},
		{"user:/a/x.verylongextension", "bin"},
	}
	for _, tc := range tests {
		if got := assetExt(tc.in); got != tc.want {
			t.Errorf("assetExt(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

// packedDocument reads document.json out of a container, as stored
func packedDocument(t *testing.T, packed []byte) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(packed), int64(len(packed)))
	if err != nil {
		t.Fatalf("container is not a zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name != packedDocName {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", f.Name, err)
		}
		defer rc.Close()
		b, err := io.ReadAll(rc)
		if err != nil {
			t.Fatalf("read %s: %v", f.Name, err)
		}
		return string(b)
	}
	t.Fatalf("container has no %s", packedDocName)
	return ""
}
