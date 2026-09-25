package office

/*
	pptx_textsave_test.go - what the .pptx writer does with the text an
	imported deck carries, checked both on the XML PowerPoint reads and on
	what the suite's own reader makes of it again. A deck opened from
	PowerPoint and saved by the suite has to look the same in PowerPoint.
*/

import (
	"encoding/json"
	"strings"
	"testing"
)

const stackOpenSansSemi = `'Open Sans SemiBold','Open Sans','Noto Sans',sans-serif`

// writeOneObject saves a one-slide deck holding obj and returns the slide
// XML and the object the reader makes of it again
func writeOneObject(t *testing.T, obj map[string]interface{}) (string, *Object) {
	t.Helper()
	deck := map[string]interface{}{
		"size": []int{960, 540},
		"slides": []interface{}{map[string]interface{}{
			"id": "s1", "objects": []interface{}{obj},
		}},
	}
	js, err := json.Marshal(deck)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	p, err := ParsePresentationJSON(string(js))
	if err != nil {
		t.Fatalf("ParsePresentationJSON: %v", err)
	}
	data, err := BuildPptx(p)
	if err != nil {
		t.Fatalf("BuildPptx: %v", err)
	}
	slide := string(zipPart(t, data, "ppt/slides/slide1.xml"))
	back, err := ParsePptx(data)
	if err != nil {
		t.Fatalf("ParsePptx: %v", err)
	}
	if len(back.Slides) != 1 || len(back.Slides[0].Objects) == 0 {
		t.Fatalf("the saved deck has no objects")
	}
	return slide, back.Slides[0].Objects[0]
}

func textObj(html string, props map[string]interface{}) map[string]interface{} {
	p := map[string]interface{}{"html": html, "fontSize": 24}
	for k, v := range props {
		p[k] = v
	}
	return map[string]interface{}{
		"id": "o1", "type": "text", "x": 40, "y": 40, "w": 600, "h": 200, "props": p,
	}
}

func TestPptxWriterRunWeight(t *testing.T) {
	cases := []struct {
		name, css string
		wantB     string
	}{
		// a SemiBold face at its own weight is the face, not bold on top
		{"semibold face", "font-family:" + stackOpenSansSemi + ";font-weight:600;", `b="0"`},
		{"bold on a semibold face", "font-family:" + stackOpenSansSemi + ";font-weight:700;", `b="1"`},
		{"600 on a plain face", "font-family:Arial;font-weight:600;", `b="1"`},
		{"bold keyword", "font-family:Arial;font-weight:bold;", `b="1"`},
		{"normal", "font-family:Arial;font-weight:400;", `b="0"`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			html := `<div><span style="font-size:24px;` + c.css + `">Word</span></div>`
			slide, _ := writeOneObject(t, textObj(html, nil))
			if !strings.Contains(slide, c.wantB) {
				t.Errorf("run properties do not say %s:\n%s", c.wantB, slide)
			}
		})
	}
}

func TestPptxWriterKeepsTypefaceCase(t *testing.T) {
	html := `<div><span style="font-size:24px;font-family:'Open Sans Medium','Open Sans',sans-serif;">Hi</span></div>`
	slide, _ := writeOneObject(t, textObj(html, nil))
	if !strings.Contains(slide, `<a:latin typeface="Open Sans Medium"/>`) {
		t.Errorf("typeface lost its case:\n%s", slide)
	}
}

func TestFontSizeToSzRounds(t *testing.T) {
	for px, want := range map[float64]int{
		37.33: 2800, // 28pt as the reader writes it
		13.33: 1000,
		21.33: 1600,
		24:    1800,
		0:     1800, // the default
	} {
		if got := fontSizeToSz(px); got != want {
			t.Errorf("fontSizeToSz(%v) = %d, want %d", px, got, want)
		}
	}
}

