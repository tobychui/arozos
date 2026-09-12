package office

/*
	pptx_fidelity_test.go - the parts of PresentationML a deck's appearance
	actually depends on: theme colours, placeholder inheritance, per-run
	formatting, bullets, spacing, autofit, groups, crops and connectors.

	Each test builds the smallest package that exercises one rule, so a
	failure names the rule rather than "the import looks wrong".
*/

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

/* ---------------- package fixture ---------------- */

// pptxParts is a minimal .pptx: the caller supplies slide bodies and may
// override the layout, master and theme.
type pptxParts struct {
	slides     []string // the inner XML of each <p:cSld><p:spTree>
	layoutBody string   // extra XML inside the layout's spTree
	masterBody string   // extra XML inside the master's spTree
	masterTx   string   // the master's <p:txStyles>
	extraParts map[string]string
	slideRels  map[string]string // rId -> Target, added to every slide
	media      map[string][]byte
}

const testTheme = `<?xml version="1.0" encoding="UTF-8"?>` +
	`<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="t">` +
	`<a:themeElements><a:clrScheme name="c">` +
	`<a:dk1><a:srgbClr val="1A1A1A"/></a:dk1><a:lt1><a:srgbClr val="FFFFFF"/></a:lt1>` +
	`<a:dk2><a:srgbClr val="595959"/></a:dk2><a:lt2><a:srgbClr val="EEEEEE"/></a:lt2>` +
	`<a:accent1><a:srgbClr val="4285F4"/></a:accent1><a:accent2><a:srgbClr val="212121"/></a:accent2>` +
	`<a:accent3><a:srgbClr val="78909C"/></a:accent3><a:accent4><a:srgbClr val="FFAB40"/></a:accent4>` +
	`<a:accent5><a:srgbClr val="0097A7"/></a:accent5><a:accent6><a:srgbClr val="EEFF41"/></a:accent6>` +
	`<a:hlink><a:srgbClr val="0000EE"/></a:hlink><a:folHlink><a:srgbClr val="551A8B"/></a:folHlink>` +
	`</a:clrScheme><a:fontScheme name="f">` +
	`<a:majorFont><a:latin typeface="Verdana"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
	`<a:minorFont><a:latin typeface="Tahoma"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>` +
	`</a:fontScheme><a:fmtScheme name="s"/></a:themeElements></a:theme>`

const testNS = `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ` +
	`xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
	`xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"`

func buildTestPptx(t *testing.T, parts pptxParts) []byte {
	t.Helper()
	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)
	add := func(name, content string) {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip create %s: %v", name, err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatalf("zip write %s: %v", name, err)
		}
	}

	var sldIds, presRels strings.Builder
	presRels.WriteString(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/>`)
	for i := range parts.slides {
		rid := fmt.Sprintf("rId%d", i+2)
		sldIds.WriteString(fmt.Sprintf(`<p:sldId id="%d" r:id="%s"/>`, 256+i, rid))
		presRels.WriteString(fmt.Sprintf(
			`<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide%d.xml"/>`,
			rid, i+1))
	}
	add("ppt/presentation.xml", `<p:presentation `+testNS+`>`+
		`<p:sldMasterIdLst><p:sldMasterId id="1" r:id="rId1"/></p:sldMasterIdLst>`+
		`<p:sldIdLst>`+sldIds.String()+`</p:sldIdLst>`+
		`<p:sldSz cx="9144000" cy="5143500"/></p:presentation>`)
	add("ppt/_rels/presentation.xml.rels",
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+
			presRels.String()+`</Relationships>`)
	add("ppt/theme/theme1.xml", testTheme)

	tx := parts.masterTx
	if tx == "" {
		tx = `<p:txStyles><p:titleStyle><a:lvl1pPr><a:defRPr sz="4000"/></a:lvl1pPr></p:titleStyle>` +
			`<p:bodyStyle><a:lvl1pPr><a:defRPr sz="2000"/></a:lvl1pPr>` +
			`<a:lvl2pPr marL="914400" indent="-228600"><a:defRPr sz="1600"/></a:lvl2pPr></p:bodyStyle>` +
			`<p:otherStyle><a:lvl1pPr><a:defRPr sz="1400"/></a:lvl1pPr></p:otherStyle></p:txStyles>`
	}
	add("ppt/slideMasters/slideMaster1.xml", `<p:sldMaster `+testNS+`><p:cSld><p:spTree>`+
		parts.masterBody+`</p:spTree></p:cSld>`+
		`<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" `+
		`accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" `+
		`hlink="hlink" folHlink="folHlink"/>`+tx+`</p:sldMaster>`)
	add("ppt/slideMasters/_rels/slideMaster1.xml.rels",
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+
			`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/>`+
			`</Relationships>`)
	add("ppt/slideLayouts/slideLayout1.xml", `<p:sldLayout `+testNS+`><p:cSld><p:spTree>`+
		parts.layoutBody+`</p:spTree></p:cSld></p:sldLayout>`)
	add("ppt/slideLayouts/_rels/slideLayout1.xml.rels",
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+
			`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/>`+
			`</Relationships>`)

	for i, body := range parts.slides {
		add(fmt.Sprintf("ppt/slides/slide%d.xml", i+1),
			`<p:sld `+testNS+`><p:cSld><p:spTree>`+body+`</p:spTree></p:cSld></p:sld>`)
		rels := `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout" Target="../slideLayouts/slideLayout1.xml"/>`
		for id, target := range parts.slideRels {
			rels += fmt.Sprintf(`<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="%s"/>`, id, target)
		}
		add(fmt.Sprintf("ppt/slides/_rels/slide%d.xml.rels", i+1),
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+
				rels+`</Relationships>`)
	}
	for name, content := range parts.extraParts {
		add(name, content)
	}
	for name, data := range parts.media {
		w, err := zw.Create(name)
		if err != nil {
			t.Fatalf("zip create %s: %v", name, err)
		}
		if _, err := w.Write(data); err != nil {
			t.Fatalf("zip write %s: %v", name, err)
		}
	}
	if err := zw.Close(); err != nil {
		t.Fatalf("zip close: %v", err)
	}
	return buf.Bytes()
}

