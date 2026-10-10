package office

import (
	"archive/zip"
	"bytes"
	"io"
	"math"
	"strings"
	"testing"
)

// replaceParts copies a package, replacing (or adding) the named parts
func replaceParts(t *testing.T, data []byte, replace map[string]string) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("zip read: %v", err)
	}
	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	seen := map[string]bool{}
	for _, f := range zr.File {
		w, err := zw.Create(f.Name)
		if err != nil {
			t.Fatalf("zip create: %v", err)
		}
		if v, ok := replace[f.Name]; ok {
			seen[f.Name] = true
			w.Write([]byte(v))
			continue
		}
		rc, err := f.Open()
		if err != nil {
			t.Fatalf("zip open: %v", err)
		}
		io.Copy(w, rc)
		rc.Close()
	}
	for name, v := range replace {
		if !seen[name] {
			w, _ := zw.Create(name)
			w.Write([]byte(v))
		}
	}
	zw.Close()
	return buf.Bytes()
}

// onePres builds a one-slide package, applies the replacements and parses it
func onePres(t *testing.T, parts pptxParts, replace map[string]string) *Presentation {
	t.Helper()
	data := buildTestPptx(t, parts)
	if len(replace) > 0 {
		data = replaceParts(t, data, replace)
	}
	p, err := ParsePptx(data)
	if err != nil {
		t.Fatalf("ParsePptx: %v", err)
	}
	return p
}

// a slide part with a background of its own
func slideWithBg(bg, tree string) string {
	return `<p:sld ` + testNS + `><p:cSld>` + bg + `<p:spTree>` + tree + `</p:spTree></p:cSld></p:sld>`
}

func closeTo(a, b float64) bool { return math.Abs(a-b) < 0.02 }

/* ---------------- slide size ---------------- */

func TestSlideSizeFor(t *testing.T) {
	tests := []struct {
		name string
		w, h float64
		ww   int
		wh   int
	}{
		{"4:3 PowerPoint", 9144000, 6858000, 960, 720},
		{"16:9 widescreen", 12192000, 6858000, 960, 540},
		{"16:9 Google Slides", 9144000, 5143500, 960, 540},
		{"16:10", 1600, 1000, 960, 600},
		{"no size", 0, 0, 960, 540},
		{"absurd shape", 100000, 1, 960, 540},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w, h := slideSizeFor(tc.w, tc.h)
			if w != tc.ww || h != tc.wh {
				t.Errorf("slideSizeFor(%v, %v) = %dx%d, want %dx%d", tc.w, tc.h, w, h, tc.ww, tc.wh)
			}
		})
	}
}