// The reader draws a bullet as its own span with its own colour, typeface
// and size; PowerPoint takes all three from the first run unless told.
func TestPptxWriterBulletKeepsItsOwnLook(t *testing.T) {
	html := `<div style="padding-left:48px;position:relative;">` +
		`<span style="position:absolute;left:12px;font-size:32px;font-family:'Open Sans Medium',sans-serif;color:#595959;">-</span>` +
		`<span style="font-size:24px;font-family:Arial;color:#4285f4;">Item</span></div>`
	slide, obj := writeOneObject(t, textObj(html, nil))
	for _, want := range []string{
		`<a:buClr><a:srgbClr val="595959"/></a:buClr>`,
		`<a:buSzPts val="2400"/>`,
		`<a:buFont typeface="Open Sans Medium"/>`,
		`<a:buChar char="-"/>`,
	} {
		if !strings.Contains(slide, want) {
			t.Errorf("slide XML lacks %s:\n%s", want, slide)
		}
	}
	marker := obj.Props.HTML[:strings.Index(obj.Props.HTML, ">-<")]
	for _, want := range []string{"color:#595959", "font-size:32px", "Open Sans Medium"} {
		if !strings.Contains(marker, want) {
			t.Errorf("bullet read back without %s: %s", want, obj.Props.HTML)
		}
	}
}

// A paragraph holding only the zero-width spacer keeps its size, font and
// colour as endParaRPr - what PowerPoint types in when the line is used.
func TestPptxWriterEmptyParagraphKeepsItsStyle(t *testing.T) {
	html := `<div><span style="font-size:18.67px;font-family:'Open Sans Medium',sans-serif;">&#8203;</span></div>`
	slide, obj := writeOneObject(t, textObj(html, map[string]interface{}{"color": "#31333c"}))
	if !strings.Contains(slide, `<a:endParaRPr lang="en-US" sz="1400"`) ||
		!strings.Contains(slide, `31333C`) || !strings.Contains(slide, `typeface="Open Sans Medium"`) {
		t.Fatalf("empty paragraph lost its style:\n%s", slide)
	}
	if obj.Props.Color != "#31333c" {
		t.Errorf("colour read back = %q, want #31333c", obj.Props.Color)
	}
	if !strings.Contains(obj.Props.FontFamily, "Open Sans Medium") {
		t.Errorf("font read back = %q", obj.Props.FontFamily)
	}
	if obj.Props.FontSize < 18.6 || obj.Props.FontSize > 18.7 {
		t.Errorf("size read back = %v, want 18.67", obj.Props.FontSize)
	}
}

// The spacer after a <br> is what sizes the line the break opens.
func TestPptxWriterBreakTakesTheSpacerSize(t *testing.T) {
	html := `<div style="font-size:24px;"><span style="font-size:24px;font-family:Arial;">Top</span>` +
		`<br><span style="font-size:12px;font-family:Arial;">&#8203;</span>` +
		`<span style="font-size:24px;font-family:Arial;">Bottom</span></div>`
	slide, _ := writeOneObject(t, textObj(html, nil))
	if !strings.Contains(slide, `<a:br><a:rPr lang="en-US" sz="900"`) {
		t.Errorf("the break did not take the spacer's 9pt:\n%s", slide)
	}
}

// Box-level bold / underline are applied by the editor to the whole box,
// and an underline cannot be taken off a descendant, so the reader only
// sets them when every run has them.
func TestPptxBoxFlagsNeedEveryRun(t *testing.T) {
	cases := []struct {
		name          string
		runs          string
		bold, underln bool
	}{
		{"all bold", `<a:r><a:rPr b="1"/><a:t>A</a:t></a:r><a:r><a:rPr b="1"/><a:t>B</a:t></a:r>`, true, false},
		{"first bold only", `<a:r><a:rPr b="1"/><a:t>A</a:t></a:r><a:r><a:rPr b="0"/><a:t>B</a:t></a:r>`, false, false},
		{"first underlined only", `<a:r><a:rPr u="sng"/><a:t>A</a:t></a:r><a:r><a:rPr/><a:t>B</a:t></a:r>`, false, false},
		{"all underlined", `<a:r><a:rPr u="sng"/><a:t>A</a:t></a:r><a:r><a:rPr u="sng"/><a:t>B</a:t></a:r>`, false, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			objs := parseOneSlide(t, pptxParts{slides: []string{
				textBox(0, 0, 4000000, 1000000, `<a:p>`+c.runs+`</a:p>`),
			}})
			if len(objs) != 1 {
				t.Fatalf("objects = %d", len(objs))
			}
			if objs[0].Props.Bold != c.bold || objs[0].Props.Underline != c.underln {
				t.Errorf("bold=%v underline=%v, want %v %v",
					objs[0].Props.Bold, objs[0].Props.Underline, c.bold, c.underln)
			}
		})
	}
}

