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

func envelopeOf(app, body string) string {
	return `{"type":"arozos/office","app":"` + app + `","version":1,` +
		`"meta":{"title":"Saved by the suite","revision":3},"body":` + body + `}`
}

// rezip copies a package, letting mutate replace (or, returning nil, drop)
// any part - what an office application re-saving the file amounts to
func rezip(t *testing.T, data []byte, mutate func(name string, b []byte) []byte) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	out := new(bytes.Buffer)
	zw := zip.NewWriter(out)
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("open %s: %v", f.Name, err)
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		if mutate != nil {
			b = mutate(f.Name, b)
		}
		if b == nil {
			continue
		}
		w, _ := zw.Create(f.Name)
		w.Write(b)
	}
	zw.Close()
	return out.Bytes()
}

func envMeta(t *testing.T, env string) map[string]interface{} {
	t.Helper()
	var e struct {
		Type string                 `json:"type"`
		App  string                 `json:"app"`
		Meta map[string]interface{} `json:"meta"`
	}
	if err := json.Unmarshal([]byte(env), &e); err != nil {
		t.Fatalf("not an envelope: %v\n%.300s", err, env)
	}
	if e.Type != "arozos/office" {
		t.Fatalf("envelope type = %q", e.Type)
	}
	return e.Meta
}

func TestNativeRoundTripEachApp(t *testing.T) {
	cases := []struct {
		app, body, want string
		parse           func([]byte) error
	}{
		{AppDocument, `{"html":"<p>Hello <b>embedded</b> world</p>","trackChanges":true,"comments":[]}`, "embedded",
			func(b []byte) error { _, err := ParseDocx(b); return err }},
		{AppSpreadsheet, `{"active":0,"sheets":[{"name":"S","cells":{"A1":{"v":"=1+1"}},"pivot":{"agg":"sum"}}]}`, `"pivot"`,
			func(b []byte) error { _, err := ParseXlsx(b); return err }},
		{AppPresentation, `{"slides":[{"id":"s1","transition":"fade","objects":[{"type":"text","x":1,"y":1,"w":9,"h":9,"props":{"html":"<div>Hi</div>","anim":"zoom"}}]}]}`, `"anim":"zoom"`,
			func(b []byte) error { _, err := ParsePptx(b); return err }},
	}
	for _, c := range cases {
		t.Run(c.app, func(t *testing.T) {
			file, err := BuildNativeFile(c.app, envelopeOf(c.app, c.body), nil)
			if err != nil {
				t.Fatalf("BuildNativeFile: %v", err)
			}
			// it is still an ordinary Office file
			if err := c.parse(file); err != nil {
				t.Fatalf("the OOXML readers reject our own file: %v", err)
			}
			if !HasEmbeddedDocument(c.app, file) {
				t.Fatalf("no current embedded document")
			}
			env, err := ReadNativeFile(c.app, file, nil)
			if err != nil {
				t.Fatalf("ReadNativeFile: %v", err)
			}
			if m := envMeta(t, env); m["title"] != "Saved by the suite" {
				t.Errorf("meta not restored from the embedded copy: %v", m)
			}
			// the embedded copy keeps what OOXML cannot: pivot settings, animations
			if !strings.Contains(env, c.want) {
				t.Errorf("editor-only content lost: want %s in %.400s", c.want, env)
			}
		})
	}
}

func TestNativePackageIsWellFormed(t *testing.T) {
	file, err := BuildNativeFile(AppDocument, envelopeOf(AppDocument, `{"html":"<p>x</p>"}`), nil)
	if err != nil {
		t.Fatal(err)
	}
	parts := unzipParts(t, file)
	for _, want := range []string{nativeDocPart, nativeManifestPart, nativeDocRels, "word/document.xml"} {
		if _, ok := parts[want]; !ok {
			t.Errorf("missing part %s", want)
		}
	}
	if !strings.Contains(parts["[Content_Types].xml"], `PartName="/arozos/document.json" ContentType="application/json"`) {
		t.Errorf("document part has no content type:\n%s", parts["[Content_Types].xml"])
	}
	rels := parts["_rels/.rels"]
	if !strings.Contains(rels, nativeRelDocument) || !strings.Contains(rels, "officeDocument") {
		t.Errorf("root rels must keep the office document and add ours:\n%s", rels)
	}
	// deterministic: the same document saves to the same bytes
	again, _ := BuildNativeFile(AppDocument, envelopeOf(AppDocument, `{"html":"<p>x</p>"}`), nil)
	if !bytes.Equal(file, again) {
		t.Errorf("saving the same document twice gave different files")
	}
}

