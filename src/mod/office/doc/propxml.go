package doc

/*
	propxml.go - property sets as WordprocessingML (w:rPr, w:pPr, w:sectPr
	and their borders and shading). Elements are written in schema order.
*/

import (
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/office/internal/xmltree"
)

func itoa(v int) string { return strconv.Itoa(v) }

func hexRGB(c uint32) string {
	s := strings.ToUpper(strconv.FormatUint(uint64(c&0xFFFFFF), 16))
	return strings.Repeat("0", 6-len(s)) + s
}

func colorAttr(c color) string {
	if c.auto {
		return "auto"
	}
	return hexRGB(c.rgb)
}

var ulNames = map[int]string{
	0: "none", 1: "single", 2: "words", 3: "double", 4: "dotted", 6: "thick", 7: "dash",
	9: "dotDash", 10: "dotDotDash", 11: "wave", 20: "dottedHeavy", 23: "dashedHeavy",
	25: "dashDotHeavy", 26: "dashDotDotHeavy", 27: "wavyHeavy", 39: "dashLong",
	43: "wavyDouble", 55: "dashLongHeavy",
}

var brcNames = map[uint8]string{
	1: "single", 2: "thick", 3: "double", 5: "single", 6: "dotted", 7: "dashed", 8: "dotDash",
	9: "dotDotDash", 10: "triple", 11: "thinThickSmallGap", 12: "thickThinSmallGap",
	13: "thinThickThinSmallGap", 14: "thinThickMediumGap", 15: "thickThinMediumGap",
	16: "thinThickThinMediumGap", 17: "thinThickLargeGap", 18: "thickThinLargeGap",
	19: "thinThickThinLargeGap", 20: "wave", 21: "doubleWave", 22: "dashSmallGap",
	23: "dashDotStroked", 24: "threeDEmboss", 25: "threeDEngrave", 26: "outset", 27: "inset",
}

// borderXML writes one border element ("" for a border that is not set)
func borderXML(tag string, b *brc) string {
	if b == nil || b.typ == 0xFF {
		return ""
	}
	if b.typ == 0 {
		return `<w:` + tag + ` w:val="nil"/>`
	}
	name, ok := brcNames[b.typ]
	if !ok {
		name = "single"
	}
	w := b.width
	if w < 2 {
		w = 2
	}
	s := `<w:` + tag + ` w:val="` + name + `" w:sz="` + itoa(w) + `" w:space="` + itoa(b.space) + `" w:color="` + colorAttr(b.color) + `"`
	if b.shadow {
		s += ` w:shadow="1"`
	}
	return s + `/>`
}

// pattern shares in percent, for the shading patterns that are a tint
var patPercent = map[int]float64{2: 5, 3: 10, 4: 20, 5: 25, 6: 30, 7: 40, 8: 50, 9: 60, 10: 70,
	11: 75, 12: 80, 13: 90, 35: 2.5, 36: 7.5, 37: 12.5, 38: 15, 39: 17.5, 40: 22.5, 41: 27.5,
	42: 32.5, 43: 35, 44: 37.5, 45: 42.5, 46: 45, 47: 47.5, 48: 52.5, 49: 55, 50: 57.5,
	51: 62.5, 52: 65, 53: 67.5, 54: 72.5, 55: 77.5, 56: 82.5, 57: 85, 58: 87.5, 59: 92.5,
	60: 95, 61: 97.5, 62: 97}

// shdXML writes shading as a plain fill: a solid pattern fills with the
// foreground colour, a percentage pattern with the mix of both colours
func shdXML(s *shd) string {
	if s == nil || s.pat == 0xFFFF {
		return ""
	}
	fore, back := s.fore, s.back
	if fore.auto {
		fore = color{rgb: 0x000000}
	}
	var fill color
	switch {
	case s.pat == 0:
		fill = s.back
	case s.pat == 1:
		fill = fore
	default:
		pct, ok := patPercent[s.pat]
		if !ok {
			fill = s.back
			break
		}
		if back.auto {
			back = color{rgb: 0xFFFFFF}
		}
		mix := func(sh uint) uint32 {
			f := float64(fore.rgb >> sh & 0xFF)
			b := float64(back.rgb >> sh & 0xFF)
			return uint32(b+(f-b)*pct/100+0.5) << sh
		}
		fill = color{rgb: mix(16) | mix(8) | mix(0)}
	}
	if fill.auto {
		return ""
	}
	return `<w:shd w:val="clear" w:color="auto" w:fill="` + hexRGB(fill.rgb) + `"/>`
}

