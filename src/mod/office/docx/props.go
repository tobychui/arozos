package docx

/*
	props.go - WordprocessingML formatting properties and the style
	inheritance that resolves them.

	A paragraph's appearance in Word is almost never stated on the paragraph
	itself. It is the sum, lowest priority first, of

	    docDefaults (rPrDefault / pPrDefault)
	    the paragraph style, walked up its basedOn chain
	    the paragraph's own pPr
	    for a run: the character style chain, then the run's own rPr

	and a table adds its table style (and TableNormal behind that) for
	borders and cell margins. Every property below is therefore optional -
	"not stated" and "stated as off" are different things, and the second
	one has to win over an inherited "on". Google Docs writes explicit
	w:val="0" for nearly every toggle, which is exactly the case an
	"element present = on" reader gets wrong (italic headings, bold body).
*/

import (
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/office/internal/xmltree"
)

// optBool is a toggle that may or may not be stated
type optBool struct {
	set bool
	v   bool
}

// optNum is a number that may or may not be stated
type optNum struct {
	set bool
	v   float64
}

func (o *optBool) merge(src optBool) {
	if src.set {
		*o = src
	}
}

func (o *optNum) merge(src optNum) {
	if src.set {
		*o = src
	}
}

// onOff reads a WordprocessingML ST_OnOff element: present without w:val
// means on
func onOff(n *xmltree.Node) optBool {
	if n == nil {
		return optBool{}
	}
	switch strings.ToLower(n.Attr("val")) {
	case "0", "false", "off", "none":
		return optBool{set: true, v: false}
	}
	return optBool{set: true, v: true}
}

// numAttr reads a numeric attribute (Google Docs writes "100.0")
func numAttr(n *xmltree.Node, name string) optNum {
	if n == nil {
		return optNum{}
	}
	s := strings.TrimSpace(n.Attr(name))
	if s == "" {
		return optNum{}
	}
	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return optNum{}
	}
	return optNum{set: true, v: v}
}

/* ---------------- run properties ---------------- */

type docxRPr struct {
	b, i, strike, dstrike, caps, smallCaps, vanish optBool
	u                                              string // "" = not stated, "none" = off
	color                                          string // RRGGBB, "auto", or ""
	highlight                                      string // named highlight colour
	shd                                            string // RRGGBB fill
	sz                                             optNum // half-points
	fontASCII, fontEA                              string
	vert                                           string // superscript | subscript | baseline
	rStyle                                         string
}

func parseRPr(n *xmltree.Node) docxRPr {
	r := docxRPr{}
	if n == nil {
		return r
	}
	r.b = onOff(n.First("b"))
	r.i = onOff(n.First("i"))
	r.strike = onOff(n.First("strike"))
	r.dstrike = onOff(n.First("dstrike"))
	r.caps = onOff(n.First("caps"))
	r.smallCaps = onOff(n.First("smallCaps"))
	r.vanish = onOff(n.First("vanish"))
	if u := n.First("u"); u != nil {
		r.u = u.Attr("val")
		if r.u == "" {
			r.u = "single"
		}
	}
	if c := n.First("color"); c != nil {
		r.color = strings.ToUpper(c.Attr("val"))
	}
	if h := n.First("highlight"); h != nil {
		r.highlight = h.Attr("val")
	}
	if s := n.First("shd"); s != nil {
		if f := strings.ToUpper(s.Attr("fill")); len(f) == 6 {
			r.shd = f
		} else if f == "AUTO" {
			r.shd = "auto"
		}
	}
	r.sz = numAttr(n.First("sz"), "val")
	if f := n.First("rFonts"); f != nil {
		r.fontASCII = f.Attr("ascii")
		if r.fontASCII == "" {
			r.fontASCII = f.Attr("hAnsi")
		}
		r.fontEA = f.Attr("eastAsia")
	}
	if va := n.First("vertAlign"); va != nil {
		r.vert = va.Attr("val")
	}
	if rs := n.First("rStyle"); rs != nil {
		r.rStyle = rs.Attr("val")
	}
	return r
}

