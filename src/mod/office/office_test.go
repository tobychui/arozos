package office

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"
)

// 1x1 red PNG for image round-trip tests
const testPngDataURL = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="

func samplePresentation() *Presentation {
	return &Presentation{
		Size:  []int{960, 540},
		Theme: "clean",
		Slides: []*Slide{
			{
				ID:    "s1",
				Notes: "hello notes",
				Objects: []*Object{
					{Type: "text", X: 80, Y: 60, W: 800, H: 90, Z: 1,
						Props: Props{HTML: "Title line&amp;more<br>second line", FontSize: 44, Color: "#202124", Align: "center", Bold: true}},
					{Type: "shape", X: 100, Y: 200, W: 200, H: 160, Z: 2,
						Props: Props{Kind: "star", Fill: "#e07b1f", Stroke: "#333333", StrokeW: 2, Text: "star text", FontSize: 18}},
					{Type: "line", X: 400, Y: 300, W: -120, H: 80, Z: 3,
						Props: Props{Stroke: "#4c9be8", StrokeW: 3, ArrowEnd: true}},
					{Type: "image", X: 500, Y: 100, W: 200, H: 150, Z: 4,
						Props: Props{Src: testPngDataURL, Fit: "contain"}},
					{Type: "table", X: 60, Y: 380, W: 400, H: 120, Z: 5,
						Props: Props{Rows: [][]string{{"h1", "h2"}, {"a", "b"}}, HeaderRow: true, FontSize: 16}},
				},
			},
			{
				ID: "s2",
				Bg: "#123456",
				Objects: []*Object{
					{Type: "chart", X: 240, Y: 110, W: 480, H: 320, Z: 1,
						Props: Props{Png: testPngDataURL}},
				},
			},
		},
	}
}

func TestBuildPptxStructure(t *testing.T) {
	data, err := BuildPptx(samplePresentation())
	if err != nil {
		t.Fatalf("BuildPptx failed: %v", err)
	}

	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("output is not a valid zip: %v", err)
	}

	wantParts := []string{
		"[Content_Types].xml",
		"_rels/.rels",
		"ppt/presentation.xml",
		"ppt/_rels/presentation.xml.rels",
		"ppt/slideMasters/slideMaster1.xml",
		"ppt/slideLayouts/slideLayout1.xml",
		"ppt/theme/theme1.xml",
		"ppt/slides/slide1.xml",
		"ppt/slides/slide2.xml",
		"ppt/slides/_rels/slide1.xml.rels",
		"ppt/media/image1.png",
		"ppt/media/image2.png",
	}
	have := map[string]bool{}
	for _, f := range zr.File {
		have[f.Name] = true
	}
	for _, p := range wantParts {
		if !have[p] {
			t.Errorf("missing expected pptx part: %s", p)
		}
	}
}

func TestBuildPptxErrors(t *testing.T) {
	tests := []struct {
		name string
		pres *Presentation
	}{
		{"nil presentation", nil},
		{"no slides", &Presentation{Slides: []*Slide{}}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := BuildPptx(tc.pres); err == nil {
				t.Errorf("expected error, got nil")
			}
		})
	}
}

func TestParsePptxInvalid(t *testing.T) {
	tests := []struct {
		name string
		data []byte
	}{
		{"garbage bytes", []byte("this is not a zip file at all")},
		{"empty", []byte{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := ParsePptx(tc.data); err == nil {
				t.Errorf("expected error, got nil")
			}
		})
	}
}

