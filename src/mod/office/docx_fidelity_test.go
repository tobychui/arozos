package office

import (
	"bytes"
	"encoding/base64"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"math"
	"strings"
	"testing"
)

// tiny real PNG with a known non-4:3 aspect (100x25)
func makePngDataURL(t *testing.T, w, h int) string {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for x := 0; x < w; x++ {
		for y := 0; y < h; y++ {
			img.Set(x, y, color.RGBA{R: 200, G: 30, B: 30, A: 255})
		}
	}
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatalf("png encode: %v", err)
	}
	return "data:image/png;base64," + base64.StdEncoding.EncodeToString(buf.Bytes())
}

func TestDocxImageKeepsNaturalAspect(t *testing.T) {
	// width given, no height: docx must derive height from the 100x25
	// natural size (aspect 4:1), not the old 4:3 guess
	src := makePngDataURL(t, 100, 25)
	doc := &Document{HTML: `<p><img src="` + src + `" width="400"></p>`}
	data, err := BuildDocx(doc)
	if err != nil {
		t.Fatalf("BuildDocx: %v", err)
	}
	body := string(zipPart(t, data, "word/document.xml"))
	wantCx := pxToEmu(400)
	wantCy := pxToEmu(100) // 400 * 25/100
	want := fmt.Sprintf(`<wp:extent cx="%d" cy="%d"/>`, wantCx, wantCy)
	if !strings.Contains(body, want) {
		t.Errorf("expected %s in document.xml, got: %s", want, snippetAround(body, "wp:extent"))
	}
}

func TestDocxImageNoSizeUsesNatural(t *testing.T) {
	src := makePngDataURL(t, 120, 90)
	doc := &Document{HTML: `<p><img src="` + src + `"></p>`}
	data, err := BuildDocx(doc)
	if err != nil {
		t.Fatalf("BuildDocx: %v", err)
	}
	body := string(zipPart(t, data, "word/document.xml"))
	want := fmt.Sprintf(`<wp:extent cx="%d" cy="%d"/>`, pxToEmu(120), pxToEmu(90))
	if !strings.Contains(body, want) {
		t.Errorf("expected %s, got: %s", want, snippetAround(body, "wp:extent"))
	}
}

func TestDocxImageCappedToTextWidth(t *testing.T) {
	src := makePngDataURL(t, 100, 50)
	textW := textWidthPt(nil) // A4, 25.4mm margins
	emu := func(pt float64) int64 { return int64(math.Round(pt * 12700)) }
	tests := []struct {
		name, img string
		cx, cy    int64
	}{
		// no stated height: the editor scales it with the width
		{"automatic height", `<img src="` + src + `" width="1240">`, emu(textW), emu(textW / 2)},
		// a stated height stays as the editor shows it (max-width only)
		{"stated height", `<img src="` + src + `" style="width:600pt;height:200pt;">`, emu(textW), emu(200)},
		{"narrow picture", `<img src="` + src + `" style="width:300pt;height:150pt;">`, emu(300), emu(150)},
	}
	for _, tc := range tests {
		data, err := BuildDocx(&Document{HTML: `<p>` + tc.img + `</p>`})
		if err != nil {
			t.Fatalf("%s: BuildDocx: %v", tc.name, err)
		}
		body := string(zipPart(t, data, "word/document.xml"))
		want := fmt.Sprintf(`<wp:extent cx="%d" cy="%d"/>`, tc.cx, tc.cy)
		if !strings.Contains(body, want) {
			t.Errorf("%s: expected %s, got: %s", tc.name, want, snippetAround(body, "wp:extent"))
		}
	}
}