// A 4:3 deck keeps its shape: 960x720, and a square stays square
func TestPptxKeepsSlideShape(t *testing.T) {
	square := `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
		`<p:spPr><a:xfrm><a:off x="4572000" y="3429000"/><a:ext cx="914400" cy="914400"/></a:xfrm>` +
		`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp>`
	data := buildTestPptx(t, pptxParts{slides: []string{square}})
	zr, _ := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	var pres string
	for _, f := range zr.File {
		if f.Name == "ppt/presentation.xml" {
			rc, _ := f.Open()
			b, _ := io.ReadAll(rc)
			rc.Close()
			pres = strings.Replace(string(b), `cy="5143500"`, `cy="6858000"`, 1)
		}
	}
	p, err := ParsePptx(replaceParts(t, data, map[string]string{"ppt/presentation.xml": pres}))
	if err != nil {
		t.Fatalf("ParsePptx: %v", err)
	}
	if len(p.Size) != 2 || p.Size[0] != 960 || p.Size[1] != 720 {
		t.Fatalf("size = %v, want [960 720]", p.Size)
	}
	o := p.Slides[0].Objects[0]
	if !closeTo(o.X, 480) || !closeTo(o.Y, 360) || !closeTo(o.W, 96) || !closeTo(o.H, 96) {
		t.Errorf("square = %v,%v %vx%v, want 480,360 96x96", o.X, o.Y, o.W, o.H)
	}
	// and the writer states the shape it was given
	out, err := BuildPptx(p)
	if err != nil {
		t.Fatalf("BuildPptx: %v", err)
	}
	if !strings.Contains(packagePart(t, out, "ppt/presentation.xml"), `<p:sldSz cx="9144000" cy="6858000"/>`) {
		t.Errorf("written deck lost its 4:3 size")
	}
}

/* ---------------- colours and fills ---------------- */

func TestColorAlphaAndWithAlpha(t *testing.T) {
	tests := []struct {
		name  string
		hex   string
		alpha float64
		want  string
	}{
		{"opaque stays six digits", "#ff0000", 1, "#ff0000"},
		{"half transparent", "#ff0000", 0.5, "#ff000080"},
		{"92.5% white", "#ffffff", 0.92549, "#ffffffec"},
		{"not a hex colour", "red", 0.5, "red"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := withAlpha(tc.hex, tc.alpha); got != tc.want {
				t.Errorf("withAlpha = %q, want %q", got, tc.want)
			}
		})
	}
	n, _ := parseXMLTree([]byte(`<a:srgbClr xmlns:a="a" val="FFFFFF"><a:alpha val="92549"/></a:srgbClr>`))
	if a := colorAlpha(n); !closeTo(a, 0.92549) {
		t.Errorf("colorAlpha = %v", a)
	}
	if a := hexAlpha("#ffffff80"); !closeTo(a, 128.0/255) {
		t.Errorf("hexAlpha = %v", a)
	}
	if got := srgbClrXML("#ff000080", "000000"); got != `<a:srgbClr val="FF0000"><a:alpha val="50196"/></a:srgbClr>` {
		t.Errorf("srgbClrXML = %s", got)
	}
}

func TestShapeFillKeepsAlpha(t *testing.T) {
	objs := parseOneSlide(t, pptxParts{slides: []string{
		`<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
			`<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>` +
			`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
			`<a:solidFill><a:srgbClr val="FFFFFF"><a:alpha val="50000"/></a:srgbClr></a:solidFill></p:spPr></p:sp>`,
	}})
	if len(objs) != 1 || objs[0].Props.Fill != "#ffffff80" {
		t.Fatalf("fill = %+v, want #ffffff80", objs)
	}
}

func TestGradientOf(t *testing.T) {
	cc := colorCtx{scheme: map[string]string{"accent1": "4285F4"}}
	tests := []struct {
		name  string
		xml   string
		kind  string
		angle float64
		cx    float64
		first string
	}{
		{"linear, top to bottom", `<a:gradFill><a:gsLst><a:gs pos="100000"><a:srgbClr val="000000"/></a:gs>` +
			`<a:gs pos="0"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill>`,
			"linear", 180, 0, "#ffffff"},
		{"linear, left to right", `<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="accent1"/></a:gs>` +
			`<a:gs pos="100000"><a:srgbClr val="000000"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>`,
			"linear", 90, 0, "#4285f4"},
		{"radial from the centre", `<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="B1DDFF"/></a:gs>` +
			`<a:gs pos="100000"><a:srgbClr val="CBE8FE"/></a:gs></a:gsLst><a:path path="circle">` +
			`<a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>`,
			"radial", 0, 0.5, "#b1ddff"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			n, err := parseXMLTree([]byte(strings.Replace(tc.xml, "<a:gradFill>", `<a:gradFill xmlns:a="a">`, 1)))
			if err != nil {
				t.Fatalf("xml: %v", err)
			}
			g := cc.gradientOf(n)
			if g == nil {
				t.Fatal("no gradient")
			}
			if g.Kind != tc.kind || !closeTo(g.Angle, tc.angle) || !closeTo(g.CX, tc.cx) || g.Stops[0].Color != tc.first {
				t.Errorf("gradient = %+v", g)
			}
			if g.Stops[0].Pos > g.Stops[len(g.Stops)-1].Pos {
				t.Errorf("stops are not in order: %+v", g.Stops)
			}
		})
	}
}

/* ---------------- backgrounds ---------------- */

func TestPptxSlideBackgrounds(t *testing.T) {
	png := pngBytes(t)
	tests := []struct {
		name  string
		bg    string
		check func(t *testing.T, s *Slide)
	}{
		{"picture stretched past the edges",
			`<p:bg><p:bgPr><a:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect l="-10000" r="-10000"/></a:stretch></a:blipFill></p:bgPr></p:bg>`,
			func(t *testing.T, s *Slide) {
				if s.BgImage == nil || !strings.HasPrefix(s.BgImage.Src, "data:image/png") {
					t.Fatalf("bgImage = %+v", s.BgImage)
				}
				if !closeTo(s.BgImage.X, -96) || !closeTo(s.BgImage.W, 1152) || !closeTo(s.BgImage.H, 540) {
					t.Errorf("placed at %+v, want x -96 w 1152 h 540", s.BgImage)
				}
			}},
		{"gradient",
			`<p:bg><p:bgPr><a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="5E9EFF"/></a:gs>` +
				`<a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs></a:gsLst><a:lin ang="5400000"/></a:gradFill></p:bgPr></p:bg>`,
			func(t *testing.T, s *Slide) {
				if s.BgGrad == nil || len(s.BgGrad.Stops) != 2 || s.Bg != "#5e9eff" {
					t.Errorf("bg = %q, grad = %+v", s.Bg, s.BgGrad)
				}
			}},
		{"theme style through bgRef",
			`<p:bg><p:bgRef idx="1001"><a:schemeClr val="accent1"/></p:bgRef></p:bg>`,
			func(t *testing.T, s *Slide) {
				if s.Bg != "#4285f4" {
					t.Errorf("bg = %q, want the reference's colour", s.Bg)
				}
			}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			p := onePres(t, pptxParts{
				slides:    []string{""},
				slideRels: map[string]string{"rId9": "../media/bg.png"},
				media:     map[string][]byte{"ppt/media/bg.png": png},
			}, map[string]string{"ppt/slides/slide1.xml": slideWithBg(tc.bg, "")})
			tc.check(t, p.Slides[0])
		})
	}
}

/* ---------------- symbol fonts ---------------- */

func TestSymbolBulletAndText(t *testing.T) {
	tests := []struct {
		font, marker, want string
		ok                 bool
	}{
		{"Wingdings", "l", "●", true},
		{"Wingdings", "", "●", true},
		{"Wingdings 2", "n", "■", true},
		{"Symbol", "", "•", true},
		{"Arial", "l", "", false},
		{"Wingdings", "lo", "", false},
	}
	for _, tc := range tests {
		got, _, ok := symbolBullet(tc.font, tc.marker)
		if ok != tc.ok || got != tc.want {
			t.Errorf("symbolBullet(%q, %q) = %q, %v", tc.font, tc.marker, got, ok)
		}
	}
	if got := symbolText("a = b  2"); got != "α = β ≥ 2" {
		t.Errorf("symbolText = %q", got)
	}
	if !isSymbolFont("Wingdings 3") || isSymbolFont("Calibri") {
		t.Error("isSymbolFont")
	}
}

func TestPptxBulletsAndNumbers(t *testing.T) {
	para := func(ppr, text string) string {
		return `<a:p><a:pPr marL="342900" indent="-342900">` + ppr + `</a:pPr><a:r><a:rPr sz="2000"/><a:t>` + text + `</a:t></a:r></a:p>`
	}
	tests := []struct {
		name   string
		paras  string
		want   []string
		absent []string
	}{
		{"a Wingdings bullet comes in as the shape it draws",
			para(`<a:buFont typeface="Wingdings"/><a:buChar char="l"/>`, "one"),
			[]string{"●"}, []string{">l<", "Wingdings"}},
		{"an empty paragraph has no bullet",
			`<a:p><a:pPr marL="342900" indent="-342900"><a:buChar char="&#8226;"/></a:pPr><a:endParaRPr sz="2000"/></a:p>`,
			nil, []string{"•"}},
		{"a number is never set in a symbol font",
			para(`<a:buFont typeface="Wingdings"/><a:buAutoNum type="arabicPeriod"/>`, "one"),
			[]string{"1."}, []string{"Wingdings"}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			objs := parseOneSlide(t, pptxParts{slides: []string{textBox(0, 0, 4000000, 2000000, tc.paras)}})
			if len(objs) == 0 {
				t.Fatal("no objects")
			}
			html := objs[0].Props.HTML
			for _, w := range tc.want {
				if !strings.Contains(html, w) {
					t.Errorf("want %q in %s", w, html)
				}
			}
			for _, a := range tc.absent {
				if strings.Contains(html, a) {
					t.Errorf("did not want %q in %s", a, html)
				}
			}
		})
	}
}

/* ---------------- text layout ---------------- */

func TestPptxTextLayoutRules(t *testing.T) {
	tests := []struct {
		name   string
		shape  string
		want   []string
		absent []string
	}{
		{"autofit sizes are whole points",
			`<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
				`<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
				`<p:txBody><a:bodyPr><a:normAutofit fontScale="92500"/></a:bodyPr><a:lstStyle/>` +
				`<a:p><a:r><a:rPr sz="2000"/><a:t>fit</a:t></a:r></a:p></p:txBody></p:sp>`,
			// 20pt at 92.5% is 18.5pt, drawn at 19pt = 25.33px
			[]string{"font-size:25.33px"}, []string{"font-size:24.67px"}},
		{"space before the first paragraph with spcFirstLastPara",
			`<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
				`<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4000000" cy="2000000"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr>` +
				`<p:txBody><a:bodyPr spcFirstLastPara="1"/><a:lstStyle/>` +
				`<a:p><a:pPr><a:spcBef><a:spcPts val="600"/></a:spcBef></a:pPr><a:r><a:rPr sz="1400"/><a:t>a</a:t></a:r></a:p></p:txBody></p:sp>`,
			[]string{"margin-top:8px"}, nil},
		{"a percentage space is of the line",
			textBox(0, 0, 4000000, 2000000, `<a:p><a:r><a:rPr sz="2000"/><a:t>a</a:t></a:r></a:p>`+
				`<a:p><a:pPr><a:spcBef><a:spcPct val="20000"/></a:spcBef></a:pPr><a:r><a:rPr sz="2000"/><a:t>b</a:t></a:r></a:p>`),
			// 20% of a 20pt paragraph's 24pt line is 4.8pt = 6.4px
			[]string{"margin-top:6.4px"}, nil},
		{"a lowered run does not make its line taller",
			textBox(0, 0, 4000000, 2000000, `<a:p><a:r><a:rPr sz="2000"/><a:t>P</a:t></a:r><a:r><a:rPr sz="2000" baseline="-25000"/><a:t>t</a:t></a:r></a:p>`),
			[]string{"vertical-align:sub;line-height:0"}, nil},
		{"a tab goes to an inch stop",
			textBox(0, 0, 4000000, 2000000, `<a:p><a:r><a:rPr sz="2000"/><a:t>a&#9;b</a:t></a:r></a:p>`),
			[]string{"tab-size:96px"}, nil},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			objs := parseOneSlide(t, pptxParts{slides: []string{tc.shape}})
			if len(objs) == 0 {
				t.Fatal("no objects")
			}
			html := objs[0].Props.HTML
			for _, w := range tc.want {
				if !strings.Contains(html, w) {
					t.Errorf("want %q in %s", w, html)
				}
			}
			for _, a := range tc.absent {
				if strings.Contains(html, a) {
					t.Errorf("did not want %q in %s", a, html)
				}
			}
		})
	}
}

