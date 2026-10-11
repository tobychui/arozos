package doc

import (
	"archive/zip"
	"bytes"
	"encoding/binary"
	"io"
	"os"
	"strings"
	"testing"
)

func TestEachSprmLengths(t *testing.T) {
	var g []byte
	add := func(b ...byte) { g = append(g, b...) }
	add(0x35, 0x08, 0x01)                                       // sprmCFBold, toggle (1 byte)
	add(0x43, 0x4A, 0x18, 0x00)                                 // sprmCHps, 2 bytes
	add(0x70, 0x68, 1, 2, 3, 0)                                 // sprmCCv, 4 bytes
	add(0x03, 0x6A, 0x10, 0, 0, 0)                              // sprmCPicLocation, 4 bytes
	add(0x71, 0xCA, 10, 1, 2, 3, 0, 4, 5, 6, 0, 1, 0)           // sprmCShd, variable (10)
	add(0x08, 0xD6, 4, 0, 1, 0, 0)                              // sprmTDefTable: size 4 means 3 operand bytes
	add(0x15, 0xC6, 255, 1, 0x10, 0, 0x20, 0, 1, 0x30, 0, 0x01) // sprmPChgTabs, counted form
	add(0x5B, 0x24, 1)                                          // sprmPFDyaBeforeAuto, 1 byte
	var ops []uint16
	var lens []int
	eachSprm(g, func(op uint16, a []byte) {
		ops = append(ops, op)
		lens = append(lens, len(a))
	})
	wantOps := []uint16{0x0835, 0x4A43, 0x6870, 0x6A03, 0xCA71, 0xD608, 0xC615, 0x245B}
	wantLens := []int{1, 2, 4, 4, 10, 3, 9, 1}
	if len(ops) != len(wantOps) {
		t.Fatalf("got %d sprms (%x), want %d", len(ops), ops, len(wantOps))
	}
	for i := range ops {
		if ops[i] != wantOps[i] || lens[i] != wantLens[i] {
			t.Errorf("sprm %d = %04X len %d, want %04X len %d", i, ops[i], lens[i], wantOps[i], wantLens[i])
		}
	}
	// a truncated list stops without panicking
	for i := range g {
		eachSprm(g[:i], func(uint16, []byte) {})
	}
}

func TestToggleSprmsAndRunXML(t *testing.T) {
	w := &writer{d: &docFile{styles: &styleSheet{byID: map[string]bool{}}}}
	tests := []struct {
		name   string
		v      byte
		style  uint32
		want   string
		absent string
	}{
		{"on", 1, 0, "<w:b/>", ""},
		{"off", 0, 1 << tBold, `<w:b w:val="0"/>`, ""},
		{"same as style", 0x80, 1 << tBold, "", "<w:b"},
		{"flip a bold style", 0x81, 1 << tBold, `<w:b w:val="0"/>`, ""},
		{"flip a plain style", 0x81, 0, "<w:b/>", ""},
	}
	for _, tc := range tests {
		c := newChp()
		c.apply(0x0835, []byte{tc.v})
		got := w.rPrXML(c, tc.style, "")
		if tc.want != "" && !strings.Contains(got, tc.want) {
			t.Errorf("%s: rPr %q lacks %q", tc.name, got, tc.want)
		}
		if tc.absent != "" && strings.Contains(got, tc.absent) {
			t.Errorf("%s: rPr %q should not contain %q", tc.name, got, tc.absent)
		}
	}
	c := newChp()
	for _, s := range []struct {
		op uint16
		a  []byte
	}{
		{0x4A43, []byte{28, 0}}, // 14pt
		{0x6870, []byte{0x12, 0x34, 0x56, 0}},
		{0x2A3E, []byte{3}},       // double underline
		{0x2A48, []byte{1}},       // superscript
		{0x2A0C, []byte{7}},       // yellow highlight
		{0x8840, []byte{0x14, 0}}, // 1pt spacing
	} {
		c.apply(s.op, s.a)
	}
	got := w.rPrXML(c, 0, "")
	for _, want := range []string{`<w:sz w:val="28"/>`, `<w:color w:val="123456"/>`, `<w:u w:val="double"/>`,
		`<w:vertAlign w:val="superscript"/>`, `<w:highlight w:val="yellow"/>`, `<w:spacing w:val="20"/>`} {
		if !strings.Contains(got, want) {
			t.Errorf("rPr %q lacks %s", got, want)
		}
	}
}

