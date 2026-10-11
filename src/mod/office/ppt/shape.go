package ppt

/*
	shape.go - OfficeArt shapes as PresentationML (LibreOffice:
	SdrPowerPointImport::ProcessObj in svdfppt.cxx and the OfficeArt import
	of msdffimp.cxx).

	A top level shape is anchored in master units (576 per inch) by its
	client anchor; a group member by its child anchor in the group's own
	coordinate space, which PresentationML keeps as the group's chOff /
	chExt - so members are written in that space as they are. Every look is
	written onto the shape itself: the colour scheme is resolved to RGB and
	the master's text styles are applied paragraph by paragraph, so the
	result reads the same without any inheritance.
*/

import (
	"encoding/binary"
	"math"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/office/internal/officeart"
	"imuslab.com/arozos/mod/office/internal/xmltree"
)

// presets maps MSOSPT shape types to DrawingML preset geometry
var presets = map[uint16]string{
	1: "rect", 2: "roundRect", 3: "ellipse", 4: "diamond", 5: "triangle", 6: "rtTriangle",
	7: "parallelogram", 8: "trapezoid", 9: "hexagon", 10: "octagon", 11: "plus", 12: "star5",
	13: "rightArrow", 14: "rightArrow", 15: "homePlate", 16: "cube", 17: "wedgeRoundRectCallout",
	18: "star16", 19: "arc", 20: "line", 21: "plaque", 22: "can", 23: "donut",
	32: "straightConnector1", 33: "bentConnector2", 34: "bentConnector3", 35: "bentConnector4",
	36: "bentConnector5", 37: "curvedConnector2", 38: "curvedConnector3", 39: "curvedConnector4",
	40: "curvedConnector5", 41: "callout1", 42: "callout2", 43: "callout3", 44: "accentCallout1",
	45: "accentCallout2", 46: "accentCallout3", 47: "borderCallout1", 48: "borderCallout2",
	49: "borderCallout3", 50: "accentBorderCallout1", 51: "accentBorderCallout2",
	52: "accentBorderCallout3", 53: "ribbon", 54: "ribbon2", 55: "chevron", 56: "pentagon",
	57: "noSmoking", 58: "star8", 59: "star16", 60: "star32", 61: "wedgeRectCallout",
	62: "wedgeRoundRectCallout", 63: "wedgeEllipseCallout", 64: "wave", 65: "foldedCorner",
	66: "leftArrow", 67: "downArrow", 68: "upArrow", 69: "leftRightArrow", 70: "upDownArrow",
	71: "irregularSeal1", 72: "irregularSeal2", 73: "lightningBolt", 74: "heart", 75: "rect",
	76: "quadArrow", 77: "leftArrowCallout", 78: "rightArrowCallout", 79: "upArrowCallout",
	80: "downArrowCallout", 81: "leftRightArrowCallout", 82: "upDownArrowCallout",
	83: "quadArrowCallout", 84: "bevel", 85: "leftBracket", 86: "rightBracket", 87: "leftBrace",
	88: "rightBrace", 89: "leftUpArrow", 90: "bentUpArrow", 91: "bentArrow", 92: "star24",
	93: "stripedRightArrow", 94: "notchedRightArrow", 95: "blockArc", 96: "smileyFace",
	97: "verticalScroll", 98: "horizontalScroll", 99: "circularArrow", 100: "circularArrow",
	101: "uturnArrow", 102: "curvedRightArrow", 103: "curvedLeftArrow", 104: "curvedUpArrow",
	105: "curvedDownArrow", 106: "cloudCallout", 107: "ellipseRibbon", 108: "ellipseRibbon2",
	109: "flowChartProcess", 110: "flowChartDecision", 111: "flowChartInputOutput",
	112: "flowChartPredefinedProcess", 113: "flowChartInternalStorage", 114: "flowChartDocument",
	115: "flowChartMultidocument", 116: "flowChartTerminator", 117: "flowChartPreparation",
	118: "flowChartManualInput", 119: "flowChartManualOperation", 120: "flowChartConnector",
	121: "flowChartPunchedCard", 122: "flowChartPunchedTape", 123: "flowChartSummingJunction",
	124: "flowChartOr", 125: "flowChartCollate", 126: "flowChartSort", 127: "flowChartExtract",
	128: "flowChartMerge", 129: "flowChartOfflineStorage", 130: "flowChartOnlineStorage",
	131: "flowChartMagneticTape", 132: "flowChartMagneticDisk", 133: "flowChartMagneticDrum",
	134: "flowChartDisplay", 135: "flowChartDelay", 176: "flowChartAlternateProcess",
	177: "flowChartOffpageConnector", 178: "callout1", 179: "accentCallout1", 180: "borderCallout1",
	181: "accentBorderCallout1", 182: "leftRightUpArrow", 183: "sun", 184: "moon",
	185: "bracketPair", 186: "bracePair", 187: "star4", 188: "doubleWave",
	189: "actionButtonBlank", 190: "actionButtonHome", 191: "actionButtonHelp",
	192: "actionButtonInformation", 193: "actionButtonForwardNext", 194: "actionButtonBackPrevious",
	195: "actionButtonEnd", 196: "actionButtonBeginning", 197: "actionButtonReturn",
	198: "actionButtonDocument", 199: "actionButtonSound", 200: "actionButtonMovie", 202: "rect",
}

