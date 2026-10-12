package pptx

/*
	text.go - PresentationML text: the property inheritance chain and
	the HTML the Slides editor renders.

	A run's appearance in a pptx is almost never written on the run. It is
	assembled from, lowest priority first:

	    presentation.xml  <p:defaultTextStyle>          (non-placeholder text)
	    slideMaster       <p:txStyles>/title|body|other (by placeholder kind)
	    slideMaster       the matching placeholder's <a:lstStyle>
	    slideLayout       the matching placeholder's <a:lstStyle>
	    the shape's own   <a:lstStyle>
	    the paragraph's   <a:pPr>  (and its <a:defRPr>)
	    the run's         <a:rPr>

	Each level is looked up per outline level (lvl1pPr..lvl9pPr), so the
	same body placeholder yields a different size, colour and bullet for
	every indent level. Reading only the run - which is what the first
	version of this reader did - loses nearly all of a real deck's design.

	The result is emitted as the restricted HTML the Slides text object
	stores: one <div> per paragraph carrying alignment, line height,
	paragraph spacing and indents, one <span> per run carrying font, size,
	colour and weight, and an absolutely positioned bullet span that
	reproduces PowerPoint's hanging-indent geometry exactly.
*/

import (
	"encoding/xml"
	"fmt"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/office/internal/fonts"
	"imuslab.com/arozos/mod/office/internal/slidetext"
	"imuslab.com/arozos/mod/office/internal/units"
	"imuslab.com/arozos/mod/office/internal/xmltree"
)

// runStyle is the resolved appearance of one text run. Zero values mean
// "not yet specified" only while a chain is being resolved - resolution
// always starts from pptxDefaultRun, so a fully resolved style is complete.
type runStyle struct {
	SizePt    float64
	Bold      bool
	Italic    bool
	Underline bool
	Strike    bool
	Color     string
	Latin     string
	EastAsian string
	Highlight string
	Caps      string  // "all", "small" or ""
	SpacingPt float64 // letter spacing
	Baseline  float64 // per cent of font size; >0 superscript, <0 subscript
}

// paraStyle is the resolved appearance of one paragraph
type paraStyle struct {
	Align     string  // l, ctr, r, just
	MarLeft   float64 // EMU
	MarRight  float64 // EMU
	Indent    float64 // EMU, negative for a hanging bullet
	LnSpcPct  float64 // 1 = 100%; 0 when an exact spacing is set instead
	LnSpcPt   float64 // exact line spacing in points
	SpcBefPt  float64
	SpcBefPct float64
	SpcAftPt  float64
	SpcAftPct float64
	BuType    string // "", "none", "char", "autonum"
	BuChar    string
	BuAutoNum string
	BuStartAt int
	BuFont    string
	BuColor   string
	BuSizePct float64
	BuSizePt  float64
	DefTabSz  float64 // EMU between default tab stops
	DefRun    runStyle
}

var pptxDefaultRun = runStyle{SizePt: 18, Color: "#000000", Latin: "Arial"}

// a default tab stop every inch, PowerPoint's own default
var pptxDefaultPara = paraStyle{Align: "l", LnSpcPct: 1, BuSizePct: 1, DefTabSz: 914400, DefRun: pptxDefaultRun}