func TestParagraphSprms(t *testing.T) {
	p := newPap()
	p.apply(0x845E, []byte{0xD0, 0x02})       // left 720
	p.apply(0x8460, []byte{0x98, 0xFE})       // first line -360: hanging
	p.apply(0x6412, []byte{0x68, 0x01, 1, 0}) // 1.5 lines
	p.apply(0xA414, []byte{0x78, 0})          // 6pt after
	p.apply(0x2461, []byte{1})                // centred
	p.apply(0x260A, []byte{1})                // level 2
	p.apply(0x460B, []byte{3, 0})             // list 3
	w := &writer{d: &docFile{styles: &styleSheet{}, lists: &lists{lfos: make([]*lfo, 5)}}}
	got := w.pPrXML(0, p, false, "")
	for _, want := range []string{`w:left="720"`, `w:hanging="360"`, `w:line="360" w:lineRule="auto"`,
		`w:after="120"`, `<w:jc w:val="center"/>`, `<w:ilvl w:val="1"/><w:numId w:val="3"/>`} {
		if !strings.Contains(got, want) {
			t.Errorf("pPr %q lacks %s", got, want)
		}
	}
	exact := newPap()
	exact.apply(0x6412, []byte{0x10, 0xFF, 0, 0}) // -240: exactly 12pt
	if got := w.pPrXML(0, exact, false, ""); !strings.Contains(got, `w:line="240" w:lineRule="exact"`) {
		t.Errorf("exact line spacing: %q", got)
	}
}

func TestTableSprms(t *testing.T) {
	p := newPap()
	// two cells, edges -108, 2000, 4108; the second cell restarts a
	// vertical merge
	def := []byte{2}
	for _, e := range []int{-108, 2000, 4108} {
		def = append(def, byte(e), byte(e>>8))
	}
	def = append(def, make([]byte, 20)...)
	tc2 := make([]byte, 20)
	tc2[0] = 0x60 // fVertMerge | fVertRestart
	def = append(def, tc2...)
	grpprl := []byte{0x08, 0xD6, byte(len(def) + 1), byte((len(def) + 1) >> 8)}
	grpprl = append(grpprl, def...)
	grpprl = append(grpprl, 0x04, 0x34, 1)                                            // header row
	grpprl = append(grpprl, 0x70, 0xD6, 10, 0, 0, 0, 0xFF, 0xCC, 0x99, 0x66, 0, 1, 0) // shading of cell 0
	eachSprm(grpprl, p.apply)
	if p.tap == nil || len(p.tap.cells) != 2 || p.tap.centers[2] != 4108 || !p.tap.header {
		t.Fatalf("tap = %+v", p.tap)
	}
	if !p.tap.cells[1].vertRestart {
		t.Error("vertical merge restart lost")
	}
	if len(p.tap.shades) == 0 || p.tap.shades[0] == nil || shdXML(p.tap.shades[0]) == "" {
		t.Error("cell shading lost")
	}
}

func TestShadingAndBorders(t *testing.T) {
	tests := []struct {
		s    shd
		want string
	}{
		{shd{fore: color{auto: true}, back: color{rgb: 0xFFFF00}, pat: 0}, `w:fill="FFFF00"`},
		{shd{fore: color{rgb: 0xFF0000}, back: color{auto: true}, pat: 1}, `w:fill="FF0000"`},
		{shd{fore: color{rgb: 0x000000}, back: color{rgb: 0xFFFFFF}, pat: 8}, `w:fill="808080"`}, // 50%
		{shd{fore: color{auto: true}, back: color{auto: true}, pat: 0}, ""},
	}
	for i, tc := range tests {
		got := shdXML(&tc.s)
		if tc.want == "" && got != "" || tc.want != "" && !strings.Contains(got, tc.want) {
			t.Errorf("case %d: %q, want %q", i, got, tc.want)
		}
	}
	b := brc80([]byte{8, 1, 6, 2})
	if got := borderXML("top", &b); got != `<w:top w:val="single" w:sz="8" w:space="2" w:color="FF0000"/>` {
		t.Errorf("borderXML = %q", got)
	}
	if got := borderXML("top", &brc{typ: 0xFF}); got != "" {
		t.Errorf("a nil border writes nothing, got %q", got)
	}
}