func isLineType(t uint16) bool { return t == 20 || (t >= 32 && t <= 40) }

// slideCtx is the slide part being written
type slideCtx struct {
	w      *writer
	p      *pres
	s      *slideRec
	master *slideRec // whose text styles and placeholders apply
	scheme [8]uint32
	part   *partRels
	nextID int
	number int
	notes  bool
}

func emu(v float64) string { return strconv.FormatInt(int64(math.Round(v)), 10) }

func hex6(c uint32) string {
	s := strings.ToUpper(strconv.FormatUint(uint64(c&0xFFFFFF), 16))
	return strings.Repeat("0", 6-len(s)) + s
}

// colorOf resolves an OfficeArtCOLORREF: RGB, scheme index or one of the
// shape's own colours
func (c *slideCtx) colorOf(v uint32, props officeart.Props) uint32 {
	cr := officeart.DecodeColor(v)
	switch {
	case cr.IsScheme():
		if int(cr.R) < 8 {
			return c.scheme[cr.R]
		}
	case cr.IsSystem():
		switch cr.R {
		case 0xF0: // the fill colour
			if f, ok := props.Get(officeart.PropFillColor); ok && officeart.DecodeColor(f).Flags&officeart.ColorSysIndex == 0 {
				return c.colorOf(f, props)
			}
			return c.scheme[4]
		case 0xF1: // the line colour
			if l, ok := props.Get(officeart.PropLineColor); ok && officeart.DecodeColor(l).Flags&officeart.ColorSysIndex == 0 {
				return c.colorOf(l, props)
			}
			return c.scheme[1]
		case 5, 15: // window / button face
			return 0xFFFFFF
		}
		return 0x000000
	}
	return uint32(cr.R)<<16 | uint32(cr.G)<<8 | uint32(cr.B)
}

// textColor resolves a ColorIndexStruct
func (c *slideCtx) textColor(ci colorIdx) uint32 {
	switch {
	case ci.index < 8:
		return c.scheme[ci.index]
	case ci.index == 0xFE:
		return uint32(ci.r)<<16 | uint32(ci.g)<<8 | uint32(ci.b)
	}
	return c.scheme[1]
}

func alphaXML(props officeart.Props, id uint16) string {
	if a := props.Fixed(id, 1); a < 0.999 && a >= 0 {
		return `<a:alpha val="` + strconv.Itoa(int(math.Round(a*100000))) + `"/>`
	}
	return ""
}

func srgb(c uint32, mods string) string {
	if mods == "" {
		return `<a:srgbClr val="` + hex6(c) + `"/>`
	}
	return `<a:srgbClr val="` + hex6(c) + `">` + mods + `</a:srgbClr>`
}

// fillXML writes a shape's fill
func (c *slideCtx) fillXML(sh *officeart.Shape, defFilled bool) string {
	pr := sh.Props
	if !pr.BoolDefault(officeart.PropFillBooleans, officeart.FillFilled, defFilled) {
		return "<a:noFill/>"
	}
	fore := uint32(0xFFFFFF)
	if v, ok := pr.Get(officeart.PropFillColor); ok {
		fore = c.colorOf(v, pr)
	}
	back := uint32(0xFFFFFF)
	if v, ok := pr.Get(officeart.PropFillBackColor); ok {
		back = c.colorOf(v, pr)
	}
	switch ft := pr.Int(officeart.PropFillType, 0); ft {
	case 2, 3: // texture, picture
		if pic := c.blip(pr, officeart.PropFillBlip); pic != "" {
			if ft == 2 {
				return `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="` + pic + `"/><a:srcRect/><a:tile tx="0" ty="0" sx="100000" sy="100000" flip="none" algn="tl"/></a:blipFill>`
			}
			return `<a:blipFill dpi="0" rotWithShape="1"><a:blip r:embed="` + pic + `"/><a:srcRect/><a:stretch><a:fillRect/></a:stretch></a:blipFill>`
		}
	case 4, 5, 6, 7, 8: // gradients
		a1, a2 := alphaXML(pr, officeart.PropFillOpacity), alphaXML(pr, officeart.PropFillBackOpacity)
		focus := pr.Int(officeart.PropFillFocus, 0)
		s1, s2 := srgb(fore, a1), srgb(back, a2)
		var stops string
		switch {
		case focus == 100 || focus == -100:
			stops = `<a:gs pos="0">` + s2 + `</a:gs><a:gs pos="100000">` + s1 + `</a:gs>`
		case focus == 50 || focus == -50:
			stops = `<a:gs pos="0">` + s2 + `</a:gs><a:gs pos="50000">` + s1 + `</a:gs><a:gs pos="100000">` + s2 + `</a:gs>`
		default:
			stops = `<a:gs pos="0">` + s1 + `</a:gs><a:gs pos="100000">` + s2 + `</a:gs>`
		}
		if ft == 4 || ft == 7 {
			ang := pr.Fixed(officeart.PropFillAngle, 0)
			deg := math.Mod(90-ang+360, 360)
			return `<a:gradFill rotWithShape="1"><a:gsLst>` + stops + `</a:gsLst><a:lin ang="` + strconv.Itoa(int(deg*60000)) + `" scaled="1"/></a:gradFill>`
		}
		return `<a:gradFill rotWithShape="1"><a:gsLst>` + stops + `</a:gsLst><a:path path="circle"><a:fillToRect l="50000" t="50000" r="50000" b="50000"/></a:path></a:gradFill>`
	case 9: // the slide background shows through
		return "<a:noFill/>"
	}
	return `<a:solidFill>` + srgb(fore, alphaXML(pr, officeart.PropFillOpacity)) + `</a:solidFill>`
}