// parseOneSlide builds a package from one slide body and returns its objects
func parseOneSlide(t *testing.T, parts pptxParts) []*Object {
	t.Helper()
	data := buildTestPptx(t, parts)
	pres, err := ParsePptx(data)
	if err != nil {
		t.Fatalf("ParsePptx: %v", err)
	}
	if len(pres.Slides) != 1 {
		t.Fatalf("slides = %d, want 1", len(pres.Slides))
	}
	return pres.Slides[0].Objects
}

// textBox is a convenience wrapper for a plain text shape
func textBox(x, y, cx, cy int, body string) string {
	return fmt.Sprintf(`<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>`+
		`<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></a:xfrm>`+
		`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>`+
		`<p:txBody><a:bodyPr/><a:lstStyle/>%s</p:txBody></p:sp>`, x, y, cx, cy, body)
}

/* ---------------- colours ---------------- */

func TestPptxSchemeColorsResolveThroughClrMap(t *testing.T) {
	tests := []struct {
		name string
		fill string
		want string
	}{
		{"scheme accent", `<a:schemeClr val="accent1"/>`, "#4285f4"},
		{"mapped text colour", `<a:schemeClr val="tx1"/>`, "#1a1a1a"},
		{"mapped background", `<a:schemeClr val="bg1"/>`, "#ffffff"},
		{"literal rgb", `<a:srgbClr val="FF8800"/>`, "#ff8800"},
		{"preset name", `<a:prstClr val="red"/>`, "#ff0000"},
		{"luminance modulated", `<a:schemeClr val="accent1"><a:lumMod val="50000"/></a:schemeClr>`, "#093c92"},
		{"tinted toward white", `<a:srgbClr val="000000"><a:tint val="50000"/></a:srgbClr>`, "#808080"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			objs := parseOneSlide(t, pptxParts{slides: []string{
				`<p:sp><p:nvSpPr><p:cNvPr id="2" name="s"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
					`<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>` +
					`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
					`<a:solidFill>` + tc.fill + `</a:solidFill></p:spPr></p:sp>`,
			}})
			if len(objs) != 1 || objs[0].Type != "shape" {
				t.Fatalf("objects = %+v, want one shape", objs)
			}
			if objs[0].Props.Fill != tc.want {
				t.Errorf("fill = %q, want %q", objs[0].Props.Fill, tc.want)
			}
		})
	}
}

/* ---------------- placeholder inheritance ---------------- */

