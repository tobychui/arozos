package pdf

import (
	"bytes"
	"math"
	"regexp"
	"strconv"
	"testing"
	"unicode/utf16"

	"imuslab.com/arozos/mod/office/model"
)

// outlineEntry is one bookmark read back from a PDF
type outlineEntry struct {
	title string
	depth int     // 0 = top level
	page  int     // 1-based
	top   float64 // the /XYZ top of its destination, pt
}

var (
	pdfObjRe    = regexp.MustCompile(`(?s)(\d+) 0 obj\s*(.*?)endobj`)
	pdfParentRe = regexp.MustCompile(`/Parent (\d+) 0 R`)
	pdfDestRe   = regexp.MustCompile(`/Dest \[(\d+) 0 R /XYZ [\d.]+ ([\d.]+) null\]`)
)

// pdfLiteral reads the PDF literal string that starts at s[0] == '(' and
// decodes a UTF-16BE text string behind a byte order mark
func pdfLiteral(t *testing.T, s []byte) string {
	t.Helper()
	var out []byte
	for i := 1; i < len(s); i++ {
		c := s[i]
		if c == ')' {
			if len(out) >= 2 && out[0] == 0xFE && out[1] == 0xFF {
				u := make([]uint16, 0, len(out)/2)
				for j := 2; j+1 < len(out); j += 2 {
					u = append(u, uint16(out[j])<<8|uint16(out[j+1]))
				}
				return string(utf16.Decode(u))
			}
			return string(out)
		}
		if c == '\\' && i+1 < len(s) {
			i++
			switch s[i] {
			case 'r':
				out = append(out, '\r')
			case 'n':
				out = append(out, '\n')
			default:
				out = append(out, s[i])
			}
			continue
		}
		out = append(out, c)
	}
	t.Fatal("unterminated string in outline entry")
	return ""
}

// pdfOutlineOf lists the outline entries of a PDF fpdf wrote, in order
func pdfOutlineOf(t *testing.T, data []byte) []outlineEntry {
	t.Helper()
	objs := map[int][]byte{}
	var order []int
	pageNo := map[int]int{}
	for _, m := range pdfObjRe.FindAllSubmatch(data, -1) {
		n, _ := strconv.Atoi(string(m[1]))
		objs[n] = m[2]
		order = append(order, n)
		if bytes.Contains(m[2], []byte("/Type /Page\n")) || bytes.Contains(m[2], []byte("/Type /Page ")) {
			pageNo[n] = len(pageNo) + 1
		}
	}
	var out []outlineEntry
	for _, n := range order {
		body := objs[n]
		if !bytes.HasPrefix(body, []byte("<</Title (")) {
			continue
		}
		e := outlineEntry{title: pdfLiteral(t, body[len("<</Title "):])}
		for p := n; ; e.depth++ {
			m := pdfParentRe.FindSubmatch(objs[p])
			if m == nil {
				t.Fatalf("outline entry %q has no parent chain", e.title)
			}
			p, _ = strconv.Atoi(string(m[1]))
			if bytes.Contains(objs[p], []byte("/Type /Outlines")) {
				break
			}
		}
		if m := pdfDestRe.FindSubmatch(body); m != nil {
			ref, _ := strconv.Atoi(string(m[1]))
			e.page = pageNo[ref]
			e.top, _ = strconv.ParseFloat(string(m[2]), 64)
		}
		out = append(out, e)
	}
	return out
}