func (r *docxRPr) merge(src docxRPr) {
	r.b.merge(src.b)
	r.i.merge(src.i)
	r.strike.merge(src.strike)
	r.dstrike.merge(src.dstrike)
	r.caps.merge(src.caps)
	r.smallCaps.merge(src.smallCaps)
	r.vanish.merge(src.vanish)
	if src.u != "" {
		r.u = src.u
	}
	if src.color != "" {
		r.color = src.color
	}
	if src.highlight != "" {
		r.highlight = src.highlight
	}
	if src.shd != "" {
		r.shd = src.shd
	}
	r.sz.merge(src.sz)
	if src.fontASCII != "" {
		r.fontASCII = src.fontASCII
	}
	if src.fontEA != "" {
		r.fontEA = src.fontEA
	}
	if src.vert != "" {
		r.vert = src.vert
	}
}

/* ---------------- paragraph properties ---------------- */

type docxBorder struct {
	val   string
	sz    float64 // eighths of a point
	color string
	space float64 // points
}

// visible reports whether the border draws anything
func (b docxBorder) visible() bool {
	switch b.val {
	case "", "nil", "none":
		return false
	}
	return true
}

func parseBorder(n *xmltree.Node) (docxBorder, bool) {
	if n == nil {
		return docxBorder{}, false
	}
	b := docxBorder{val: n.Attr("val"), color: strings.ToUpper(n.Attr("color"))}
	if v := numAttr(n, "sz"); v.set {
		b.sz = v.v
	}
	if v := numAttr(n, "space"); v.set {
		b.space = v.v
	}
	return b, true
}

type docxTab struct {
	align  string  // left | right | center | decimal | clear
	pos    float64 // twips from the text column's left edge
	leader string  // none | dot | hyphen | underscore ...
}

type docxPPr struct {
	style                                string
	before, after, line                  optNum
	lineRule                             string
	indL, indR, indFirst, indHang        optNum
	jc                                   string
	keepNext, keepLines, pageBreakBefore optBool
	widow, contextual                    optBool
	shd                                  string
	borders                              map[string]docxBorder
	numID                                string
	numSet                               bool
	ilvl                                 optNum
	tabs                                 []docxTab
	sect                                 *xmltree.Node
	mark                                 docxRPr // paragraph mark run properties
	outline                              optNum
	// spacing before / after is Word's "auto" (HTML) spacing
	autoBefore, autoAfter optBool
}