func TestPptxPlaceholderInheritsGeometryAndSize(t *testing.T) {
	layout := `<p:sp><p:nvSpPr><p:cNvPr id="9" name="lt"/><p:cNvSpPr/>` +
		`<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
		`<p:spPr><a:xfrm><a:off x="457200" y="228600"/><a:ext cx="4572000" cy="914400"/></a:xfrm></p:spPr>` +
		`<p:txBody><a:bodyPr/><a:lstStyle><a:lvl1pPr><a:defRPr sz="3200">` +
		`<a:solidFill><a:schemeClr val="accent1"/></a:solidFill></a:defRPr></a:lvl1pPr></a:lstStyle>` +
		`<a:p/></p:txBody></p:sp>`
	slide := `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr txBox="1"/>` +
		`<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/>` +
		`<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>Title</a:t></a:r></a:p></p:txBody></p:sp>`

	objs := parseOneSlide(t, pptxParts{slides: []string{slide}, layoutBody: layout})
	if len(objs) != 1 || objs[0].Type != "text" {
		t.Fatalf("objects = %+v, want one text object", objs)
	}
	o := objs[0]
	// 457200 EMU = 48px, 228600 = 24px at this slide size
	if o.X != 48 || o.Y != 24 || o.W != 480 || o.H != 96 {
		t.Errorf("geometry = %v,%v %vx%v, want 48,24 480x96", o.X, o.Y, o.W, o.H)
	}
	// 32pt inherited from the layout placeholder = 42.67 css px
	if o.Props.FontSize < 42 || o.Props.FontSize > 43 {
		t.Errorf("font size = %v, want ~42.67 (32pt from the layout)", o.Props.FontSize)
	}
	if o.Props.Color != "#4285f4" {
		t.Errorf("colour = %q, want the layout's accent1", o.Props.Color)
	}
}

func TestPptxOutlineLevelPicksItsOwnStyle(t *testing.T) {
	slide := `<p:sp><p:nvSpPr><p:cNvPr id="2" name="b"/><p:cNvSpPr txBox="1"/>` +
		`<p:nvPr><p:ph idx="1" type="body"/></p:nvPr></p:nvSpPr>` +
		`<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="2743200"/></a:xfrm></p:spPr>` +
		`<p:txBody><a:bodyPr/><a:lstStyle/>` +
		`<a:p><a:pPr lvl="0"/><a:r><a:t>top</a:t></a:r></a:p>` +
		`<a:p><a:pPr lvl="1"/><a:r><a:t>nested</a:t></a:r></a:p>` +
		`</p:txBody></p:sp>`
	objs := parseOneSlide(t, pptxParts{slides: []string{slide}})
	if len(objs) != 1 {
		t.Fatalf("objects = %+v, want one", objs)
	}
	html := objs[0].Props.HTML
	// lvl1 is 20pt (26.67px), lvl2 is 16pt (21.33px) from the master's bodyStyle
	if !strings.Contains(html, "font-size:26.67px") {
		t.Errorf("level 1 run did not take the 20pt body style: %s", html)
	}
	if !strings.Contains(html, "font-size:21.33px") {
		t.Errorf("level 2 run did not take the 16pt body style: %s", html)
	}
	// and the deeper level takes its own indent
	if !strings.Contains(html, "padding-left:96px") {
		t.Errorf("level 2 paragraph did not take the 914400 EMU margin: %s", html)
	}
}

/* ---------------- runs, breaks, autofit ---------------- */

func TestPptxKeepsPerRunFormatting(t *testing.T) {
	body := `<a:p><a:r><a:rPr sz="1800" b="1"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill>` +
		`<a:latin typeface="Georgia"/></a:rPr><a:t>red bold</a:t></a:r>` +
		`<a:r><a:rPr sz="1200" i="1" u="sng"><a:solidFill><a:srgbClr val="00FF00"/></a:solidFill></a:rPr>` +
		`<a:t>small green</a:t></a:r></a:p>`
	objs := parseOneSlide(t, pptxParts{slides: []string{textBox(0, 0, 4572000, 914400, body)}})
	html := objs[0].Props.HTML
	for _, want := range []string{
		"font-size:24px", "font-weight:700", "color:#ff0000", "Georgia",
		"font-size:16px", "font-style:italic", "text-decoration:underline", "color:#00ff00",
	} {
		if !strings.Contains(html, want) {
			t.Errorf("run formatting %q missing from %s", want, html)
		}
	}
}

func TestPptxLineBreakKeepsItsOwnHeight(t *testing.T) {
	body := `<a:p><a:r><a:rPr sz="1600"/><a:t>one</a:t></a:r>` +
		`<a:br><a:rPr sz="1600"/></a:br><a:br><a:rPr sz="1600"/></a:br></a:p>`
	objs := parseOneSlide(t, pptxParts{slides: []string{textBox(0, 0, 4572000, 914400, body)}})
	html := objs[0].Props.HTML
	// two breaks must leave two empty lines that still take up their height
	if strings.Count(html, "<br>") != 2 {
		t.Errorf("want 2 breaks, got %d: %s", strings.Count(html, "<br>"), html)
	}
	if strings.Count(html, "&#8203;") != 2 {
		t.Errorf("each break needs a sized spacer so the empty line has height: %s", html)
	}
}

func TestPptxAutofitScalesFontSizes(t *testing.T) {
	body := `<a:p><a:r><a:rPr sz="2000"/><a:t>shrunk</a:t></a:r></a:p>`
	sp := `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
		`<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="914400"/></a:xfrm>` +
		`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
		`<p:txBody><a:bodyPr><a:normAutofit fontScale="50000"/></a:bodyPr><a:lstStyle/>` + body + `</p:txBody></p:sp>`
	objs := parseOneSlide(t, pptxParts{slides: []string{sp}})
	// 20pt = 26.67px, halved by the autofit scale
	if !strings.Contains(objs[0].Props.HTML, "font-size:13.33px") {
		t.Errorf("normAutofit fontScale was not applied: %s", objs[0].Props.HTML)
	}
}

func TestPptxBodyAnchorAndInsets(t *testing.T) {
	sp := `<p:sp><p:nvSpPr><p:cNvPr id="2" name="t"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>` +
		`<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="914400"/></a:xfrm>` +
		`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr>` +
		`<p:txBody><a:bodyPr anchor="ctr" lIns="91440" tIns="91440" rIns="0" bIns="0"/><a:lstStyle/>` +
		`<a:p><a:r><a:t>x</a:t></a:r></a:p></p:txBody></p:sp>`
	objs := parseOneSlide(t, pptxParts{slides: []string{sp}})
	p := objs[0].Props
	if p.VAlign != "middle" {
		t.Errorf("valign = %q, want middle", p.VAlign)
	}
	// 91440 EMU = 9.6px
	want := []float64{9.6, 0, 0, 9.6}
	if len(p.Pad) != 4 {
		t.Fatalf("pad = %v, want 4 values", p.Pad)
	}
	for i := range want {
		if p.Pad[i] != want[i] {
			t.Errorf("pad[%d] = %v, want %v", i, p.Pad[i], want[i])
		}
	}
}

/* ---------------- bullets ---------------- */

func TestPptxBulletsUseHangingIndent(t *testing.T) {
	body := `<a:p><a:pPr marL="457200" indent="-228600"><a:buChar char="-"/></a:pPr>` +
		`<a:r><a:rPr sz="1600"/><a:t>item</a:t></a:r></a:p>`
	objs := parseOneSlide(t, pptxParts{slides: []string{textBox(0, 0, 4572000, 914400, body)}})
	html := objs[0].Props.HTML
	// 457200 EMU = 48px, 457200-228600 = 24px
	if !strings.Contains(html, "padding-left:48px") {
		t.Errorf("paragraph margin lost: %s", html)
	}
	if !strings.Contains(html, "position:absolute;left:24px") {
		t.Errorf("bullet is not at the hanging position: %s", html)
	}
	if !strings.Contains(html, ">-</span>") {
		t.Errorf("bullet glyph lost: %s", html)
	}
}

func TestPptxAutoNumberedBulletsCount(t *testing.T) {
	para := func(n string) string {
		return `<a:p><a:pPr marL="457200" indent="-228600"><a:buAutoNum type="arabicPeriod"/></a:pPr>` +
			`<a:r><a:t>` + n + `</a:t></a:r></a:p>`
	}
	objs := parseOneSlide(t, pptxParts{slides: []string{
		textBox(0, 0, 4572000, 1828800, para("a")+para("b")+para("c"))}})
	html := objs[0].Props.HTML
	for _, want := range []string{">1.</span>", ">2.</span>", ">3.</span>"} {
		if !strings.Contains(html, want) {
			t.Errorf("auto number %q missing: %s", want, html)
		}
	}
}

/* ---------------- groups, crops, connectors ---------------- */

func TestPptxGroupTransformsChildren(t *testing.T) {
	// the group maps a 0..1000000 child space onto 914400..2743200 EMU,
	// so a child at 500000 lands halfway across the group
	grp := `<p:grpSp><p:nvGrpSpPr><p:cNvPr id="2" name="g"/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>` +
		`<p:grpSpPr><a:xfrm><a:off x="914400" y="0"/><a:ext cx="1828800" cy="914400"/>` +
		`<a:chOff x="0" y="0"/><a:chExt cx="1000000" cy="500000"/></a:xfrm></p:grpSpPr>` +
		`<p:sp><p:nvSpPr><p:cNvPr id="3" name="c"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
		`<p:spPr><a:xfrm><a:off x="500000" y="0"/><a:ext cx="250000" cy="250000"/></a:xfrm>` +
		`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
		`<a:solidFill><a:srgbClr val="112233"/></a:solidFill></p:spPr></p:sp></p:grpSp>`
	objs := parseOneSlide(t, pptxParts{slides: []string{grp}})
	if len(objs) != 1 {
		t.Fatalf("objects = %+v, want the group's one child", objs)
	}
	o := objs[0]
	// group origin 914400 EMU = 96px, plus half of the 1828800 EMU (192px) width
	if o.X != 96+96 {
		t.Errorf("child x = %v, want 192", o.X)
	}
	// the child's 250000 of 1000000 becomes a quarter of the group's width
	if o.W != 48 {
		t.Errorf("child w = %v, want 48", o.W)
	}
}

func TestPptxPictureCropAndRadius(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("x", 32))
	pic := `<p:pic><p:nvPicPr><p:cNvPr id="2" name="p"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
		`<p:blipFill><a:blip r:embed="rId9"/><a:srcRect l="10000" t="20000" r="30000" b="0"/>` +
		`<a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
		`<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>` +
		`<a:prstGeom prst="roundRect"><a:avLst><a:gd name="adj" fmla="val 10000"/></a:avLst></a:prstGeom>` +
		`</p:spPr></p:pic>`
	objs := parseOneSlide(t, pptxParts{
		slides:    []string{pic},
		slideRels: map[string]string{"rId9": "../media/image1.png"},
		media:     map[string][]byte{"ppt/media/image1.png": png},
	})
	if len(objs) != 1 || objs[0].Type != "image" {
		t.Fatalf("objects = %+v, want one image", objs)
	}
	p := objs[0].Props
	want := []float64{0.1, 0.2, 0.3, 0}
	if len(p.Crop) != 4 {
		t.Fatalf("crop = %v, want 4 fractions", p.Crop)
	}
	for i := range want {
		if p.Crop[i] != want[i] {
			t.Errorf("crop[%d] = %v, want %v", i, p.Crop[i], want[i])
		}
	}
	// 10% of the shorter side (914400 EMU = 96px)
	if p.Radius != 9.6 {
		t.Errorf("radius = %v, want 9.6", p.Radius)
	}
	if !strings.HasPrefix(p.Src, "data:image/png;base64,") {
		t.Errorf("picture was not inlined: %.30s", p.Src)
	}
}

func TestPptxPictureMaskRoundTrips(t *testing.T) {
	// a shaped crop is a preset geometry on the picture; every kind the
	// editor can draw must survive being written and read back
	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("x", 32))
	for _, kind := range []string{"ellipse", "triangle", "diamond", "star5",
		"chevron", "hexagon", "downArrow", "plus", "roundRect", "heart"} {
		t.Run(kind, func(t *testing.T) {
			pres := &Presentation{Slides: []*Slide{{Objects: []*Object{{
				Type: "image", X: 10, Y: 20, W: 200, H: 100, Z: 1,
				Props: Props{
					Src:  encodeDataURL(png, "png"),
					Fit:  "fill",
					Mask: kind,
					Crop: []float64{0.1, 0, 0.2, 0},
				},
			}}}}}
			data, err := BuildPptx(pres)
			if err != nil {
				t.Fatalf("BuildPptx: %v", err)
			}
			got, err := ParsePptx(data)
			if err != nil {
				t.Fatalf("ParsePptx: %v", err)
			}
			objs := got.Slides[0].Objects
			if len(objs) != 1 || objs[0].Type != "image" {
				t.Fatalf("objects = %+v, want one image", objs)
			}
			p := objs[0].Props
			if p.Mask != kind {
				t.Errorf("mask = %q, want %q", p.Mask, kind)
			}
			if len(p.Crop) != 4 || p.Crop[0] != 0.1 || p.Crop[2] != 0.2 {
				t.Errorf("crop = %v, want [0.1 0 0.2 0]", p.Crop)
			}
		})
	}
}

func TestPptxPictureEffectsRoundTrip(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("x", 32))
	tests := []struct {
		name string
		in   Props
		want func(Props) string // "" when the value survived
	}{
		{"flips", Props{FlipH: true, FlipV: true}, func(p Props) string {
			if !p.FlipH || !p.FlipV {
				return fmt.Sprintf("flipH/flipV = %v/%v, want true/true", p.FlipH, p.FlipV)
			}
			return ""
		}},
		{"greyscale", Props{Recolor: "gray"}, func(p Props) string {
			if p.Recolor != "gray" {
				return "recolor = " + p.Recolor + ", want gray"
			}
			return ""
		}},
		{"black and white", Props{Recolor: "black-white"}, func(p Props) string {
			if p.Recolor != "black-white" {
				return "recolor = " + p.Recolor + ", want black-white"
			}
			return ""
		}},
		{"duotone tint", Props{Recolor: "teal"}, func(p Props) string {
			if p.Recolor != "teal" {
				return "recolor = " + p.Recolor + ", want teal"
			}
			return ""
		}},
		{"brightness and contrast", Props{Bright: 0.2, Contrast: -0.3}, func(p Props) string {
			if p.Bright != 0.2 || p.Contrast != -0.3 {
				return fmt.Sprintf("bright/contrast = %v/%v, want 0.2/-0.3", p.Bright, p.Contrast)
			}
			return ""
		}},
		{"transparency", Props{Opacity: 0.4}, func(p Props) string {
			if p.Opacity != 0.4 {
				return fmt.Sprintf("opacity = %v, want 0.4", p.Opacity)
			}
			return ""
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			props := tc.in
			props.Src = encodeDataURL(png, "png")
			props.Fit = "fill"
			pres := &Presentation{Slides: []*Slide{{Objects: []*Object{{
				Type: "image", X: 0, Y: 0, W: 200, H: 100, Z: 1, Props: props,
			}}}}}
			data, err := BuildPptx(pres)
			if err != nil {
				t.Fatalf("BuildPptx: %v", err)
			}
			got, err := ParsePptx(data)
			if err != nil {
				t.Fatalf("ParsePptx: %v", err)
			}
			objs := got.Slides[0].Objects
			if len(objs) != 1 || objs[0].Type != "image" {
				t.Fatalf("objects = %+v, want one image", objs)
			}
			if msg := tc.want(objs[0].Props); msg != "" {
				t.Error(msg)
			}
		})
	}
}

func TestPptxRoundPictureKeepsItsRadius(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\n" + strings.Repeat("x", 32))
	pres := &Presentation{Slides: []*Slide{{Objects: []*Object{{
		Type: "image", X: 0, Y: 0, W: 200, H: 100, Z: 1,
		Props: Props{Src: encodeDataURL(png, "png"), Mask: "roundRect", Radius: 10},
	}}}}}
	data, err := BuildPptx(pres)
	if err != nil {
		t.Fatalf("BuildPptx: %v", err)
	}
	got, err := ParsePptx(data)
	if err != nil {
		t.Fatalf("ParsePptx: %v", err)
	}
	p := got.Slides[0].Objects[0].Props
	if p.Mask != "roundRect" {
		t.Errorf("mask = %q, want roundRect", p.Mask)
	}
	// 10px of the 100px short side is a 10% adjust
	if p.Radius < 9.5 || p.Radius > 10.5 {
		t.Errorf("radius = %v, want ~10", p.Radius)
	}
}

func TestPptxBentConnectorKeepsItsElbow(t *testing.T) {
	cxn := `<p:cxnSp><p:nvCxnSpPr><p:cNvPr id="2" name="c"/><p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr>` +
		`<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="1828800" cy="914400"/></a:xfrm>` +
		`<a:prstGeom prst="bentConnector3"><a:avLst><a:gd name="adj1" fmla="val 50000"/></a:avLst></a:prstGeom>` +
		`<a:ln w="12700"><a:solidFill><a:srgbClr val="000000"/></a:solidFill>` +
		`<a:tailEnd type="triangle"/></a:ln></p:spPr></p:cxnSp>`
	objs := parseOneSlide(t, pptxParts{slides: []string{cxn}})
	if len(objs) != 1 || objs[0].Type != "line" {
		t.Fatalf("objects = %+v, want one line", objs)
	}
	pts := objs[0].Props.Points
	// 1828800 EMU = 192px wide, 914400 = 96px tall; the elbow bends halfway
	want := [][]float64{{0, 0}, {96, 0}, {96, 96}, {192, 96}}
	if len(pts) != len(want) {
		t.Fatalf("points = %v, want %v", pts, want)
	}
	for i := range want {
		if pts[i][0] != want[i][0] || pts[i][1] != want[i][1] {
			t.Errorf("point %d = %v, want %v", i, pts[i], want[i])
		}
	}
	if !objs[0].Props.ArrowEnd {
		t.Errorf("connector lost its arrow head")
	}
}

func TestPptxLayoutDecorationIsDrawnUnderTheSlide(t *testing.T) {
	layout := `<p:sp><p:nvSpPr><p:cNvPr id="9" name="deco"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr>` +
		`<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>` +
		`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
		`<a:solidFill><a:srgbClr val="ABCDEF"/></a:solidFill></p:spPr></p:sp>` +
		// a placeholder on the layout is a prototype and must NOT be drawn
		`<p:sp><p:nvSpPr><p:cNvPr id="10" name="ph"/><p:cNvSpPr/>` +
		`<p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr>` +
		`<p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="914400" cy="914400"/></a:xfrm>` +
		`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` +
		`<a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></p:spPr></p:sp>`
	objs := parseOneSlide(t, pptxParts{
		slides:     []string{textBox(0, 0, 914400, 914400, `<a:p><a:r><a:t>hi</a:t></a:r></a:p>`)},
		layoutBody: layout,
	})
	if len(objs) != 2 {
		t.Fatalf("objects = %d, want the layout's decoration plus the slide's text", len(objs))
	}
	if objs[0].Type != "shape" || objs[0].Props.Fill != "#abcdef" {
		t.Errorf("first object = %+v, want the layout's decoration underneath", objs[0])
	}
	if objs[1].Type != "text" {
		t.Errorf("second object = %+v, want the slide's own text on top", objs[1])
	}
}