func TestFieldsAndHelpers(t *testing.T) {
	tests := map[string]string{
		`HYPERLINK "https://arozos.com/"`:           "https://arozos.com/",
		`HYPERLINK \l "_Toc123"`:                    "#_Toc123",
		` HYPERLINK "http://x/" \o "tip" \l "frag"`: "http://x/#frag",
		`PAGE`: "",
		`HYPERLINK "file:///C:/My Docs/a.doc" \t "_blank"`: "file:///C:/My Docs/a.doc",
	}
	for in, want := range tests {
		if got := hyperlinkTarget(in); got != want {
			t.Errorf("hyperlinkTarget(%q) = %q, want %q", in, got, want)
		}
	}
	if got := lvlText([]uint16{0, '.', 1, ')'}); got != "%1.%2)" {
		t.Errorf("lvlText = %q", got)
	}
	// 2026-10-11 09:30
	v := uint32(30) | 9<<6 | 11<<11 | 10<<16 | uint32(2026-1900)<<20
	if got := dttm(v); got != ` w:date="2026-10-11T09:30:00Z"` {
		t.Errorf("dttm = %q", got)
	}
	if hex4(0xF04A) != "F04A" || hex4(0x41) != "0041" {
		t.Error("hex4")
	}
	// an extended STTB of two strings
	st := []byte{0xFF, 0xFF, 2, 0, 0, 0, 2, 0, 'A', 0, 'b', 0, 1, 0, 'C', 0}
	if got := sttb(st); len(got) != 2 || got[0] != "Ab" || got[1] != "C" {
		t.Errorf("sttb = %q", got)
	}
}

func TestPieceTable(t *testing.T) {
	// a Prc then a PlcPcd of two pieces: 8-bit "Hi" then UTF-16 "!"
	plc := make([]byte, 0)
	for _, cp := range []uint32{0, 2, 3} {
		plc = binary.LittleEndian.AppendUint32(plc, cp)
	}
	pcd := func(fc uint32, prm uint16) []byte {
		b := make([]byte, 8)
		binary.LittleEndian.PutUint32(b[2:], fc)
		binary.LittleEndian.PutUint16(b[6:], prm)
		return b
	}
	plc = append(plc, pcd(0x40000000|200, 0)...)
	plc = append(plc, pcd(300, 1)...)
	clx := []byte{0x01, 3, 0, 0x35, 0x08, 0x01} // one Prc: bold
	clx = append(clx, 0x02)
	clx = binary.LittleEndian.AppendUint32(clx, uint32(len(plc)))
	clx = append(clx, plc...)
	pieces, prc := pieceTable(clx, 3)
	if len(pieces) != 2 || len(prc) != 1 {
		t.Fatalf("pieces %d prc %d", len(pieces), len(prc))
	}
	if !pieces[0].compressed || pieces[0].fc != 100 || pieces[1].compressed || pieces[1].fc != 300 {
		t.Errorf("pieces = %+v", pieces)
	}
	wd := make([]byte, 400)
	copy(wd[100:], "Hi")
	wd[300] = '!'
	text := textUnits(wd, pieces, 3)
	if string(rune(text[0]))+string(rune(text[1]))+string(rune(text[2])) != "Hi!" {
		t.Errorf("text = %v", text)
	}
	if fcOf(pieces, 1) != 101 || fcOf(pieces, 2) != 300 {
		t.Errorf("fcOf = %d, %d", fcOf(pieces, 1), fcOf(pieces, 2))
	}
}