// applyRPr folds one <a:rPr> / <a:defRPr> / <a:endParaRPr> into dst,
// touching only the properties that element actually states
func applyRPr(dst *runStyle, n *xmltree.Node, cc *colorCtx) {
	if n == nil {
		return
	}
	if v := n.Attr("sz"); v != "" {
		if f := units.AtofDefault(v, 0); f > 0 {
			dst.SizePt = f / 100
		}
	}
	if v := n.Attr("b"); v != "" {
		dst.Bold = v == "1" || v == "true"
	}
	if v := n.Attr("i"); v != "" {
		dst.Italic = v == "1" || v == "true"
	}
	if v := n.Attr("u"); v != "" {
		dst.Underline = v != "none"
	}
	if v := n.Attr("strike"); v != "" {
		dst.Strike = v != "noStrike"
	}
	if v := n.Attr("cap"); v != "" {
		if v == "none" {
			dst.Caps = ""
		} else {
			dst.Caps = v
		}
	}
	if v := n.Attr("spc"); v != "" {
		dst.SpacingPt = units.AtofDefault(v, 0) / 100
	}
	if v := n.Attr("baseline"); v != "" {
		dst.Baseline = units.AtofDefault(v, 0) / 1000
	}
	if n.First("noFill") != nil {
		// text with no fill is invisible; approximate with transparency
		dst.Color = "transparent"
	} else if c := cc.solidColorOf(n); c != "" {
		dst.Color = c
	}
	if hl := n.First("highlight"); hl != nil {
		for i := range hl.Nodes {
			if c := cc.resolveColor(&hl.Nodes[i]); c != "" {
				dst.Highlight = c
				break
			}
		}
	}
	if l := n.First("latin"); l != nil {
		if tf := l.Attr("typeface"); tf != "" {
			dst.Latin = tf
		}
	}
	if e := n.First("ea"); e != nil {
		if tf := e.Attr("typeface"); tf != "" {
			dst.EastAsian = tf
		}
	}
}

// applyPPr folds one <a:pPr> / <a:lvlNpPr> / <a:defPPr> into dst
func applyPPr(dst *paraStyle, n *xmltree.Node, cc *colorCtx) {
	if n == nil {
		return
	}
	if v := n.Attr("algn"); v != "" {
		dst.Align = v
	}
	if v := n.Attr("marL"); v != "" {
		dst.MarLeft = units.AtofDefault(v, 0)
	}
	if v := n.Attr("marR"); v != "" {
		dst.MarRight = units.AtofDefault(v, 0)
	}
	if v := n.Attr("indent"); v != "" {
		dst.Indent = units.AtofDefault(v, 0)
	}
	if v := units.AtofDefault(n.Attr("defTabSz"), 0); v > 0 {
		dst.DefTabSz = v
	}
	if ls := n.First("lnSpc"); ls != nil {
		if p := ls.First("spcPct"); p != nil {
			dst.LnSpcPct = units.AtofDefault(p.Attr("val"), 100000) / 100000
			dst.LnSpcPt = 0
		} else if p := ls.First("spcPts"); p != nil {
			dst.LnSpcPt = units.AtofDefault(p.Attr("val"), 0) / 100
			dst.LnSpcPct = 0
		}
	}
	readSpc := func(sp *xmltree.Node, pt, pct *float64) {
		if sp == nil {
			return
		}
		if p := sp.First("spcPts"); p != nil {
			*pt = units.AtofDefault(p.Attr("val"), 0) / 100
			*pct = 0
		} else if p := sp.First("spcPct"); p != nil {
			*pct = units.AtofDefault(p.Attr("val"), 0) / 100000
			*pt = 0
		}
	}
	readSpc(n.First("spcBef"), &dst.SpcBefPt, &dst.SpcBefPct)
	readSpc(n.First("spcAft"), &dst.SpcAftPt, &dst.SpcAftPct)

	if n.First("buNone") != nil {
		dst.BuType = "none"
	}
	if bc := n.First("buChar"); bc != nil {
		dst.BuType = "char"
		dst.BuChar = bc.Attr("char")
	}
	if ba := n.First("buAutoNum"); ba != nil {
		dst.BuType = "autonum"
		dst.BuAutoNum = ba.Attr("type")
		dst.BuStartAt = int(units.AtofDefault(ba.Attr("startAt"), 1))
	}
	if bf := n.First("buFont"); bf != nil {
		if tf := bf.Attr("typeface"); tf != "" {
			dst.BuFont = tf
		}
	}
	if bcl := n.First("buClr"); bcl != nil {
		for i := range bcl.Nodes {
			if c := cc.resolveColor(&bcl.Nodes[i]); c != "" {
				dst.BuColor = c
				break
			}
		}
	}
	if bs := n.First("buSzPct"); bs != nil {
		dst.BuSizePct = units.AtofDefault(bs.Attr("val"), 100000) / 100000
		dst.BuSizePt = 0
	}
	if bs := n.First("buSzPts"); bs != nil {
		dst.BuSizePt = units.AtofDefault(bs.Attr("val"), 0) / 100
		dst.BuSizePct = 0
	}
	applyRPr(&dst.DefRun, n.First("defRPr"), cc)
}