func TestPptxSlideNumberField(t *testing.T) {
	body := `<a:p><a:fld id="{1}" type="slidenum"><a:t>&#8249;#&#8250;</a:t></a:fld></a:p>`
	data := buildTestPptx(t, pptxParts{slides: []string{
		textBox(0, 0, 914400, 457200, `<a:p><a:r><a:t>one</a:t></a:r></a:p>`),
		textBox(0, 0, 914400, 457200, body),
	}})
	pres, err := ParsePptx(data)
	if err != nil {
		t.Fatalf("ParsePptx: %v", err)
	}
	html := pres.Slides[1].Objects[0].Props.HTML
	if !strings.Contains(html, ">2</span>") {
		t.Errorf("slide number field did not resolve to 2: %s", html)
	}
}

/* ---------------- charts ---------------- */

func TestPptxChartFromCachedValues(t *testing.T) {
	chartXML := `<?xml version="1.0"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ` +
		`xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart>` +
		`<c:title><c:tx><c:rich><a:p><a:r><a:t>Sales</a:t></a:r></a:p></c:rich></c:tx></c:title>` +
		`<c:plotArea><c:barChart><c:barDir val="col"/><c:grouping val="stacked"/>` +
		`<c:ser><c:tx><c:strRef><c:strCache><c:ptCount val="1"/>` +
		`<c:pt idx="0"><c:v>2025</c:v></c:pt></c:strCache></c:strRef></c:tx>` +
		`<c:cat><c:strRef><c:strCache><c:ptCount val="2"/>` +
		`<c:pt idx="0"><c:v>Jan</c:v></c:pt><c:pt idx="1"><c:v>Feb</c:v></c:pt>` +
		`</c:strCache></c:strRef></c:cat>` +
		`<c:val><c:numRef><c:numCache><c:ptCount val="2"/>` +
		`<c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20.5</c:v></c:pt>` +
		`</c:numCache></c:numRef></c:val></c:ser></c:barChart>` +
		`<c:valAx><c:majorGridlines/></c:valAx></c:plotArea><c:legend/></c:chart></c:chartSpace>`

	frame := `<p:graphicFrame><p:nvGraphicFramePr><p:cNvPr id="2" name="ch"/>` +
		`<p:cNvGraphicFramePr/><p:nvPr/></p:nvGraphicFramePr>` +
		`<p:xfrm><a:off x="0" y="0"/><a:ext cx="4572000" cy="2743200"/></p:xfrm>` +
		`<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
		`<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" r:id="rId9"/>` +
		`</a:graphicData></a:graphic></p:graphicFrame>`

	objs := parseOneSlide(t, pptxParts{
		slides:     []string{frame},
		slideRels:  map[string]string{"rId9": "../charts/chart1.xml"},
		extraParts: map[string]string{"ppt/charts/chart1.xml": chartXML},
	})
	if len(objs) != 1 || objs[0].Type != "chart" {
		t.Fatalf("objects = %+v, want one chart", objs)
	}
	var spec chartSpec
	if err := json.Unmarshal(objs[0].Props.Spec, &spec); err != nil {
		t.Fatalf("chart spec is not valid JSON: %v", err)
	}
	if spec.Type != "bar" || spec.Title != "Sales" {
		t.Errorf("spec = %+v, want a bar chart titled Sales", spec)
	}
	if !spec.Options.Stacked || !spec.Options.Legend || !spec.Options.Gridlines {
		t.Errorf("chart options lost: %+v", spec.Options)
	}
	if len(spec.Labels) != 2 || spec.Labels[1] != "Feb" {
		t.Errorf("labels = %v, want [Jan Feb]", spec.Labels)
	}
	if len(spec.Series) != 1 || spec.Series[0].Name != "2025" ||
		len(spec.Series[0].Values) != 2 || spec.Series[0].Values[1] != 20.5 {
		t.Errorf("series = %+v, want one series 2025 [10 20.5]", spec.Series)
	}
}