// A group's scale moves and sizes its children but leaves type alone
func TestPptxGroupDoesNotScaleText(t *testing.T) {
	grp := `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="5" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
		`<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="2000000" cy="1000000"/>` +
		`<a:chOff x="0" y="0"/><a:chExt cx="4000000" cy="2000000"/></a:xfrm></p:grpSpPr>` +
		textBox(0, 0, 4000000, 2000000, `<a:p><a:r><a:rPr sz="2000"/><a:t>big</a:t></a:r></a:p>`) +
		`</p:grpSp>`
	objs := parseOneSlide(t, pptxParts{slides: []string{grp}})
	if len(objs) != 1 {
		t.Fatalf("objects = %d", len(objs))
	}
	if !strings.Contains(objs[0].Props.HTML, "font-size:26.67px") {
		t.Errorf("20pt text in a half-size group = %s, want 26.67px", objs[0].Props.HTML)
	}
	if !closeTo(objs[0].W, 2000000.0/emuPerPx) {
		t.Errorf("the box itself should still be scaled: w = %v", objs[0].W)
	}
}

/* ---------------- shapes ---------------- */

func TestPptxShapeKinds(t *testing.T) {
	sp := func(spPr string) string {
		return `<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>` + spPr + `</p:spPr></p:sp>`
	}
	tests := []struct {
		name  string
		shape string
		check func(t *testing.T, o *Object)
	}{
		{"a zero-wide line shape is a line",
			sp(`<a:xfrm><a:off x="914400" y="0"/><a:ext cx="0" cy="914400"/></a:xfrm><a:prstGeom prst="line"><a:avLst/></a:prstGeom>` +
				`<a:ln w="9525"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>`),
			func(t *testing.T, o *Object) {
				if o.Type != "line" || !closeTo(o.W, 0) || !closeTo(o.H, 96) {
					t.Errorf("got %s %vx%v", o.Type, o.W, o.H)
				}
			}},
		{"a preset keeps the adjustments it states",
			sp(`<a:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="457200"/></a:xfrm><a:prstGeom prst="chevron"><a:avLst><a:gd name="adj" fmla="val 30000"/></a:avLst></a:prstGeom>` +
				`<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>`),
			func(t *testing.T, o *Object) {
				if o.Props.Kind != "chevron" || o.Props.Adj["adj"] != 30000 {
					t.Errorf("kind %q adj %v", o.Props.Kind, o.Props.Adj)
				}
			}},
		{"a gradient fill",
			sp(`<a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
				`<a:gradFill><a:gsLst><a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs><a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs></a:gsLst><a:lin ang="0"/></a:gradFill>`),
			func(t *testing.T, o *Object) {
				if o.Props.FillGrad == nil || o.Props.Fill != "#ff0000" {
					t.Errorf("fill %q grad %+v", o.Props.Fill, o.Props.FillGrad)
				}
			}},
		{"custom geometry",
			sp(`<a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:pathLst>` +
				`<a:path w="100" h="100"><a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo>` +
				`<a:lnTo><a:pt x="50" y="100"/></a:lnTo><a:close/></a:path></a:pathLst></a:custGeom>` +
				`<a:solidFill><a:srgbClr val="00FF00"/></a:solidFill>`),
			func(t *testing.T, o *Object) {
				if o.Props.Kind != "custom" || o.Props.Geom == nil || o.Props.Geom.Paths[0].D != "M0 0L100 0L50 100Z" {
					t.Errorf("kind %q geom %+v", o.Props.Kind, o.Props.Geom)
				}
			}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			objs := parseOneSlide(t, pptxParts{slides: []string{tc.shape}})
			if len(objs) != 1 {
				t.Fatalf("objects = %d", len(objs))
			}
			tc.check(t, objs[0])
		})
	}
}

