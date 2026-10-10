package office

/*
	pptx_text.go - PresentationML text: the property inheritance chain and
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
)

// PowerPoint's "single" line spacing is the font's line height, which is
// about 1.2 em for the fonts office documents use. A <a:lnSpc> percentage
// multiplies that, so 100% renders as CSS line-height 1.2 - checked
// against Google Slides' own PDF export of the reference decks.
const pptxLineHeightFactor = 1.2

// EMU per point (a point is 1/72 inch, an EMU 1/914400 inch)
const emuPerPt = 12700

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
func applyRPr(dst *runStyle, n *xnode, cc *colorCtx) {
	if n == nil {
		return
	}
	if v := n.attr("sz"); v != "" {
		if f := atofDefault(v, 0); f > 0 {
			dst.SizePt = f / 100
		}
	}
	if v := n.attr("b"); v != "" {
		dst.Bold = v == "1" || v == "true"
	}
	if v := n.attr("i"); v != "" {
		dst.Italic = v == "1" || v == "true"
	}
	if v := n.attr("u"); v != "" {
		dst.Underline = v != "none"
	}
	if v := n.attr("strike"); v != "" {
		dst.Strike = v != "noStrike"
	}
	if v := n.attr("cap"); v != "" {
		if v == "none" {
			dst.Caps = ""
		} else {
			dst.Caps = v
		}
	}
	if v := n.attr("spc"); v != "" {
		dst.SpacingPt = atofDefault(v, 0) / 100
	}
	if v := n.attr("baseline"); v != "" {
		dst.Baseline = atofDefault(v, 0) / 1000
	}
	if n.first("noFill") != nil {
		// text with no fill is invisible; approximate with transparency
		dst.Color = "transparent"
	} else if c := cc.solidColorOf(n); c != "" {
		dst.Color = c
	}
	if hl := n.first("highlight"); hl != nil {
		for i := range hl.Nodes {
			if c := cc.resolveColor(&hl.Nodes[i]); c != "" {
				dst.Highlight = c
				break
			}
		}
	}
	if l := n.first("latin"); l != nil {
		if tf := l.attr("typeface"); tf != "" {
			dst.Latin = tf
		}
	}
	if e := n.first("ea"); e != nil {
		if tf := e.attr("typeface"); tf != "" {
			dst.EastAsian = tf
		}
	}
}

// applyPPr folds one <a:pPr> / <a:lvlNpPr> / <a:defPPr> into dst
func applyPPr(dst *paraStyle, n *xnode, cc *colorCtx) {
	if n == nil {
		return
	}
	if v := n.attr("algn"); v != "" {
		dst.Align = v
	}
	if v := n.attr("marL"); v != "" {
		dst.MarLeft = atofDefault(v, 0)
	}
	if v := n.attr("marR"); v != "" {
		dst.MarRight = atofDefault(v, 0)
	}
	if v := n.attr("indent"); v != "" {
		dst.Indent = atofDefault(v, 0)
	}
	if v := atofDefault(n.attr("defTabSz"), 0); v > 0 {
		dst.DefTabSz = v
	}
	if ls := n.first("lnSpc"); ls != nil {
		if p := ls.first("spcPct"); p != nil {
			dst.LnSpcPct = atofDefault(p.attr("val"), 100000) / 100000
			dst.LnSpcPt = 0
		} else if p := ls.first("spcPts"); p != nil {
			dst.LnSpcPt = atofDefault(p.attr("val"), 0) / 100
			dst.LnSpcPct = 0
		}
	}
	readSpc := func(sp *xnode, pt, pct *float64) {
		if sp == nil {
			return
		}
		if p := sp.first("spcPts"); p != nil {
			*pt = atofDefault(p.attr("val"), 0) / 100
			*pct = 0
		} else if p := sp.first("spcPct"); p != nil {
			*pct = atofDefault(p.attr("val"), 0) / 100000
			*pt = 0
		}
	}
	readSpc(n.first("spcBef"), &dst.SpcBefPt, &dst.SpcBefPct)
	readSpc(n.first("spcAft"), &dst.SpcAftPt, &dst.SpcAftPct)

	if n.first("buNone") != nil {
		dst.BuType = "none"
	}
	if bc := n.first("buChar"); bc != nil {
		dst.BuType = "char"
		dst.BuChar = bc.attr("char")
	}
	if ba := n.first("buAutoNum"); ba != nil {
		dst.BuType = "autonum"
		dst.BuAutoNum = ba.attr("type")
		dst.BuStartAt = int(atofDefault(ba.attr("startAt"), 1))
	}
	if bf := n.first("buFont"); bf != nil {
		if tf := bf.attr("typeface"); tf != "" {
			dst.BuFont = tf
		}
	}
	if bcl := n.first("buClr"); bcl != nil {
		for i := range bcl.Nodes {
			if c := cc.resolveColor(&bcl.Nodes[i]); c != "" {
				dst.BuColor = c
				break
			}
		}
	}
	if bs := n.first("buSzPct"); bs != nil {
		dst.BuSizePct = atofDefault(bs.attr("val"), 100000) / 100000
		dst.BuSizePt = 0
	}
	if bs := n.first("buSzPts"); bs != nil {
		dst.BuSizePt = atofDefault(bs.attr("val"), 0) / 100
		dst.BuSizePct = 0
	}
	applyRPr(&dst.DefRun, n.first("defRPr"), cc)
}

// lvlPPr picks the <a:lvlNpPr> for a zero-based outline level out of an
// <a:lstStyle> (or a <p:titleStyle> / <p:bodyStyle> / <p:otherStyle>,
// which use the same child elements)
func lvlPPr(lst *xnode, lvl int) *xnode {
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
	if n := lst.first(name); n != nil {
		return n
	}
	// some producers only write defPPr
	return lst.first("defPPr")
}

// resolveParaStyle walks the inheritance chain (lowest priority first) for
// one outline level and folds the paragraph's own pPr on top
func resolveParaStyle(chain []*xnode, pPr *xnode, lvl int, cc *colorCtx) paraStyle {
	st := pptxDefaultPara
	for _, lst := range chain {
		applyPPr(&st, lvlPPr(lst, lvl), cc)
	}
	applyPPr(&st, pPr, cc)
	return st
}

/* ---------------- HTML generation ---------------- */