func parsePPr(n *xmltree.Node) docxPPr {
	p := docxPPr{}
	if n == nil {
		return p
	}
	if ps := n.First("pStyle"); ps != nil {
		p.style = ps.Attr("val")
	}
	if sp := n.First("spacing"); sp != nil {
		p.before = numAttr(sp, "before")
		p.after = numAttr(sp, "after")
		p.line = numAttr(sp, "line")
		p.lineRule = sp.Attr("lineRule")
		// "auto" spacing before/after is Word's HTML-ish 14pt; close enough
		if onOff2(sp.Attr("beforeAutospacing")) {
			p.before = optNum{set: true, v: 280}
			p.autoBefore = optBool{set: true, v: true}
		}
		if onOff2(sp.Attr("afterAutospacing")) {
			p.after = optNum{set: true, v: 280}
			p.autoAfter = optBool{set: true, v: true}
		}
	}
	if ind := n.First("ind"); ind != nil {
		p.indL = numAttr(ind, "left")
		if !p.indL.set {
			p.indL = numAttr(ind, "start")
		}
		p.indR = numAttr(ind, "right")
		if !p.indR.set {
			p.indR = numAttr(ind, "end")
		}
		p.indFirst = numAttr(ind, "firstLine")
		p.indHang = numAttr(ind, "hanging")
		// a stated firstLine clears an inherited hanging indent and vice versa
		if p.indFirst.set && !p.indHang.set {
			p.indHang = optNum{set: true, v: 0}
		}
		if p.indHang.set && !p.indFirst.set {
			p.indFirst = optNum{set: true, v: 0}
		}
	}
	if jc := n.First("jc"); jc != nil {
		p.jc = jc.Attr("val")
	}
	p.keepNext = onOff(n.First("keepNext"))
	p.keepLines = onOff(n.First("keepLines"))
	p.pageBreakBefore = onOff(n.First("pageBreakBefore"))
	p.widow = onOff(n.First("widowControl"))
	p.contextual = onOff(n.First("contextualSpacing"))
	if s := n.First("shd"); s != nil {
		if f := strings.ToUpper(s.Attr("fill")); len(f) == 6 {
			p.shd = f
		} else if f == "AUTO" {
			p.shd = "auto"
		}
	}
	if bd := n.First("pBdr"); bd != nil {
		p.borders = map[string]docxBorder{}
		for _, side := range []string{"top", "left", "bottom", "right"} {
			if b, ok := parseBorder(bd.First(side)); ok {
				p.borders[side] = b
			}
		}
	}
	if np := n.First("numPr"); np != nil {
		if id := np.First("numId"); id != nil {
			p.numID = id.Attr("val")
			p.numSet = true
		}
		p.ilvl = numAttr(np.First("ilvl"), "val")
	}
	if tabs := n.First("tabs"); tabs != nil {
		for _, t := range tabs.All("tab") {
			pos := numAttr(t, "pos")
			if !pos.set {
				continue
			}
			p.tabs = append(p.tabs, docxTab{align: t.Attr("val"), pos: pos.v, leader: t.Attr("leader")})
		}
	}
	p.sect = n.First("sectPr")
	p.mark = parseRPr(n.First("rPr"))
	p.outline = numAttr(n.First("outlineLvl"), "val")
	return p
}

func onOff2(s string) bool {
	switch strings.ToLower(s) {
	case "1", "true", "on":
		return true
	}
	return false
}

func (p *docxPPr) merge(src docxPPr) {
	if src.style != "" {
		p.style = src.style
	}
	p.before.merge(src.before)
	p.after.merge(src.after)
	if src.before.set {
		p.autoBefore = src.autoBefore
	}
	if src.after.set {
		p.autoAfter = src.autoAfter
	}
	if src.line.set {
		p.line = src.line
		p.lineRule = src.lineRule
	}
	p.indL.merge(src.indL)
	p.indR.merge(src.indR)
	p.indFirst.merge(src.indFirst)
	p.indHang.merge(src.indHang)
	if src.jc != "" {
		p.jc = src.jc
	}
	p.keepNext.merge(src.keepNext)
	p.keepLines.merge(src.keepLines)
	p.pageBreakBefore.merge(src.pageBreakBefore)
	p.widow.merge(src.widow)
	p.contextual.merge(src.contextual)
	if src.shd != "" {
		p.shd = src.shd
	}
	if src.borders != nil {
		if p.borders == nil {
			p.borders = map[string]docxBorder{}
		}
		for k, v := range src.borders {
			p.borders[k] = v
		}
	}
	if src.numSet {
		p.numID = src.numID
		p.numSet = true
	}
	p.ilvl.merge(src.ilvl)
	if len(src.tabs) > 0 {
		// tab stops accumulate; a "clear" stop removes an inherited one
		for _, t := range src.tabs {
			kept := p.tabs[:0]
			for _, old := range p.tabs {
				if absF(old.pos-t.pos) > 1 {
					kept = append(kept, old)
				}
			}
			p.tabs = kept
			if t.align != "clear" {
				p.tabs = append(p.tabs, t)
			}
		}
	}
	if src.sect != nil {
		p.sect = src.sect
	}
	p.outline.merge(src.outline)
}

/* ---------------- table properties ---------------- */