func TestEvalGuideAndArcs(t *testing.T) {
	g := map[string]float64{"w": 1000, "h": 500, "adj": 25000}
	tests := []struct {
		fmla string
		want float64
	}{
		{"val 7", 7},
		{"*/ w adj 100000", 250},
		{"+- w h 100", 1400},
		{"pin 0 adj 10000", 10000},
		{"max w h", 1000},
		{"?: -1 w h", 500},
		{"sin 100 5400000", 100},
		{"cos 100 0", 100},
	}
	for _, tc := range tests {
		if got := evalGuide(tc.fmla, g); !closeTo(got, tc.want) {
			t.Errorf("evalGuide(%q) = %v, want %v", tc.fmla, got, tc.want)
		}
	}
	// a quarter arc from the top of a circle round to its right side
	n, _ := parseXMLTree([]byte(`<a:path xmlns:a="a" w="200" h="200"><a:moveTo><a:pt x="100" y="0"/></a:moveTo>` +
		`<a:arcTo wR="100" hR="100" stAng="16200000" swAng="5400000"/></a:path>`))
	d := pathD(n, geomGuides(&xnode{}, 200, 200))
	if !strings.HasPrefix(d, "M100 0C") || !strings.HasSuffix(d, " 200 100") {
		t.Errorf("arc path = %q", d)
	}
}