// fontStackFor turns a pptx typeface pair into a CSS font-family list.
// The east-asian face is kept as a second entry so a browser picks it per
// glyph, exactly the way PowerPoint switches fonts mid-run for CJK text.
func fontStackFor(latin, ea string) string {
	var parts []string
	seen := map[string]bool{}
	add := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" || seen[name] {
			return
		}
		// "+mj-lt" / "+mn-lt" are theme font references the caller has
		// already resolved; anything still unresolved is not a real font
		if strings.HasPrefix(name, "+") {
			return
		}
		seen[name] = true
		parts = append(parts, quoteFontName(name))
	}
	add(latin)
	add(ea)
	// a weighted family name ("Open Sans SemiBold") is not installed on most
	// systems - offer the base family so the browser can synthesize instead
	// of dropping to a completely unrelated default
	if base := baseFontName(latin); base != latin {
		add(base)
	}
	if base := baseFontName(ea); base != ea {
		add(base)
	}
	// the shipped document fonts (web/Office/common/fonts), offered before
	// the generic. They are the only faces the browser-side PDF exporter can
	// embed - a system font's bytes are not readable from a page - so a run
	// that lands on one exports as real text instead of a picture of itself.
	// Noto Sans leads so Latin keeps a Latin design; the CJK faces behind it
	// cover what it does not, in the order a browser will try them.
	for _, shipped := range shippedFontFallbacks {
		add(shipped)
	}
	generic := "sans-serif"
	l := strings.ToLower(latin)
	switch {
	case strings.Contains(l, "courier"), strings.Contains(l, "mono"),
		strings.Contains(l, "consolas"):
		generic = "monospace"
	case strings.Contains(l, "times"), strings.Contains(l, "georgia"),
		strings.Contains(l, "serif") && !strings.Contains(l, "sans"),
		strings.Contains(l, "garamond"), strings.Contains(l, "book antiqua"):
		generic = "serif"
	}
	parts = append(parts, generic)
	return strings.Join(parts, ",")
}

// shippedFontFallbacks are the families in web/Office/common/fonts, in the
// order fonts.js offers them to the browser. Keep the two lists in step.
var shippedFontFallbacks = []string{
	"Noto Sans", "Noto Sans TC", "Noto Sans SC", "Noto Sans JP", "Noto Sans KR",
}

func quoteFontName(n string) string {
	if strings.ContainsAny(n, " '\"") {
		return "'" + strings.ReplaceAll(n, "'", "") + "'"
	}
	return n
}

var fontWeightSuffixes = []struct {
	suffix string
	weight int
}{
	{" thin", 100}, {" extralight", 200}, {" extra light", 200}, {" ultralight", 200},
	{" light", 300}, {" regular", 400}, {" medium", 500},
	{" semibold", 600}, {" semi bold", 600}, {" demibold", 600},
	{" bold", 700}, {" extrabold", 800}, {" extra bold", 800}, {" black", 900},
}