// rPrXML writes a run's own formatting; styleToggles are the toggle
// values its styles give it, which a "flip" inverts
func (w *writer) rPrXML(c *chp, styleToggles uint32, extra string) string {
	if c == nil {
		if extra == "" {
			return ""
		}
		return "<w:rPr>" + extra + "</w:rPr>"
	}
	var sb strings.Builder
	if c.istd >= 0 {
		if st := w.d.styles.get(c.istd); st != nil && st.stk == stkChar && st.sti != 65 {
			sb.WriteString(`<w:rStyle w:val="` + xmltree.Escape(st.id) + `"/>`)
		}
	}
	if fonts := w.rFonts(c.ftc); fonts != "" {
		sb.WriteString(fonts)
	}
	tog := func(i int, tag string) {
		if on, set := c.toggle(i); set {
			if on {
				sb.WriteString("<w:" + tag + "/>")
			} else {
				sb.WriteString("<w:" + tag + ` w:val="0"/>`)
			}
		} else if c.togFlip&(1<<i) != 0 {
			if styleToggles&(1<<i) == 0 {
				sb.WriteString("<w:" + tag + "/>")
			} else {
				sb.WriteString("<w:" + tag + ` w:val="0"/>`)
			}
		}
	}
	tog(tBold, "b")
	tog(tBoldCs, "bCs")
	tog(tItalic, "i")
	tog(tItalicCs, "iCs")
	tog(tCaps, "caps")
	tog(tSmallCaps, "smallCaps")
	tog(tStrike, "strike")
	tog(tDStrike, "dstrike")
	tog(tOutline, "outline")
	tog(tShadow, "shadow")
	tog(tEmboss, "emboss")
	tog(tImprint, "imprint")
	tog(tVanish, "vanish")
	if c.col != nil {
		sb.WriteString(`<w:color w:val="` + colorAttr(*c.col) + `"/>`)
	}
	if c.dxaSpace != nil {
		sb.WriteString(`<w:spacing w:val="` + itoa(*c.dxaSpace) + `"/>`)
	}
	if c.charScale > 0 && c.charScale != 100 {
		sb.WriteString(`<w:w w:val="` + itoa(c.charScale) + `"/>`)
	}
	if c.kern > 0 {
		sb.WriteString(`<w:kern w:val="` + itoa(c.kern) + `"/>`)
	}
	if c.hpsPos != nil {
		sb.WriteString(`<w:position w:val="` + itoa(*c.hpsPos) + `"/>`)
	}
	if c.hps > 0 {
		sb.WriteString(`<w:sz w:val="` + itoa(c.hps) + `"/>`)
	}
	if c.hpsCs > 0 {
		sb.WriteString(`<w:szCs w:val="` + itoa(c.hpsCs) + `"/>`)
	}
	if c.highlight >= 0 {
		if c.highlight > 0 && c.highlight < len(highlightNames) {
			sb.WriteString(`<w:highlight w:val="` + highlightNames[c.highlight] + `"/>`)
		} else if c.highlight == 0 {
			sb.WriteString(`<w:highlight w:val="none"/>`)
		}
	}
	if c.ul >= 0 {
		name, ok := ulNames[c.ul]
		if !ok {
			name = "single"
		}
		sb.WriteString(`<w:u w:val="` + name + `"/>`)
	}
	if c.border != nil {
		sb.WriteString(borderXML("bdr", c.border))
	}
	if s := shdXML(c.shading); s != "" {
		sb.WriteString(s)
	}
	switch c.iss {
	case 0:
		sb.WriteString(`<w:vertAlign w:val="baseline"/>`)
	case 1:
		sb.WriteString(`<w:vertAlign w:val="superscript"/>`)
	case 2:
		sb.WriteString(`<w:vertAlign w:val="subscript"/>`)
	}
	tog(tRTL, "rtl")
	if c.emphasis > 0 {
		em := map[int]string{1: "dot", 2: "comma", 3: "circle", 4: "underDot"}[c.emphasis]
		if em != "" {
			sb.WriteString(`<w:em w:val="` + em + `"/>`)
		}
	}
	sb.WriteString(extra)
	if sb.Len() == 0 {
		return ""
	}
	return "<w:rPr>" + sb.String() + "</w:rPr>"
}

