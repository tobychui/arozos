package office

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

func sampleDocument() *Document {
	return &Document{
		HTML: `<h1 class="doc-title col-span-all">My Report</h1>` +
			`<p class="col-span-all" style="text-align:center;">A. Author, B. Author</p>` +
			`<h2>Section &amp; Chapter</h2>` +
			`<p style="text-align:center;">Some <b>bold</b> and <i>italic</i> and ` +
			`<span style="color:#cc0000;font-size:20px;">styled</span> text</p>` +
			`<p>A <a href="https://example.com/x?a=1">link</a> here<br>second line</p>` +
			`<ul><li>alpha</li><li>beta</li></ul>` +
			`<ol><li>one</li><li>two</li></ol>` +
			`<blockquote>quoted wisdom</blockquote>` +
			`<pre>code line 1` + "\n" + `code line 2</pre>` +
			`<table><tr><th>H1</th><th>H2</th></tr><tr><td>a</td><td>b</td></tr></table>` +
			`<p><img src="` + testPngDataURL + `" style="width:200px;height:100px;"></p>` +
			`<hr><p>end</p>`,
		Page: &PageConf{
			Size: "Letter", Orientation: "landscape",
			Margins: &MarginsMM{Top: 20, Right: 15, Bottom: 20, Left: 15},
			Columns: 2, ColGap: 5,
		},
		Header:      "Confidential",
		Footer:      "ArozOS Docs",
		PageNumbers: true,
	}
}

func TestBuildDocxStructure(t *testing.T) {
	data, err := BuildDocx(sampleDocument())
	if err != nil {
		t.Fatalf("BuildDocx failed: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("output is not a valid zip: %v", err)
	}
	want := []string{
		"[Content_Types].xml", "_rels/.rels",
		"word/document.xml", "word/_rels/document.xml.rels",
		"word/styles.xml", "word/numbering.xml",
		"word/header1.xml", "word/footer1.xml",
		"word/media/image1.png",
	}
	have := map[string]bool{}
	for _, f := range zr.File {
		have[f.Name] = true
	}
	for _, p := range want {
		if !have[p] {
			t.Errorf("missing expected docx part: %s", p)
		}
	}
}

func TestParseDocxInvalid(t *testing.T) {
	if _, err := ParseDocx([]byte("garbage")); err == nil {
		t.Errorf("garbage: expected error")
	}
	doc97 := append([]byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}, make([]byte, 32)...)
	if _, err := ParseDocx(doc97); err == nil || !strings.Contains(err.Error(), ".doc") {
		t.Errorf("legacy doc: want specific error, got %v", err)
	}
}

func TestDocxRoundtrip(t *testing.T) {
	src := sampleDocument()
	data, err := BuildDocx(src)
	if err != nil {
		t.Fatalf("BuildDocx failed: %v", err)
	}
	got, err := ParseDocx(data)
	if err != nil {
		t.Fatalf("ParseDocx failed on own output: %v", err)
	}
	h := got.HTML

	checks := []struct {
		name, want string
	}{
		{"title", "doc-title"},
		{"title text", "My Report"},
		{"heading", "<h2>Section &amp; Chapter</h2>"},
		{"bold", "<b>bold</b>"},
		{"italic", "<i>italic</i>"},
		{"color+size", "color:#cc0000"},
		{"font size", "font-size:20px"},
		{"center align", "text-align:center"},
		{"link", `href="https://example.com/x?a=1"`},
		{"line break", "<br>"},
		{"bullet list", "<ul><li>alpha</li><li>beta</li></ul>"},
		{"numbered list", "<ol><li>one</li><li>two</li></ol>"},
		{"blockquote", "<blockquote>"},
		{"quote text", "quoted wisdom"},
		{"code text", "code line 1"},
		{"table cell", "<td>a</td>"},
		{"table header bold", "<b>H1</b>"},
		{"image", `<img src="data:image/png;base64,`},
		{"image width", "width:200px"},
		{"end text", "end"},
	}
	for _, c := range checks {
		if !strings.Contains(h, c.want) {
			t.Errorf("%s lost in roundtrip (want substring %q)\nhtml: %.600s", c.name, c.want, h)
		}
	}

	if got.Page == nil || got.Page.Size != "Letter" || got.Page.Orientation != "landscape" {
		t.Errorf("page conf = %+v, want Letter landscape", got.Page)
	}
	if got.Page != nil && got.Page.Columns != 2 {
		t.Errorf("columns = %d, want 2", got.Page.Columns)
	}
	if got.Page != nil && (got.Page.ColGap < 4.5 || got.Page.ColGap > 5.5) {
		t.Errorf("colGap = %v, want ~5", got.Page.ColGap)
	}
	// spanning title blocks survive as a leading single-column section
	if !strings.Contains(h, "col-span-all") {
		t.Errorf("col-span-all class lost in roundtrip")
	}
	if strings.Count(h, "col-span-all") != 2 {
		t.Errorf("expected exactly 2 spanning blocks, html: %.300s", h)
	}
	if got.Page != nil && got.Page.Margins != nil {
		if got.Page.Margins.Top < 19 || got.Page.Margins.Top > 21 {
			t.Errorf("top margin = %v, want ~20", got.Page.Margins.Top)
		}
	}
	if got.Header != "Confidential" {
		t.Errorf("header = %q, want Confidential", got.Header)
	}
	if !strings.Contains(got.Footer, "ArozOS Docs") {
		t.Errorf("footer = %q, want to contain ArozOS Docs", got.Footer)
	}
	if !got.PageNumbers {
		t.Errorf("pageNumbers flag lost")
	}
}

func TestParseDocumentJSON(t *testing.T) {
	if _, err := ParseDocumentJSON(`{"html":"<p>x</p>"}`); err != nil {
		t.Errorf("valid doc: %v", err)
	}
	if _, err := ParseDocumentJSON(`{bad`); err == nil {
		t.Errorf("invalid json: expected error")
	}
}

func TestPageUnitHelpers(t *testing.T) {
	if tw := mmToTwips(25.4); tw != 1440 {
		t.Errorf("mmToTwips(25.4) = %d, want 1440", tw)
	}
	if mm := twipsToMm(1440); mm < 25.3 || mm > 25.5 {
		t.Errorf("twipsToMm(1440) = %v, want 25.4", mm)
	}
	if hp := pxToHalfPoints(16); hp != 24 {
		t.Errorf("pxToHalfPoints(16) = %d, want 24", hp)
	}
}