// adj 0 on a roundRect is square corners; stored as a roundRect with no
// radius it would be drawn with the default rounding.
func TestPptxSquareRoundRectIsARect(t *testing.T) {
	sp := `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
		`<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="500000"/></a:xfrm>` +
		`<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val %s"/></a:avLst></a:prstGeom>` +
		`<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp>`
	for adj, want := range map[string]string{"0": "rect", "8000": "roundRect"} {
		objs := parseOneSlide(t, pptxParts{slides: []string{strings.Replace(sp, "%s", adj, 1)}})
		if len(objs) != 1 {
			t.Fatalf("objects = %d", len(objs))
		}
		if objs[0].Props.Kind != want {
			t.Errorf("adj %s: kind = %q, want %q", adj, objs[0].Props.Kind, want)
		}
	}
}

// A frame drawn around a picture (<a:ln> on the p:pic) is read into the
// picture's stroke and written back the same way.
func TestPptxPictureOutlineRoundTrips(t *testing.T) {
	png := makePngDataURL(t, 20, 10)
	obj := map[string]interface{}{
		"id": "i1", "type": "image", "x": 10, "y": 10, "w": 200, "h": 100,
		"props": map[string]interface{}{"src": png, "fit": "fill", "stroke": "#595959", "strokeW": 1},
	}
	slide, back := writeOneObject(t, obj)
	if !strings.Contains(slide, `<a:ln w="9525"><a:solidFill><a:srgbClr val="595959"/>`) {
		t.Fatalf("picture outline not written:\n%s", slide)
	}
	if back.Type != "image" || back.Props.Stroke != "#595959" || back.Props.StrokeW != 1 {
		t.Errorf("picture read back as %s stroke=%q w=%v", back.Type, back.Props.Stroke, back.Props.StrokeW)
	}
	// and a picture without one gets no line at all
	delete(obj["props"].(map[string]interface{}), "stroke")
	slide, back = writeOneObject(t, obj)
	if strings.Contains(slide, "<a:ln") || back.Props.StrokeW != 0 {
		t.Errorf("a picture without an outline gained one:\n%s", slide)
	}
}

// A horizontal or vertical line has a box that is zero across; a one-pixel
// floor there tilts it by a pixel.
func TestPptxStraightLineStaysStraight(t *testing.T) {
	for _, c := range []struct{ w, h float64 }{{0, 120}, {200, 0}, {-150, 0}} {
		obj := map[string]interface{}{
			"id": "l1", "type": "line", "x": 100, "y": 100, "w": c.w, "h": c.h,
			"props": map[string]interface{}{"stroke": "#000000", "strokeW": 2},
		}
		_, back := writeOneObject(t, obj)
		if back.W != c.w || back.H != c.h {
			t.Errorf("line %vx%v came back %vx%v", c.w, c.h, back.W, back.H)
		}
	}
}