type docxTblPr struct {
	style     string
	width     optNum
	widthType string
	ind       optNum
	jc        string
	borders   map[string]docxBorder // top left bottom right insideH insideV
	cellMar   map[string]optNum     // top left bottom right (twips)
	layout    string
}

func parseTblPr(n *xmltree.Node) docxTblPr {
	t := docxTblPr{}
	if n == nil {
		return t
	}
	if s := n.First("tblStyle"); s != nil {
		t.style = s.Attr("val")
	}
	if w := n.First("tblW"); w != nil {
		t.width = numAttr(w, "w")
		t.widthType = w.Attr("type")
	}
	if ind := n.First("tblInd"); ind != nil {
		t.ind = numAttr(ind, "w")
	}
	if jc := n.First("jc"); jc != nil {
		t.jc = jc.Attr("val")
	}
	if l := n.First("tblLayout"); l != nil {
		t.layout = l.Attr("type")
	}
	t.borders = parseBorderSet(n.First("tblBorders"))
	t.cellMar = parseMarginSet(n.First("tblCellMar"))
	return t
}

func parseBorderSet(n *xmltree.Node) map[string]docxBorder {
	if n == nil {
		return nil
	}
	out := map[string]docxBorder{}
	for _, side := range []string{"top", "left", "bottom", "right", "insideH", "insideV"} {
		b, ok := parseBorder(n.First(side))
		if !ok {
			// start/end are the bidi-neutral spellings of left/right
			if side == "left" {
				b, ok = parseBorder(n.First("start"))
			} else if side == "right" {
				b, ok = parseBorder(n.First("end"))
			}
		}
		if ok {
			out[side] = b
		}
	}
	return out
}

func parseMarginSet(n *xmltree.Node) map[string]optNum {
	if n == nil {
		return nil
	}
	out := map[string]optNum{}
	for _, side := range []string{"top", "left", "bottom", "right"} {
		m := n.First(side)
		if m == nil {
			if side == "left" {
				m = n.First("start")
			} else if side == "right" {
				m = n.First("end")
			}
		}
		if v := numAttr(m, "w"); v.set {
			out[side] = v
		}
	}
	return out
}

func (t *docxTblPr) merge(src docxTblPr) {
	if src.style != "" {
		t.style = src.style
	}
	if src.width.set {
		t.width = src.width
		t.widthType = src.widthType
	}
	t.ind.merge(src.ind)
	if src.jc != "" {
		t.jc = src.jc
	}
	if src.layout != "" {
		t.layout = src.layout
	}
	if src.borders != nil {
		if t.borders == nil {
			t.borders = map[string]docxBorder{}
		}
		for k, v := range src.borders {
			t.borders[k] = v
		}
	}
	if src.cellMar != nil {
		if t.cellMar == nil {
			t.cellMar = map[string]optNum{}
		}
		for k, v := range src.cellMar {
			t.cellMar[k] = v
		}
	}
}

/* ---------------- style sheet ---------------- */

type docxStyle struct {
	id, typ, name, basedOn string
	pPr                    docxPPr
	rPr                    docxRPr
	tbl                    docxTblPr
}

type docxStyleSheet struct {
	docP        docxPPr
	docR        docxRPr
	styles      map[string]*docxStyle
	defPara     string
	defTable    string
	defChar     string
	resolvedP   map[string]*docxPPr
	resolvedR   map[string]*docxRPr
	resolvedTbl map[string]*docxTblPr
}

