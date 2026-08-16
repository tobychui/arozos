package office

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestOdfZipStructure(t *testing.T) {
	data, err := BuildOdt(&Document{HTML: "<p>hi</p>"})
	if err != nil {
		t.Fatalf("BuildOdt: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("not a zip: %v", err)
	}
	// mimetype must be the FIRST entry and stored uncompressed
	if len(zr.File) == 0 || zr.File[0].Name != "mimetype" {
		t.Fatalf("first entry is %q, want mimetype", zr.File[0].Name)
	}
	if zr.File[0].Method != zip.Store {
		t.Error("mimetype entry is compressed; ODF requires it stored")
	}
	names := map[string]bool{}
	for _, f := range zr.File {
		names[f.Name] = true
	}
	for _, want := range []string{"content.xml", "styles.xml", "META-INF/manifest.xml"} {
		if !names[want] {
			t.Errorf("missing part %s", want)
		}
	}
}

func TestOdtRoundTrip(t *testing.T) {
	src := &Document{
		HTML: `<h1 class="doc-title">Title Here</h1>` +
			`<p style="text-align:center;">Some <b>bold</b> and <i>italic</i> and ` +
			`<span style="color:#cc0000;">red</span> text</p>` +
			`<p>A <a href="https://example.com/">link</a> here</p>` +
			`<ul><li>alpha</li><li>beta</li></ul>` +
			`<ol><li>one</li><li>two</li></ol>` +
			`<div class="doc-pagebreak" contenteditable="false"></div>` +
			`<p>on page two</p>` +
			`<table class="of-table"><colgroup><col style="width:70%"><col style="width:30%"></colgroup>` +
			`<tbody><tr><td style="background-color: rgb(217, 231, 248);">H</td><td>x</td></tr></tbody></table>` +
			`<p><img src="` + makePngDataURL(t, 80, 40) + `" width="200"></p>`,
		Header:      "My Header",
		Footer:      "My Footer",
		PageNumbers: true,
		Page: &PageConf{Size: "Letter", Orientation: "portrait",
			Margins: &MarginsMM{Top: 20, Right: 15, Bottom: 20, Left: 15}},
	}
	data, err := BuildOdt(src)
	if err != nil {
		t.Fatalf("BuildOdt: %v", err)
	}
	back, err := ParseOdt(data)
	if err != nil {
		t.Fatalf("ParseOdt: %v", err)
	}
	checks := []string{"Title Here", "<b>bold</b>", "<i>italic</i>", "color:#cc0000",
		`href="https://example.com/"`, "<ul>", "<li>alpha</li>", "<ol>", "<li>one</li>",
		"doc-pagebreak", "on page two", "<table", "background-color:#d9e7f8", "data:image/png"}
	for _, c := range checks {
		if !strings.Contains(back.HTML, c) {
			t.Errorf("round trip lost %q\nhtml: %s", c, back.HTML)
		}
	}
	if back.Header != "My Header" {
		t.Errorf("header: got %q", back.Header)
	}
	if !strings.Contains(back.Footer, "My Footer") {
		t.Errorf("footer: got %q", back.Footer)
	}
	if !back.PageNumbers {
		t.Error("pageNumbers flag lost")
	}
	if back.Page == nil || back.Page.Size != "Letter" {
		t.Errorf("page size lost: %+v", back.Page)
	}
	if back.Page.Margins == nil || int(back.Page.Margins.Right) != 15 {
		t.Errorf("margins lost: %+v", back.Page.Margins)
	}
	// table column proportions survive (70/30)
	if !strings.Contains(back.HTML, "width:70%") {
		t.Errorf("colgroup lost: %s", back.HTML)
	}
}

func TestOdsFormulaSyntax(t *testing.T) {
	tests := []struct{ in, odf string }{
		{"=SUM(A1:B2)", "of:=SUM([.A1:.B2])"},
		{"=A1*2+C10", "of:=[.A1]*2+[.C10]"},
		{`=IF(A1>0,"yes A1","no")`, `of:=IF([.A1]>0,"yes A1","no")`},
		{"=$B$2+A1", "of:=[.$B$2]+[.A1]"},
	}
	for _, tc := range tests {
		if got := formulaToOdf(tc.in); got != tc.odf {
			t.Errorf("formulaToOdf(%q) = %q, want %q", tc.in, got, tc.odf)
		}
		if got := formulaFromOdf(tc.odf); got != tc.in {
			t.Errorf("formulaFromOdf(%q) = %q, want %q", tc.odf, got, tc.in)
		}
	}
	// sheet-qualified refs from other apps still come back usable
	if got := formulaFromOdf("of:=SUM([Sheet1.A1:.B2])"); got != "=SUM(A1:B2)" {
		t.Errorf("sheet-qualified: got %q", got)
	}
}

func TestOdsRoundTrip(t *testing.T) {
	dec := 0
	_ = dec
	wb := &Workbook{Sheets: []*WorkSheet{{
		Name: "Data 1",
		Cells: map[string]*WorkCell{
			"A1": {V: "Name", S: &CellStyle{B: true, Bg: "#d9e7f8"}},
			"B1": {V: "Val", S: &CellStyle{B: true}},
			"A2": {V: "alpha", N: "a note"},
			"B2": {V: "42.5"},
			"A3": {V: "TRUE"},
			"B3": {V: "=SUM(B2:B2)*2"},
			"C1": {V: "'123"},
		},
		ColW:   map[string]float64{"0": 150},
		RowH:   map[string]float64{"1": 40},
		Merges: []string{"A5:B6"},
	}}}
	data, err := BuildOds(wb)
	if err != nil {
		t.Fatalf("BuildOds: %v", err)
	}
	back, err := ParseOds(data)
	if err != nil {
		t.Fatalf("ParseOds: %v", err)
	}
	ws := back.Sheets[0]
	if ws.Name != "Data 1" {
		t.Errorf("sheet name: %q", ws.Name)
	}
	get := func(ref string) *WorkCell { return ws.Cells[ref] }
	if c := get("A1"); c == nil || c.V != "Name" || c.S == nil || !c.S.B || c.S.Bg != "#d9e7f8" {
		t.Errorf("A1 lost style/value: %+v", c)
	}
	if c := get("B2"); c == nil || c.V != "42.5" {
		t.Errorf("B2 number: %+v", c)
	}
	if c := get("A3"); c == nil || c.V != "TRUE" {
		t.Errorf("A3 bool: %+v", c)
	}
	if c := get("B3"); c == nil || c.V != "=SUM(B2:B2)*2" {
		t.Errorf("B3 formula: %+v", c)
	}
	if c := get("A2"); c == nil || c.N != "a note" {
		t.Errorf("A2 note: %+v", c)
	}
	if c := get("C1"); c == nil || c.V != "'123" {
		t.Errorf("C1 forced text: %+v", c)
	}
	if w := ws.ColW["0"]; w < 145 || w > 155 {
		t.Errorf("col width drifted: %v", w)
	}
	if h := ws.RowH["1"]; h < 36 || h > 44 {
		t.Errorf("row height drifted: %v", h)
	}
	foundMerge := false
	for _, m := range ws.Merges {
		if m == "A5:B6" {
			foundMerge = true
		}
	}
	if !foundMerge {
		t.Errorf("merge lost: %v", ws.Merges)
	}
}

func TestOdpRoundTrip(t *testing.T) {
	src := &Presentation{Theme: "clean", Slides: []*Slide{{
		Bg:    "#123456",
		Notes: "remember this",
		Objects: []*Object{
			{Type: "text", X: 96, Y: 48, W: 480, H: 96,
				Props: Props{HTML: "Hello<br>World", FontSize: 32, Color: "#202124", Bold: true}},
			{Type: "image", X: 480, Y: 192, W: 192, H: 96,
				Props: Props{Src: makePngDataURL(t, 60, 30)}},
			{Type: "shape", X: 96, Y: 288, W: 192, H: 96,
				Props: Props{Kind: "ellipse", Fill: "#e07b1f", Stroke: "#333333", StrokeW: 2}},
			{Type: "line", X: 96, Y: 480, W: 384, H: 0,
				Props: Props{Stroke: "#ff0000", StrokeW: 3}},
			{Type: "table", X: 480, Y: 336, W: 384, H: 96,
				Props: Props{Rows: [][]string{{"A", "B"}, {"1", "2"}}, HeaderRow: true}},
		},
	}}}
	data, err := BuildOdp(src)
	if err != nil {
		t.Fatalf("BuildOdp: %v", err)
	}
	back, err := ParseOdp(data)
	if err != nil {
		t.Fatalf("ParseOdp: %v", err)
	}
	s := back.Slides[0]
	if s.Bg != "#123456" {
		t.Errorf("bg lost: %q", s.Bg)
	}
	if s.Notes != "remember this" {
		t.Errorf("notes lost: %q", s.Notes)
	}
	byType := map[string]*Object{}
	for _, o := range s.Objects {
		byType[o.Type] = o
	}
	txt := byType["text"]
	if txt == nil || !strings.Contains(txt.Props.HTML, "Hello") || !strings.Contains(txt.Props.HTML, "World") {
		t.Errorf("text object lost: %+v", txt)
	}
	// geometry survives the px -> cm -> px trip within a pixel or two
	if txt != nil && (absF(txt.X-96) > 2 || absF(txt.W-480) > 2) {
		t.Errorf("text geometry drifted: x=%v w=%v", txt.X, txt.W)
	}
	if img := byType["image"]; img == nil || !strings.HasPrefix(img.Props.Src, "data:image/png") {
		t.Errorf("image lost: %+v", img)
	}
	if sh := byType["shape"]; sh == nil || sh.Props.Kind != "ellipse" || sh.Props.Fill != "#e07b1f" {
		t.Errorf("shape lost: %+v", sh)
	}
	if ln := byType["line"]; ln == nil || ln.Props.Stroke != "#ff0000" {
		t.Errorf("line lost: %+v", ln)
	}
	tb := byType["table"]
	if tb == nil || len(tb.Props.Rows) != 2 || tb.Props.Rows[0][0] != "A" {
		b, _ := json.Marshal(tb)
		t.Errorf("table lost: %s", b)
	}
}