func TestPictureFilledShape(t *testing.T) {
	png := pngBytes(t)
	objs := parseOneSlide(t, pptxParts{
		slides: []string{`<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr>` +
			`<a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm><a:prstGeom prst="ellipse"><a:avLst/></a:prstGeom>` +
			`<a:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect l="-25000" r="-25000"/></a:stretch></a:blipFill></p:spPr>` +
			`<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr><a:noFill/></a:rPr><a:t> </a:t></a:r></a:p></p:txBody></p:sp>`},
		slideRels: map[string]string{"rId9": "../media/p.png"},
		media:     map[string][]byte{"ppt/media/p.png": png},
	})
	if len(objs) != 1 || objs[0].Type != "image" {
		t.Fatalf("objects = %+v", objs)
	}
	p := objs[0].Props
	if p.Mask != "ellipse" || len(p.Crop) != 4 || !closeTo(p.Crop[0], 0.1667) || !closeTo(p.Crop[2], 0.1667) {
		t.Errorf("mask %q crop %v, want ellipse and a sixth off each side", p.Mask, p.Crop)
	}
}

/* ---------------- tables ---------------- */

const testTableStyles = `<a:tblStyleLst xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" def="{S}">` +
	`<a:tblStyle styleId="{S}" styleName="t"><a:wholeTbl><a:tcTxStyle><a:schemeClr val="dk1"/></a:tcTxStyle>` +
	`<a:tcStyle><a:tcBdr><a:insideH><a:ln w="12700"><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill></a:ln></a:insideH></a:tcBdr>` +
	`<a:fill><a:solidFill><a:srgbClr val="EEEEEE"/></a:solidFill></a:fill></a:tcStyle></a:wholeTbl>` +
	`<a:band1H><a:tcStyle><a:fill><a:solidFill><a:srgbClr val="CCCCCC"/></a:solidFill></a:fill></a:tcStyle></a:band1H>` +
	`<a:firstRow><a:tcTxStyle b="on"><a:srgbClr val="FFFFFF"/></a:tcTxStyle><a:tcStyle><a:fill><a:solidFill><a:srgbClr val="FF8800"/></a:solidFill></a:fill></a:tcStyle></a:firstRow>` +
	`</a:tblStyle></a:tblStyleLst>`