var dashNames = []string{"solid", "sysDash", "sysDot", "sysDashDot", "sysDashDotDot", "dot", "dash", "lgDash", "dashDot", "lgDashDot", "lgDashDotDot"}
var arrowNames = []string{"none", "triangle", "stealth", "diamond", "oval", "arrow"}

// lineXML writes a shape's outline
func (c *slideCtx) lineXML(sh *officeart.Shape, defLine bool) string {
	pr := sh.Props
	if !pr.BoolDefault(officeart.PropLineBooleans, officeart.LineLine, defLine) {
		return "<a:ln><a:noFill/></a:ln>"
	}
	col := uint32(0)
	if v, ok := pr.Get(officeart.PropLineColor); ok {
		col = c.colorOf(v, pr)
	}
	w := pr.Int(officeart.PropLineWidth, 9525)
	var sb strings.Builder
	sb.WriteString(`<a:ln w="` + strconv.Itoa(int(w)) + `"><a:solidFill>` + srgb(col, alphaXML(pr, officeart.PropLineOpacity)) + `</a:solidFill>`)
	if d := int(pr.Int(officeart.PropLineDashing, 0)); d > 0 && d < len(dashNames) {
		sb.WriteString(`<a:prstDash val="` + dashNames[d] + `"/>`)
	}
	if a := int(pr.Int(officeart.PropLineStartArrow, 0)); a > 0 && a < len(arrowNames) {
		sb.WriteString(`<a:headEnd type="` + arrowNames[a] + `"/>`)
	}
	if a := int(pr.Int(officeart.PropLineEndArrow, 0)); a > 0 && a < len(arrowNames) {
		sb.WriteString(`<a:tailEnd type="` + arrowNames[a] + `"/>`)
	}
	sb.WriteString(`</a:ln>`)
	return sb.String()
}

// blip relates the picture a property names (pib or fillBlip) and returns
// its relationship id
func (c *slideCtx) blip(pr officeart.Props, id uint16) string {
	v, ok := pr.Get(id)
	if !ok || int(v) < 1 || int(v) > len(c.p.store) {
		return ""
	}
	b := c.p.store[v-1]
	data, ext, ok := usable(b)
	if !ok {
		return ""
	}
	return c.w.mediaRel(data, ext, c.part)
}

// anchor reads a shape's rectangle: (x, y, w, h) in EMU for a top level
// shape, in the group's space for a member
func (c *slideCtx) anchor(sh *officeart.Shape, inGroup bool) (float64, float64, float64, float64, bool) {
	// a group's own space is in master units in practice: written in EMU
	// like everything else, a member keeps its line widths unscaled
	if sh.Child != nil && (inGroup || sh.ClientAnchor == nil) {
		a := sh.Child
		return float64(a[0]) * emuPerMaster, float64(a[1]) * emuPerMaster,
			float64(a[2]-a[0]) * emuPerMaster, float64(a[3]-a[1]) * emuPerMaster, true
	}
	if sh.ClientAnchor == nil {
		return 0, 0, 0, 0, false
	}
	d := sh.ClientAnchor.Data
	le := binary.LittleEndian
	var t, l, r, b int
	switch {
	case len(d) >= 16:
		t, l, r, b = int(int32(le.Uint32(d))), int(int32(le.Uint32(d[4:]))), int(int32(le.Uint32(d[8:]))), int(int32(le.Uint32(d[12:])))
	case len(d) >= 8:
		t, l, r, b = int(int16(le.Uint16(d))), int(int16(le.Uint16(d[2:]))), int(int16(le.Uint16(d[4:]))), int(int16(le.Uint16(d[6:])))
	default:
		return 0, 0, 0, 0, false
	}
	return float64(l) * emuPerMaster, float64(t) * emuPerMaster, float64(r-l) * emuPerMaster, float64(b-t) * emuPerMaster, true
}