func TestNativeEditedElsewhereIsImported(t *testing.T) {
	file, err := BuildNativeFile(AppDocument, envelopeOf(AppDocument, `{"html":"<p>Original text</p>"}`), nil)
	if err != nil {
		t.Fatal(err)
	}
	// Word re-saves: the text changes, our parts may even survive
	edited := rezip(t, file, func(name string, b []byte) []byte {
		if name == "word/document.xml" {
			return bytes.Replace(b, []byte("Original text"), []byte("Changed in Word"), 1)
		}
		return b
	})
	if HasEmbeddedDocument(AppDocument, edited) {
		t.Fatalf("a stale embedded copy was still trusted")
	}
	env, err := ReadNativeFile(AppDocument, edited, nil)
	if err != nil {
		t.Fatalf("ReadNativeFile: %v", err)
	}
	if !strings.Contains(env, "Changed in Word") || strings.Contains(env, "Original text") {
		t.Errorf("the OOXML edit did not win: %.300s", env)
	}
	if m := envMeta(t, env); m["title"] != nil {
		t.Errorf("an imported file should carry fresh meta, got %v", m)
	}

	// a part added by another program also invalidates the copy
	zr, _ := zip.NewReader(bytes.NewReader(file), int64(len(file)))
	out := new(bytes.Buffer)
	zw := zip.NewWriter(out)
	for _, f := range zr.File {
		zw.Copy(f)
	}
	w, _ := zw.Create("docProps/custom.xml")
	w.Write([]byte("<x/>"))
	zw.Close()
	if HasEmbeddedDocument(AppDocument, out.Bytes()) {
		t.Errorf("an added part did not invalidate the embedded copy")
	}
}

func TestNativeForeignFileImports(t *testing.T) {
	// a plain .docx as any other program writes it
	plain, err := BuildDocx(&Document{HTML: "<p>From Word</p>"})
	if err != nil {
		t.Fatal(err)
	}
	env, err := ReadNativeFile(AppDocument, plain, nil)
	if err != nil {
		t.Fatalf("ReadNativeFile: %v", err)
	}
	if !strings.Contains(env, `"app":"document"`) || !strings.Contains(env, "From Word") {
		t.Errorf("import envelope wrong: %.300s", env)
	}
}

func TestNativeRejectsMismatches(t *testing.T) {
	cases := []struct {
		name, app, envelope string
	}{
		{"wrong app", AppSpreadsheet, envelopeOf(AppDocument, `{"html":""}`)},
		{"not an envelope", AppDocument, `{"html":"<p>x</p>"}`},
		{"no body", AppDocument, `{"type":"arozos/office","app":"document"}`},
		{"not json", AppDocument, `<p>`},
		{"unknown app", "drawing", `{"type":"arozos/office","app":"drawing","body":{}}`},
	}
	for _, c := range cases {
		if _, err := BuildNativeFile(c.app, c.envelope, nil); err == nil {
			t.Errorf("%s: expected an error", c.name)
		}
	}
	if _, err := ReadNativeFile(AppDocument, []byte("not a zip"), nil); err == nil {
		t.Errorf("garbage input read without error")
	}
	// a .xlsx is not a document: the manifest names its app
	x, _ := BuildNativeFile(AppSpreadsheet, envelopeOf(AppSpreadsheet, `{"sheets":[{"name":"S","cells":{}}]}`), nil)
	if HasEmbeddedDocument(AppDocument, x) {
		t.Errorf("a spreadsheet's copy was accepted as a document")
	}
}