func testTableFrame(tblPr, rows string) string {
	return `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="4" name="t"/><p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
		`<p:xfrm><a:off x="0" y="0"/><a:ext cx="2743200" cy="914400"/></p:xfrm><a:graphic>` +
		`<a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/table"><a:tbl>` + tblPr +
		`<a:tblGrid><a:gridCol w="914400"/><a:gridCol w="914400"/><a:gridCol w="914400"/></a:tblGrid>` + rows +
		`</a:tbl></a:graphicData></a:graphic></p:graphicFrame>`
}

func testCell(attrs, text string) string {
	return `<a:tc` + attrs + `><a:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:rPr sz="1400"/><a:t>` + text +
		`</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`
}

func TestPptxTableStyleAndMerges(t *testing.T) {
	rows := `<a:tr h="304800">` + testCell(` gridSpan="2"`, "head") + testCell(` hMerge="1"`, "") + testCell("", "x") + `</a:tr>` +
		`<a:tr h="304800">` + testCell(` rowSpan="2"`, "tall") + testCell("", "a") + testCell("", "b") + `</a:tr>` +
		`<a:tr h="304800">` + testCell(` vMerge="1"`, "") + testCell("", "c") + testCell("", "d") + `</a:tr>`
	objs := parseOneSlide(t, pptxParts{
		slides:     []string{testTableFrame(`<a:tblPr firstRow="1" bandRow="1"/>`, rows)},
		extraParts: map[string]string{"ppt/tableStyles.xml": testTableStyles},
	})
	if len(objs) != 1 || objs[0].Type != "table" {
		t.Fatalf("objects = %+v", objs)
	}
	p := objs[0].Props
	if !p.Styled || p.Stroke != "#ffffff" || !closeTo(p.StrokeW, 12700.0/emuPerPx) {
		t.Errorf("styled %v rule %q %v", p.Styled, p.Stroke, p.StrokeW)
	}
	if p.CellFill[0][0] != "#ff8800" || p.CellFill[1][1] != "#cccccc" || p.CellFill[2][1] != "#eeeeee" {
		t.Errorf("fills = %v (heading, band 1, band 2)", p.CellFill)
	}
	if !strings.Contains(p.Rows[0][0], "font-weight:700") || !strings.Contains(p.Rows[0][0], "#ffffff") {
		t.Errorf("heading text = %s, want bold white", p.Rows[0][0])
	}
	want := [][]int{{0, 0, 1, 2}, {1, 0, 2, 1}}
	if len(p.Merges) != 2 || p.Merges[0][3] != 2 || p.Merges[1][2] != 2 {
		t.Fatalf("merges = %v, want %v", p.Merges, want)
	}
	// the writer states the merges back
	out, err := BuildPptx(&Presentation{Slides: []*Slide{{Objects: objs}}})
	if err != nil {
		t.Fatalf("BuildPptx: %v", err)
	}
	slide := packagePart(t, out, "ppt/slides/slide1.xml")
	for _, w := range []string{`gridSpan="2"`, `hMerge="1"`, `rowSpan="2"`, `vMerge="1"`} {
		if !strings.Contains(slide, w) {
			t.Errorf("written table lacks %s", w)
		}
	}
}

func TestTableStylePartsOrder(t *testing.T) {
	style, _ := parseXMLTree([]byte(strings.Replace(testTableStyles, `def="{S}">`, `def="{S}">`, 1)))
	st := style.first("tblStyle")
	names := func(parts []*xnode) string {
		var out []string
		for _, p := range parts {
			out = append(out, p.XMLName.Local)
		}
		return strings.Join(out, ",")
	}
	f := tblFlags{firstRow: true, bandRow: true}
	if got := names(styleParts(st, f, 0, 0, 3, 3)); got != "wholeTbl,firstRow" {
		t.Errorf("heading cell parts = %s", got)
	}
	if got := names(styleParts(st, f, 1, 0, 3, 3)); got != "wholeTbl,band1H" {
		t.Errorf("first body row parts = %s", got)
	}
	if got := names(styleParts(st, f, 2, 0, 3, 3)); got != "wholeTbl" {
		t.Errorf("second body row parts = %s (the style has no band2H)", got)
	}
}

/* ---------------- Office math ---------------- */