// rFonts names the fonts a run sets
func (w *writer) rFonts(ftc [4]int) string {
	name := func(i int) string {
		if i < 0 || i >= len(w.d.fonts) {
			return ""
		}
		return w.d.fonts[i].name
	}
	var attrs []string
	for k, a := range []string{"ascii", "eastAsia", "hAnsi", "cs"} {
		if n := name(ftc[k]); n != "" {
			attrs = append(attrs, `w:`+a+`="`+xmltree.Escape(n)+`"`)
		}
	}
	if len(attrs) == 0 {
		return ""
	}
	return "<w:rFonts " + strings.Join(attrs, " ") + "/>"
}

var jcNames = map[int]string{0: "left", 1: "center", 2: "right", 3: "both", 4: "distribute"}
var tabJc = []string{"left", "center", "right", "decimal", "bar", "left", "left", "left"}
var tabLeader = []string{"none", "dot", "hyphen", "underscore", "heavy", "middleDot", "none", "none"}

// pPrXML writes a paragraph's own formatting (extra is placed where
// w:rPr / w:sectPr go: at the end)
func (w *writer) pPrXML(istd int, p *pap, withStyle bool, extra string) string {
	var sb strings.Builder
	if withStyle {
		if st := w.d.styles.get(istd); st != nil && st.stk == stkPara && istd != 0 {
			sb.WriteString(`<w:pStyle w:val="` + xmltree.Escape(st.id) + `"/>`)
		}
	}
	onoff := func(v int, tag string) {
		switch v {
		case 0:
			sb.WriteString("<w:" + tag + ` w:val="0"/>`)
		case 1:
			sb.WriteString("<w:" + tag + "/>")
		}
	}
	onoff(p.keepNext, "keepNext")
	onoff(p.keep, "keepLines")
	onoff(p.pageBefore, "pageBreakBefore")
	onoff(p.widow, "widowControl")
	if p.ilfo >= 0 {
		ilfo := p.ilfo
		if ilfo == 0xF801-0x10000 || ilfo < 0 {
			ilfo = 0
		}
		ilvl := p.ilvl
		if ilvl < 0 {
			ilvl = 0
		}
		if ilfo > len(w.d.lists.lfos) {
			ilfo = 0
		}
		sb.WriteString(`<w:numPr><w:ilvl w:val="` + itoa(ilvl) + `"/><w:numId w:val="` + itoa(ilfo) + `"/></w:numPr>`)
	} else if p.ilvl >= 0 {
		sb.WriteString(`<w:numPr><w:ilvl w:val="` + itoa(p.ilvl) + `"/></w:numPr>`)
	}
	var bd strings.Builder
	for i, tag := range []string{"top", "left", "bottom", "right", "between"} {
		bd.WriteString(borderXML(tag, p.borders[i]))
	}
	if bd.Len() > 0 {
		sb.WriteString("<w:pBdr>" + bd.String() + "</w:pBdr>")
	}
	sb.WriteString(shdXML(p.shading))
	if len(p.tabs) > 0 {
		sb.WriteString("<w:tabs>")
		for _, t := range p.tabs {
			if t.clear {
				sb.WriteString(`<w:tab w:val="clear" w:pos="` + itoa(t.pos) + `"/>`)
				continue
			}
			sb.WriteString(`<w:tab w:val="` + tabJc[t.jc&7] + `"`)
			if t.leader > 0 {
				sb.WriteString(` w:leader="` + tabLeader[t.leader&7] + `"`)
			}
			sb.WriteString(` w:pos="` + itoa(t.pos) + `"/>`)
		}
		sb.WriteString("</w:tabs>")
	}
	onoff(p.bidi, "bidi")
	var sp []string
	if p.spBefore != nil {
		sp = append(sp, `w:before="`+itoa(*p.spBefore)+`"`)
	}
	if p.beforeAuto >= 0 {
		sp = append(sp, `w:beforeAutospacing="`+itoa(p.beforeAuto)+`"`)
	}
	if p.spAfter != nil {
		sp = append(sp, `w:after="`+itoa(*p.spAfter)+`"`)
	}
	if p.afterAuto >= 0 {
		sp = append(sp, `w:afterAutospacing="`+itoa(p.afterAuto)+`"`)
	}
	if p.line != nil {
		switch {
		case p.lineMult:
			sp = append(sp, `w:line="`+itoa(*p.line)+`" w:lineRule="auto"`)
		case *p.line >= 0:
			sp = append(sp, `w:line="`+itoa(*p.line)+`" w:lineRule="atLeast"`)
		default:
			sp = append(sp, `w:line="`+itoa(-*p.line)+`" w:lineRule="exact"`)
		}
	}
	if len(sp) > 0 {
		sb.WriteString("<w:spacing " + strings.Join(sp, " ") + "/>")
	}
	var ind []string
	if p.indLeft != nil {
		ind = append(ind, `w:left="`+itoa(*p.indLeft)+`"`)
	}
	if p.indRight != nil {
		ind = append(ind, `w:right="`+itoa(*p.indRight)+`"`)
	}
	if p.indFirst != nil {
		if *p.indFirst < 0 {
			ind = append(ind, `w:hanging="`+itoa(-*p.indFirst)+`"`)
		} else {
			ind = append(ind, `w:firstLine="`+itoa(*p.indFirst)+`"`)
		}
	}
	if len(ind) > 0 {
		sb.WriteString("<w:ind " + strings.Join(ind, " ") + "/>")
	}
	onoff(p.contextual, "contextualSpacing")
	if p.jc >= 0 {
		if n, ok := jcNames[p.jc]; ok {
			sb.WriteString(`<w:jc w:val="` + n + `"/>`)
		}
	}
	if p.outline >= 0 && p.outline < 9 {
		sb.WriteString(`<w:outlineLvl w:val="` + itoa(p.outline) + `"/>`)
	}
	sb.WriteString(extra)
	if sb.Len() == 0 {
		return ""
	}
	return "<w:pPr>" + sb.String() + "</w:pPr>"
}