func TestNativeMediaSharedWithOOXML(t *testing.T) {
	png := pngBytes(t)
	reads := 0
	read := func(vp string) ([]byte, error) {
		reads++
		if vp == "user:/Photo/cat.png" {
			return png, nil
		}
		return nil, errors.New("no such file")
	}
	body := `{"html":"<p><img src=\"../../media?file=user%3A%2FPhoto%2Fcat.png\" style=\"width: 20pt\"></p>` +
		`<p><img src=\"../../media?file=user%3A%2FPhoto%2Fcat.png\"></p>"}`
	file, err := BuildNativeFile(AppDocument, envelopeOf(AppDocument, body), read)
	if err != nil {
		t.Fatalf("BuildNativeFile: %v", err)
	}
	if reads != 1 {
		t.Errorf("the picture was read %d times, want once", reads)
	}
	parts := unzipParts(t, file)
	media := 0
	for name := range parts {
		if strings.HasPrefix(name, "word/media/") {
			media++
		}
		if strings.HasPrefix(name, nativeAssetDir) {
			t.Errorf("picture stored twice: %s", name)
		}
	}
	if media != 1 {
		t.Errorf("word/media holds %d pictures, want 1 (deduplicated)", media)
	}
	if !strings.Contains(parts["word/document.xml"], "<w:drawing>") {
		t.Errorf("linked picture not written into the docx")
	}

	// reading back: the sink receives the bytes and its link lands in the body
	var got []byte
	env, err := ReadNativeFile(AppDocument, file, func(name string, data []byte) (string, error) {
		got = data
		return "LINK/" + name, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(got, png) {
		t.Errorf("the sink did not receive the picture")
	}
	if !strings.Contains(env, `src=\"LINK/`) || strings.Contains(env, "asset://") {
		t.Errorf("asset refs not resolved to sink links: %.400s", env)
	}
	// without a sink the picture comes back inline
	env, _ = ReadNativeFile(AppDocument, file, nil)
	if !strings.Contains(env, "data:image/png;base64,") {
		t.Errorf("no data URL without a sink: %.300s", env)
	}
}

func TestNativeKeepsVideoInEmbeddedCopy(t *testing.T) {
	video := []byte("not really an mp4 but bytes all the same")
	read := func(vp string) ([]byte, error) { return video, nil }
	body := `{"slides":[{"id":"s1","objects":[{"type":"video","x":1,"y":1,"w":90,"h":50,` +
		`"props":{"src":"../../media?file=user%3A%2FVideo%2Fclip.mp4"}}]}]}`
	file, err := BuildNativeFile(AppPresentation, envelopeOf(AppPresentation, body), read)
	if err != nil {
		t.Fatal(err)
	}
	var found bool
	for name, data := range unzipParts(t, file) {
		if strings.HasPrefix(name, nativeAssetDir) && strings.HasSuffix(name, ".mp4") && data == string(video) {
			found = true
		}
	}
	if !found {
		t.Errorf("the video is not in the package")
	}
}

func TestExternalizeDataURLs(t *testing.T) {
	body := `{"html":"<p><img src=\"` + testPngDataURL + `\"> text data: stays</p>","src":"` + testPngDataURL +
		`","font":"data:font/ttf;base64,AAAA"}`
	n := 0
	out, err := externalizeDataURLs(body, func(name string, data []byte) (string, error) {
		n++
		if !strings.HasSuffix(name, ".png") {
			t.Errorf("asset name %q lost its extension", name)
		}
		return "../../media?file=x/" + name, nil
	})
	if err != nil {
		t.Fatal(err)
	}
	if n != 1 {
		t.Errorf("the same picture was written %d times", n)
	}
	if strings.Contains(out, "data:image/png") {
		t.Errorf("picture still inline: %s", out)
	}
	if !strings.Contains(out, "data:font/ttf") {
		t.Errorf("a font must stay inline: %s", out)
	}
	if !strings.Contains(out, "text data: stays") {
		t.Errorf("text mangled: %s", out)
	}
}

func TestAppForExt(t *testing.T) {
	cases := map[string]string{".docx": AppDocument, ".XLSX": AppSpreadsheet, ".pptx": AppPresentation, ".doca": "", ".odt": ""}
	for ext, want := range cases {
		if got := AppForExt(ext); got != want {
			t.Errorf("AppForExt(%q) = %q, want %q", ext, got, want)
		}
		if want != "" && AppForExt(ExtForApp(want)) != want {
			t.Errorf("ExtForApp(%q) does not map back", want)
		}
	}
}

func pngBytes(t *testing.T) []byte {
	t.Helper()
	b, _, ok := decodeDataURL(testPngDataURL)
	if !ok {
		t.Fatal("test picture does not decode")
	}
	return b
}

// Office refuses a package with a part it has no content type for, so
// every part of every file the suite writes must be covered by a Default
// (by extension) or an Override (by name)
func TestNativeEveryPartHasAContentType(t *testing.T) {
	video := []byte("fake video")
	read := func(vp string) ([]byte, error) {
		if strings.HasSuffix(vp, ".mp4") {
			return video, nil
		}
		return pngBytes(t), nil
	}
	docs := map[string]string{
		AppDocument: `{"html":"<p><img src=\"../../media?file=user%3A%2Fa.png\"><span class=\"doc-cmt\" data-cid=\"c\">x</span></p>",` +
			`"comments":[{"id":"c","text":"t","resolved":true}]}`,
		AppSpreadsheet: `{"sheets":[{"name":"S","cells":{"A1":{"v":"1","n":"note","cf":["r"]}},` +
			`"cfDefs":{"r":{"anchor":"A1","type":"gt","v1":"0","style":{"bg":"#ff0000"}}},` +
			`"charts":[{"id":"c1","x":0,"y":0,"w":300,"h":200,"range":"A1:A1","opts":{"type":"bar"}}]}]}`,
		AppPresentation: `{"slides":[{"objects":[{"type":"image","w":9,"h":9,"props":{"src":"../../media?file=user%3A%2Fa.png"}},` +
			`{"type":"video","w":9,"h":9,"props":{"src":"../../media?file=user%3A%2Fv.mp4"}}]}]}`,
	}
	for app, body := range docs {
		file, err := BuildNativeFile(app, envelopeOf(app, body), read)
		if err != nil {
			t.Fatalf("%s: %v", app, err)
		}
		parts := unzipParts(t, file)
		ct := parts["[Content_Types].xml"]
		for name := range parts {
			if name == "[Content_Types].xml" {
				continue
			}
			ext := name[strings.LastIndex(name, ".")+1:]
			if !strings.Contains(ct, `PartName="/`+name+`"`) && !strings.Contains(ct, `Extension="`+ext+`"`) {
				t.Errorf("%s: part %s has no content type", app, name)
			}
		}
	}
}
