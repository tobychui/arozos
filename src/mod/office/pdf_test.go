package office

import (
	"archive/zip"
	"bytes"
	"compress/zlib"
	"io"
	"math"
	"strings"
	"testing"

	"github.com/go-pdf/fpdf"
	"golang.org/x/net/html"
)

// pdfStreamsText inflates every content stream in a PDF and returns the
// concatenated text, so tests can assert on real text-drawing operators
func pdfStreamsText(t *testing.T, data []byte) string {
	t.Helper()
	var sb strings.Builder
	rest := data
	for {
		i := bytes.Index(rest, []byte("stream"))
		if i < 0 {
			break
		}
		chunk := rest[i+len("stream"):]
		chunk = bytes.TrimLeft(chunk, "\r\n")
		j := bytes.Index(chunk, []byte("endstream"))
		if j < 0 {
			break
		}
		raw := chunk[:j]
		if zr, err := zlib.NewReader(bytes.NewReader(raw)); err == nil {
			if inflated, err := io.ReadAll(zr); err == nil {
				sb.Write(inflated)
			}
			zr.Close()
		} else {
			sb.Write(raw)
		}
		rest = chunk[j+len("endstream"):]
	}
	return sb.String()
}

func TestDocPdfRealText(t *testing.T) {
	doc := &Document{HTML: `<h1>Quarterly Report</h1>` +
		`<p>Hello <b>bold</b> and <i>italic</i> world.</p>` +
		`<table class="of-table"><tbody><tr><th>Name</th><td>Value</td></tr></tbody></table>`}
	data, err := BuildDocPdf(doc)
	if err != nil {
		t.Fatalf("BuildDocPdf: %v", err)
	}
	if !bytes.HasPrefix(data, []byte("%PDF-")) {
		t.Fatal("output is not a PDF")
	}
	text := pdfStreamsText(t, data)
	for _, want := range []string{"Quarterly Report", "Hello", "bold", "italic", "Name", "Value"} {
		if !strings.Contains(text, want) {
			t.Errorf("PDF text streams missing %q", want)
		}
	}
	if strings.Count(string(data), "/Type /Page\n") == 0 &&
		!strings.Contains(string(data), "/Page") {
		t.Error("no page objects found")
	}
}

func TestDocPdfTableCellImageAndBlocks(t *testing.T) {
	png := makePngDataURL(t, 60, 40)
	doc := &Document{HTML: `<table class="of-table"><tbody><tr>` +
		`<td><h2>Lapwing</h2><ul><li>Waifu</li><li>Cute</li></ul></td>` +
		`<td><img src="` + png + `" width="60" height="40"></td>` +
		`</tr></tbody></table>`}
	data, err := BuildDocPdf(doc)
	if err != nil {
		t.Fatalf("BuildDocPdf: %v", err)
	}
	// the cell image must land in the PDF as an image object
	if !strings.Contains(string(data), "/Subtype /Image") {
		t.Error("table cell image missing from PDF")
	}
	text := pdfStreamsText(t, data)
	// block structure preserved: heading and bulleted items are separate
	// text ops, not one mashed-together line
	if strings.Contains(text, "LapwingWaifu") {
		t.Error("cell blocks mashed together without line breaks")
	}
	// list markers hang in the indent, so they are their own text object
	// (bullets are cp1252-translated to byte 0x95 in the stream)
	if strings.Count(text, "\x95") < 2 {
		t.Error("bullet markers missing from the cell list")
	}
	for _, want := range []string{"Lapwing", "Waifu", "Cute"} {
		if !strings.Contains(text, want) {
			t.Errorf("cell text missing %q", want)
		}
	}
}

func TestDocPdfPageGeometryAndBreak(t *testing.T) {
	doc := &Document{
		HTML: `<p>first page</p><div class="doc-pagebreak"></div><p>second page</p>`,
		Page: &PageConf{Size: "Letter", Orientation: "landscape",
			Margins: &MarginsMM{Top: 20, Right: 20, Bottom: 20, Left: 20}},
	}
	data, err := BuildDocPdf(doc)
	if err != nil {
		t.Fatalf("BuildDocPdf: %v", err)
	}
	s := string(data)
	// Letter landscape = 792 x 612 pt
	if !strings.Contains(s, "792.00 612.00") {
		t.Error("MediaBox is not Letter landscape")
	}
	if got := strings.Count(s, "/Type /Page "); got+strings.Count(s, "/Type /Page\n") < 2 {
		t.Errorf("expected 2 pages after explicit break, page markers=%d", got)
	}
	text := pdfStreamsText(t, data)
	for _, want := range []string{"first page", "second page"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing %q", want)
		}
	}
}