// xfrmXML writes a shape's transform. A shape turned by 45-135 or 225-315
// degrees is stored with its frame turned too: swap it back about its
// centre.
func xfrmXML(tag string, sh *officeart.Shape, x, y, w, h float64, group string) string {
	rot := sh.Props.Fixed(officeart.PropRotation, 0)
	rot = math.Mod(rot, 360)
	if rot < 0 {
		rot += 360
	}
	if (rot > 45 && rot <= 135) || (rot > 225 && rot <= 315) {
		cx, cy := x+w/2, y+h/2
		w, h = h, w
		x, y = cx-w/2, cy-h/2
	}
	s := `<` + tag
	if rot != 0 {
		s += ` rot="` + strconv.Itoa(int(math.Round(rot*60000))) + `"`
	}
	if sh.FlipH() {
		s += ` flipH="1"`
	}
	if sh.FlipV() {
		s += ` flipV="1"`
	}
	s += `><a:off x="` + emu(x) + `" y="` + emu(y) + `"/><a:ext cx="` + emu(math.Max(w, 0)) + `" cy="` + emu(math.Max(h, 0)) + `"/>` + group + `</` + tag + `>`
	return s
}

// placeholder reads a shape's OEPlaceholderAtom (placementId), -1 if none
func placeholder(sh *officeart.Shape) int {
	if sh.ClientData == nil {
		return -1
	}
	for _, r := range officeart.Parse(sh.ClientData.Data) {
		if r.Type == rtOEPlaceholderAtom && len(r.Data) >= 5 {
			return int(r.Data[4])
		}
	}
	return -1
}

// shapeLink is the click action of a shape (InteractiveInfo in its client
// data)
func shapeLink(sh *officeart.Shape) string {
	if sh.ClientData == nil {
		return ""
	}
	for _, r := range officeart.Parse(sh.ClientData.Data) {
		if r.Type == rtInteractiveInfo {
			return interactiveRef(r)
		}
	}
	return ""
}

// textOf gathers the text blocks of a shape: its client textbox, or the
// slide's outline text it refers to
func (c *slideCtx) textOf(sh *officeart.Shape) *textBlock {
	if sh.ClientTextbox == nil {
		return nil
	}
	var blocks []*textBlock
	for _, r := range officeart.Parse(sh.ClientTextbox.Data) {
		if r.Type == rtOutlineTextRef && len(r.Data) >= 4 {
			idx := int(int32(binary.LittleEndian.Uint32(r.Data)))
			if idx >= 0 && idx < len(c.s.texts) {
				blocks = append(blocks, c.s.texts[idx])
			}
			continue
		}
		addTextRecord(&blocks, r)
	}
	for _, b := range blocks {
		if len(b.text) > 0 {
			return b
		}
	}
	if len(blocks) > 0 {
		return blocks[0]
	}
	return nil
}

func (c *slideCtx) id() string {
	c.nextID++
	return strconv.Itoa(c.nextID)
}

// shapesXML writes the members of a group (or a drawing's patriarch)
func (c *slideCtx) shapesXML(g *officeart.Shape, inGroup bool, skipPlaceholders bool) string {
	var sb strings.Builder
	for _, sh := range g.Children {
		sb.WriteString(c.shapeXML(sh, inGroup, skipPlaceholders))
	}
	return sb.String()
}