func TestPptxRoundtrip(t *testing.T) {
	src := samplePresentation()
	data, err := BuildPptx(src)
	if err != nil {
		t.Fatalf("BuildPptx failed: %v", err)
	}
	got, err := ParsePptx(data)
	if err != nil {
		t.Fatalf("ParsePptx failed on own output: %v", err)
	}

	if len(got.Slides) != 2 {
		t.Fatalf("slide count = %d, want 2", len(got.Slides))
	}

	s1 := got.Slides[0]
	types := map[string]int{}
	for _, o := range s1.Objects {
		types[o.Type]++
	}
	// slide 1: text + shape + line + image + table
	for _, want := range []string{"text", "shape", "line", "image", "table"} {
		if types[want] != 1 {
			t.Errorf("slide 1 object types = %v, want one %q", types, want)
		}
	}

	// text content survives (flattened to lines)
	var textObj *Object
	for _, o := range s1.Objects {
		if o.Type == "text" {
			textObj = o
		}
	}
	if textObj == nil {
		t.Fatal("no text object found after roundtrip")
	}
	if !strings.Contains(textObj.Props.HTML, "Title line&amp;more") ||
		!strings.Contains(textObj.Props.HTML, "second line") {
		t.Errorf("text content lost in roundtrip: %q", textObj.Props.HTML)
	}
	if !textObj.Props.Bold {
		t.Errorf("bold flag lost in roundtrip")
	}
	if textObj.Props.Align != "center" {
		t.Errorf("align = %q, want center", textObj.Props.Align)
	}
	// 44px -> 33pt -> back to 44px
	if textObj.Props.FontSize < 43 || textObj.Props.FontSize > 45 {
		t.Errorf("font size = %v, want ~44", textObj.Props.FontSize)
	}
	// position tolerance: EMU conversion is lossless at these scales
	if textObj.X < 79 || textObj.X > 81 {
		t.Errorf("text X = %v, want ~80", textObj.X)
	}

	// shape kind + text survive
	for _, o := range s1.Objects {
		if o.Type == "shape" {
			if o.Props.Kind != "star" {
				t.Errorf("shape kind = %q, want star", o.Props.Kind)
			}
			if o.Props.Text != "star text" {
				t.Errorf("shape text = %q, want %q", o.Props.Text, "star text")
			}
		}
		if o.Type == "line" {
			// negative W encodes direction; must survive via flipH
			if o.W >= 0 {
				t.Errorf("line W = %v, want negative (flipH lost)", o.W)
			}
			if !o.Props.ArrowEnd {
				t.Errorf("line arrowEnd lost in roundtrip")
			}
		}
		if o.Type == "image" {
			if !strings.HasPrefix(o.Props.Src, "data:image/png;base64,") {
				t.Errorf("image src is not a png data URL: %.40s", o.Props.Src)
			}
		}
		if o.Type == "table" {
			if len(o.Props.Rows) != 2 || len(o.Props.Rows[0]) != 2 {
				t.Fatalf("table dims = %dx%d, want 2x2", len(o.Props.Rows), len(o.Props.Rows[0]))
			}
			if o.Props.Rows[0][0] != "h1" || o.Props.Rows[1][1] != "b" {
				t.Errorf("table content lost: %v", o.Props.Rows)
			}
			if !o.Props.HeaderRow {
				t.Errorf("headerRow flag lost")
			}
		}
	}

	// slide 2: explicit background + chart-as-image
	s2 := got.Slides[1]
	if s2.Bg != "#123456" {
		t.Errorf("slide 2 bg = %q, want #123456", s2.Bg)
	}
	if len(s2.Objects) != 1 || s2.Objects[0].Type != "image" {
		t.Errorf("slide 2: chart should import as one image, got %+v", s2.Objects)
	}
}

func TestTableCellHtmlFlatten(t *testing.T) {
	// table cells store a limited HTML subset in the editor; the pptx
	// writer must flatten it to text paragraphs (never leak literal tags)
	pres := &Presentation{
		Slides: []*Slide{{
			Objects: []*Object{{
				Type: "table", X: 10, Y: 10, W: 400, H: 100, Z: 1,
				Props: Props{Rows: [][]string{{"<b>x</b>&amp;y<br>z", "plain"}}},
			}},
		}},
	}
	data, err := BuildPptx(pres)
	if err != nil {
		t.Fatalf("BuildPptx failed: %v", err)
	}
	if bytes.Contains(data, []byte("&lt;b&gt;")) {
		t.Errorf("literal <b> tag leaked into the pptx output")
	}
	got, err := ParsePptx(data)
	if err != nil {
		t.Fatalf("ParsePptx failed: %v", err)
	}
	cell := got.Slides[0].Objects[0].Props.Rows[0][0]
	if cell != "x&amp;y<br>z" {
		t.Errorf("cell after roundtrip = %q, want %q", cell, "x&amp;y<br>z")
	}
}