func TestDocPdfHeaderFooter(t *testing.T) {
	doc := &Document{HTML: "<p>content</p>", Header: "ACME Corp",
		Footer: "Confidential", PageNumbers: true}
	data, err := BuildDocPdf(doc)
	if err != nil {
		t.Fatalf("BuildDocPdf: %v", err)
	}
	text := pdfStreamsText(t, data)
	for _, want := range []string{"ACME Corp", "Confidential - 1"} {
		if !strings.Contains(text, want) {
			t.Errorf("missing header/footer text %q", want)
		}
	}
}

// layoutDoc lays out an HTML fragment on an A4 page with 20mm margins and
// returns the top-level boxes, so the tests can assert on line counts and
// block heights instead of guessing from the PDF stream
func layoutDoc(t *testing.T, fragment string) (*docPdf, []pdfBox) {
	t.Helper()
	pdf := fpdf.NewCustom(&fpdf.InitType{OrientationStr: "P", UnitStr: "mm",
		Size: fpdf.SizeType{Wd: 210, Ht: 297}})
	pdf.SetMargins(20, 20, 20)
	pdf.SetCellMargin(0)
	pdf.AddPage()
	d := &docPdf{pdf: pdf, tr: pdfTr(pdf), textW: 170, topY: 20, botY: 277}
	root, err := html.Parse(strings.NewReader("<body>" + fragment + "</body>"))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	var body *html.Node
	var find func(n *html.Node)
	find = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "body" {
			body = n
			return
		}
		for c := n.FirstChild; c != nil && body == nil; c = c.NextSibling {
			find(c)
		}
	}
	find(root)
	return d, d.boxes(body, 20, 170, pdfSeg{sizePt: docBaseSizePt})
}

func boxHeight(b pdfBox) float64 {
	h := 0.0
	for _, it := range b.items {
		h += it.h
	}
	return h
}

// Pasted HTML is hard-wrapped with real newlines; a browser collapses them
// into spaces. Treating them as line breaks used to leave a huge blank gutter
// on the right of every exported page and inflate the page count.
func TestDocPdfCollapsesSourceNewlines(t *testing.T) {
	words := strings.Repeat("lorem ipsum dolor sit amet consectetur ", 6)
	hard := strings.ReplaceAll(words, " ", "\n") // as pasted from a web page
	_, wrapped := layoutDoc(t, "<p>"+words+"</p>")
	_, pasted := layoutDoc(t, "<p>"+hard+"</p>")
	if len(wrapped) != 1 || len(pasted) != 1 {
		t.Fatalf("expected one block each, got %d and %d", len(wrapped), len(pasted))
	}
	if got, want := boxHeight(pasted[0]), boxHeight(wrapped[0]); got != want {
		t.Errorf("hard-wrapped source laid out differently: %.2fmm vs %.2fmm", got, want)
	}
	// 36 words at 11pt fill far fewer than 36 lines once collapsed
	if n := len(wrapped[0].items); n > 6 {
		t.Errorf("text wrapped too early: %d lines for %d words", n, 36)
	}
}

// Lines must run to the right text edge, not stop a wide margin short of it
func TestDocPdfUsesFullTextWidth(t *testing.T) {
	para := "<p>" + strings.Repeat("alpha beta gamma delta ", 8) + "</p>"
	d, _ := layoutDoc(t, para)
	lines := d.paraLines(mustFirstElement(t, para), 170,
		pdfSeg{sizePt: docBaseSizePt}, docLineFactor)
	if len(lines) < 2 {
		t.Fatalf("expected the text to wrap, got %d line(s)", len(lines))
	}
	for i, ln := range lines[:len(lines)-1] { // the last line is short by nature
		if ln.w < 160 {
			t.Errorf("line %d only uses %.1fmm of the 170mm text width", i, ln.w)
		}
		if ln.w > 170 {
			t.Errorf("line %d overflows the text width: %.1fmm", i, ln.w)
		}
	}
}