/* ---------------- embedded fonts ---------------- */

func TestDecodeEmbeddedFont(t *testing.T) {
	ttf := append([]byte{0x00, 0x01, 0x00, 0x00}, bytes.Repeat([]byte{0x41}, 64)...)

	// an uncompressed EOT: header, then the font file as the tail
	eot := func(flags uint32, payload []byte) []byte {
		head := make([]byte, 82)
		putU32 := func(off int, v uint32) {
			head[off] = byte(v)
			head[off+1] = byte(v >> 8)
			head[off+2] = byte(v >> 16)
			head[off+3] = byte(v >> 24)
		}
		putU32(4, uint32(len(payload)))
		putU32(8, 0x00020002)
		putU32(12, flags)
		head[34], head[35] = 0x4C, 0x50 // magic 0x504C, little endian
		out := append(head, payload...)
		putU32(0, uint32(len(out)))
		out[0], out[1], out[2], out[3] = byte(len(out)), byte(len(out)>>8),
			byte(len(out)>>16), byte(len(out)>>24)
		return out
	}

	tests := []struct {
		name string
		in   []byte
		ok   bool
		mime string
	}{
		{"bare truetype", ttf, true, "font/ttf"},
		{"bare opentype", append([]byte("OTTO"), ttf[4:]...), true, "font/otf"},
		{"uncompressed eot", eot(0, ttf), true, "font/ttf"},
		{"compressed eot is declined", eot(eotCompressed, ttf), false, ""},
		{"not a font", []byte("hello there, not a font at all"), false, ""},
		{"too short", []byte{1, 2, 3}, false, ""},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			out, mime, ok := decodeEmbeddedFont(tc.in)
			if ok != tc.ok {
				t.Fatalf("ok = %v, want %v", ok, tc.ok)
			}
			if !tc.ok {
				return
			}
			if mime != tc.mime {
				t.Errorf("mime = %q, want %q", mime, tc.mime)
			}
			if sfntMagic(out) == "" {
				t.Errorf("decoded payload is not a font file")
			}
		})
	}
}