// lvlPPr picks the <a:lvlNpPr> for a zero-based outline level out of an
// <a:lstStyle> (or a <p:titleStyle> / <p:bodyStyle> / <p:otherStyle>,
// which use the same child elements)
func lvlPPr(lst *xmltree.Node, lvl int) *xmltree.Node {
	if lst == nil {
		return nil
	}
	if lvl < 0 {
		lvl = 0
	}
	if lvl > 8 {
		lvl = 8
	}
	name := fmt.Sprintf("lvl%dpPr", lvl+1)
	if n := lst.First(name); n != nil {
		return n
	}
	// some producers only write defPPr
	return lst.First("defPPr")
}

// resolveParaStyle walks the inheritance chain (lowest priority first) for
// one outline level and folds the paragraph's own pPr on top
func resolveParaStyle(chain []*xmltree.Node, pPr *xmltree.Node, lvl int, cc *colorCtx) paraStyle {
	st := pptxDefaultPara
	for _, lst := range chain {
		applyPPr(&st, lvlPPr(lst, lvl), cc)
	}
	applyPPr(&st, pPr, cc)
	return st
}

// runCSS renders the inline style for one text run
func runCSS(rs runStyle, scale float64) string {
	var sb strings.Builder
	sb.WriteString("font-size:" + units.FmtPx(units.PtToPx(rs.SizePt)*scale) + ";")
	sb.WriteString("font-family:" + fonts.StackFor(rs.Latin, rs.EastAsian) + ";")
	// only b="1" sets a weight. A weight word in the Latin typeface ("Open
	// Sans SemiBold") belongs to that face alone - PowerPoint draws the
	// run's East Asian text at regular weight in the EA font - and the
	// Latin glyphs already get the heavy face from the family name
	// (fonts.js substitute())
	if rs.Bold {
		sb.WriteString("font-weight:700;")
	}
	if rs.Italic {
		sb.WriteString("font-style:italic;")
	}
	deco := ""
	if rs.Underline {
		deco = "underline"
	}
	if rs.Strike {
		if deco != "" {
			deco += " "
		}
		deco += "line-through"
	}
	if deco != "" {
		sb.WriteString("text-decoration:" + deco + ";")
	}
	if rs.Color != "" {
		sb.WriteString("color:" + rs.Color + ";")
	}
	if rs.Highlight != "" {
		sb.WriteString("background-color:" + rs.Highlight + ";")
	}
	if rs.Caps == "all" {
		sb.WriteString("text-transform:uppercase;")
	}
	if rs.SpacingPt != 0 {
		sb.WriteString("letter-spacing:" + units.FmtPx(units.PtToPx(rs.SpacingPt)*scale) + ";")
	}
	// a raised or lowered run does not make its line any taller in
	// PowerPoint; in CSS it would, unless its own line box is empty
	if rs.Baseline > 0 {
		sb.WriteString("vertical-align:super;line-height:0;font-size:" + units.FmtPx(units.PtToPx(rs.SizePt)*scale*0.65) + ";")
	} else if rs.Baseline < 0 {
		sb.WriteString("vertical-align:sub;line-height:0;font-size:" + units.FmtPx(units.PtToPx(rs.SizePt)*scale*0.65) + ";")
	}
	return sb.String()
}

// lineSpacerFor renders the invisible span that gives an otherwise empty
// line its height. A <a:br/> in PresentationML carries its own run
// properties and the line it opens is as tall as those state, but an HTML
// <br> with nothing after it adds no height at all - so a zero-width space
// at the stated size stands in for the text that is not there.
func lineSpacerFor(rs runStyle, scale float64) string {
	return `<span style="font-size:` + units.FmtPx(units.PtToPx(rs.SizePt)*scale) +
		`;font-family:` + fonts.StackFor(rs.Latin, rs.EastAsian) + `">&#8203;</span>`
}