func TestParsePresentationJSON(t *testing.T) {
	tests := []struct {
		name    string
		json    string
		wantErr bool
	}{
		{"valid", `{"size":[960,540],"slides":[{"objects":[]}]}`, false},
		{"no slides", `{"size":[960,540],"slides":[]}`, true},
		{"invalid json", `{not json`, true},
		{"empty", ``, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParsePresentationJSON(tc.json)
			if (err != nil) != tc.wantErr {
				t.Errorf("err = %v, wantErr = %v", err, tc.wantErr)
			}
		})
	}
}

func TestHtmlToLines(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want []string
	}{
		{"plain", "hello", []string{"hello"}},
		{"br split", "a<br>b", []string{"a", "b"}},
		{"br self-closing", "a<br/>b", []string{"a", "b"}},
		{"divs", "<div>a</div><div>b</div>", []string{"a", "b"}},
		{"tags stripped", "<b>bold</b> text", []string{"bold text"}},
		{"entities", "a &amp; b &lt;c&gt;", []string{"a & b <c>"}},
		{"empty", "", []string{""}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := htmlToLines(tc.in)
			if len(got) != len(tc.want) {
				t.Fatalf("lines = %q, want %q", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("line %d = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}

func TestHexColor(t *testing.T) {
	tests := []struct {
		in, fallback, want string
	}{
		{"#aabbcc", "000000", "AABBCC"},
		{"aabbcc", "000000", "AABBCC"},
		{"#abc", "000000", "AABBCC"},
		{"nonsense", "112233", "112233"},
		{"", "112233", "112233"},
		{"#12345", "FFFFFF", "FFFFFF"},
	}
	for _, tc := range tests {
		if got := hexColor(tc.in, tc.fallback); got != tc.want {
			t.Errorf("hexColor(%q) = %q, want %q", tc.in, got, tc.want)
		}
	}
}

func TestDecodeDataURL(t *testing.T) {
	tests := []struct {
		name    string
		in      string
		wantOk  bool
		wantExt string
	}{
		{"png", testPngDataURL, true, "png"},
		{"jpeg", "data:image/jpeg;base64,aGVsbG8=", true, "jpeg"},
		{"not data url", "https://example.com/x.png", false, ""},
		{"no base64 marker", "data:image/png,rawdata", false, ""},
		{"bad base64", "data:image/png;base64,!!!!", false, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, ext, ok := decodeDataURL(tc.in)
			if ok != tc.wantOk {
				t.Fatalf("ok = %v, want %v", ok, tc.wantOk)
			}
			if ok && ext != tc.wantExt {
				t.Errorf("ext = %q, want %q", ext, tc.wantExt)
			}
		})
	}
}

func TestEmuConversion(t *testing.T) {
	if pxToEmu(960) != 9144000 {
		t.Errorf("pxToEmu(960) = %d, want 9144000", pxToEmu(960))
	}
	if px := emuToPx(9144000, 1.0); px < 959.9 || px > 960.1 {
		t.Errorf("emuToPx(9144000) = %v, want 960", px)
	}
}

func TestHtmlToLinesLists(t *testing.T) {
	tests := []struct {
		name string
		in   string
		want []string
	}{
		{"bullet list", "intro<ul><li>alpha</li><li>beta</li></ul>",
			[]string{"intro", "• alpha", "• beta"}},
		{"numbered list", "<ol><li>one</li><li>two</li><li>three</li></ol>",
			[]string{"1. one", "2. two", "3. three"}},
		{"nested", "<ul><li>a<ul><li>a1</li></ul></li><li>b</li></ul>",
			[]string{"• a", "  • a1", "• b"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := htmlToLines(tc.in)
			// drop trailing empties for comparison
			for len(got) > 0 && strings.TrimSpace(got[len(got)-1]) == "" {
				got = got[:len(got)-1]
			}
			if len(got) != len(tc.want) {
				t.Fatalf("lines = %q, want %q", got, tc.want)
			}
			for i := range got {
				if got[i] != tc.want[i] {
					t.Errorf("line %d = %q, want %q", i, got[i], tc.want[i])
				}
			}
		})
	}
}