// baseFontName strips a trailing weight word ("Open Sans SemiBold" ->
// "Open Sans"); returns the name unchanged when there is none
func baseFontName(n string) string {
	l := strings.ToLower(n)
	for _, w := range fontWeightSuffixes {
		if strings.HasSuffix(l, w.suffix) {
			return strings.TrimSpace(n[:len(n)-len(w.suffix)])
		}
	}
	return n
}

// fontWeightOf reads the weight a font name implies, 0 when it implies none
func fontWeightOf(n string) int {
	l := strings.ToLower(n)
	for _, w := range fontWeightSuffixes {
		if strings.HasSuffix(l, w.suffix) {
			return w.weight
		}
	}
	return 0
}

func fmtPx(v float64) string {
	return strconv.FormatFloat(round2(v), 'f', -1, 64) + "px"
}

func round2(v float64) float64 {
	return float64(int64(v*100+copySign(0.5, v))) / 100
}

func copySign(v, sign float64) float64 {
	if sign < 0 {
		return -v
	}
	return v
}

// ptToPx converts points to CSS pixels at 96 dpi
func ptToPx(pt float64) float64 { return pt / 0.75 }

// runCSS renders the inline style for one text run
func runCSS(rs runStyle, scale float64) string {
	var sb strings.Builder
	sb.WriteString("font-size:" + fmtPx(ptToPx(rs.SizePt)*scale) + ";")
	sb.WriteString("font-family:" + fontStackFor(rs.Latin, rs.EastAsian) + ";")
	weight := 0
	if rs.Bold {
		weight = 700
	} else if w := fontWeightOf(rs.Latin); w != 0 {
		weight = w
	}
	if weight != 0 {
		sb.WriteString("font-weight:" + strconv.Itoa(weight) + ";")
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
		sb.WriteString("letter-spacing:" + fmtPx(ptToPx(rs.SpacingPt)*scale) + ";")
	}
	// a raised or lowered run does not make its line any taller in
	// PowerPoint; in CSS it would, unless its own line box is empty
	if rs.Baseline > 0 {
		sb.WriteString("vertical-align:super;line-height:0;font-size:" + fmtPx(ptToPx(rs.SizePt)*scale*0.65) + ";")
	} else if rs.Baseline < 0 {
		sb.WriteString("vertical-align:sub;line-height:0;font-size:" + fmtPx(ptToPx(rs.SizePt)*scale*0.65) + ";")
	}
	return sb.String()
}

// lineSpacerFor renders the invisible span that gives an otherwise empty
// line its height. A <a:br/> in PresentationML carries its own run
// properties and the line it opens is as tall as those state, but an HTML
// <br> with nothing after it adds no height at all - so a zero-width space
// at the stated size stands in for the text that is not there.
func lineSpacerFor(rs runStyle, scale float64) string {
	return `<span style="font-size:` + fmtPx(ptToPx(rs.SizePt)*scale) +
		`;font-family:` + fontStackFor(rs.Latin, rs.EastAsian) + `">&#8203;</span>`
}