// shapeXML writes one shape
func (c *slideCtx) shapeXML(sh *officeart.Shape, inGroup bool, skipPlaceholders bool) string {
	if sh.Deleted() || sh.Flags&officeart.SpBackground != 0 {
		return ""
	}
	if hidden, set := sh.Props.Bool(officeart.PropGroupBooleans, officeart.GroupHidden); set && hidden {
		return ""
	}
	ph := placeholder(sh)
	if ph >= 0 && skipPlaceholders {
		return ""
	}
	x, y, w, h, ok := c.anchor(sh, inGroup)
	if !ok {
		return ""
	}
	name := xmltree.Escape(sh.Props.String(officeart.PropWzName))
	descr := xmltree.Escape(sh.Props.String(officeart.PropWzDescription))
	id := c.id()
	cNvPr := `<p:cNvPr id="` + id + `" name="` + name + `"`
	if descr != "" {
		cNvPr += ` descr="` + descr + `"`
	}
	link := c.linkXML(shapeLink(sh), "hlinkClick")
	if link != "" {
		cNvPr += `>` + link + `</p:cNvPr>`
	} else {
		cNvPr += `/>`
	}

	if sh.IsGroup() {
		g := sh.Group
		chOff := `<a:chOff x="` + emu(float64(g[0])*emuPerMaster) + `" y="` + emu(float64(g[1])*emuPerMaster) + `"/><a:chExt cx="` +
			emu(float64(g[2]-g[0])*emuPerMaster) + `" cy="` + emu(float64(g[3]-g[1])*emuPerMaster) + `"/>`
		return `<p:grpSp><p:nvGrpSpPr>` + cNvPr + `<p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr>` +
			xfrmXML("a:xfrm", sh, x, y, w, h, chOff) + `</p:grpSpPr>` + c.shapesXML(sh, true, skipPlaceholders) + `</p:grpSp>`
	}

	text := c.textOf(sh)
	empty := text == nil || strings.TrimSpace(strings.Trim(string(decodeUTF16(text.text)), "\r\v\x00")) == ""

	// a picture
	if rid := c.blip(sh.Props, officeart.PropPib); rid != "" && (sh.Type == 75 || sh.Flags&officeart.SpOleShape != 0 || empty) {
		crop := ""
		l, t := sh.Props.Fixed(officeart.PropCropFromLeft, 0), sh.Props.Fixed(officeart.PropCropFromTop, 0)
		r, b := sh.Props.Fixed(officeart.PropCropFromRight, 0), sh.Props.Fixed(officeart.PropCropFromBottom, 0)
		if l != 0 || t != 0 || r != 0 || b != 0 {
			pct := func(v float64) string { return strconv.Itoa(int(math.Round(v * 100000))) }
			crop = `<a:srcRect l="` + pct(l) + `" t="` + pct(t) + `" r="` + pct(r) + `" b="` + pct(b) + `"/>`
		}
		geom := "rect"
		if g, ok := presets[sh.Type]; ok && sh.Type != 75 && sh.Type != 202 && !isLineType(sh.Type) {
			geom = g
		}
		return `<p:pic><p:nvPicPr>` + cNvPr + `<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr>` +
			`<p:blipFill><a:blip r:embed="` + rid + `"/>` + crop + `<a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr>` +
			xfrmXML("a:xfrm", sh, x, y, w, h, "") + `<a:prstGeom prst="` + geom + `"><a:avLst/></a:prstGeom>` +
			c.lineXML(sh, false) + `</p:spPr></p:pic>`
	}

	// a line or connector
	if isLineType(sh.Type) {
		return `<p:cxnSp><p:nvCxnSpPr>` + cNvPr + `<p:cNvCxnSpPr/><p:nvPr/></p:nvCxnSpPr><p:spPr>` +
			xfrmXML("a:xfrm", sh, x, y, w, h, "") + `<a:prstGeom prst="` + presets[sh.Type] + `"><a:avLst/></a:prstGeom>` +
			c.lineXML(sh, true) + `</p:spPr></p:cxnSp>`
	}

	// an empty placeholder is a prompt, not something shown
	if ph >= 0 && empty {
		return ""
	}
	geom := c.geometryXML(sh, w, h)
	defFilled := sh.Type != 202
	defLine := sh.Type != 202
	if ph >= 0 {
		defFilled, defLine = false, false
	}
	var sb strings.Builder
	sb.WriteString(`<p:sp><p:nvSpPr>` + cNvPr + `<p:cNvSpPr`)
	if sh.Type == 202 {
		sb.WriteString(` txBox="1"`)
	}
	sb.WriteString(`/><p:nvPr/></p:nvSpPr><p:spPr>` + xfrmXML("a:xfrm", sh, x, y, w, h, "") + geom +
		c.fillXML(sh, defFilled) + c.lineXML(sh, defLine) + `</p:spPr>`)
	sb.WriteString(c.txBodyXML(sh, text, ph))
	sb.WriteString(`</p:sp>`)
	return sb.String()
}

// geometryXML writes preset geometry, or the path of a freeform
func (c *slideCtx) geometryXML(sh *officeart.Shape, w, h float64) string {
	if sh.Type == 0 {
		if g := freeformXML(sh.Props); g != "" {
			return g
		}
	}
	prst, ok := presets[sh.Type]
	if !ok {
		prst = "rect"
	}
	av := ""
	if sh.Type == 2 { // round rectangle: adjust value 0..21600 of the shorter side
		if v, ok := sh.Props.Get(officeart.PropAdjustValue); ok {
			av = `<a:gd name="adj" fmla="val ` + strconv.Itoa(int(float64(int32(v))*50000/10800)) + `"/>`
		}
	}
	return `<a:prstGeom prst="` + prst + `"><a:avLst>` + av + `</a:avLst></a:prstGeom>`
}