/* ---------------- font stacks ---------------- */

func TestFontStackFor(t *testing.T) {
	tests := []struct {
		name        string
		latin, ea   string
		wantParts   []string
		wantGeneric string
	}{
		{"plain family", "Arial", "Arial", []string{"Arial"}, "sans-serif"},
		{"weighted name offers its base", "Open Sans SemiBold", "Open Sans SemiBold",
			[]string{"'Open Sans SemiBold'", "'Open Sans'"}, "sans-serif"},
		{"east asian face is kept", "Arial", "Noto Sans TC",
			[]string{"Arial", "'Noto Sans TC'"}, "sans-serif"},
		{"monospace generic", "Courier New", "", []string{"'Courier New'"}, "monospace"},
		{"serif generic", "Times New Roman", "", []string{"'Times New Roman'"}, "serif"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := fontStackFor(tc.latin, tc.ea)
			for _, part := range tc.wantParts {
				if !strings.Contains(got, part) {
					t.Errorf("stack %q is missing %q", got, part)
				}
			}
			if !strings.HasSuffix(got, tc.wantGeneric) {
				t.Errorf("stack %q does not end in %q", got, tc.wantGeneric)
			}
		})
	}
}

// Every stack ends with the shipped document fonts: they are the only faces
// the browser-side PDF exporter can embed, so a run that falls through to one
// exports as real text. The document's own face must still come first, and
// the shipped names must not be repeated when the document already asked for
// one of them.
func TestFontStackOffersShippedFonts(t *testing.T) {
	tests := []struct {
		name      string
		latin, ea string
		wantFirst string
	}{
		{"latin document", "Arial", "", "Arial"},
		{"document already names a shipped face", "Noto Sans TC", "", "'Noto Sans TC'"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := fontStackFor(tc.latin, tc.ea)
			parts := strings.Split(got, ",")
			if parts[0] != tc.wantFirst {
				t.Errorf("stack %q starts with %q, want %q", got, parts[0], tc.wantFirst)
			}
			for _, shipped := range shippedFontFallbacks {
				if !strings.Contains(got, quoteFontName(shipped)) {
					t.Errorf("stack %q is missing the shipped face %q", got, shipped)
				}
				if n := strings.Count(got, quoteFontName(shipped)); n != 1 {
					t.Errorf("stack %q names %q %d times, want once", got, shipped, n)
				}
			}
		})
	}
}

