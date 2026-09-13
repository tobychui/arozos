package office

/*
	docx_props.go - WordprocessingML formatting properties and the style
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
func onOff(n *xnode) optBool {
	if n == nil {
		return optBool{}
	}
	switch strings.ToLower(n.attr("val")) {
	case "0", "false", "off", "none":
		return optBool{set: true, v: false}
	}
	return optBool{set: true, v: true}
}

// numAttr reads a numeric attribute (Google Docs writes "100.0")
func numAttr(n *xnode, name string) optNum {
	if n == nil {
		return optNum{}
	}
	s := strings.TrimSpace(n.attr(name))
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

func parseRPr(n *xnode) docxRPr {
	r := docxRPr{}
	if n == nil {
		return r
	}
	r.b = onOff(n.first("b"))
	r.i = onOff(n.first("i"))
	r.strike = onOff(n.first("strike"))
	r.dstrike = onOff(n.first("dstrike"))
	r.caps = onOff(n.first("caps"))
	r.smallCaps = onOff(n.first("smallCaps"))
	r.vanish = onOff(n.first("vanish"))
	if u := n.first("u"); u != nil {
		r.u = u.attr("val")
		if r.u == "" {
			r.u = "single"
		}
	}
	if c := n.first("color"); c != nil {
		r.color = strings.ToUpper(c.attr("val"))
	}
	if h := n.first("highlight"); h != nil {
		r.highlight = h.attr("val")
	}
	if s := n.first("shd"); s != nil {
		if f := strings.ToUpper(s.attr("fill")); len(f) == 6 {
			r.shd = f
		} else if f == "AUTO" {
			r.shd = "auto"
		}
	}
	r.sz = numAttr(n.first("sz"), "val")
	if f := n.first("rFonts"); f != nil {
		r.fontASCII = f.attr("ascii")
		if r.fontASCII == "" {
			r.fontASCII = f.attr("hAnsi")
		}
		r.fontEA = f.attr("eastAsia")
	}
	if va := n.first("vertAlign"); va != nil {
		r.vert = va.attr("val")
	}
	if rs := n.first("rStyle"); rs != nil {
		r.rStyle = rs.attr("val")
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

func parseBorder(n *xnode) (docxBorder, bool) {
	if n == nil {
		return docxBorder{}, false
	}
	b := docxBorder{val: n.attr("val"), color: strings.ToUpper(n.attr("color"))}
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
	sect                                 *xnode
	mark                                 docxRPr // paragraph mark run properties
	outline                              optNum
}

func parsePPr(n *xnode) docxPPr {
	p := docxPPr{}
	if n == nil {
		return p
	}
	if ps := n.first("pStyle"); ps != nil {
		p.style = ps.attr("val")
	}
	if sp := n.first("spacing"); sp != nil {
		p.before = numAttr(sp, "before")
		p.after = numAttr(sp, "after")
		p.line = numAttr(sp, "line")
		p.lineRule = sp.attr("lineRule")
		// "auto" spacing before/after is Word's HTML-ish 14pt; close enough
		if onOff2(sp.attr("beforeAutospacing")) {
			p.before = optNum{set: true, v: 280}
		}
		if onOff2(sp.attr("afterAutospacing")) {
			p.after = optNum{set: true, v: 280}
		}
	}
	if ind := n.first("ind"); ind != nil {
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
	if jc := n.first("jc"); jc != nil {
		p.jc = jc.attr("val")
	}
	p.keepNext = onOff(n.first("keepNext"))
	p.keepLines = onOff(n.first("keepLines"))
	p.pageBreakBefore = onOff(n.first("pageBreakBefore"))
	p.widow = onOff(n.first("widowControl"))
	p.contextual = onOff(n.first("contextualSpacing"))
	if s := n.first("shd"); s != nil {
		if f := strings.ToUpper(s.attr("fill")); len(f) == 6 {
			p.shd = f
		} else if f == "AUTO" {
			p.shd = "auto"
		}
	}
	if bd := n.first("pBdr"); bd != nil {
		p.borders = map[string]docxBorder{}
		for _, side := range []string{"top", "left", "bottom", "right"} {
			if b, ok := parseBorder(bd.first(side)); ok {
				p.borders[side] = b
			}
		}
	}
	if np := n.first("numPr"); np != nil {
		if id := np.first("numId"); id != nil {
			p.numID = id.attr("val")
			p.numSet = true
		}
		p.ilvl = numAttr(np.first("ilvl"), "val")
	}
	if tabs := n.first("tabs"); tabs != nil {
		for _, t := range tabs.all("tab") {
			pos := numAttr(t, "pos")
			if !pos.set {
				continue
			}
			p.tabs = append(p.tabs, docxTab{align: t.attr("val"), pos: pos.v, leader: t.attr("leader")})
		}
	}
	p.sect = n.first("sectPr")
	p.mark = parseRPr(n.first("rPr"))
	p.outline = numAttr(n.first("outlineLvl"), "val")
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

func parseTblPr(n *xnode) docxTblPr {
	t := docxTblPr{}
	if n == nil {
		return t
	}
	if s := n.first("tblStyle"); s != nil {
		t.style = s.attr("val")
	}
	if w := n.first("tblW"); w != nil {
		t.width = numAttr(w, "w")
		t.widthType = w.attr("type")
	}
	if ind := n.first("tblInd"); ind != nil {
		t.ind = numAttr(ind, "w")
	}
	if jc := n.first("jc"); jc != nil {
		t.jc = jc.attr("val")
	}
	if l := n.first("tblLayout"); l != nil {
		t.layout = l.attr("type")
	}
	t.borders = parseBorderSet(n.first("tblBorders"))
	t.cellMar = parseMarginSet(n.first("tblCellMar"))
	return t
}

func parseBorderSet(n *xnode) map[string]docxBorder {
	if n == nil {
		return nil
	}
	out := map[string]docxBorder{}
	for _, side := range []string{"top", "left", "bottom", "right", "insideH", "insideV"} {
		b, ok := parseBorder(n.first(side))
		if !ok {
			// start/end are the bidi-neutral spellings of left/right
			if side == "left" {
				b, ok = parseBorder(n.first("start"))
			} else if side == "right" {
				b, ok = parseBorder(n.first("end"))
			}
		}
		if ok {
			out[side] = b
		}
	}
	return out
}

func parseMarginSet(n *xnode) map[string]optNum {
	if n == nil {
		return nil
	}
	out := map[string]optNum{}
	for _, side := range []string{"top", "left", "bottom", "right"} {
		m := n.first(side)
		if m == nil {
			if side == "left" {
				m = n.first("start")
			} else if side == "right" {
				m = n.first("end")
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
	tree, err := parseXMLTree(raw)
	if err != nil {
		return ss
	}
	if dd := tree.first("docDefaults"); dd != nil {
		ss.docR = parseRPr(dd.path("rPrDefault", "rPr"))
		ss.docP = parsePPr(dd.path("pPrDefault", "pPr"))
	}
	for _, s := range tree.all("style") {
		st := &docxStyle{id: s.attr("styleId"), typ: s.attr("type")}
		if n := s.first("name"); n != nil {
			st.name = n.attr("val")
		}
		if b := s.first("basedOn"); b != nil {
			st.basedOn = b.attr("val")
		}
		st.pPr = parsePPr(s.first("pPr"))
		st.pPr.style = ""
		st.rPr = parseRPr(s.first("rPr"))
		st.tbl = parseTblPr(s.first("tblPr"))
		ss.styles[st.id] = st
		if onOff2(s.attr("default")) {
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