// freeformXML writes a freeform's vertices and segments as custGeom
func freeformXML(pr officeart.Props) string {
	verts := pr.Array(officeart.PropVertices)
	segs := pr.Array(officeart.PropSegmentInfo)
	if len(verts) == 0 {
		return ""
	}
	pt := func(b []byte) (int, int) {
		if len(b) == 4 {
			return int(int16(binary.LittleEndian.Uint16(b))), int(int16(binary.LittleEndian.Uint16(b[2:])))
		}
		return int(int32(binary.LittleEndian.Uint32(b))), int(int32(binary.LittleEndian.Uint32(b[4:])))
	}
	left := int(pr.Int(officeart.PropGeoLeft, 0))
	top := int(pr.Int(officeart.PropGeoTop, 0))
	right := int(pr.Int(officeart.PropGeoRight, 21600))
	bottom := int(pr.Int(officeart.PropGeoBottom, 21600))
	var path strings.Builder
	v := 0
	next := func() string {
		if v >= len(verts) {
			return ""
		}
		x, y := pt(verts[v])
		v++
		return `<a:pt x="` + strconv.Itoa(x-left) + `" y="` + strconv.Itoa(y-top) + `"/>`
	}
	if len(segs) == 0 {
		// no segments: one open polyline through every vertex
		path.WriteString(`<a:moveTo>` + next() + `</a:moveTo>`)
		for v < len(verts) {
			path.WriteString(`<a:lnTo>` + next() + `</a:lnTo>`)
		}
	}
	for _, s := range segs {
		if len(s) < 2 {
			continue
		}
		e := binary.LittleEndian.Uint16(s)
		typ := e >> 13
		n := int(e & 0x1FFF)
		if n == 0 {
			n = 1
		}
		switch typ {
		case 0: // line to
			for k := 0; k < n; k++ {
				path.WriteString(`<a:lnTo>` + next() + `</a:lnTo>`)
			}
		case 1: // curve to: three points each
			for k := 0; k < n; k++ {
				path.WriteString(`<a:cubicBezTo>` + next() + next() + next() + `</a:cubicBezTo>`)
			}
		case 2: // move to
			path.WriteString(`<a:moveTo>` + next() + `</a:moveTo>`)
		case 3:
			path.WriteString(`<a:close/>`)
		case 4: // end
		case 5, 6: // escapes and client escapes draw nothing here
		}
	}
	return `<a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="0" t="0" r="r" b="b"/><a:pathLst><a:path w="` +
		strconv.Itoa(right-left) + `" h="` + strconv.Itoa(bottom-top) + `">` + path.String() + `</a:path></a:pathLst></a:custGeom>`
}

// linkXML writes an a:hlinkClick for a link target ("" for none)
func (c *slideCtx) linkXML(target, tag string) string {
	switch {
	case target == "":
		return ""
	case strings.HasPrefix(target, "link:"):
		n, _ := strconv.ParseUint(target[5:], 10, 32)
		l, ok := c.p.links[uint32(n)]
		if !ok {
			return ""
		}
		if l.url != "" {
			rid := c.part.add(relHyperlink, l.url, true)
			return `<a:` + tag + ` r:id="` + rid + `"/>`
		}
		// "slideId,number,title": a jump to a slide of this deck
		if parts := strings.Split(l.location, ","); len(parts) >= 2 {
			if num, err := strconv.Atoi(strings.TrimSpace(parts[1])); err == nil && num >= 1 {
				rid := c.part.add(relSlide, "slide"+strconv.Itoa(num)+".xml", false)
				return `<a:` + tag + ` r:id="` + rid + `" action="ppaction://hlinksldjump"/>`
			}
		}
	case target == "#next":
		return `<a:` + tag + ` r:id="" action="ppaction://hlinkshowjump?jump=nextslide"/>`
	case target == "#prev":
		return `<a:` + tag + ` r:id="" action="ppaction://hlinkshowjump?jump=previousslide"/>`
	case target == "#first":
		return `<a:` + tag + ` r:id="" action="ppaction://hlinkshowjump?jump=firstslide"/>`
	case target == "#last":
		return `<a:` + tag + ` r:id="" action="ppaction://hlinkshowjump?jump=lastslide"/>`
	}
	return ""
}

var anchors = map[int32]string{0: `anchor="t"`, 1: `anchor="ctr"`, 2: `anchor="b"`, 3: `anchor="t" anchorCtr="1"`,
	4: `anchor="ctr" anchorCtr="1"`, 5: `anchor="b" anchorCtr="1"`}