func TestChoiceReadable(t *testing.T) {
	const m = `xmlns:mc="mc" xmlns:a14="a14" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"`
	tests := []struct {
		name string
		xml  string
		want bool
	}{
		{"a symbol set as math", `<mc:Choice ` + m + ` Requires="a14"><a14:m><m:oMath><m:r><m:t>≥</m:t></m:r></m:oMath></a14:m></mc:Choice>`, true},
		{"a fraction", `<mc:Choice ` + m + ` Requires="a14"><a14:m><m:oMath><m:f><m:num/><m:den/></m:f></m:oMath></a14:m></mc:Choice>`, false},
		{"no math at all", `<mc:Choice ` + m + ` Requires="a14"><x/></mc:Choice>`, false},
		{"another requirement", `<mc:Choice ` + m + ` Requires="p14"><a14:m><m:oMath/></a14:m></mc:Choice>`, false},
	}
	for _, tc := range tests {
		n, err := parseXMLTree([]byte(tc.xml))
		if err != nil {
			t.Fatalf("%s: %v", tc.name, err)
		}
		if got := choiceReadable(n); got != tc.want {
			t.Errorf("%s: choiceReadable = %v", tc.name, got)
		}
	}
}

func packagePart(t *testing.T, data []byte, name string) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name == name {
			rc, _ := f.Open()
			b, _ := io.ReadAll(rc)
			rc.Close()
			return string(b)
		}
	}
	t.Fatalf("no part %s", name)
	return ""
}

/* ---------------- writing ---------------- */

func TestPptxWriterKeepsNewLooks(t *testing.T) {
	pres := &Presentation{Size: []int{960, 540}, Slides: []*Slide{{Objects: []*Object{
		{Type: "shape", W: 100, H: 100, Props: Props{Kind: "rect", Fill: "#ff000080"}},
		{Type: "shape", W: 100, H: 100, Props: Props{Kind: "chevron", Fill: "#00ff00", Adj: map[string]float64{"adj": 30000}}},
		{Type: "shape", W: 100, H: 100, Props: Props{Kind: "custom", Fill: "#0000ff",
			Geom: &CustomGeom{Paths: []CustomPath{{W: 100, H: 100, D: "M0 0L100 0L50 100Z"}}}}},
	}}}}
	out, err := BuildPptx(pres)
	if err != nil {
		t.Fatalf("BuildPptx: %v", err)
	}
	slide := packagePart(t, out, "ppt/slides/slide1.xml")
	for _, w := range []string{
		`<a:srgbClr val="FF0000"><a:alpha val="50196"/></a:srgbClr>`,
		`<a:gd name="adj" fmla="val 30000"/>`,
		`<a:custGeom>`, `<a:lnTo><a:pt x="100" y="0"/></a:lnTo>`, `<a:close/>`,
	} {
		if !strings.Contains(slide, w) {
			t.Errorf("written slide lacks %s", w)
		}
	}
}

// Backgrounds and gradient fills go out as PowerPoint states them, and come
// back the same
func TestPptxBackgroundsRoundTrip(t *testing.T) {
	grad := &Gradient{Kind: "linear", Angle: 180, Stops: []GradientStop{{Pos: 0, Color: "#5e9eff"}, {Pos: 1, Color: "#ffffff"}}}
	radial := &Gradient{Kind: "radial", CX: 0.5, CY: 0.5, Stops: []GradientStop{{Pos: 0, Color: "#b1ddff"}, {Pos: 1, Color: "#cbe8fe"}}}
	pic := encodeDataURL(pngBytes(t), "png")
	pres := &Presentation{Size: []int{960, 720}, Slides: []*Slide{
		{BgGrad: grad, Objects: []*Object{{Type: "shape", X: 10, Y: 10, W: 100, H: 100,
			Props: Props{Kind: "rect", Fill: "#b1ddff", FillGrad: radial}}}},
		{BgImage: &BgImage{Src: pic, X: -96, Y: 0, W: 1152, H: 720}, Objects: []*Object{}},
	}}
	out, err := BuildPptx(pres)
	if err != nil {
		t.Fatalf("BuildPptx: %v", err)
	}
	back, err := ParsePptx(out)
	if err != nil {
		t.Fatalf("ParsePptx: %v", err)
	}
	s1, s2 := back.Slides[0], back.Slides[1]
	if s1.BgGrad == nil || !closeTo(s1.BgGrad.Angle, 180) || s1.BgGrad.Stops[0].Color != "#5e9eff" {
		t.Errorf("gradient background = %+v", s1.BgGrad)
	}
	var shape *Object
	for _, o := range s1.Objects {
		if o.Type == "shape" {
			shape = o
		}
	}
	if shape == nil || shape.Props.FillGrad == nil || shape.Props.FillGrad.Kind != "radial" || !closeTo(shape.Props.FillGrad.CX, 0.5) {
		t.Errorf("gradient fill = %+v", shape)
	}
	if s2.BgImage == nil || !closeTo(s2.BgImage.X, -96) || !closeTo(s2.BgImage.W, 1152) {
		t.Errorf("picture background = %+v", s2.BgImage)
	}
}