// Browser rules for near-empty blocks, which decide where pages break
func TestDocPdfEmptyBlockHeights(t *testing.T) {
	line := docBaseSizePt * docLineFactor * 25.4 / 72.0
	cases := []struct {
		name string
		html string
		want float64
	}{
		{"empty paragraph", "<p></p>", 0},
		{"whitespace only", "<p>\n  </p>", 0},
		{"placeholder br", "<p><br></p>", line},
		{"trailing br", "<p>text<br></p>", line},
		{"real break", "<p>a<br>b</p>", 2 * line},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, boxes := layoutDoc(t, tc.html)
			got := 0.0
			for _, b := range boxes {
				got += boxHeight(b)
			}
			if math.Abs(got-tc.want) > 0.01 {
				t.Errorf("height = %.2fmm, want %.2fmm", got, tc.want)
			}
		})
	}
}

// The exported PDF only paginates like the editor's page preview if every
// block is exactly as tall as the browser makes it. The wanted values were
// measured in Chrome with docs.css applied (margin box of the whole flow);
// if docs.css changes, re-measure and update both sides.
func TestDocPdfBlockHeightsMatchEditorCSS(t *testing.T) {
	cases := []struct {
		name string
		html string
		want float64 // mm, as measured in the browser
	}{
		{"plain paragraph", "<p>hello</p>", 5.82},
		{"heading", "<h1>Heading</h1>", 15.87},
		{"heading in a wrapper", "<div><h1>Heading</h1></div>", 15.87},
		{"collapsed margins", "<p>a</p><h1>b</h1>", 21.70},
		{"two headings", "<h1>a</h1><h2>b</h2>", 27.78},
		{"table cell blocks", "<table class=\"of-table\"><tbody><tr>" +
			"<td><h1>Lapwing</h1><p>x</p></td></tr></tbody></table>", 29.90},
		{"table plain cells", "<table class=\"of-table\"><tbody><tr>" +
			"<td>plain</td><td>cell</td></tr></tbody></table>", 14.02},
		{"blockquote", "<blockquote>quoted line</blockquote>", 12.96},
		{"bulleted list", "<ul><li>one</li><li>two</li><li>three</li></ul>", 23.02},
		{"checklist", "<ul class=\"of-checklist\"><li>one</li>" +
			"<li class=\"checked\">two</li></ul>", 16.93},
		{"numbered list", "<ol><li>one</li><li>two</li></ol>", 16.67},
		{"preformatted", "<pre>code line\ncode two</pre>", 21.70},
		{"rule between paragraphs", "<p>a</p><hr><p>b</p>", 21.70},
		{"mixed font sizes", "<p><span style=\"font-size:16pt\">big</span> small</p>", 8.47},
		{"wrapped paragraph", "<p>" + strings.Repeat("alpha beta ", 39) + "</p>", 29.10},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			_, boxes := layoutDoc(t, tc.html)
			got, pending := 0.0, 0.0
			for i, b := range boxes {
				gap := b.mt
				if i > 0 {
					gap = math.Max(pending, b.mt)
				}
				got += gap + boxHeight(b)
				pending = b.mb
			}
			got += pending
			if math.Abs(got-tc.want) > 0.2 {
				t.Errorf("block height = %.2fmm, browser lays it out at %.2fmm",
					got, tc.want)
			}
		})
	}
}

// A block that does not fit on the rest of a page moves to the next one as a
// whole - the same rule the editor's page preview uses - so both agree on the
// page count
func TestDocPdfKeepsBlocksWhole(t *testing.T) {
	// 257mm of usable height / 5.82mm per line = 44 lines per page
	filler := strings.Repeat("<p>filler line</p>", 42)
	para := "<p>" + strings.Repeat("word ", 60) + "</p>" // ~4 lines, cannot fit
	data, err := BuildDocPdf(&Document{HTML: filler + para,
		Page: &PageConf{Size: "A4", Orientation: "portrait",
			Margins: &MarginsMM{Top: 20, Right: 20, Bottom: 20, Left: 20}}})
	if err != nil {
		t.Fatalf("BuildDocPdf: %v", err)
	}
	if got := pdfPageCount(data); got != 2 {
		t.Fatalf("page count = %d, want 2", got)
	}
	// the paragraph must start on page 2, not straddle the break
	pages := strings.SplitN(pdfStreamsText(t, data), "(filler line)", 43)
	if strings.Contains(pages[len(pages)-1], "(word") == false {
		t.Error("paragraph did not move to the next page in one piece")
	}
}

func pdfPageCount(data []byte) int {
	s := string(data)
	return strings.Count(s, "/Type /Page\n") + strings.Count(s, "/Type /Page ")
}