func parseStyleSheet(raw []byte) *docxStyleSheet {
	ss := &docxStyleSheet{
		styles:      map[string]*docxStyle{},
		resolvedP:   map[string]*docxPPr{},
		resolvedR:   map[string]*docxRPr{},
		resolvedTbl: map[string]*docxTblPr{},
	}
	if raw == nil {
		return ss
	}
	tree, err := xmltree.Parse(raw)
	if err != nil {
		return ss
	}
	if dd := tree.First("docDefaults"); dd != nil {
		ss.docR = parseRPr(dd.Path("rPrDefault", "rPr"))
		ss.docP = parsePPr(dd.Path("pPrDefault", "pPr"))
	}
	for _, s := range tree.All("style") {
		st := &docxStyle{id: s.Attr("styleId"), typ: s.Attr("type")}
		if n := s.First("name"); n != nil {
			st.name = n.Attr("val")
		}
		if b := s.First("basedOn"); b != nil {
			st.basedOn = b.Attr("val")
		}
		st.pPr = parsePPr(s.First("pPr"))
		st.pPr.style = ""
		st.rPr = parseRPr(s.First("rPr"))
		st.tbl = parseTblPr(s.First("tblPr"))
		ss.styles[st.id] = st
		if onOff2(s.Attr("default")) {
			switch st.typ {
			case "paragraph":
				ss.defPara = st.id
			case "table":
				ss.defTable = st.id
			case "character":
				ss.defChar = st.id
			}
		}
	}
	return ss
}

// chain returns the style and its basedOn ancestors, root first
func (ss *docxStyleSheet) chain(id string) []*docxStyle {
	var out []*docxStyle
	seen := map[string]bool{}
	for id != "" && !seen[id] {
		seen[id] = true
		st, ok := ss.styles[id]
		if !ok {
			break
		}
		out = append([]*docxStyle{st}, out...)
		id = st.basedOn
	}
	return out
}

// paraStyle resolves a paragraph style (the default one when id is empty)
// into the pPr/rPr it contributes on top of docDefaults
func (ss *docxStyleSheet) paraStyle(id string) (*docxPPr, *docxRPr) {
	if id == "" || ss.styles[id] == nil {
		id = ss.defPara
	}
	if p, ok := ss.resolvedP[id]; ok {
		return p, ss.resolvedR[id]
	}
	p := ss.docP
	p.style = ""
	r := ss.docR
	for _, st := range ss.chain(id) {
		p.merge(st.pPr)
		r.merge(st.rPr)
	}
	ss.resolvedP[id] = &p
	ss.resolvedR[id] = &r
	return &p, &r
}

// charStyle returns what a character style chain contributes
func (ss *docxStyleSheet) charStyle(id string) docxRPr {
	r := docxRPr{}
	for _, st := range ss.chain(id) {
		r.merge(st.rPr)
	}
	return r
}

// tableStyle resolves a table style (TableNormal behind it)
func (ss *docxStyleSheet) tableStyle(id string) *docxTblPr {
	key := "tbl:" + id
	if t, ok := ss.resolvedTbl[key]; ok {
		return t
	}
	t := docxTblPr{}
	if ss.defTable != "" && ss.defTable != id {
		for _, st := range ss.chain(ss.defTable) {
			t.merge(st.tbl)
		}
	}
	for _, st := range ss.chain(id) {
		t.merge(st.tbl)
	}
	ss.resolvedTbl[key] = &t
	return &t
}

// headingLevel reports which heading (1-6) a paragraph style is, 0 for none.
// Title and Subtitle come back as -1 and -2.
func (ss *docxStyleSheet) headingLevel(id string) int {
	// walk from the style itself towards its roots: a custom style based
	// on a heading is that heading
	chain := ss.chain(id)
	for i := len(chain) - 1; i >= 0; i-- {
		if lvl := styleNameLevel(chain[i].id, chain[i].name); lvl != 0 {
			return lvl
		}
	}
	if len(chain) == 0 {
		return styleNameLevel(id, "")
	}
	return 0
}

func styleNameLevel(id, name string) int {
	n := strings.ToLower(id)
	if name != "" {
		n = strings.ToLower(name)
	}
	compact := strings.ReplaceAll(n, " ", "")
	switch {
	case compact == "title":
		return -1
	case compact == "subtitle":
		return -2
	case strings.HasPrefix(compact, "heading") && len(compact) == 8 && compact[7] >= '1' && compact[7] <= '6':
		return int(compact[7] - '0')
	}
	return 0
}