func TestDocxTableWidthAndShading(t *testing.T) {
	doc := &Document{HTML: `<table class="of-table">` +
		`<colgroup><col style="width:60%"><col style="width:40%"></colgroup>` +
		`<tbody><tr>` +
		`<td style="background-color: rgb(60, 64, 67); font-weight: 700;">A</td>` +
		`<td>B</td></tr></tbody></table>`}
	data, err := BuildDocx(doc)
	if err != nil {
		t.Fatalf("BuildDocx: %v", err)
	}
	body := string(zipPart(t, data, "word/document.xml"))
	// full text width (A4, 25.4mm margins: 9026 twips), fixed layout
	if !strings.Contains(body, `<w:tblW w:w="9026" w:type="dxa"/>`) {
		t.Errorf("table is not full width: %s", snippetAround(body, "tblW"))
	}
	if !strings.Contains(body, `<w:tblLayout w:type="fixed"/>`) {
		t.Error("table layout is not fixed")
	}
	// column proportions from the colgroup: 60% and 40% of 9026 twips
	if !strings.Contains(body, `<w:gridCol w:w="5416"/>`) ||
		!strings.Contains(body, `<w:gridCol w:w="3610"/>`) {
		t.Errorf("grid columns do not follow the colgroup: %s", snippetAround(body, "tblGrid"))
	}
	if !strings.Contains(body, `<w:tcW w:w="5416" w:type="dxa"/>`) ||
		!strings.Contains(body, `<w:tcW w:w="3610" w:type="dxa"/>`) {
		t.Errorf("cell widths not proportional: %s", snippetAround(body, "tcW"))
	}
	// theme shading + bold survive
	if !strings.Contains(body, `<w:shd w:val="clear" w:color="auto" w:fill="3C4043"/>`) {
		t.Errorf("cell shading lost: %s", snippetAround(body, "shd"))
	}
	// ... on the cell alone: the runs inside do not shade themselves again
	if n := strings.Count(body, `w:fill="3C4043"`); n != 1 {
		t.Errorf("cell shading written %d times, want once (tcPr): %s", n, body)
	}
}

func TestDocxTableWidthRoundTrip(t *testing.T) {
	// a resized table: 372px of the 620px text column (60%), px colgroup
	doc := &Document{HTML: `<table class="of-table" style="width: 372px; table-layout: fixed;">` +
		`<colgroup><col style="width:186px"><col style="width:93px"><col style="width:93px"></colgroup>` +
		`<tbody><tr><td>a</td><td>b</td><td>c</td></tr></tbody></table>`}
	data, err := BuildDocx(doc)
	if err != nil {
		t.Fatalf("BuildDocx: %v", err)
	}
	body := string(zipPart(t, data, "word/document.xml"))
	// 372px = 279pt = 5580 twips
	if !strings.Contains(body, `<w:tblW w:w="5580" w:type="dxa"/>`) {
		t.Errorf("table width not 279pt: %s", snippetAround(body, "tblW"))
	}
	// px colgroup ratios (50/25/25) scaled into the grid
	if !strings.Contains(body, `<w:tcW w:w="2790" w:type="dxa"/>`) ||
		!strings.Contains(body, `<w:tcW w:w="1395" w:type="dxa"/>`) {
		t.Errorf("cell widths not 50/25/25: %s", snippetAround(body, "tcW"))
	}
	back, err := ParseDocx(data)
	if err != nil {
		t.Fatalf("ParseDocx: %v", err)
	}
	if !strings.Contains(back.HTML, `class="of-table"`) {
		t.Errorf("imported table lost the of-table class: %s", back.HTML)
	}
	if !strings.Contains(back.HTML, "width:279pt") {
		t.Errorf("imported table lost its width: %s", back.HTML)
	}
	if !strings.Contains(back.HTML, `<colgroup><col style="width:139.5pt"><col style="width:69.75pt"><col style="width:69.75pt"></colgroup>`) {
		t.Errorf("imported table lost column proportions: %s", back.HTML)
	}
}

func TestDocxTableShadingRoundTrip(t *testing.T) {
	doc := &Document{HTML: `<table class="of-table"><tbody><tr>` +
		`<td style="background-color: rgb(60, 64, 67);">H</td><td>x</td></tr></tbody></table>`}
	data, err := BuildDocx(doc)
	if err != nil {
		t.Fatalf("BuildDocx: %v", err)
	}
	back, err := ParseDocx(data)
	if err != nil {
		t.Fatalf("ParseDocx: %v", err)
	}
	if !strings.Contains(back.HTML, "background-color:#3c4043") {
		t.Errorf("cell shading lost on import: %s", back.HTML)
	}
}

func snippetAround(s, needle string) string {
	i := strings.Index(s, needle)
	if i < 0 {
		return "(needle absent) " + s[:minInt(300, len(s))]
	}
	start := i - 80
	if start < 0 {
		start = 0
	}
	end := i + 220
	if end > len(s) {
		end = len(s)
	}
	return s[start:end]
}

func minInt(a, b int) int {
	if a < b {
		return a
	}
	return b
}