func mustFirstElement(t *testing.T, fragment string) *html.Node {
	t.Helper()
	root, err := html.Parse(strings.NewReader("<body>" + fragment + "</body>"))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	var found *html.Node
	var walk func(n *html.Node)
	walk = func(n *html.Node) {
		if found != nil {
			return
		}
		if n.Type == html.ElementNode && n.Data == "p" {
			found = n
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)
	if found == nil {
		t.Fatal("no <p> in fragment")
	}
	return found
}

// unzipParts reads every text part of a docx/odt package
func unzipParts(t *testing.T, data []byte) map[string]string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("output is not a valid zip: %v", err)
	}
	out := map[string]string{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			continue
		}
		b, _ := io.ReadAll(rc)
		rc.Close()
		out[f.Name] = string(b)
	}
	return out
}

// Header and footer text repeat on every page; hfMode decides where they are
// suppressed (and a suppressed first page suppresses its page number too)
func TestDocPdfHeaderFooterModes(t *testing.T) {
	// three pages of content
	body := strings.Repeat("<p>line</p>", 100)
	cases := []struct {
		mode            string
		wantPerPage     []int // page -> expected count of the header text
		wantPageNumbers []string
	}{
		{HFModeAll, []int{1, 1, 1}, []string{"1", "2", "3"}},
		{HFModeExceptFirst, []int{0, 1, 1}, []string{"2", "3"}},
		{HFModeNone, []int{0, 0, 0}, []string{"1", "2", "3"}},
	}
	for _, tc := range cases {
		t.Run(tc.mode, func(t *testing.T) {
			data, err := BuildDocPdf(&Document{HTML: body, Header: "ACME Corp",
				Footer: "Confidential", PageNumbers: true, HFMode: tc.mode,
				Page: &PageConf{Size: "A4", Orientation: "portrait",
					Margins: &MarginsMM{Top: 20, Right: 20, Bottom: 20, Left: 20}}})
			if err != nil {
				t.Fatalf("BuildDocPdf: %v", err)
			}
			if got := pdfPageCount(data); got != 3 {
				t.Fatalf("page count = %d, want 3", got)
			}
			text := pdfStreamsText(t, data)
			want := 0
			for _, n := range tc.wantPerPage {
				want += n
			}
			if got := strings.Count(text, "ACME Corp"); got != want {
				t.Errorf("header drawn %d time(s), want %d", got, want)
			}
			if got := strings.Count(text, "Confidential"); got != want {
				t.Errorf("footer drawn %d time(s), want %d", got, want)
			}
			for _, n := range tc.wantPageNumbers {
				marker := "Confidential - " + n
				if tc.mode == HFModeNone {
					marker = "(" + n + ")"
				}
				if !strings.Contains(text, marker) {
					t.Errorf("page counter %q missing", marker)
				}
			}
			if tc.mode == HFModeExceptFirst && strings.Contains(text, "(1) Tj") {
				t.Error("page 1 must not carry a page number when it has no footer")
			}
		})
	}
}

func TestDocxHeaderFooterModes(t *testing.T) {
	doc := &Document{HTML: "<p>x</p>", Header: "Head", Footer: "Foot",
		PageNumbers: true, HFMode: HFModeExceptFirst}
	data, err := BuildDocx(doc)
	if err != nil {
		t.Fatalf("BuildDocx: %v", err)
	}
	parts := unzipParts(t, data)
	if !strings.Contains(parts["word/document.xml"], "<w:titlePg/>") {
		t.Error("except-first must set <w:titlePg/> so Word blanks page 1")
	}
	if !strings.Contains(parts["word/header1.xml"], "Head") {
		t.Error("header part missing")
	}
	// round trip: the reader recognises it again
	back, err := ParseDocx(data)
	if err != nil {
		t.Fatalf("ParseDocx: %v", err)
	}
	if back.HFMode != HFModeExceptFirst {
		t.Errorf("hfMode round trip = %q, want %q", back.HFMode, HFModeExceptFirst)
	}

	doc.HFMode = HFModeNone
	data, err = BuildDocx(doc)
	if err != nil {
		t.Fatalf("BuildDocx: %v", err)
	}
	parts = unzipParts(t, data)
	if _, ok := parts["word/header1.xml"]; ok {
		t.Error("mode none must not write a header part")
	}
	// the page counter is its own setting and survives
	if !strings.Contains(parts["word/footer1.xml"], "PAGE") {
		t.Error("page number field lost")
	}
	if strings.Contains(parts["word/footer1.xml"], "Foot") {
		t.Error("mode none must drop the footer text")
	}
}