func TestRejectsOtherFiles(t *testing.T) {
	for _, data := range [][]byte{nil, []byte("PK\x03\x04 plain zip"), make([]byte, 1024)} {
		if _, err := ToDocx(data); err == nil {
			t.Error("ToDocx should fail on a file that is not a .doc")
		}
	}
	if _, err := parseFib([]byte{0xEC, 0xA5, 0x65, 0x00}); err == nil {
		t.Error("parseFib should refuse a truncated / Word 6 FIB")
	}
}

/* ---------------- documents saved by Word ---------------- */

func convert(t *testing.T, name string) ([]byte, map[string]string) {
	t.Helper()
	data, err := os.ReadFile("testdata/" + name)
	if err != nil {
		t.Fatal(err)
	}
	x, err := ToDocx(data)
	if err != nil {
		t.Fatalf("ToDocx(%s): %v", name, err)
	}
	zr, err := zip.NewReader(bytes.NewReader(x), int64(len(x)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	parts := map[string]string{}
	for _, f := range zr.File {
		rc, _ := f.Open()
		b, _ := io.ReadAll(rc)
		rc.Close()
		parts[f.Name] = string(b)
	}
	return x, parts
}

func TestFeaturesDocument(t *testing.T) {
	_, parts := convert(t, "features.doc")
	for _, p := range []string{"[Content_Types].xml", "word/document.xml", "word/styles.xml", "word/numbering.xml",
		"word/footnotes.xml", "word/settings.xml", "word/_rels/document.xml.rels"} {
		if parts[p] == "" {
			t.Errorf("part %s missing", p)
		}
	}
	data, _ := os.ReadFile("testdata/features.doc")
	doc, err := Parse(data)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	h := doc.HTML
	for _, want := range []string{
		"ArozOS Legacy Import Test</h1>",
		`font-weight:700;">bold</span>`,
		`font-style:italic;">italic</span>`,
		`text-decoration:line-through;">struck</span>`,
		`color:#ff0000;">red text</span>`,
		"<sup>", "<sub>",
		`text-align:center`, "Centred paragraph",
		`<ul class="doc-list"`, `data-fmt="bullet"`, "Nested bullet",
		`<ol class="doc-list"`, `data-lvltext="%1."`, "Step three",
		`<table class="of-table"`, `background-color:#ccc0da`, "Apple", "8.60",
		`<img src="data:image/png;base64,`,
		`class="doc-fnref"`,
		`<a href="https://arozos.com/"`, "the ArozOS website",
		`class="doc-pagebreak"`, "Second page</span></h1>",
		"Text inside a text box",
		`class="doc-anchor"`,
	} {
		if !strings.Contains(h, want) {
			t.Errorf("document HTML lacks %q", want)
		}
	}
	if len(doc.Footnotes) != 1 || !strings.Contains(doc.Footnotes[0].HTML, "This is the footnote text.") {
		t.Errorf("footnotes = %+v", doc.Footnotes)
	}
	if !strings.Contains(doc.HeaderHTML, "Document header") {
		t.Errorf("header = %q", doc.HeaderHTML)
	}
	if !strings.Contains(doc.FooterHTML, `data-field="PAGE"`) {
		t.Errorf("footer = %q", doc.FooterHTML)
	}
	if doc.Page == nil || doc.Page.Size != "A4" || doc.Page.Orientation != "portrait" || doc.Page.Margins == nil ||
		doc.Page.Margins.Top < 19 || doc.Page.Margins.Top > 21 {
		t.Errorf("page = %+v", doc.Page)
	}
}

func TestSectionsDocument(t *testing.T) {
	_, parts := convert(t, "sections.doc")
	d := parts["word/document.xml"]
	if strings.Count(d, "<w:sectPr>") != 2 {
		t.Errorf("want two sections, document has %d", strings.Count(d, "<w:sectPr>"))
	}
	if !strings.Contains(d, `w:orient="landscape"`) || !strings.Contains(d, `<w:cols w:num="2"`) {
		t.Error("the landscape two-column section is lost")
	}
	data, _ := os.ReadFile("testdata/sections.doc")
	doc, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	if doc.Page.Orientation != "landscape" || doc.Page.Columns != 2 {
		t.Errorf("page = %+v", doc.Page)
	}
}

func TestReviewDocument(t *testing.T) {
	_, parts := convert(t, "review.doc")
	d := parts["word/document.xml"]
	for _, want := range []string{"<w:commentRangeStart", "<w:commentReference", "<w:ins ", "<w:del ", "<w:delText",
		"<w:endnoteReference", `<w:sym w:font="Wingdings" w:char="F04A"/>`} {
		if !strings.Contains(d, want) {
			t.Errorf("document.xml lacks %s", want)
		}
	}
	if !strings.Contains(parts["word/comments.xml"], "Please check this phrase.") {
		t.Error("comment text lost")
	}
	if !strings.Contains(parts["word/endnotes.xml"], "Endnote text.") {
		t.Error("endnote text lost")
	}
	// the nested table: a w:tbl inside a w:tc
	if i := strings.Index(d, "<w:tc>"); i < 0 || !strings.Contains(d[i:], "<w:tbl>") {
		t.Error("nested table lost")
	}
	data, _ := os.ReadFile("testdata/review.doc")
	doc, err := Parse(data)
	if err != nil {
		t.Fatal(err)
	}
	h := doc.HTML
	for _, want := range []string{`class="doc-cmt"`, `<del class="doc-del"> deleted</del>`, `class="doc-ins"`,
		"Level three", "in4", "After the tables."} {
		if !strings.Contains(h, want) {
			t.Errorf("document HTML lacks %q", want)
		}
	}
	if len(doc.Comments) != 1 || doc.Comments[0].Text != "Please check this phrase." {
		t.Errorf("comments = %+v", doc.Comments)
	}
}

// a damaged file must fail or degrade, never panic
func TestCorruptDocumentDoesNotPanic(t *testing.T) {
	data, err := os.ReadFile("testdata/features.doc")
	if err != nil {
		t.Fatal(err)
	}
	for off := 512; off < len(data); off += 97 {
		bad := append([]byte(nil), data...)
		for k := 0; k < 4 && off+k < len(bad); k++ {
			bad[off+k] ^= 0x5A
		}
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("panic with bytes flipped at %d: %v", off, r)
				}
			}()
			ToDocx(bad)
		}()
	}
}