// A save keeps what the editor draws: a picture's frame fill showing through
// its transparent pixels, and a first paragraph's space before
func TestPptxWriterKeepsFrameFillAndFirstSpacing(t *testing.T) {
	grad := &Gradient{Kind: "linear", Angle: 180, Stops: []GradientStop{{Pos: 0, Color: "#263b86"}, {Pos: 1, Color: "#5e9eff"}}}
	pic := encodeDataURL(pngBytes(t), "png")
	html := `<div style="margin-top:8px;margin-bottom:6px;">first</div><div style="margin-top:8px;">second</div>`
	pres := &Presentation{Size: []int{960, 540}, Slides: []*Slide{{Objects: []*Object{
		{Type: "image", X: 10, Y: 10, W: 200, H: 50, Props: Props{Src: pic, Fill: "#263b86", FillGrad: grad}},
		{Type: "image", X: 10, Y: 80, W: 200, H: 50, Props: Props{Src: pic, Fill: "#ffffffec"}},
		{Type: "text", X: 10, Y: 150, W: 400, H: 100, Props: Props{HTML: html, FontSize: 18}},
	}}}}
	out, err := BuildPptx(pres)
	if err != nil {
		t.Fatalf("BuildPptx: %v", err)
	}
	back, err := ParsePptx(out)
	if err != nil {
		t.Fatalf("ParsePptx: %v", err)
	}
	var imgs []*Object
	var text *Object
	for _, o := range back.Slides[0].Objects {
		switch o.Type {
		case "image":
			imgs = append(imgs, o)
		case "text":
			text = o
		}
	}
	tests := []struct {
		name string
		ok   bool
	}{
		{"gradient frame fill", len(imgs) == 2 && imgs[0].Props.FillGrad != nil && imgs[0].Props.FillGrad.Stops[0].Color == "#263b86"},
		{"translucent frame fill", len(imgs) == 2 && imgs[1].Props.Fill == "#ffffffec"},
		{"first paragraph keeps its space before", text != nil && strings.HasPrefix(text.Props.HTML, `<div`) &&
			strings.Contains(text.Props.HTML[:strings.Index(text.Props.HTML, ">")], "margin-top:8px")},
	}
	for _, tc := range tests {
		if !tc.ok {
			t.Errorf("%s lost: images %+v, text %+v", tc.name, imgs, text)
		}
	}
}

// A table that came with a style keeps its own look through a save: it names
// the style that adds nothing, and its rules come back from the cells
func TestPptxStyledTableRoundTrip(t *testing.T) {
	tests := []struct {
		name, stroke string
		strokeW      float64
	}{
		{"white rules", "#ffffff", 1.33},
		{"no rules", "none", 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			pres := &Presentation{Size: []int{960, 540}, Slides: []*Slide{{Objects: []*Object{
				{Type: "table", X: 10, Y: 10, W: 300, H: 100, Props: Props{
					Rows: [][]string{{"a", "b"}, {"c", "d"}}, HeaderRow: true, Styled: true,
					Stroke: tc.stroke, StrokeW: tc.strokeW,
					CellFill: [][]string{{"#6aa84f", "#6aa84f"}, {"", ""}},
				}},
			}}}}
			out, err := BuildPptx(pres)
			if err != nil {
				t.Fatalf("BuildPptx: %v", err)
			}
			if !strings.Contains(packagePart(t, out, "ppt/slides/slide1.xml"), noTableStyleID) {
				t.Errorf("styled table does not name the no-look style")
			}
			back, err := ParsePptx(out)
			if err != nil {
				t.Fatalf("ParsePptx: %v", err)
			}
			var tbl *Object
			for _, o := range back.Slides[0].Objects {
				if o.Type == "table" {
					tbl = o
				}
			}
			if tbl == nil {
				t.Fatalf("table lost")
			}
			p := tbl.Props
			if !p.Styled || p.Stroke != tc.stroke || !closeTo(p.StrokeW, tc.strokeW) {
				t.Errorf("styled = %v, stroke = %q %v; want true, %q %v", p.Styled, p.Stroke, p.StrokeW, tc.stroke, tc.strokeW)
			}
		})
	}
}