func TestOdtHeaderFooterModes(t *testing.T) {
	doc := &Document{HTML: "<p>x</p>", Header: "Head", Footer: "Foot",
		HFMode: HFModeExceptFirst}
	data, err := BuildOdt(doc)
	if err != nil {
		t.Fatalf("BuildOdt: %v", err)
	}
	styles := unzipParts(t, data)["styles.xml"]
	for _, want := range []string{"<style:header>", "<style:header-first>",
		"<style:footer-first>"} {
		if !strings.Contains(styles, want) {
			t.Errorf("styles.xml missing %s", want)
		}
	}
	back, err := ParseOdt(data)
	if err != nil {
		t.Fatalf("ParseOdt: %v", err)
	}
	if back.HFMode != HFModeExceptFirst {
		t.Errorf("hfMode round trip = %q, want %q", back.HFMode, HFModeExceptFirst)
	}

	doc.HFMode = HFModeNone
	data, err = BuildOdt(doc)
	if err != nil {
		t.Fatalf("BuildOdt: %v", err)
	}
	if styles := unzipParts(t, data)["styles.xml"]; strings.Contains(styles, "Head") {
		t.Error("mode none must not write header text")
	}
}

func TestSheetPdf(t *testing.T) {
	m := &SheetPrintModel{Sheets: []*SheetPrintSheet{
		{Name: "Budget", ColW: []float64{120, 80},
			Rows: [][]*SheetPrintCell{
				{{T: "Item", B: true, Bg: "#dde5f0"}, {T: "Cost", B: true, Bg: "#dde5f0", Al: "r"}},
				{{T: "Paper"}, {T: "12.50", Al: "r"}},
			}},
		{Name: "Notes", ColW: []float64{200},
			Rows: [][]*SheetPrintCell{{{T: "remember the milk"}}}},
	}}
	data, err := BuildSheetPdf(m)
	if err != nil {
		t.Fatalf("BuildSheetPdf: %v", err)
	}
	text := pdfStreamsText(t, data)
	for _, want := range []string{"Budget", "Item", "Cost", "Paper", "12.50", "Notes", "remember the milk"} {
		if !strings.Contains(text, want) {
			t.Errorf("sheet PDF missing %q", want)
		}
	}
}

func TestPdfFitText(t *testing.T) {
	pdf := fpdf.New("L", "mm", "A4", "")
	pdf.AddPage()
	pdf.SetFont("Arial", "", 9)
	tr := pdfTr(pdf)

	wide := pdf.GetStringWidth(tr("2026-08-24 21:01:24")) + 1

	tests := []struct {
		name string
		in   string
		maxW float64
		want string // "" means: expect exactly the translated input back
	}{
		{"fits untouched", "2026-08-24 21:01:24", wide, ""},
		{"empty stays empty", "", wide, ""},
		{"zero width yields nothing", "anything", 0, ""},
		{"negative width yields nothing", "anything", -5, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := pdfFitText(pdf, tr, tc.in, tc.maxW)
			want := tc.want
			if want == "" && tc.maxW > 0 {
				want = tr(tc.in)
			}
			if got != want {
				t.Errorf("pdfFitText(%q, %v) = %q, want %q", tc.in, tc.maxW, got, want)
			}
		})
	}

	// the real job: a string too wide for its cell comes back shortened,
	// never wider than the cell it has to sit in
	t.Run("overlong text is trimmed to fit", func(t *testing.T) {
		long := "need help with my Deployment configuration"
		narrow := pdf.GetStringWidth(tr(long)) / 3
		got := pdfFitText(pdf, tr, long, narrow)
		if w := pdf.GetStringWidth(got); w > narrow {
			t.Errorf("fitted text is %v wide, cell is only %v", w, narrow)
		}
		if got == tr(long) {
			t.Error("overlong text was returned unchanged")
		}
		if !strings.HasPrefix(got, tr("need")) {
			t.Errorf("trimmed text lost its start: %q", got)
		}
	})

	// a cut must not land in the middle of a multi-byte character
	t.Run("multi-byte text is cut on rune boundaries", func(t *testing.T) {
		s := "café crème brûlée gâteau"
		got := pdfFitText(pdf, tr, s, pdf.GetStringWidth(tr(s))/2)
		if w := pdf.GetStringWidth(got); w > pdf.GetStringWidth(tr(s))/2 {
			t.Errorf("fitted text %q overflows", got)
		}
		if got == "" {
			t.Error("multi-byte text was dropped entirely")
		}
	})

	// whatever comes back must fit, however little room there is - including
	// a column too narrow for even the ellipsis
	t.Run("never wider than the cell", func(t *testing.T) {
		for _, maxW := range []float64{0.5, 1, 2, 3, 5, 10, 25} {
			got := pdfFitText(pdf, tr, "abcdefghij klmnop", maxW)
			if w := pdf.GetStringWidth(got); w > maxW {
				t.Errorf("maxW=%v: got %q which is %v wide", maxW, got, w)
			}
		}
	})
}