var bkcNames = []string{"continuous", "nextColumn", "nextPage", "evenPage", "oddPage"}

var pgnFormats = map[int]string{0: "decimal", 1: "upperRoman", 2: "lowerRoman", 3: "upperLetter", 4: "lowerLetter"}

// sectPrXML writes a section's properties with its header references
func sectPrXML(s sep, refs string) string {
	var sb strings.Builder
	sb.WriteString("<w:sectPr>")
	sb.WriteString(refs)
	if s.bkc >= 0 && s.bkc < len(bkcNames) && s.bkc != 2 {
		sb.WriteString(`<w:type w:val="` + bkcNames[s.bkc] + `"/>`)
	}
	sb.WriteString(`<w:pgSz w:w="` + itoa(s.pageW) + `" w:h="` + itoa(s.pageH) + `"`)
	if s.landscape {
		sb.WriteString(` w:orient="landscape"`)
	}
	sb.WriteString(`/>`)
	sb.WriteString(`<w:pgMar w:top="` + itoa(s.top) + `" w:right="` + itoa(s.right) + `" w:bottom="` + itoa(s.bottom) +
		`" w:left="` + itoa(s.left) + `" w:header="` + itoa(s.hdrTop) + `" w:footer="` + itoa(s.hdrBottom) +
		`" w:gutter="` + itoa(s.gutter) + `"/>`)
	if s.pgnRestart || s.pgnFmt != 0 {
		sb.WriteString(`<w:pgNumType`)
		if f, ok := pgnFormats[s.pgnFmt]; ok && s.pgnFmt != 0 {
			sb.WriteString(` w:fmt="` + f + `"`)
		}
		if s.pgnRestart {
			sb.WriteString(` w:start="` + itoa(s.pgnStart) + `"`)
		}
		sb.WriteString(`/>`)
	}
	if s.cols > 1 {
		sb.WriteString(`<w:cols w:num="` + itoa(s.cols) + `" w:space="` + itoa(s.colSpace) + `"`)
		if s.lineBetween {
			sb.WriteString(` w:sep="1"`)
		}
		sb.WriteString(`/>`)
	} else {
		sb.WriteString(`<w:cols w:space="` + itoa(s.colSpace) + `"/>`)
	}
	if s.titlePg {
		sb.WriteString(`<w:titlePg/>`)
	}
	sb.WriteString("</w:sectPr>")
	return sb.String()
}