// autoNumMarker renders the visible marker of an <a:buAutoNum> list
func autoNumMarker(kind string, n int) string {
	switch {
	case strings.HasPrefix(kind, "alphaLc"):
		return alphaMarker(n, 'a') + autoNumSuffix(kind)
	case strings.HasPrefix(kind, "alphaUc"):
		return alphaMarker(n, 'A') + autoNumSuffix(kind)
	case strings.HasPrefix(kind, "romanLc"):
		return strings.ToLower(romanMarker(n)) + autoNumSuffix(kind)
	case strings.HasPrefix(kind, "romanUc"):
		return romanMarker(n) + autoNumSuffix(kind)
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

func alphaMarker(n int, base byte) string {
	if n < 1 {
		n = 1
	}
	out := ""
	for n > 0 {
		n--
		out = string([]byte{base + byte(n%26)}) + out
		n /= 26
	}
	return out
}

func romanMarker(n int) string {
	if n < 1 {
		return ""
	}
	vals := []int{1000, 900, 500, 400, 100, 90, 50, 40, 10, 9, 5, 4, 1}
	syms := []string{"M", "CM", "D", "CD", "C", "XC", "L", "XL", "X", "IX", "V", "IV", "I"}
	var sb strings.Builder
	for i, v := range vals {
		for n >= v {
			sb.WriteString(syms[i])
			n -= v
		}
	}
	return sb.String()
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

// symbolBullets are the bullet characters of the symbol fonts, as Unicode
// characters that look the same. A deck states a marker as a code in the
// font (Wingdings "l" is a black circle); a machine without that font
// would show the letter instead. The replacements are all characters the
// shipped Noto Sans CJK faces carry (and Arial mostly does too), so the PDF
// exporter can always set the marker as text; k scales the marker to the
// size the symbol font draws it at.
type symbolGlyph struct {
	s string
	k float64
}

var symbolBullets = map[string]map[rune]symbolGlyph{
	"wingdings": {
		'l': {"\u25CF", 1.3}, 'm': {"\u25CB", 1.2}, 'n': {"\u25A0", 1.1}, 'o': {"\u25A1", 1.1},
		'p': {"\u25A1", 1.1}, 'q': {"\u25A1", 1.1}, 'r': {"\u25A1", 1.1}, 's': {"\u25C6", 0.9},
		't': {"\u25C6", 0.9}, 'u': {"\u25C6", 1}, 'v': {"\u2756", 1}, 'w': {"\u25C6", 0.7},
		'x': {"\u25A1", 1}, 0x9F: {"\u2022", 1}, 0xA7: {"\u25AA", 1}, 0xA8: {"\u25A1", 0.8},
		0xD8: {"\u25B6", 0.85}, 0xE0: {"\u2192", 1}, 0xE8: {"\u2192", 1}, 0xF0: {"\u21E8", 1},
		0xFB: {"\u00D7", 1}, 0xFC: {"\u2713", 1}, 0xFD: {"\u25A1", 1}, 0xFE: {"\u2713", 1},
	},
	"symbol": {
		0xB7: {"\u2022", 1}, 0xA8: {"\u2666", 1}, 0xA7: {"\u2663", 1}, 0xA9: {"\u2665", 1},
		0xAA: {"\u2660", 1}, 0xAE: {"\u2192", 1}, 0xDE: {"\u21D2", 1}, 0x2D: {"\u2212", 1},
		0xBE: {"\u2014", 1}, 0xE0: {"\u25CA", 1},
	},
	"webdings": {
		'=': {"\u25A0", 1}, 'n': {"\u25CF", 1}, 'a': {"\u2713", 1}, 'r': {"\u00D7", 1},
	},
}

// symbolBullet maps a marker set in a symbol font to the character it
// draws and the scale it is drawn at. Such fonts are often addressed
// through the private use area (U+F06C for Wingdings "l"), which is folded
// back first.
func symbolBullet(font, marker string) (string, float64, bool) {
	f := strings.ToLower(strings.TrimSpace(font))
	var table map[rune]symbolGlyph
	switch {
	case strings.HasPrefix(f, "wingdings"):
		table = symbolBullets["wingdings"]
	case f == "symbol":
		table = symbolBullets["symbol"]
	case strings.HasPrefix(f, "webdings"):
		table = symbolBullets["webdings"]
	default:
		return "", 1, false
	}
	r := []rune(marker)
	if len(r) != 1 {
		return "", 1, false
	}
	c := r[0]
	if c >= 0xF020 && c <= 0xF0FF {
		c -= 0xF000
	}
	if g, ok := table[c]; ok {
		return g.s, g.k, true
	}
	return "", 1, false
}

// isSymbolFont reports whether a typeface maps letters onto pictographs
func isSymbolFont(font string) bool {
	f := strings.ToLower(strings.TrimSpace(font))
	return strings.HasPrefix(f, "wingdings") || strings.HasPrefix(f, "webdings") ||
		f == "symbol" || strings.Contains(f, "dingbat")
}

// paraItems lists a paragraph's runs, fields and breaks in order. The runs
// of inline Office math (<a14:m><m:oMath><m:r>) come through as plain runs:
// the symbols of a simple formula read the same set as text, in the run
// properties (<a:rPr>) PowerPoint gives them.
func paraItems(p *xnode) []*xnode {
	var out []*xnode
	for i := range p.Nodes {
		ch := &p.Nodes[i]
		if ch.XMLName.Local != "m" {
			out = append(out, ch)
			continue
		}
		var mr []*xnode
		ch.findAll("r", &mr)
		for _, r := range mr {
			t := r.first("t")
			if t == nil {
				continue
			}
			syn := &xnode{XMLName: xml.Name{Local: "r"}}
			// m:r carries both <m:rPr> (math) and <a:rPr> (DrawingML);
			// only the latter means anything here
			for j := range r.Nodes {
				n := &r.Nodes[j]
				if n.XMLName.Local == "rPr" && strings.Contains(n.XMLName.Space, "drawingml") {
					syn.Nodes = append(syn.Nodes, *n)
				}
			}
			syn.Nodes = append(syn.Nodes, xnode{XMLName: xml.Name{Local: "t"}, Text: t.Text})
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
func choiceReadable(choice *xnode) bool {
	if choice.attr("Requires") != "a14" {
		return false
	}
	var oms []*xnode
	choice.findAll("oMath", &oms)
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

func mathHasStructure(n *xnode) bool {
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

// symbolEncoding is the Symbol font's character set (Adobe's Symbol
// encoding) for the codes that differ from what they show: the Greek
// alphabet on the Latin letters, and the mathematical signs
var symbolEncoding = func() map[rune]rune {
	m := map[rune]rune{}
	upper := "\u0391\u0392\u03A7\u0394\u0395\u03A6\u0393\u0397\u0399\u03D1\u039A\u039B\u039C\u039D\u039F\u03A0\u0398\u03A1\u03A3\u03A4\u03A5\u03C2\u03A9\u039E\u03A8\u0396"
	lower := "\u03B1\u03B2\u03C7\u03B4\u03B5\u03C6\u03B3\u03B7\u03B9\u03D5\u03BA\u03BB\u03BC\u03BD\u03BF\u03C0\u03B8\u03C1\u03C3\u03C4\u03C5\u03D6\u03C9\u03BE\u03C8\u03B6"
	for i, r := range []rune(upper) {
		m['A'+rune(i)] = r
	}
	for i, r := range []rune(lower) {
		m['a'+rune(i)] = r
	}
	for k, v := range map[rune]rune{
		0x22: 0x2200, 0x24: 0x2203, 0x27: 0x220B, 0x2A: 0x2217, 0x2D: 0x2212, 0x40: 0x2245,
		0x5C: 0x2234, 0x5E: 0x22A5, 0x60: 0x203E, 0x7E: 0x223C, 0xA1: 0x03D2, 0xA2: 0x2032,
		0xA3: 0x2264, 0xA4: 0x2044, 0xA5: 0x221E, 0xA6: 0x0192, 0xA7: 0x2663, 0xA8: 0x2666,
		0xA9: 0x2665, 0xAA: 0x2660, 0xAB: 0x2194, 0xAC: 0x2190, 0xAD: 0x2191, 0xAE: 0x2192,
		0xAF: 0x2193, 0xB0: 0x00B0, 0xB1: 0x00B1, 0xB2: 0x2033, 0xB3: 0x2265, 0xB4: 0x00D7,
		0xB5: 0x221D, 0xB6: 0x2202, 0xB7: 0x2022, 0xB8: 0x00F7, 0xB9: 0x2260, 0xBA: 0x2261,
		0xBB: 0x2248, 0xBC: 0x2026, 0xC0: 0x2135, 0xC1: 0x2111, 0xC2: 0x211C, 0xC3: 0x2118,
		0xC4: 0x2297, 0xC5: 0x2295, 0xC6: 0x2205, 0xC7: 0x2229, 0xC8: 0x222A, 0xC9: 0x2283,
		0xCA: 0x2287, 0xCB: 0x2284, 0xCC: 0x2282, 0xCD: 0x2286, 0xCE: 0x2208, 0xCF: 0x2209,
		0xD0: 0x2220, 0xD1: 0x2207, 0xD5: 0x220F, 0xD6: 0x221A, 0xD7: 0x22C5, 0xD8: 0x00AC,
		0xD9: 0x2227, 0xDA: 0x2228, 0xDB: 0x21D4, 0xDC: 0x21D0, 0xDD: 0x21D1, 0xDE: 0x21D2,
		0xDF: 0x21D3, 0xE0: 0x25CA, 0xE1: 0x2329, 0xE5: 0x2211, 0xF1: 0x232A, 0xF2: 0x222B,
	} {
		m[k] = v
	}
	return m
}()

// symbolText maps text set in the Symbol font to the characters it shows.
// Codes may come through the private use area (U+F061 for "a"), which is
// folded back first; anything else is kept as it is.
func symbolText(s string) string {
	var b strings.Builder
	for _, r := range s {
		c := r
		if c >= 0xF020 && c <= 0xF0FF {
			c -= 0xF000
		}
		if u, ok := symbolEncoding[c]; ok {
			b.WriteRune(u)
		} else {
			b.WriteRune(c)
		}
	}
	return b.String()
}
