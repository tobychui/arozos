package office

import (
	"archive/zip"
	"bytes"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
)

const wNS = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
	`xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
	`xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" ` +
	`xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
	`xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`

// testDocx zips a minimal package: the body XML plus any extra parts
func testDocx(t *testing.T, body string, parts map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	all := map[string]string{
		"word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document ` + wNS + `><w:body>` + body +
			`<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720"/></w:sectPr></w:body></w:document>`,
	}
	for k, v := range parts {
		all[k] = v
	}
	for name, content := range all {
		f, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip create: %v", err)
		}
		if _, err := f.Write([]byte(content)); err != nil {
			t.Fatalf("zip write: %v", err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

func parseTestDocx(t *testing.T, body string, parts map[string]string) *Document {
	t.Helper()
	doc, err := ParseDocx(testDocx(t, body, parts))
	if err != nil {
		t.Fatalf("ParseDocx: %v", err)
	}
	return doc
}

func TestOnOff(t *testing.T) {
	tests := []struct {
		xml     string
		set, on bool
	}{
		{`<w:b/>`, true, true},
		{`<w:b w:val="1"/>`, true, true},
		{`<w:b w:val="true"/>`, true, true},
		{`<w:b w:val="0"/>`, true, false},
		{`<w:b w:val="false"/>`, true, false},
		{`<w:b w:val="off"/>`, true, false},
	}
	for _, tc := range tests {
		n, err := parseXMLTree([]byte(`<w:rPr ` + wNS + `>` + tc.xml + `</w:rPr>`))
		if err != nil {
			t.Fatalf("%s: %v", tc.xml, err)
		}
		got := onOff(n.first("b"))
		if got.set != tc.set || got.v != tc.on {
			t.Errorf("onOff(%s) = %+v, want set=%v on=%v", tc.xml, got, tc.set, tc.on)
		}
	}
	if got := onOff(nil); got.set {
		t.Errorf("onOff(nil) = %+v, want unset", got)
	}
}

func TestFormatListNumber(t *testing.T) {
	tests := []struct {
		v    int
		fmt  string
		want string
	}{
		{3, "decimal", "3"},
		{1, "lowerLetter", "a"},
		{28, "lowerLetter", "bb"},
		{2, "upperLetter", "B"},
		{4, "lowerRoman", "iv"},
		{1994, "upperRoman", "MCMXCIV"},
		{7, "decimalZero", "07"},
		{12, "decimalZero", "12"},
		{5, "bullet", ""},
	}
	for _, tc := range tests {
		if got := formatListNumber(tc.v, tc.fmt); got != tc.want {
			t.Errorf("formatListNumber(%d, %s) = %q, want %q", tc.v, tc.fmt, got, tc.want)
		}
	}
}

func TestPictureTurns(t *testing.T) {
	tests := []struct {
		rot   float64
		turns int
		ok    bool
	}{
		{0, 0, true},
		{5400000, 1, true},
		{10800000, 2, true},
		{16200000, 3, true},
		{-5400000, 3, true},
		{21600000, 0, true},
		{5430000, 1, true}, // within a degree
		{2700000, 0, false},
	}
	for _, tc := range tests {
		turns, ok := pictureTurns(tc.rot)
		if ok != tc.ok || (ok && turns != tc.turns) {
			t.Errorf("pictureTurns(%v) = %d,%v want %d,%v", tc.rot, turns, ok, tc.turns, tc.ok)
		}
	}
}

func TestOrientInsets(t *testing.T) {
	in := [4]float64{1, 2, 3, 4} // top right bottom left
	tests := []struct {
		name         string
		turns        int
		flipH, flipV bool
		want         [4]float64
	}{
		{"none", 0, false, false, [4]float64{1, 2, 3, 4}},
		{"quarter", 1, false, false, [4]float64{4, 1, 2, 3}},
		{"half", 2, false, false, [4]float64{3, 4, 1, 2}},
		{"three quarters", 3, false, false, [4]float64{2, 3, 4, 1}},
		{"mirror", 0, true, false, [4]float64{1, 4, 3, 2}},
		{"flip", 0, false, true, [4]float64{3, 2, 1, 4}},
	}
	for _, tc := range tests {
		if got := orientInsets(in, tc.turns, tc.flipH, tc.flipV); got != tc.want {
			t.Errorf("%s: orientInsets = %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestOrientPixels(t *testing.T) {
	// a 3x2 picture with a red top-left pixel
	src := image.NewNRGBA(image.Rect(0, 0, 3, 2))
	red := color.NRGBA{R: 255, A: 255}
	src.SetNRGBA(0, 0, red)
	tests := []struct {
		name         string
		turns        int
		flipH, flipV bool
		w, h, rx, ry int
	}{
		{"quarter turn", 1, false, false, 2, 3, 1, 0},
		{"half turn", 2, false, false, 3, 2, 2, 1},
		{"three quarters", 3, false, false, 2, 3, 0, 2},
		{"mirror", 0, true, false, 3, 2, 2, 0},
		{"flip", 0, false, true, 3, 2, 0, 1},
	}
	for _, tc := range tests {
		out := orientPixels(src, tc.turns, tc.flipH, tc.flipV)
		if out.Bounds().Dx() != tc.w || out.Bounds().Dy() != tc.h {
			t.Errorf("%s: size %v, want %dx%d", tc.name, out.Bounds().Size(), tc.w, tc.h)
			continue
		}
		if out.NRGBAAt(tc.rx, tc.ry) != red {
			t.Errorf("%s: red pixel not at (%d,%d)", tc.name, tc.rx, tc.ry)
		}
	}
}

func TestDocxReaderRunAndParagraphRules(t *testing.T) {
	tests := []struct {
		name, body string
		want       []string
		dont       []string
	}{
		{
			name: "explicit off toggle",
			body: `<w:p><w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>plain</w:t></w:r></w:p>`,
			want: []string{`>plain</p>`},
			dont: []string{"font-weight:700"},
		},
		{
			name: "spacing before and after",
			body: `<w:p><w:pPr><w:spacing w:before="240" w:after="120"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`,
			want: []string{"padding-top:12pt;margin-bottom:6pt;"},
		},
		{
			name: "exact line height",
			body: `<w:p><w:pPr><w:spacing w:line="360" w:lineRule="exact"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`,
			want: []string{`data-lsexact="18pt"`},
		},
		{
			name: "a leading space inside the text collapses as usual",
			body: `<w:p><w:r><w:t xml:space="preserve">one</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> two</w:t></w:r></w:p>`,
			dont: []string{"pre-wrap"},
		},
		{
			name: "a leading space at the start is kept",
			body: `<w:p><w:r><w:t xml:space="preserve"> lead</w:t></w:r></w:p>`,
			want: []string{"white-space:pre-wrap"},
		},
		{
			name: "right tab stop with leader",
			body: `<w:p><w:pPr><w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9026"/></w:tabs></w:pPr><w:r><w:t>a</w:t></w:r><w:r><w:tab/><w:t>1</w:t></w:r></w:p>`,
			want: []string{`data-tabs="right:451.3:dot"`, `<span class="doc-tab">` + "\t" + `</span>1`},
		},
		{
			name: "page break splits the paragraph",
			body: `<w:p><w:r><w:t>before</w:t></w:r><w:r><w:br w:type="page"/></w:r><w:r><w:t>after</w:t></w:r></w:p>`,
			want: []string{`>before</p><div class="doc-pagebreak"`, `>after</p>`},
		},
		{
			name: "non-breaking and soft hyphens",
			body: `<w:p><w:r><w:t>a</w:t><w:noBreakHyphen/><w:t>b</w:t><w:softHyphen/><w:t>c</w:t></w:r></w:p>`,
			want: []string{"a\u2011b\u00adc"},
		},
	}
	for _, tc := range tests {
		doc := parseTestDocx(t, tc.body, nil)
		for _, w := range tc.want {
			if !strings.Contains(doc.HTML, w) {
				t.Errorf("%s: want %q in %s", tc.name, w, doc.HTML)
			}
		}
		for _, d := range tc.dont {
			if strings.Contains(doc.HTML, d) {
				t.Errorf("%s: did not want %q in %s", tc.name, d, doc.HTML)
			}
		}
	}
}

func TestDocxReaderFootnotes(t *testing.T) {
	body := `<w:p><w:r><w:t>text</w:t></w:r><w:r><w:rPr><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="7"/></w:r></w:p>`
	notes := `<?xml version="1.0" encoding="UTF-8"?><w:footnotes ` + wNS + `>` +
		`<w:footnote w:type="separator" w:id="-1"><w:p><w:r><w:separator/></w:r></w:p></w:footnote>` +
		`<w:footnote w:id="7"><w:p><w:r><w:footnoteRef/></w:r><w:r><w:t xml:space="preserve"> the note</w:t></w:r></w:p></w:footnote></w:footnotes>`
	doc := parseTestDocx(t, body, map[string]string{"word/footnotes.xml": notes})
	if !strings.Contains(doc.HTML, `<sup class="doc-fnref" data-fn="7" contenteditable="false">1</sup>`) {
		t.Errorf("footnote reference not imported: %s", doc.HTML)
	}
	if strings.Count(doc.HTML, "<sup") != 1 {
		t.Errorf("footnote reference nested in another superscript: %s", doc.HTML)
	}
	if len(doc.Footnotes) != 1 || doc.Footnotes[0].ID != "7" || !strings.Contains(doc.Footnotes[0].HTML, "the note") {
		t.Errorf("footnotes = %+v", doc.Footnotes)
	}
}

func TestDocxReaderRotatedPicture(t *testing.T) {
	img := image.NewNRGBA(image.Rect(0, 0, 4, 2))
	var pngBuf bytes.Buffer
	if err := png.Encode(&pngBuf, img); err != nil {
		t.Fatalf("png: %v", err)
	}
	rels := `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		`<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/p.png"/></Relationships>`
	picture := func(rot string) string {
		return `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="508000" cy="254000"/>` +
			`<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/>` +
			`<a:srcRect t="10000"/></pic:blipFill><pic:spPr><a:xfrm ` + rot + `><a:ext cx="508000" cy="254000"/></a:xfrm></pic:spPr>` +
			`</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
	}
	tests := []struct {
		name, rot, want string
	}{
		{"upright", ``, "width:40pt;height:20pt;object-fit:fill;object-view-box:inset(10% 0% 0% 0%)"},
		{"quarter turn", `rot="5400000"`, "width:20pt;height:40pt;object-fit:fill;object-view-box:inset(0% 10% 0% 0%)"},
	}
	for _, tc := range tests {
		zipData := testDocx(t, picture(tc.rot), map[string]string{
			"word/_rels/document.xml.rels": rels,
		})
		// the media part is binary: add it by rebuilding with the bytes
		doc := parseDocxWithMedia(t, zipData, "word/media/p.png", pngBuf.Bytes())
		if !strings.Contains(doc.HTML, tc.want) {
			t.Errorf("%s: want %q in %.400s", tc.name, tc.want, doc.HTML)
		}
	}
}

// parseDocxWithMedia adds one binary part to a test package and parses it
func parseDocxWithMedia(t *testing.T, zipData []byte, name string, data []byte) *Document {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(zipData), int64(len(zipData)))
	if err != nil {
		t.Fatalf("zip: %v", err)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("zip open: %v", err)
		}
		w, _ := zw.Create(f.Name)
		var b bytes.Buffer
		if _, err := b.ReadFrom(rc); err != nil {
			t.Fatalf("zip read: %v", err)
		}
		rc.Close()
		w.Write(b.Bytes())
	}
	w, _ := zw.Create(name)
	w.Write(data)
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	doc, err := ParseDocx(buf.Bytes())
	if err != nil {
		t.Fatalf("ParseDocx: %v", err)
	}
	return doc
}

func TestDocxRichRoundTrip(t *testing.T) {
	// the editor's own model survives docx -> model unchanged
	tests := []struct {
		name, html string
	}{
		{"spacing and indents", `<p style="padding-top:6pt;margin-bottom:10pt;margin-left:36pt;text-indent:-18pt;">x</p>`},
		{"exact line height", `<p data-lsexact="14pt">x</p>`},
		{"line spacing", `<p data-ls="1.5">x</p>`},
		{"keep with next", `<p data-keep-next="1">x</p>`},
		{"tab stops", `<p data-tabs="right:451.3:dot">a<span class="doc-tab">` + "\t" + `</span>1</p>`},
		{"footnote reference", `<p>a<sup class="doc-fnref" data-fn="1" contenteditable="false">1</sup></p>`},
		{"page field", `<p><span class="doc-field" data-field="PAGE">1</span></p>`},
		{"shaded paragraph", `<p style="background-color:#ffe599;">x</p>`},
		{"trailing line break", `<p>x<br><br></p>`},
		{"horizontal rule", `<p>a</p><hr><p>b</p>`},
		{"bordered paragraph", `<p style="margin-top:6pt;margin-left:10pt;border-left:1.5pt solid #ff0000;padding-left:4pt;">x</p>`},
	}
	for _, tc := range tests {
		src := &Document{HTML: tc.html, Footnotes: []Footnote{{ID: "1", HTML: "<p>note</p>"}}}
		data, err := BuildDocx(src)
		if err != nil {
			t.Fatalf("%s: BuildDocx: %v", tc.name, err)
		}
		back, err := ParseDocx(data)
		if err != nil {
			t.Fatalf("%s: ParseDocx: %v", tc.name, err)
		}
		if !strings.Contains(back.HTML, tc.html) {
			t.Errorf("%s: want %s, got %s", tc.name, tc.html, back.HTML)
		}
	}
}

func TestDocxWriterEditorBoxes(t *testing.T) {
	tests := []struct {
		name, html string
		want       []string
	}{
		{
			// docs.css: 3px rule, 12px padding, 8pt + 2pt either side
			name: "blockquote",
			html: `<blockquote>quoted</blockquote>`,
			want: []string{`<w:left w:val="single" w:sz="18" w:space="9" w:color="C3C7CC"/>`,
				`<w:spacing w:before="200" w:after="200"`, `<w:ind w:left="225"`, `<w:color w:val="5F6368"/>`},
		},
		{
			// a 1px frame with 10px 12px inside: the half point w:space
			// cannot hold goes to the spacing outside
			name: "code block",
			html: `<pre>code</pre>`,
			want: []string{`<w:top w:val="single" w:sz="6" w:space="8" w:color="E2E5E9"/>`,
				`<w:left w:val="single" w:sz="6" w:space="9" w:color="E2E5E9"/>`,
				`<w:spacing w:before="150" w:after="150"`, `<w:ind w:left="195" w:right="195"`,
				`<w:shd w:val="clear" w:color="auto" w:fill="F1F3F4"/>`, `w:ascii="Consolas"`},
		},
		{
			name: "an indent blockquote from the browser keeps no rule",
			html: `<blockquote style="margin: 0 0 0 40px; border: none; padding: 0px;"><p>x</p></blockquote>`,
			want: []string{`<w:ind w:left="600"`},
		},
		{
			name: "header cell is centred",
			html: `<table class="of-table"><tbody><tr><th>H</th></tr></tbody></table>`,
			want: []string{`<w:tblStyle w:val="ArozEditorTable"/>`, `<w:jc w:val="center"/>`},
		},
		{
			name: "imported table stays a Word table",
			html: `<table class="of-table" data-docx="1"><tbody><tr><td>c</td></tr></tbody></table>`,
			want: []string{`<w:tblStyle w:val="TableGrid"/>`},
		},
		{
			name: "rule",
			html: `<hr>`,
			want: []string{`<w:pStyle w:val="ArozHorizontalRule"/>`, `w:line="20" w:lineRule="exact"`},
		},
	}
	for _, tc := range tests {
		data, err := BuildDocx(&Document{HTML: tc.html})
		if err != nil {
			t.Fatalf("%s: BuildDocx: %v", tc.name, err)
		}
		body := string(zipPart(t, data, "word/document.xml"))
		for _, w := range tc.want {
			if !strings.Contains(body, w) {
				t.Errorf("%s: want %s in %s", tc.name, w, body)
			}
		}
	}
	// the indent blockquote draws no rule
	data, _ := BuildDocx(&Document{HTML: tests[2].html})
	if body := string(zipPart(t, data, "word/document.xml")); strings.Contains(body, "<w:pBdr>") {
		t.Errorf("border:none blockquote got a rule: %s", body)
	}
}

func TestDocxPlainHeaderStaysPlain(t *testing.T) {
	data, err := BuildDocx(&Document{HTML: "<p>x</p>", Header: "Top & tail", Footer: "Bottom"})
	if err != nil {
		t.Fatalf("BuildDocx: %v", err)
	}
	back, err := ParseDocx(data)
	if err != nil {
		t.Fatalf("ParseDocx: %v", err)
	}
	if back.Header != "Top & tail" || back.HeaderHTML != "" {
		t.Errorf("header = %q / %q, want plain text", back.Header, back.HeaderHTML)
	}
	if back.Footer != "Bottom" || back.FooterHTML != "" || back.PageNumbers {
		t.Errorf("footer = %q / %q pn=%v, want plain text", back.Footer, back.FooterHTML, back.PageNumbers)
	}
}