// txBodyXML writes the text of a shape with every format resolved
func (c *slideCtx) txBodyXML(sh *officeart.Shape, t *textBlock, ph int) string {
	pr := sh.Props
	var body strings.Builder
	body.WriteString(`<p:txBody><a:bodyPr lIns="` + strconv.Itoa(int(pr.Int(officeart.PropDxTextLeft, 91440))) +
		`" tIns="` + strconv.Itoa(int(pr.Int(officeart.PropDyTextTop, 45720))) +
		`" rIns="` + strconv.Itoa(int(pr.Int(officeart.PropDxTextRight, 91440))) +
		`" bIns="` + strconv.Itoa(int(pr.Int(officeart.PropDyTextBottom, 45720))) + `"`)
	defAnchor := int32(0)
	if t != nil && (t.typ == 0 || t.typ == 6) {
		defAnchor = 1
	}
	if a, ok := anchors[pr.Int(officeart.PropAnchorText, defAnchor)]; ok {
		body.WriteString(` ` + a)
	}
	if pr.Int(officeart.PropWrapText, 0) == 2 {
		body.WriteString(` wrap="none"`)
	} else {
		body.WriteString(` wrap="square"`)
	}
	body.WriteString(` rtlCol="0"><a:noAutofit/></a:bodyPr><a:lstStyle/>`)
	if t == nil || len(t.text) == 0 {
		body.WriteString(`<a:p><a:endParaRPr lang="en-US"/></a:p></p:txBody>`)
		return body.String()
	}
	typ := t.typ
	if typ < 0 || typ > 8 {
		typ = 4
	}
	master := c.master
	chain := c.p.styleChain(master, typ)

	text := t.text
	// the runs cover the text plus one character
	pfAt := func(i int) pfRun {
		n := 0
		for _, r := range t.pfRuns {
			n += r.count
			if i < n {
				return r
			}
		}
		if len(t.pfRuns) > 0 {
			return t.pfRuns[len(t.pfRuns)-1]
		}
		return pfRun{}
	}
	cfAt := func(i int) (cf, int) {
		n := 0
		for _, r := range t.cfRuns {
			if i < n+r.count {
				return r.cf, n + r.count
			}
			n += r.count
		}
		return cf{}, len(text) + 1
	}
	linkAt := func(i int) string {
		for _, l := range t.links {
			if i >= l.start && i < l.end {
				return l.target
			}
		}
		return ""
	}
	isNum := map[int]bool{}
	for _, p := range t.slideNum {
		isNum[p] = true
	}
	start := 0
	for start <= len(text) {
		end := start
		for end < len(text) && text[end] != 0x0D {
			end++
		}
		run := pfAt(start)
		ppf, pcf := resolve(chain, run.level)
		ppf = ppf.over(run.pf)
		if t.ruler != nil && run.level < 5 {
			if t.ruler.marginSet[run.level] {
				ppf.leftMargin = t.ruler.leftMargin[run.level]
			}
			if t.ruler.indentSet[run.level] {
				ppf.indent = t.ruler.indent[run.level]
			}
		}
		// the paragraph's first character decides its bullet's look
		firstCF, _ := cfAt(start)
		paraCF := pcf.over(firstCF)
		body.WriteString(`<a:p>` + c.pPrXML(ppf, paraCF, run.level))
		for i := start; i < end; {
			ex, runEnd := cfAt(i)
			stop := end
			if runEnd < stop {
				stop = runEnd
			}
			lk := linkAt(i)
			// split at links, line breaks and fields
			j := i
			for j < stop && linkAt(j) == lk && text[j] != 0x0B && !isNum[j] {
				j++
			}
			rcf := pcf.over(ex)
			rpr := c.rPrXML(rcf, lk)
			switch {
			case j == i && text[i] == 0x0B:
				body.WriteString(`<a:br>` + rpr + `</a:br>`)
				j = i + 1
			case j == i && isNum[i]:
				body.WriteString(`<a:fld id="{B6F15528-21DE-4FAA-801E-634DDDAF4B2B}" type="slidenum">` + rpr +
					`<a:t>` + strconv.Itoa(c.number) + `</a:t></a:fld>`)
				j = i + 1
			default:
				if j == i {
					j = i + 1
				}
				body.WriteString(`<a:r>` + rpr + `<a:t>` + xmlText(text[i:j]) + `</a:t></a:r>`)
			}
			i = j
		}
		ecf, _ := cfAt(end)
		body.WriteString(`<a:endParaRPr` + c.rPrAttrs(pcf.over(ecf)) + `/></a:p>`)
		if end >= len(text) {
			break
		}
		start = end + 1
	}
	body.WriteString(`</p:txBody>`)
	return body.String()
}

var alignNames = []string{"l", "ctr", "r", "just", "dist", "thaiDist", "justLow"}

// spacing writes a PowerPoint spacing value: a percentage when positive,
// master units when negative
func spacing(tag string, v int) string {
	if v >= 0 {
		return `<a:` + tag + `><a:spcPct val="` + strconv.Itoa(v*1000) + `"/></a:` + tag + `>`
	}
	return `<a:` + tag + `><a:spcPts val="` + strconv.Itoa(-v*100/8) + `"/></a:` + tag + `>`
}