func TestDocPdfOutline(t *testing.T) {
	type want struct {
		title string
		depth int
		page  int
	}
	cases := []struct {
		name string
		html string
		want []want
	}{
		{"nests by level", `<h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2><h1>E</h1>`,
			[]want{{"A", 0, 1}, {"B", 1, 1}, {"C", 2, 1}, {"D", 1, 1}, {"E", 0, 1}}},
		{"skipped levels nest one step", `<h1>A</h1><h3>B</h3><h2>C</h2><h4>D</h4>`,
			[]want{{"A", 0, 1}, {"B", 1, 1}, {"C", 1, 1}, {"D", 2, 1}}},
		{"starts below level 1", `<h3>Intro</h3><h4>Detail</h4><h3>Features</h3>`,
			[]want{{"Intro", 0, 1}, {"Detail", 1, 1}, {"Features", 0, 1}}},
		{"title, empty headings and footnote markers",
			`<h1 class="doc-title">Report</h1><h2> </h2><h2>Intro<sup class="doc-fnref">1</sup></h2>`,
			[]want{{"Intro", 0, 1}}},
		{"whitespace and line breaks", "<h2>Two\n   lines<br>here</h2>",
			[]want{{"Two lines here", 0, 1}}},
		{"any script", `<h1>系統概覽 (Overview)</h1><h2>Ünïcödé \ path</h2>`,
			[]want{{"系統概覽 (Overview)", 0, 1}, {"Ünïcödé \\ path", 1, 1}}},
		{"headings inside a table", `<table><tbody><tr><td><h2>In a cell</h2></td></tr></tbody></table>`,
			[]want{{"In a cell", 0, 1}}},
		{"follows page breaks", `<h1>One</h1><div class="doc-pagebreak"></div><h1>Two</h1><h2>Sub</h2>`,
			[]want{{"One", 0, 1}, {"Two", 0, 2}, {"Sub", 1, 2}}},
		{"no headings", `<p>Just text</p>`, nil},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			data, err := BuildDoc(&model.Document{HTML: tc.html})
			if err != nil {
				t.Fatalf("BuildDoc: %v", err)
			}
			got := pdfOutlineOf(t, data)
			if len(got) != len(tc.want) {
				t.Fatalf("got %d outline entries %+v, want %d", len(got), got, len(tc.want))
			}
			for i, w := range tc.want {
				g := got[i]
				if g.title != w.title || g.depth != w.depth || g.page != w.page {
					t.Errorf("entry %d = %q depth %d page %d, want %q depth %d page %d",
						i, g.title, g.depth, g.page, w.title, w.depth, w.page)
				}
			}
			if tc.want == nil && bytes.Contains(data, []byte("/Outlines")) {
				t.Errorf("a document without headings has an outline")
			}
		})
	}
}

// a bookmark opens its page with the heading's line at the top of the view
func TestDocPdfOutlineDestination(t *testing.T) {
	data, err := BuildDoc(&model.Document{HTML: `<p>first</p><div class="doc-pagebreak"></div><h1>Top of page 2</h1>`})
	if err != nil {
		t.Fatalf("BuildDoc: %v", err)
	}
	got := pdfOutlineOf(t, data)
	if len(got) != 1 {
		t.Fatalf("got %d outline entries, want 1", len(got))
	}
	// A4, 25.4mm top margin, then the heading's 14pt margin-top, which
	// applies again below a break: where its first line box starts
	wantTop := (297.0-25.4)*72/25.4 - 14
	if got[0].page != 2 || math.Abs(got[0].top-wantTop) > 0.5 {
		t.Errorf("destination page %d top %.2f, want page 2 top %.2f", got[0].page, got[0].top, wantTop)
	}
}

func TestSheetPdfOutline(t *testing.T) {
	long := make([][]*SheetPrintCell, 40)
	for i := range long {
		long[i] = []*SheetPrintCell{{T: "row " + strconv.Itoa(i)}}
	}
	m := &SheetPrintModel{Sheets: []*SheetPrintSheet{
		{Name: "Data", Rows: long},
		{Name: "  ", Rows: [][]*SheetPrintCell{{{T: "x"}}}},
		{Name: "總表  Summary"},
	}}
	data, err := BuildSheet(m)
	if err != nil {
		t.Fatalf("BuildSheet: %v", err)
	}
	got := pdfOutlineOf(t, data)
	want := []outlineEntry{{title: "Data", page: 1}, {title: "Sheet 2", page: 3}, {title: "總表 Summary", page: 4}}
	if pdfPageCount(data) != 4 {
		// the first sheet's 40 rows run over two pages
		t.Fatalf("got %d pages, want 4 (the first sheet runs over two)", pdfPageCount(data))
	}
	if len(got) != len(want) {
		t.Fatalf("got %d outline entries %+v, want %d", len(got), got, len(want))
	}
	for i, w := range want {
		if got[i].title != w.title || got[i].page != w.page || got[i].depth != 0 {
			t.Errorf("entry %d = %q depth %d page %d, want %q depth 0 page %d",
				i, got[i].title, got[i].depth, got[i].page, w.title, w.page)
		}
	}
}

func TestPdfTextString(t *testing.T) {
	cases := []struct {
		in   string
		want []byte
	}{
		{"", []byte{0xFE, 0xFF}},
		{"AB", []byte{0xFE, 0xFF, 0x00, 0x41, 0x00, 0x42}},
		{"系", []byte{0xFE, 0xFF, 0x7C, 0xFB}},
		// outside the BMP: a surrogate pair
		{string(rune(0x20000)), []byte{0xFE, 0xFF, 0xD8, 0x40, 0xDC, 0x00}},
	}
	for _, tc := range cases {
		if got := []byte(pdfTextString(tc.in)); !bytes.Equal(got, tc.want) {
			t.Errorf("pdfTextString(%q) = % X, want % X", tc.in, got, tc.want)
		}
	}
}