/* ---------------- preset geometries ---------------- */

// The editor's catalogue (web/Office/slides/slides_shapes.js) names its
// shapes after the PresentationML presets, so a preset it draws must come
// back as itself and go out as itself. A round trip through both tables is
// what pins that down - and it is what stopped rightBrace from importing as
// an outlined rectangle.
func TestPresetGeometryRoundTrip(t *testing.T) {
	for _, prst := range []string{
		"rect", "roundRect", "ellipse", "triangle", "rtTriangle", "diamond",
		"rightArrow", "leftArrow", "upArrow", "downArrow", "star5",
		"chevron", "pentagon", "hexagon", "parallelogram", "trapezoid",
		"rightBrace", "leftBrace", "bracePair", "leftBracket", "rightBracket",
		"wedgeRectCallout", "wedgeRoundRectCallout", "cloudCallout",
		"flowChartDecision", "flowChartDocument", "flowChartTerminator",
		"can", "cube", "donut", "heart", "cloud", "quadArrow", "mathPlus",
	} {
		t.Run(prst, func(t *testing.T) {
			kind, ok := prstToShapeKind[prst]
			if !ok {
				t.Fatalf("preset %q has no shape kind", prst)
			}
			if got := shapeKindPrst(kind); got != prst {
				t.Errorf("%q -> kind %q -> %q, want %q back", prst, kind, got, prst)
			}
		})
	}
}

