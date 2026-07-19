package office

import (
	"bytes"
	"compress/zlib"
	"io"
	"strings"
	"testing"
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
	// bullets are cp1252-translated (byte 0x95) in the stream
	for _, want := range []string{"Lapwing", "\x95 Waifu", "\x95 Cute"} {
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