func (c *slideCtx) font(i int) string {
	if i >= 0 && i < len(c.p.fonts) {
		return c.p.fonts[i]
	}
	return ""
}

func (c *slideCtx) pPrXML(p pf, firstCF cf, level int) string {
	var sb strings.Builder
	marL := float64(p.leftMargin) * emuPerMaster
	indent := float64(p.indent-p.leftMargin) * emuPerMaster
	sb.WriteString(`<a:pPr marL="` + emu(marL) + `" indent="` + emu(indent) + `"`)
	if level > 0 && level < 9 {
		sb.WriteString(` lvl="` + strconv.Itoa(level) + `"`)
	}
	if p.align >= 0 && p.align < len(alignNames) {
		sb.WriteString(` algn="` + alignNames[p.align] + `"`)
	}
	sb.WriteString(`>`)
	if p.lineSpacing != 0 {
		sb.WriteString(spacing("lnSpc", p.lineSpacing))
	}
	sb.WriteString(spacing("spcBef", p.spaceBefore))
	sb.WriteString(spacing("spcAft", p.spaceAfter))
	if p.bulletFlags&1 != 0 {
		if p.bulletFlags&4 != 0 {
			sb.WriteString(`<a:buClr>` + srgb(c.textColor(p.bulletColor), "") + `</a:buClr>`)
		}
		if p.bulletFlags&8 != 0 && p.bulletSize > 0 {
			sb.WriteString(`<a:buSzPct val="` + strconv.Itoa(p.bulletSize*1000) + `"/>`)
		}
		fontName := c.font(firstCF.font)
		if p.bulletFlags&2 != 0 {
			fontName = c.font(p.bulletFont)
		}
		if fontName != "" {
			sb.WriteString(`<a:buFont typeface="` + xmltree.Escape(fontName) + `"/>`)
		}
		ch := p.bulletChar
		if ch == 0 {
			ch = 0x2022
		}
		sb.WriteString(`<a:buChar char="` + xmltree.Escape(string(ch)) + `"/>`)
	} else {
		sb.WriteString(`<a:buNone/>`)
	}
	sb.WriteString(`</a:pPr>`)
	return sb.String()
}

// rPrAttrs is the attribute part of a run's properties
func (c *slideCtx) rPrAttrs(f cf) string {
	s := ` lang="en-US" sz="` + strconv.Itoa(f.size*100) + `"`
	if f.style&cfBold != 0 {
		s += ` b="1"`
	} else {
		s += ` b="0"`
	}
	if f.style&cfItalic != 0 {
		s += ` i="1"`
	} else {
		s += ` i="0"`
	}
	if f.style&cfUnderline != 0 {
		s += ` u="sng"`
	}
	if f.position != 0 {
		s += ` baseline="` + strconv.Itoa(f.position*1000) + `"`
	}
	return s
}

func (c *slideCtx) rPrXML(f cf, link string) string {
	var sb strings.Builder
	sb.WriteString(`<a:rPr` + c.rPrAttrs(f) + `>`)
	sb.WriteString(`<a:solidFill>` + srgb(c.textColor(f.color), "") + `</a:solidFill>`)
	if f.style&cfShadow != 0 {
		sb.WriteString(`<a:effectLst><a:outerShdw blurRad="38100" dist="38100" dir="2700000" algn="tl"><a:srgbClr val="000000"><a:alpha val="43137"/></a:srgbClr></a:outerShdw></a:effectLst>`)
	}
	if n := c.font(f.font); n != "" {
		sb.WriteString(`<a:latin typeface="` + xmltree.Escape(n) + `"/>`)
	}
	if f.mask&cfOldEA != 0 {
		if n := c.font(f.eaFont); n != "" {
			sb.WriteString(`<a:ea typeface="` + xmltree.Escape(n) + `"/>`)
		}
	}
	if f.mask&cfSymbol != 0 {
		if n := c.font(f.symFont); n != "" {
			sb.WriteString(`<a:sym typeface="` + xmltree.Escape(n) + `"/>`)
		}
	}
	sb.WriteString(c.linkXML(link, "hlinkClick"))
	sb.WriteString(`</a:rPr>`)
	return sb.String()
}

// xmlText escapes text for an a:t, dropping control characters
func xmlText(u []uint16) string {
	var sb strings.Builder
	for _, r := range decodeUTF16(u) {
		switch {
		case r == '&':
			sb.WriteString("&amp;")
		case r == '<':
			sb.WriteString("&lt;")
		case r == '>':
			sb.WriteString("&gt;")
		case r < 0x20 && r != '\t', r == 0xFFFE, r == 0xFFFF:
		default:
			sb.WriteRune(r)
		}
	}
	return sb.String()
}