// The line menus' choices reach PowerPoint as its own presets, and come
// back as the nearest of the editor's: PowerPoint has no square end and no
// open ones, so those arrive as the diamond and the filled shape.
func TestPptxLineEndsAndDashes(t *testing.T) {
	cases := []struct {
		dash, start, end         string
		prst, headT, tailT       string
		backDash, backS, backEnd string
	}{
		{"dot", "none", "arrow", "sysDot", "", "arrow", "dot", "", "arrow"},
		{"dash", "circle", "triangle", "dash", "oval", "triangle", "dash", "circle", "triangle"},
		{"dashDot", "square", "openDiamond", "dashDot", "diamond", "diamond", "dashDot", "diamond", "diamond"},
		{"longDash", "openCircle", "openTriangle", "lgDash", "oval", "triangle", "longDash", "circle", "triangle"},
		{"longDashDot", "diamond", "none", "lgDashDot", "diamond", "", "longDashDot", "diamond", ""},
		{"solid", "none", "none", "", "", "", "", "", ""},
	}
	for _, c := range cases {
		t.Run(c.dash+"-"+c.start+"-"+c.end, func(t *testing.T) {
			obj := map[string]interface{}{
				"id": "l1", "type": "line", "x": 100, "y": 100, "w": 300, "h": 0,
				"props": map[string]interface{}{"stroke": "#000000", "strokeW": 3,
					"dashStyle": c.dash, "startHead": c.start, "endHead": c.end},
			}
			slide, back := writeOneObject(t, obj)
			if c.prst != "" && !strings.Contains(slide, `<a:prstDash val="`+c.prst+`"/>`) {
				t.Errorf("dash %s not written as %s:\n%s", c.dash, c.prst, slide)
			}
			if c.prst == "" && strings.Contains(slide, "prstDash") {
				t.Errorf("a solid line was written with a dash")
			}
			for tag, want := range map[string]string{"headEnd": c.headT, "tailEnd": c.tailT} {
				if want == "" {
					if strings.Contains(slide, "<a:"+tag) {
						t.Errorf("%s written for no end", tag)
					}
				} else if !strings.Contains(slide, `<a:`+tag+` type="`+want+`"/>`) {
					t.Errorf("%s not %s:\n%s", tag, want, slide)
				}
			}
			if back.Props.DashStyle != c.backDash || back.Props.StartHead != c.backS || back.Props.EndHead != c.backEnd {
				t.Errorf("read back dash=%q start=%q end=%q, want %q %q %q", back.Props.DashStyle,
					back.Props.StartHead, back.Props.EndHead, c.backDash, c.backS, c.backEnd)
			}
		})
	}
	// a document from before the menus: dash + arrowEnd still mean a dash
	// and a filled arrow
	slide, _ := writeOneObject(t, map[string]interface{}{
		"id": "l1", "type": "line", "x": 100, "y": 100, "w": 300, "h": 0,
		"props": map[string]interface{}{"stroke": "#000000", "strokeW": 2, "dash": true, "arrowEnd": true},
	})
	if !strings.Contains(slide, `<a:prstDash val="dash"/>`) || !strings.Contains(slide, `<a:tailEnd type="triangle"/>`) {
		t.Errorf("legacy dash / arrowEnd lost:\n%s", slide)
	}
}

// A speech bubble's tip is its adjustments, both ways.
func TestPptxCalloutTipRoundTrips(t *testing.T) {
	obj := map[string]interface{}{
		"id": "c1", "type": "shape", "x": 100, "y": 100, "w": 300, "h": 120,
		"props": map[string]interface{}{"kind": "wedgeRoundRectCallout", "fill": "#ffffff",
			"adj": map[string]interface{}{"adj1": 35000, "adj2": -90000, "adj3": 12000}},
	}
	slide, back := writeOneObject(t, obj)
	for _, want := range []string{`<a:gd name="adj1" fmla="val 35000"/>`, `<a:gd name="adj2" fmla="val -90000"/>`,
		`<a:gd name="adj3" fmla="val 12000"/>`} {
		if !strings.Contains(slide, want) {
			t.Errorf("slide lacks %s:\n%s", want, slide)
		}
	}
	if back.Props.Adj["adj1"] != 35000 || back.Props.Adj["adj2"] != -90000 || back.Props.Adj["adj3"] != 12000 {
		t.Errorf("tip read back as %v", back.Props.Adj)
	}
	// the tip placement is not a corner radius
	if back.Props.Radius > 40 {
		t.Errorf("tip offsets read as a %vpx corner radius", back.Props.Radius)
	}
}

// A callout from before adjustments drew its body in the top 72% of its
// frame with the tip at the bottom: written for PowerPoint, the frame is
// the body and the tip is stated where it was.
func TestPptxLegacyCalloutIsConverted(t *testing.T) {
	obj := map[string]interface{}{
		"id": "c1", "type": "shape", "x": 100, "y": 100, "w": 300, "h": 200,
		"props": map[string]interface{}{"kind": "wedgeRectCallout", "fill": "#ffffff"},
	}
	_, back := writeOneObject(t, obj)
	if absF(back.H-144) > 0.5 {
		t.Errorf("frame height %v, want the 144px body", back.H)
	}
	// the tip was at (0.2w, h) = (60, 200) in the old frame
	tipX := back.W/2 + back.Props.Adj["adj1"]*back.W/100000
	tipY := back.H/2 + back.Props.Adj["adj2"]*back.H/100000
	if absF(tipX-60) > 1 || absF(tipY-200) > 1 {
		t.Errorf("tip at (%v,%v), want (60,200)", tipX, tipY)
	}
}