// A preset the editor cannot draw still has to land on something, and
// "rect" is the answer of last resort - never an empty geometry.
// The editor had three names of its own before the catalogue: round, arrow
// and star. They are gone from the catalogue, but a .ppta written back then
// still says them, so export has to translate - and what comes back is the
// preset's own name, which is how a deck gets rewritten by opening it.
func TestLegacyShapeNamesStillExport(t *testing.T) {
	for legacy, want := range map[string]string{
		"round": "roundRect", "arrow": "rightArrow", "star": "star5",
	} {
		t.Run(legacy, func(t *testing.T) {
			if got := shapeKindPrst(legacy); got != want {
				t.Errorf("%q exports as %q, want %q", legacy, got, want)
			}
			if _, drawn := prstToShapeKind[legacy]; drawn {
				t.Errorf("%q is still in the catalogue; it should only be a legacy alias", legacy)
			}
		})
	}
}

func TestPresetGeometryFallback(t *testing.T) {
	if got := shapeKindPrst("nothingLikeThisExists"); got != "rect" {
		t.Errorf("unknown kind -> %q, want rect", got)
	}
	if got := shapeKindPrst(""); got != "rect" {
		t.Errorf("empty kind -> %q, want rect", got)
	}
}

// Every kind the ODF writer knows has to read back as the same kind, or a
// deck loses its shapes on a .odp round trip.
func TestOdpShapeTypesRoundTrip(t *testing.T) {
	seen := map[string]string{}
	for kind, typ := range odpShapeTypes {
		if other, dup := seen[typ]; dup {
			// two kinds may share an ODF type (chevron and homePlate do);
			// the reader can only pick one, and that is fine
			t.Logf("ODF type %q is shared by %q and %q", typ, other, kind)
			continue
		}
		seen[typ] = kind
	}
	for typ, kind := range seen {
		eg := &onode{name: "enhanced-geometry", attrs: map[string]string{"type": typ}}
		n := &onode{name: "custom-shape", children: []onodeChild{{el: eg}}}
		got := odpCustomShapeKind(n)
		if got != kind && odpShapeTypes[got] != typ {
			t.Errorf("ODF type %q read back as %q, want %q", typ, got, kind)
		}
	}
}

func TestFontWeightOf(t *testing.T) {
	tests := []struct {
		name string
		want int
	}{
		{"Open Sans", 0},
		{"Open Sans SemiBold", 600},
		{"Open Sans Medium", 500},
		{"Roboto Light", 300},
		{"Arial Black", 900},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := fontWeightOf(tc.name); got != tc.want {
				t.Errorf("fontWeightOf(%q) = %d, want %d", tc.name, got, tc.want)
			}
		})
	}
}