// boundaryWords are the values that break offset and length arithmetic:
// the int limits of a 32-bit target and the largest 32-bit values
var boundaryWords = []uint32{0x7FFFFFFF, 0x80000000, 0xFFFFFFFF}

func TestBoundaryValuesDoNotPanic(t *testing.T) {
	for _, name := range []string{"features.doc", "sections.doc"} {
		data, err := os.ReadFile("testdata/" + name)
		if err != nil {
			t.Fatal(err)
		}
		for off := 512; off+4 <= len(data); off += 61 {
			for _, v := range boundaryWords {
				bad := append([]byte(nil), data...)
				binary.LittleEndian.PutUint32(bad[off:], v)
				func() {
					defer func() {
						if r := recover(); r != nil {
							t.Fatalf("%s: panic with %#x at %d: %v", name, v, off, r)
						}
					}()
					ToDocx(bad)
				}()
			}
		}
	}
}

func TestTextboxStoriesDoNotNest(t *testing.T) {
	data, err := os.ReadFile("testdata/features.doc")
	if err != nil {
		t.Fatal(err)
	}
	d, err := open(data)
	if err != nil {
		t.Fatal(err)
	}
	w := newWriter(d)
	part := &partCtx{rels: newRelSet()}
	if got := w.textboxXML(0, false, part); !strings.Contains(got, "Text inside a text box") || w.inTextbox {
		t.Fatalf("text box story = %q (inTextbox %v)", got, w.inTextbox)
	}
	// inside a text box story another text box is not expanded: a damaged
	// file that anchors one there would recurse without end
	w.inTextbox = true
	if got := w.textboxXML(0, false, part); got != "" || !w.inTextbox {
		t.Errorf("nested text box = %q (inTextbox %v)", got, w.inTextbox)
	}
}