// the bug this pins down: fpdf's CellFormat does not clip, so a cell wider
// than its column used to be painted straight over the next column
func TestSheetPdfClipsOverlongCells(t *testing.T) {
	overflow := "need help with my Deployment configuration"
	// the Name column is wide enough for its value; the Message column is not
	m := &SheetPrintModel{Sheets: []*SheetPrintSheet{
		{Name: "contact-form", ColW: []float64{140, 200, 120, 90},
			Rows: [][]*SheetPrintCell{
				{{T: "Submitted at", B: true}, {T: "Name", B: true}, {T: "Email", B: true}, {T: "Message", B: true}},
				{{T: "2026-08-24 21:01:24"}, {T: "Yami Odymel"}, {T: "yami@foobar.com"}, {T: overflow}},
			}},
	}}
	data, err := BuildSheetPdf(m)
	if err != nil {
		t.Fatalf("BuildSheetPdf: %v", err)
	}
	text := pdfStreamsText(t, data)
	if strings.Contains(text, overflow) {
		t.Error("a cell too wide for its column was drawn in full and overlaps its neighbour")
	}
	// short cells must still be written out untouched
	if !strings.Contains(text, "Yami Odymel") {
		t.Error("a cell that fits its column was trimmed anyway")
	}
	if !strings.Contains(text, "need") {
		t.Error("the trimmed cell lost its leading text entirely")
	}
}

func TestParseSheetPrintJSON(t *testing.T) {
	if _, err := ParseSheetPrintJSON("{"); err == nil {
		t.Error("invalid JSON accepted")
	}
	if _, err := ParseSheetPrintJSON(`{"sheets":[]}`); err == nil {
		t.Error("empty model accepted")
	}
	m, err := ParseSheetPrintJSON(`{"sheets":[{"name":"S1","colW":[100],"rows":[[{"t":"x"}]]}]}`)
	if err != nil {
		t.Fatalf("valid model rejected: %v", err)
	}
	if m.Sheets[0].Rows[0][0].T != "x" {
		t.Error("cell text lost in parse")
	}
}

func TestSlidesPdf(t *testing.T) {
	pres := &Presentation{Theme: "clean", Slides: []*Slide{
		{Objects: []*Object{
			{Type: "text", X: 60, Y: 40, W: 840, H: 80,
				Props: Props{HTML: "Slide Title", FontSize: 40, Bold: true, Align: "center"}},
			{Type: "shape", X: 100, Y: 200, W: 200, H: 100,
				Props: Props{Kind: "rect", Fill: "#34568a", Text: "Caption"}},
			{Type: "table", X: 400, Y: 200, W: 400, H: 120,
				Props: Props{Rows: [][]string{{"H1", "H2"}, {"a", "b"}}, HeaderRow: true}},
		}},
		{Bg: "#101418", Objects: []*Object{
			{Type: "video", X: 100, Y: 60, W: 480, H: 270,
				Props: Props{Src: "../../media?file=user%3A%2Fclip.mp4"}},
		}},
	}}
	data, err := BuildSlidesPdf(pres)
	if err != nil {
		t.Fatalf("BuildSlidesPdf: %v", err)
	}
	s := string(data)
	// 960x540 px deck -> 720 x 405 pt pages
	if !strings.Contains(s, "720.00 405.00") {
		t.Error("slide page size wrong (expected 720x405pt)")
	}
	text := pdfStreamsText(t, data)
	for _, want := range []string{"Slide Title", "Caption", "H1", "a"} {
		if !strings.Contains(text, want) {
			t.Errorf("slides PDF missing %q", want)
		}
	}
	// the video placeholder embeds the poster PNG as an image object
	if !strings.Contains(s, "/Subtype /Image") {
		t.Error("video poster image missing")
	}
}