// autoNumMarker renders the visible marker of an <a:buAutoNum> list
func autoNumMarker(kind string, n int) string {
	switch {
	case strings.HasPrefix(kind, "alphaLc"):
		return slidetext.AlphaMarker(n, 'a') + autoNumSuffix(kind)
	case strings.HasPrefix(kind, "alphaUc"):
		return slidetext.AlphaMarker(n, 'A') + autoNumSuffix(kind)
	case strings.HasPrefix(kind, "romanLc"):
		return strings.ToLower(slidetext.RomanMarker(n)) + autoNumSuffix(kind)
	case strings.HasPrefix(kind, "romanUc"):
		return slidetext.RomanMarker(n) + autoNumSuffix(kind)
	}
	return strconv.Itoa(n) + autoNumSuffix(kind)
}

func autoNumSuffix(kind string) string {
	switch {
	case strings.HasSuffix(kind, "ParenBoth"):
		return ")"
	case strings.HasSuffix(kind, "ParenR"):
		return ")"
	case strings.HasSuffix(kind, "Period"):
		return "."
	}
	return "."
}

// spanSizes folds one run size into a paragraph's running max and min
func spanSizes(size, curMax, curMin float64) (float64, float64) {
	if size <= 0 {
		return curMax, curMin
	}
	if size > curMax {
		curMax = size
	}
	if curMin == 0 || size < curMin {
		curMin = size
	}
	return curMax, curMin
}

// paraItems lists a paragraph's runs, fields and breaks in order. The runs
// of inline Office math (<a14:m><m:oMath><m:r>) come through as plain runs:
// the symbols of a simple formula read the same set as text, in the run
// properties (<a:rPr>) PowerPoint gives them.
func paraItems(p *xmltree.Node) []*xmltree.Node {
	var out []*xmltree.Node
	for i := range p.Nodes {
		ch := &p.Nodes[i]
		if ch.XMLName.Local != "m" {
			out = append(out, ch)
			continue
		}
		var mr []*xmltree.Node
		ch.FindAll("r", &mr)
		for _, r := range mr {
			t := r.First("t")
			if t == nil {
				continue
			}
			syn := &xmltree.Node{XMLName: xml.Name{Local: "r"}}
			// m:r carries both <m:rPr> (math) and <a:rPr> (DrawingML);
			// only the latter means anything here
			for j := range r.Nodes {
				n := &r.Nodes[j]
				if n.XMLName.Local == "rPr" && strings.Contains(n.XMLName.Space, "drawingml") {
					syn.Nodes = append(syn.Nodes, *n)
				}
			}
			syn.Nodes = append(syn.Nodes, xmltree.Node{XMLName: xml.Name{Local: "t"}, Text: t.Text})
			out = append(out, syn)
		}
	}
	return out
}

// mathStructures are the Office math elements that lay a formula out in
// two dimensions - a fraction, a radical, scripts, a matrix - which a line
// of text cannot show
var mathStructures = map[string]bool{
	"f": true, "rad": true, "sSup": true, "sSub": true, "sSubSup": true, "sPre": true,
	"nary": true, "d": true, "m": true, "eqArr": true, "func": true, "acc": true,
	"bar": true, "limLow": true, "limUpp": true, "groupChr": true, "borderBox": true,
	"box": true, "phant": true,
}

// choiceReadable reports whether the preferred branch of an
// mc:AlternateContent is one this reader shows as well as its fallback:
// Office 2010 drawing content whose math, if any, is a line of symbols
func choiceReadable(choice *xmltree.Node) bool {
	if choice.Attr("Requires") != "a14" {
		return false
	}
	var oms []*xmltree.Node
	choice.FindAll("oMath", &oms)
	if len(oms) == 0 {
		return false
	}
	for _, om := range oms {
		if mathHasStructure(om) {
			return false
		}
	}
	return true
}

func mathHasStructure(n *xmltree.Node) bool {
	for i := range n.Nodes {
		ch := &n.Nodes[i]
		if strings.Contains(ch.XMLName.Space, "math") && mathStructures[ch.XMLName.Local] {
			return true
		}
		if mathHasStructure(ch) {
			return true
		}
	}
	return false
}
