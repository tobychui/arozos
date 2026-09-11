package office

/*
	pptx_reader.go - Parse a PowerPoint (.pptx) file into a Presentation.

	The goal is that a deck authored in PowerPoint or Google Slides looks
	the same in the Slides webapp as it does in the application it came
	from. That means resolving the parts of PresentationML that decide what
	a slide actually looks like, not just the ones a shape states outright:

	  - theme colours (schemeClr) through the master's colour map, with the
	    lumMod / lumOff / shade / tint transforms applied
	  - placeholder inheritance: a shape with no position, size, body
	    properties or text style takes them from the matching placeholder
	    on its layout, and failing that on the master
	  - per-run and per-paragraph formatting, bullets, indents, line
	    spacing, paragraph spacing, vertical anchoring and text insets
	  - autofit font scaling (normAutofit), which is how a deck keeps
	    oversized text inside its box
	  - group shapes, with the child coordinate transform
	  - picture cropping (srcRect) and rounded picture frames

	Everything is scaled from the source slide size into the 960x540 px
	coordinate space of the Slides editor. Anything the editor cannot
	model - native charts, SmartArt, 3D effects, animations - is skipped
	rather than approximated badly.
*/

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"math"
	"path"
	"strconv"
	"strings"
)

// prstToShapeKind maps DrawingML preset geometries onto the shape kinds
// the Slides editor can draw. Anything absent falls back to a rectangle,
// which is closer to right than dropping the shape.
var prstToShapeKind = map[string]string{
	"rect":                  "rect",
	"flowChartProcess":      "rect",
	"snip1Rect":             "rect",
	"snip2SameRect":         "rect",
	"plaque":                "round",
	"roundRect":             "round",
	"round1Rect":            "round",
	"round2SameRect":        "round",
	"round2DiagRect":        "round",
	"snipRoundRect":         "round",
	"wedgeRoundRectCallout": "round",
	"wedgeRectCallout":      "rect",
	"ellipse":               "ellipse",
	"circle":                "ellipse",
	"flowChartConnector":    "ellipse",
	"ovalCallout":           "ellipse",
	"triangle":              "triangle",
	"flowChartExtract":      "triangle",
	"rtTriangle":            "rtTriangle",
	"diamond":               "diamond",
	"flowChartDecision":     "diamond",
	"rightArrow":            "arrow",
	"leftArrow":             "leftArrow",
	"upArrow":               "upArrow",
	"downArrow":             "downArrow",
	"star5":                 "star",
	"star4":                 "star",
	"star6":                 "star",
	"chevron":               "chevron",
	"homePlate":             "chevron",
	"pentagon":              "pentagon",
	"hexagon":               "hexagon",
	"parallelogram":         "parallelogram",
	"trapezoid":             "trapezoid",
	"mathPlus":              "plus",
	"plus":                  "plus",
}

// pptxDoc is the whole package plus everything shared across slides
type pptxDoc struct {
	files      map[string][]byte
	pres       *xnode
	presRels   map[string]string
	defTxStyle *xnode
	sx, sy     float64 // source EMU -> editor px scale
	// parsed part cache, keyed by part path
	trees map[string]*xnode
	rels  map[string]map[string]string
	// typefaces some run actually asks for, lower-cased - only these are
	// worth pulling out of the embedded font list
	usedFonts map[string]bool
}

// slideCtx is the resolution context of one slide: its layout, master,
// theme colours and colour map
type slideCtx struct {
	doc        *pptxDoc
	baseDir    string
	rels       map[string]string
	layout     *xnode
	layoutDir  string
	layoutRels map[string]string
	master     *xnode
	masterDir  string
	masterRels map[string]string
	cc         colorCtx
	majorLatin string
	minorLatin string
	fmtScheme  *xnode
	slideNum   int
	// the part whose shapes are being walked right now - a layout's or
	// master's picture resolves through that part's own rels, not the
	// slide's
	curRels map[string]string
	curDir  string
}

// walkPart walks one part's shape tree with that part's relationships in
// scope, then restores the previous scope
func (sc *slideCtx) walkPart(tree *xnode, rels map[string]string, dir string, slide *Slide, z *int, phOnly bool) {
	spTree := tree.path("cSld", "spTree")
	if spTree == nil {
		return
	}
	prevRels, prevDir := sc.curRels, sc.curDir
	sc.curRels, sc.curDir = rels, dir
	sc.walkShapes(spTree, sc.rootMap(), slide, z, phOnly)
	sc.curRels, sc.curDir = prevRels, prevDir
}

// coordMap converts EMU in the current (possibly grouped) coordinate space
// into editor pixels. Group shapes nest these: a child's coordinates are
// expressed in the group's child space and scaled by ext/chExt.
type coordMap struct {
	kx, ky float64 // px per EMU
	bx, by float64 // px origin of this space
	cx, cy float64 // EMU origin of this space
	fs     float64 // font scale accumulated from group scaling
}

func (c coordMap) px(emuX, emuY float64) (float64, float64) {
	return c.bx + (emuX-c.cx)*c.kx, c.by + (emuY-c.cy)*c.ky
}

func (c coordMap) size(emuW, emuH float64) (float64, float64) {
	return emuW * c.kx, emuH * c.ky
}

// ParsePptx converts raw .pptx bytes into a Presentation
func ParsePptx(data []byte) (*Presentation, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("not a valid pptx (zip) file")
	}

	files := map[string][]byte{}
	for _, f := range zr.File {
		// presentations can carry large videos - only read the parts we need
		name := path.Clean(f.Name)
		if strings.HasSuffix(name, ".xml") || strings.HasSuffix(name, ".rels") ||
			strings.HasPrefix(name, "ppt/media/") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			b, err := io.ReadAll(rc)
			rc.Close()
			if err != nil {
				continue
			}
			files[name] = b
		}
	}

	presXML, ok := files["ppt/presentation.xml"]
	if !ok {
		return nil, errors.New("pptx is missing ppt/presentation.xml")
	}
	pres, err := parseXMLTree(presXML)
	if err != nil {
		return nil, errors.New("cannot parse presentation.xml: " + err.Error())
	}

	doc := &pptxDoc{
		files: files, pres: pres, sx: 1, sy: 1,
		trees:     map[string]*xnode{},
		rels:      map[string]map[string]string{},
		usedFonts: map[string]bool{},
	}
	doc.presRels = doc.relsFor("ppt/presentation.xml")
	doc.defTxStyle = pres.first("defaultTextStyle")

	// source slide size -> scale into the 960x540 editor space
	if sz := pres.first("sldSz"); sz != nil {
		cx := atofDefault(sz.attr("cx"), 0)
		cy := atofDefault(sz.attr("cy"), 0)
		if cx > 0 {
			doc.sx = float64(slidePxW) / (cx / emuPerPx)
		}
		if cy > 0 {
			doc.sy = float64(slidePxH) / (cy / emuPerPx)
		}
	}

	slidePaths := doc.slideOrder()
	if len(slidePaths) == 0 {
		return nil, errors.New("pptx contains no slides")
	}

	out := &Presentation{
		Size:   []int{slidePxW, slidePxH},
		Theme:  "clean",
		Slides: []*Slide{},
	}

	for si, sp := range slidePaths {
		tree := doc.tree(sp)
		if tree == nil {
			continue
		}
		sc := doc.slideContext(sp, tree)
		sc.slideNum = si + 1
		slide := sc.parseSlide(tree)
		slide.ID = fmt.Sprintf("s-import%d", si+1)
		slide.Notes = sc.extractNotes()
		out.Slides = append(out.Slides, slide)
	}

	if len(out.Slides) == 0 {
		return nil, errors.New("no readable slides found in pptx")
	}
	out.Fonts = doc.embeddedFontFaces(doc.usedFonts)
	return out, nil
}

/* ---------------- package plumbing ---------------- */

// tree parses (and caches) one XML part
func (d *pptxDoc) tree(part string) *xnode {
	if t, ok := d.trees[part]; ok {
		return t
	}
	raw, ok := d.files[part]
	if !ok {
		d.trees[part] = nil
		return nil
	}
	t, err := parseXMLTree(raw)
	if err != nil {
		t = nil
	}
	d.trees[part] = t
	return t
}

// relsFor loads (and caches) the relationship map of a part
func (d *pptxDoc) relsFor(part string) map[string]string {
	if r, ok := d.rels[part]; ok {
		return r
	}
	relPath := path.Dir(part) + "/_rels/" + path.Base(part) + ".rels"
	out := map[string]string{}
	if raw, ok := d.files[relPath]; ok {
		if tree, err := parseXMLTree(raw); err == nil {
			for _, rel := range tree.all("Relationship") {
				out[rel.attr("Id")] = rel.attr("Target")
			}
		}
	}
	d.rels[part] = out
	return out
}

// slideOrder resolves sldIdLst into slide part paths
func (d *pptxDoc) slideOrder() []string {
	var out []string
	if lst := d.pres.first("sldIdLst"); lst != nil {
		for _, sid := range lst.all("sldId") {
			rid := sid.attrNS("relationships", "id")
			if rid == "" {
				// some producers write r:id without a resolvable namespace
				for _, a := range sid.Attrs {
					if a.Name.Local == "id" && strings.HasPrefix(a.Value, "rId") {
						rid = a.Value
					}
				}
			}
			if target, ok := d.presRels[rid]; ok {
				out = append(out, resolvePartPath("ppt", target))
			}
		}
	}
	if len(out) == 0 {
		for i := 1; ; i++ {
			p := fmt.Sprintf("ppt/slides/slide%d.xml", i)
			if _, ok := d.files[p]; !ok {
				break
			}
			out = append(out, p)
		}
	}
	return out
}

// resolvePartPath resolves a (possibly relative) rels target against a base dir
func resolvePartPath(baseDir, target string) string {
	if strings.HasPrefix(target, "/") {
		return strings.TrimPrefix(target, "/")
	}
	return path.Clean(path.Join(baseDir, target))
}

// relTarget finds the first relationship whose type ends with the given
// suffix and returns the part path it points at
func relTarget(rels map[string]string, baseDir, typeSuffix string, files map[string][]byte) string {
	for _, target := range rels {
		if strings.Contains(target, typeSuffix) {
			p := resolvePartPath(baseDir, target)
			if _, ok := files[p]; ok {
				return p
			}
		}
	}
	return ""
}

// slideContext resolves a slide's layout, master, theme and colour map
func (d *pptxDoc) slideContext(slidePath string, slide *xnode) *slideCtx {
	sc := &slideCtx{doc: d, baseDir: path.Dir(slidePath), rels: d.relsFor(slidePath)}

	layoutPath := relTarget(sc.rels, sc.baseDir, "slideLayout", d.files)
	if layoutPath != "" {
		sc.layout = d.tree(layoutPath)
		sc.layoutDir = path.Dir(layoutPath)
		sc.layoutRels = d.relsFor(layoutPath)
	}
	masterPath := ""
	if sc.layoutRels != nil {
		masterPath = relTarget(sc.layoutRels, sc.layoutDir, "slideMaster", d.files)
	}
	if masterPath == "" {
		masterPath = "ppt/slideMasters/slideMaster1.xml"
	}
	sc.master = d.tree(masterPath)
	sc.masterDir = path.Dir(masterPath)
	sc.masterRels = d.relsFor(masterPath)

	// theme through the master's rels
	var theme *xnode
	if sc.masterRels != nil {
		if tp := relTarget(sc.masterRels, sc.masterDir, "theme", d.files); tp != "" {
			theme = d.tree(tp)
		}
	}
	sc.cc.scheme = map[string]string{}
	if theme != nil {
		if cs := theme.path("themeElements", "clrScheme"); cs != nil {
			for i := range cs.Nodes {
				slot := cs.Nodes[i].XMLName.Local
				for j := range cs.Nodes[i].Nodes {
					c := &cs.Nodes[i].Nodes[j]
					plain := colorCtx{}
					if hex := plain.resolveColor(c); hex != "" {
						sc.cc.scheme[slot] = strings.TrimPrefix(hex, "#")
						break
					}
				}
			}
		}
		if fs := theme.path("themeElements", "fontScheme"); fs != nil {
			if l := fs.path("majorFont", "latin"); l != nil {
				sc.majorLatin = l.attr("typeface")
			}
			if l := fs.path("minorFont", "latin"); l != nil {
				sc.minorLatin = l.attr("typeface")
			}
		}
		sc.fmtScheme = theme.path("themeElements", "fmtScheme")
	}
	// colour map: the master's, optionally overridden per slide
	sc.cc.clrMap = map[string]string{}
	if cm := sc.master.first("clrMap"); cm != nil {
		for _, a := range cm.Attrs {
			sc.cc.clrMap[a.Name.Local] = a.Value
		}
	}
	if ovr := slide.path("clrMapOvr", "overrideClrMapping"); ovr != nil {
		for _, a := range ovr.Attrs {
			sc.cc.clrMap[a.Name.Local] = a.Value
		}
	}
	return sc
}

/* ---------------- slide parsing ---------------- */

func (sc *slideCtx) rootMap() coordMap {
	return coordMap{
		kx: sc.doc.sx / emuPerPx, ky: sc.doc.sy / emuPerPx,
		fs: math.Sqrt(sc.doc.sx * sc.doc.sy),
	}
}

// parseSlide converts one slide part into the editor model
func (sc *slideCtx) parseSlide(tree *xnode) *Slide {
	slide := &Slide{Objects: []*Object{}}
	slide.Bg = sc.slideBackground(tree)

	z := 0
	// PowerPoint paints a slide on top of its layout, and the layout on
	// top of its master. Only the decoration is inherited - a placeholder
	// on a layout or master is a prototype, not something that is drawn.
	if tree.attr("showMasterSp") != "0" {
		if sc.master != nil && sc.layout.attr("showMasterSp") != "0" {
			sc.walkPart(sc.master, sc.masterRels, sc.masterDir, slide, &z, true)
		}
		if sc.layout != nil {
			sc.walkPart(sc.layout, sc.layoutRels, sc.layoutDir, slide, &z, true)
		}
	}
	sc.walkPart(tree, sc.rels, sc.baseDir, slide, &z, false)
	return slide
}

// slideBackground resolves the slide's own background, then the layout's,
// then the master's - the first one that states a fill wins
func (sc *slideCtx) slideBackground(tree *xnode) string {
	for _, src := range []*xnode{tree, sc.layout, sc.master} {
		bg := src.path("cSld", "bg")
		if bg == nil {
			continue
		}
		if pr := bg.first("bgPr"); pr != nil {
			if c := sc.cc.fillColorOf(pr); c != "" && c != "none" {
				return c
			}
		}
		if ref := bg.first("bgRef"); ref != nil {
			for i := range ref.Nodes {
				if c := sc.cc.resolveColor(&ref.Nodes[i]); c != "" {
					return c
				}
			}
		}
	}
	return ""
}

// walkShapes appends every drawable descendant of a shape tree, recursing
// into group shapes with the transform their child space implies
func (sc *slideCtx) walkShapes(spTree *xnode, cm coordMap, slide *Slide, z *int, skipPh bool) {
	for i := range spTree.Nodes {
		node := &spTree.Nodes[i]
		if skipPh {
			if _, isPh := phOf(node); isPh {
				continue
			}
		}
		switch node.XMLName.Local {
		case "sp":
			sc.addObject(slide, sc.parseSp(node, cm), z)
		case "cxnSp":
			sc.addObject(slide, sc.parseCxnSp(node, cm), z)
		case "pic":
			sc.addObject(slide, sc.parsePic(node, cm), z)
		case "graphicFrame":
			sc.addObject(slide, sc.parseGraphicFrame(node, cm), z)
		case "grpSp":
			sc.walkShapes(node, groupMap(node, cm), slide, z, false)
		case "AlternateContent":
			// mc:AlternateContent wraps a preferred and a fallback rendering;
			// the Fallback branch is the one built from plain DrawingML
			if fb := node.first("Fallback"); fb != nil {
				sc.walkShapes(fb, cm, slide, z, skipPh)
			} else if ch := node.first("Choice"); ch != nil {
				sc.walkShapes(ch, cm, slide, z, skipPh)
			}
		}
	}
}

func (sc *slideCtx) addObject(slide *Slide, obj *Object, z *int) {
	if obj == nil {
		return
	}
	*z++
	obj.ID = fmt.Sprintf("o-import%d", *z)
	obj.Z = *z
	slide.Objects = append(slide.Objects, obj)
}

// groupMap builds the coordinate map of a group's children
func groupMap(grp *xnode, parent coordMap) coordMap {
	xf := grp.path("grpSpPr", "xfrm")
	if xf == nil {
		return parent
	}
	off, ext := xf.first("off"), xf.first("ext")
	chOff, chExt := xf.first("chOff"), xf.first("chExt")
	if off == nil || ext == nil || chOff == nil || chExt == nil {
		return parent
	}
	cex := atofDefault(chExt.attr("cx"), 0)
	cey := atofDefault(chExt.attr("cy"), 0)
	if cex == 0 || cey == 0 {
		return parent
	}
	rx := atofDefault(ext.attr("cx"), 0) / cex
	ry := atofDefault(ext.attr("cy"), 0) / cey
	bx, by := parent.px(atofDefault(off.attr("x"), 0), atofDefault(off.attr("y"), 0))
	return coordMap{
		kx: parent.kx * rx, ky: parent.ky * ry,
		bx: bx, by: by,
		cx: atofDefault(chOff.attr("x"), 0), cy: atofDefault(chOff.attr("y"), 0),
		fs: parent.fs * math.Sqrt(math.Abs(rx*ry)),
	}
}

// xfrmBox is a resolved position/size/rotation in editor pixels
type xfrmBox struct {
	X, Y, W, H, Rot float64
	FlipH, FlipV    bool
	OK              bool
}

// parseXfrm extracts position/size/rotation/flips from an xfrm block
func parseXfrm(xf *xnode, cm coordMap) xfrmBox {
	if xf == nil {
		return xfrmBox{}
	}
	off, ext := xf.first("off"), xf.first("ext")
	if off == nil || ext == nil {
		return xfrmBox{}
	}
	x, y := cm.px(atofDefault(off.attr("x"), 0), atofDefault(off.attr("y"), 0))
	w, h := cm.size(atofDefault(ext.attr("cx"), 0), atofDefault(ext.attr("cy"), 0))
	b := xfrmBox{X: x, Y: y, W: w, H: h, OK: true}
	if r := xf.attr("rot"); r != "" {
		b.Rot = atofDefault(r, 0) / 60000.0
	}
	b.FlipH = xf.attr("flipH") == "1"
	b.FlipV = xf.attr("flipV") == "1"
	return b
}

/* ---------------- placeholder inheritance ---------------- */

// phKey identifies a placeholder: its type and its index
type phKey struct {
	typ string
	idx string
}

func phOf(node *xnode) (phKey, bool) {
	ph := node.path("nvSpPr", "nvPr", "ph")
	if ph == nil {
		ph = node.path("nvPicPr", "nvPr", "ph")
	}
	if ph == nil {
		ph = node.path("nvGraphicFramePr", "nvPr", "ph")
	}
	if ph == nil {
		return phKey{}, false
	}
	t := ph.attr("type")
	if t == "" {
		t = "body"
	}
	return phKey{typ: t, idx: ph.attr("idx")}, true
}

// findPh looks for the shape carrying a matching placeholder in a layout
// or master. An exact type+index match wins; a type match is next; an
// index match last, which is how PowerPoint pairs body placeholders whose
// type was omitted.
func findPh(root *xnode, want phKey) *xnode {
	spTree := root.path("cSld", "spTree")
	if spTree == nil {
		return nil
	}
	var shapes []*xnode
	spTree.findAll("sp", &shapes)
	var byType, byIdx *xnode
	for _, sp := range shapes {
		got, ok := phOf(sp)
		if !ok {
			continue
		}
		if got.typ == want.typ && got.idx == want.idx {
			return sp
		}
		if byType == nil && phTypeAlike(got.typ, want.typ) {
			byType = sp
		}
		if byIdx == nil && want.idx != "" && got.idx == want.idx {
			byIdx = sp
		}
	}
	if byType != nil {
		return byType
	}
	return byIdx
}

// phTypeAlike treats the title variants as one kind, the way PowerPoint does
func phTypeAlike(a, b string) bool {
	norm := func(s string) string {
		switch s {
		case "ctrTitle":
			return "title"
		case "subTitle":
			return "body"
		}
		return s
	}
	return norm(a) == norm(b)
}

// phChain returns the layout's and master's shape for a placeholder
func (sc *slideCtx) phChain(node *xnode) (layoutSp, masterSp *xnode) {
	key, ok := phOf(node)
	if !ok {
		return nil, nil
	}
	if sc.layout != nil {
		layoutSp = findPh(sc.layout, key)
	}
	if sc.master != nil {
		masterSp = findPh(sc.master, key)
	}
	return layoutSp, masterSp
}

// masterTxStyle picks the master text style block a placeholder kind uses
func (sc *slideCtx) masterTxStyle(key phKey, isPh bool) *xnode {
	ts := sc.master.first("txStyles")
	if ts == nil {
		return nil
	}
	if !isPh {
		return ts.first("otherStyle")
	}
	switch key.typ {
	case "title", "ctrTitle":
		return ts.first("titleStyle")
	case "body", "subTitle", "obj", "":
		return ts.first("bodyStyle")
	}
	return ts.first("otherStyle")
}

// styleChain builds the list of <a:lstStyle>-shaped nodes to fold, lowest
// priority first, for the text inside one shape
func (sc *slideCtx) styleChain(node, layoutSp, masterSp *xnode) []*xnode {
	key, isPh := phOf(node)
	var chain []*xnode
	if !isPh && sc.doc.defTxStyle != nil {
		chain = append(chain, sc.doc.defTxStyle)
	}
	if s := sc.masterTxStyle(key, isPh); s != nil {
		chain = append(chain, s)
	}
	if masterSp != nil {
		if l := masterSp.path("txBody", "lstStyle"); l != nil {
			chain = append(chain, l)
		}
	}
	if layoutSp != nil {
		if l := layoutSp.path("txBody", "lstStyle"); l != nil {
			chain = append(chain, l)
		}
	}
	if l := node.path("txBody", "lstStyle"); l != nil {
		chain = append(chain, l)
	}
	return chain
}

// firstNonNil returns the first node in the list that is not nil
func firstNonNil(nodes ...*xnode) *xnode {
	for _, n := range nodes {
		if n != nil {
			return n
		}
	}
	return nil
}

/* ---------------- body properties ---------------- */

// bodyProps is the resolved <a:bodyPr> of a text body
type bodyProps struct {
	Anchor     string  // t, ctr, b
	LIns       float64 // px
	TIns       float64
	RIns       float64
	BIns       float64
	FontScale  float64 // normAutofit fontScale, 1 when none
	LnSpcScale float64 // 1 - lnSpcReduction
	Wrap       bool
}

// pptx default text insets, in EMU (0.1" left/right, 0.05" top/bottom)
const (
	defaultLIns = 91440
	defaultTIns = 45720
)

func (sc *slideCtx) resolveBodyPr(nodes []*xnode, cm coordMap) bodyProps {
	bp := bodyProps{Anchor: "t", FontScale: 1, LnSpcScale: 1, Wrap: true,
		LIns: defaultLIns, TIns: defaultTIns, RIns: defaultLIns, BIns: defaultTIns}
	for _, n := range nodes {
		if n == nil {
			continue
		}
		if v := n.attr("anchor"); v != "" {
			bp.Anchor = v
		}
		if v := n.attr("lIns"); v != "" {
			bp.LIns = atofDefault(v, defaultLIns)
		}
		if v := n.attr("rIns"); v != "" {
			bp.RIns = atofDefault(v, defaultLIns)
		}
		if v := n.attr("tIns"); v != "" {
			bp.TIns = atofDefault(v, defaultTIns)
		}
		if v := n.attr("bIns"); v != "" {
			bp.BIns = atofDefault(v, defaultTIns)
		}
		if v := n.attr("wrap"); v != "" {
			bp.Wrap = v != "none"
		}
		if na := n.first("normAutofit"); na != nil {
			bp.FontScale = atofDefault(na.attr("fontScale"), 100000) / 100000
			bp.LnSpcScale = 1 - atofDefault(na.attr("lnSpcReduction"), 0)/100000
		}
		if n.first("noAutofit") != nil || n.first("spAutoFit") != nil {
			bp.FontScale = 1
			bp.LnSpcScale = 1
		}
	}
	// EMU -> px, using the horizontal / vertical scale of this space
	bp.LIns *= cm.kx
	bp.RIns *= cm.kx
	bp.TIns *= cm.ky
	bp.BIns *= cm.ky
	return bp
}

func anchorToVAlign(a string) string {
	switch a {
	case "ctr":
		return "middle"
	case "b":
		return "bottom"
	}
	return "top"
}

/* ---------------- text bodies ---------------- */

// textResult is everything a txBody contributes to an object
type textResult struct {
	HTML     string
	Plain    string
	First    runStyle
	Align    string
	Empty    bool
	FontCSS  string
	LineH    float64
	FontSize float64
}

// buildTextBody renders a <p:txBody> into the editor's storage HTML
func (sc *slideCtx) buildTextBody(tx *xnode, chain []*xnode, bp bodyProps, cm coordMap) textResult {
	res := textResult{Empty: true, Align: "left"}
	if tx == nil {
		return res
	}
	scale := bp.FontScale * cm.fs
	var sb strings.Builder
	var plain []string
	autoNum := map[int]int{}
	firstSet := false
	paras := tx.all("p")
	for pi, p := range paras {
		pPr := p.first("pPr")
		lvl := int(atofDefault(pPr.attr("lvl"), 0))
		ps := resolveParaStyle(chain, pPr, lvl, &sc.cc)
		sc.resolveThemeFonts(&ps.DefRun)

		// runs
		var runs strings.Builder
		var lineText strings.Builder
		maxSizePt := 0.0
		minSizePt := 0.0
		var firstRun, lastRun runStyle
		haveRun := false
		for ci := range p.Nodes {
			ch := &p.Nodes[ci]
			switch ch.XMLName.Local {
			case "r", "fld":
				t := ch.first("t")
				if t == nil {
					continue
				}
				rs := ps.DefRun
				applyRPr(&rs, ch.first("rPr"), &sc.cc)
				sc.resolveThemeFonts(&rs)
				maxSizePt, minSizePt = spanSizes(rs.SizePt, maxSizePt, minSizePt)
				if !haveRun {
					firstRun = rs
					haveRun = true
				}
				lastRun = rs
				txt := t.Text
				if ch.XMLName.Local == "fld" &&
					strings.EqualFold(ch.attr("type"), "slidenum") {
					// the stored text is the producer's placeholder glyph
					// ("<#>"); what belongs on the slide is its number
					txt = strconv.Itoa(sc.slideNum)
				}
				if txt == "" {
					continue
				}
				runs.WriteString(`<span style="` + runCSS(rs, scale) + `">` +
					xmlEscape(txt) + `</span>`)
				lineText.WriteString(txt)
			case "br":
				// a break with no properties of its own opens a line as
				// tall as the run before it, not as the box default
				rs := ps.DefRun
				if haveRun {
					rs = lastRun
				}
				applyRPr(&rs, ch.first("rPr"), &sc.cc)
				sc.resolveThemeFonts(&rs)
				maxSizePt, minSizePt = spanSizes(rs.SizePt, maxSizePt, minSizePt)
				runs.WriteString("<br>" + lineSpacerFor(rs, scale))
				lineText.WriteString("\n")
			}
		}
		if !haveRun {
			// an empty paragraph still occupies a line, sized by endParaRPr
			rs := ps.DefRun
			applyRPr(&rs, p.first("endParaRPr"), &sc.cc)
			sc.resolveThemeFonts(&rs)
			firstRun = rs
			maxSizePt, minSizePt = rs.SizePt, rs.SizePt
		}
		if maxSizePt <= 0 {
			maxSizePt = ps.DefRun.SizePt
		}
		if minSizePt <= 0 {
			minSizePt = maxSizePt
		}
		if !firstSet && haveRun {
			res.First = firstRun
			res.Align = algnToCSS(ps.Align)
			res.LineH = lineHeightOf(ps, bp)
			firstSet = true
		}
		if strings.TrimSpace(lineText.String()) != "" {
			res.Empty = false
		}
		plain = append(plain, lineText.String())

		// bullet marker
		bullet := ""
		if ps.BuType == "char" || ps.BuType == "autonum" {
			marker := ps.BuChar
			if ps.BuType == "autonum" {
				autoNum[lvl]++
				start := ps.BuStartAt
				if start < 1 {
					start = 1
				}
				marker = autoNumMarker(ps.BuAutoNum, autoNum[lvl]+start-1)
			}
			if marker != "" {
				bs := firstRun
				if ps.BuSizePt > 0 {
					bs.SizePt = ps.BuSizePt
				} else if ps.BuSizePct > 0 {
					bs.SizePt = firstRun.SizePt * ps.BuSizePct
				}
				if ps.BuColor != "" {
					bs.Color = ps.BuColor
				}
				if ps.BuFont != "" {
					bs.Latin, bs.EastAsian = ps.BuFont, ps.BuFont
				}
				bs.Underline, bs.Strike, bs.Highlight = false, false, ""
				left := (ps.MarLeft + ps.Indent) * cm.kx
				bullet = `<span style="position:absolute;left:` + fmtPx(left) +
					`;` + runCSS(bs, scale) + `">` + xmlEscape(marker) + `</span>`
			}
		} else {
			autoNum = map[int]int{}
		}

		// paragraph box
		var css strings.Builder
		css.WriteString("text-align:" + algnToCSS(ps.Align) + ";")
		css.WriteString("line-height:" + strconv.FormatFloat(round2(lineHeightOf(ps, bp)), 'f', -1, 64) + ";")
		// the block's own font size is a floor under every line box in it,
		// so it has to be the paragraph's *smallest* run - otherwise a
		// small line under a big one inherits the big line's height
		css.WriteString("font-size:" + fmtPx(ptToPx(minSizePt)*scale) + ";")
		if pi > 0 {
			// PowerPoint does not apply space-before to the first paragraph
			if before := spaceOf(ps.SpcBefPt, ps.SpcBefPct, maxSizePt) * scale; before > 0 {
				css.WriteString("margin-top:" + fmtPx(ptToPx(before)) + ";")
			}
		}
		if after := spaceOf(ps.SpcAftPt, ps.SpcAftPct, maxSizePt) * scale; after > 0 {
			css.WriteString("margin-bottom:" + fmtPx(ptToPx(after)) + ";")
		}
		if ps.MarLeft != 0 {
			css.WriteString("padding-left:" + fmtPx(ps.MarLeft*cm.kx) + ";")
		}
		if ps.MarRight != 0 {
			css.WriteString("padding-right:" + fmtPx(ps.MarRight*cm.kx) + ";")
		}
		if bullet != "" {
			css.WriteString("position:relative;")
		} else if ps.Indent != 0 {
			css.WriteString("text-indent:" + fmtPx(ps.Indent*cm.kx) + ";")
		}
		body := runs.String()
		if body == "" {
			// nothing to draw, but the line still takes up its own height
			body = lineSpacerFor(firstRun, scale)
		}
		sb.WriteString(`<div style="` + css.String() + `">` + bullet + body + `</div>`)
	}

	// trailing empty paragraphs add nothing but height the source did have,
	// so they are kept - but a body that is entirely empty renders nothing
	res.HTML = sb.String()
	res.Plain = strings.Join(plain, "\n")
	if !firstSet && len(paras) > 0 {
		ps := resolveParaStyle(chain, paras[0].first("pPr"), 0, &sc.cc)
		sc.resolveThemeFonts(&ps.DefRun)
		res.First = ps.DefRun
		res.Align = algnToCSS(ps.Align)
		res.LineH = lineHeightOf(ps, bp)
	}
	res.FontCSS = fontStackFor(res.First.Latin, res.First.EastAsian)
	res.FontSize = ptToPx(res.First.SizePt) * scale
	return res
}

// resolveThemeFonts expands the +mj-lt / +mn-lt theme font references
func (sc *slideCtx) resolveThemeFonts(rs *runStyle) {
	fix := func(s string) string {
		switch {
		case strings.HasPrefix(s, "+mj"):
			return sc.majorLatin
		case strings.HasPrefix(s, "+mn"):
			return sc.minorLatin
		}
		return s
	}
	rs.Latin = fix(rs.Latin)
	rs.EastAsian = fix(rs.EastAsian)
	for _, n := range []string{rs.Latin, rs.EastAsian} {
		if n != "" {
			sc.doc.usedFonts[strings.ToLower(n)] = true
		}
	}
}

// lineHeightOf converts a paragraph's line spacing into a CSS multiplier
func lineHeightOf(ps paraStyle, bp bodyProps) float64 {
	if ps.LnSpcPt > 0 {
		// exact spacing: express it relative to the paragraph's own size
		size := ps.DefRun.SizePt
		if size <= 0 {
			size = 18
		}
		return ps.LnSpcPt / size * bp.LnSpcScale
	}
	pct := ps.LnSpcPct
	if pct <= 0 {
		pct = 1
	}
	return pct * pptxLineHeightFactor * bp.LnSpcScale
}

// spaceOf resolves a paragraph space to points, given the paragraph's
// largest run size for the percentage form
func spaceOf(pts, pct, sizePt float64) float64 {
	if pts > 0 {
		return pts
	}
	if pct > 0 {
		return pct * sizePt
	}
	return 0
}

func algnToCSS(a string) string {
	switch a {
	case "ctr":
		return "center"
	case "r":
		return "right"
	case "just", "justLow", "dist":
		return "justify"
	}
	return "left"
}

/* ---------------- shapes ---------------- */

// parseSp handles p:sp - a text box or a preset-geometry shape
func (sc *slideCtx) parseSp(node *xnode, cm coordMap) *Object {
	layoutSp, masterSp := sc.phChain(node)

	// geometry: the shape's own, else the placeholder it inherits from
	box := parseXfrm(node.path("spPr", "xfrm"), cm)
	if !box.OK && layoutSp != nil {
		box = parseXfrm(layoutSp.path("spPr", "xfrm"), cm)
	}
	if !box.OK && masterSp != nil {
		box = parseXfrm(masterSp.path("spPr", "xfrm"), cm)
	}
	if !box.OK || box.W <= 0 || box.H <= 0 {
		return nil
	}

	spPr := node.first("spPr")
	prst := ""
	if g := spPr.first("prstGeom"); g != nil {
		prst = g.attr("prst")
	} else if spPr.first("custGeom") == nil {
		// no geometry of its own: a placeholder takes the shape its
		// prototype states, and anything else is a plain rectangle
		for _, src := range []*xnode{layoutSp, masterSp} {
			if g := src.path("spPr", "prstGeom"); g != nil {
				prst = g.attr("prst")
				break
			}
		}
		if prst == "" {
			prst = "rect"
		}
	} else if spPr.first("custGeom") != nil {
		// an unfilled freeform made only of straight segments is a
		// polyline, which the editor draws as a line - that is also how
		// this package writes a bent connector back out
		if obj := sc.freeformLine(node, spPr, box, cm); obj != nil {
			return obj
		}
		prst = "rect"
	}

	fill := sc.cc.fillColorOf(spPr)
	if fill == "" {
		fill = sc.styleRefColor(node, "fillRef")
	}
	stroke, strokeW, dash := sc.lineOf(spPr, cm)
	if stroke == "" {
		if c := sc.styleRefColor(node, "lnRef"); c != "" && c != "none" {
			stroke = c
			if strokeW == 0 {
				strokeW = 1
			}
		}
	}

	// text
	chain := sc.styleChain(node, layoutSp, masterSp)
	bp := sc.resolveBodyPr([]*xnode{
		masterSp.path("txBody", "bodyPr"),
		layoutSp.path("txBody", "bodyPr"),
		node.path("txBody", "bodyPr"),
	}, cm)
	tr := sc.buildTextBody(node.first("txBody"), chain, bp, cm)

	kind, known := prstToShapeKind[prst]
	if !known {
		kind = "rect"
	}
	hasFill := fill != "" && fill != "none"
	hasLine := stroke != "" && stroke != "none" && strokeW > 0
	// a shape is drawn as a shape when it has a visible body; a bare
	// rectangle with only text in it is a text box
	isShape := hasFill || hasLine || (known && kind != "rect") || !known

	pad := []float64{
		round2(bp.TIns), round2(bp.RIns), round2(bp.BIns), round2(bp.LIns),
	}

	if !isShape {
		if tr.HTML == "" {
			return nil
		}
		return &Object{
			Type: "text", X: box.X, Y: box.Y, W: box.W, H: box.H, Rot: box.Rot,
			Props: Props{
				HTML: tr.HTML, FontSize: round2(tr.FontSize), Color: tr.First.Color,
				Align: tr.Align, Bold: tr.First.Bold, Italic: tr.First.Italic,
				Underline: tr.First.Underline, FontFamily: tr.FontCSS,
				VAlign: anchorToVAlign(bp.Anchor), Pad: pad,
				LineHeight: round2(tr.LineH),
			},
		}
	}

	if !hasFill {
		fill = "none"
	}
	if !hasLine {
		stroke, strokeW = "", 0
	}
	return &Object{
		Type: "shape", X: box.X, Y: box.Y, W: box.W, H: box.H, Rot: box.Rot,
		Props: Props{
			Kind: kind, Fill: fill, Stroke: stroke, StrokeW: round2(strokeW),
			Dash: dash, Radius: round2(sc.cornerRadius(spPr, prst, box)),
			HTML: tr.HTML, Text: tr.Plain, TextColor: tr.First.Color,
			FontSize: round2(tr.FontSize), FontFamily: tr.FontCSS,
			Bold: tr.First.Bold, Italic: tr.First.Italic,
			Align: tr.Align, VAlign: anchorToVAlign(bp.Anchor), Pad: pad,
			LineHeight: round2(tr.LineH),
		},
	}
}

// cornerRadius resolves the corner radius of a rounded rectangle, in px
func (sc *slideCtx) cornerRadius(spPr *xnode, prst string, box xfrmBox) float64 {
	if !strings.Contains(strings.ToLower(prst), "round") {
		return 0
	}
	adj := 16667.0 // the DrawingML default for roundRect
	if g := spPr.first("prstGeom"); g != nil {
		if av := g.first("avLst"); av != nil {
			for _, gd := range av.all("gd") {
				if strings.Contains(gd.attr("name"), "adj") {
					if v := strings.TrimPrefix(gd.attr("fmla"), "val "); v != gd.attr("fmla") {
						adj = atofDefault(v, adj)
					}
				}
			}
		}
	}
	return math.Min(box.W, box.H) * adj / 100000
}

// styleRefColor resolves the colour of a <p:style> fillRef / lnRef, which
// is how PowerPoint's shape gallery states a theme fill
func (sc *slideCtx) styleRefColor(node *xnode, ref string) string {
	st := node.first("style")
	if st == nil {
		return ""
	}
	r := st.first(ref)
	if r == nil {
		return ""
	}
	if r.attr("idx") == "0" {
		return "none"
	}
	for i := range r.Nodes {
		if c := sc.cc.resolveColor(&r.Nodes[i]); c != "" {
			return c
		}
	}
	return ""
}

// lineOf resolves an <a:ln> into colour, width (px) and dash
func (sc *slideCtx) lineOf(spPr *xnode, cm coordMap) (string, float64, bool) {
	ln := spPr.first("ln")
	if ln == nil {
		return "", 0, false
	}
	if ln.first("noFill") != nil {
		return "none", 0, false
	}
	color := sc.cc.solidColorOf(ln)
	width := 0.0
	if w := ln.attr("w"); w != "" {
		width = atofDefault(w, 0) * cm.kx
	}
	if color != "" && width == 0 {
		width = 1 // DrawingML's default hairline
	}
	dash := false
	if d := ln.first("prstDash"); d != nil {
		v := d.attr("val")
		dash = v != "" && v != "solid"
	}
	return color, width, dash
}

// parseCxnSp handles p:cxnSp - connectors, drawn as straight lines
func (sc *slideCtx) parseCxnSp(node *xnode, cm coordMap) *Object {
	spPr := node.first("spPr")
	if spPr == nil {
		return nil
	}
	box := parseXfrm(spPr.first("xfrm"), cm)
	if !box.OK {
		return nil
	}
	stroke, strokeW, dash := sc.lineOf(spPr, cm)
	if stroke == "" {
		stroke = sc.styleRefColor(node, "lnRef")
	}
	if stroke == "" || stroke == "none" {
		stroke = "#000000"
	}
	if strokeW <= 0 {
		strokeW = 1
	}
	arrowEnd, arrowStart := false, false
	if ln := spPr.first("ln"); ln != nil {
		if te := ln.first("tailEnd"); te != nil {
			t := te.attr("type")
			arrowEnd = t != "" && t != "none"
		}
		if he := ln.first("headEnd"); he != nil {
			t := he.attr("type")
			arrowStart = t != "" && t != "none"
		}
	}
	prst := ""
	if g := spPr.first("prstGeom"); g != nil {
		prst = g.attr("prst")
	}
	pts := connectorPath(prst, spPr, box)

	// the editor stores a line as a start point plus a vector to the far
	// end; anything with a bend carries the full polyline alongside it
	ox, oy := pts[0][0], pts[0][1]
	last := pts[len(pts)-1]
	props := Props{Stroke: stroke, StrokeW: round2(strokeW), Dash: dash,
		ArrowEnd: arrowEnd, ArrowStart: arrowStart}
	if len(pts) > 2 {
		rel := make([][]float64, len(pts))
		for i, p := range pts {
			rel[i] = []float64{round2(p[0] - ox), round2(p[1] - oy)}
		}
		props.Points = rel
	}
	return &Object{
		Type: "line", X: ox, Y: oy, W: last[0] - ox, H: last[1] - oy,
		Props: props,
	}
}

// connectorPath builds the polyline a connector follows, in absolute
// editor pixels: the preset's own path, mirrored by the flips and turned
// by the shape's rotation about the centre of its bounding box.
func connectorPath(prst string, spPr *xnode, box xfrmBox) [][2]float64 {
	w, h := box.W, box.H
	var local [][2]float64
	switch prst {
	case "bentConnector2":
		local = [][2]float64{{0, 0}, {w, 0}, {w, h}}
	case "bentConnector3", "bentConnector4", "bentConnector5":
		a := 0.5
		if g := spPr.first("prstGeom"); g != nil {
			if av := g.first("avLst"); av != nil {
				for _, gd := range av.all("gd") {
					if gd.attr("name") == "adj1" {
						if v := strings.TrimPrefix(gd.attr("fmla"), "val "); v != gd.attr("fmla") {
							a = atofDefault(v, 50000) / 100000
						}
					}
				}
			}
		}
		local = [][2]float64{{0, 0}, {a * w, 0}, {a * w, h}, {w, h}}
	default:
		local = [][2]float64{{0, 0}, {w, h}}
	}
	if box.FlipH {
		for i := range local {
			local[i][0] = w - local[i][0]
		}
	}
	if box.FlipV {
		for i := range local {
			local[i][1] = h - local[i][1]
		}
	}
	if box.Rot != 0 {
		rad := box.Rot * math.Pi / 180
		cos, sin := math.Cos(rad), math.Sin(rad)
		cx, cy := w/2, h/2
		for i := range local {
			dx, dy := local[i][0]-cx, local[i][1]-cy
			local[i][0] = cx + dx*cos - dy*sin
			local[i][1] = cy + dx*sin + dy*cos
		}
	}
	out := make([][2]float64, len(local))
	for i := range local {
		out[i] = [2]float64{round2(box.X + local[i][0]), round2(box.Y + local[i][1])}
	}
	return out
}

// parsePic handles p:pic - embedded pictures become data URLs
func (sc *slideCtx) parsePic(node *xnode, cm coordMap) *Object {
	spPr := node.first("spPr")
	if spPr == nil {
		return nil
	}
	box := parseXfrm(spPr.first("xfrm"), cm)
	if !box.OK {
		if layoutSp, masterSp := sc.phChain(node); layoutSp != nil || masterSp != nil {
			box = parseXfrm(firstNonNil(layoutSp, masterSp).path("spPr", "xfrm"), cm)
		}
	}
	if !box.OK || box.W <= 0 || box.H <= 0 {
		return nil
	}
	blipFill := node.first("blipFill")
	blip := blipFill.first("blip")
	if blip == nil {
		return nil
	}
	rid := blip.attrNS("relationships", "embed")
	if rid == "" {
		for _, a := range blip.Attrs {
			if a.Name.Local == "embed" {
				rid = a.Value
			}
		}
	}
	target, ok := sc.partRels()[rid]
	if !ok {
		return nil
	}
	mediaPath := resolvePartPath(sc.partDir(), target)
	data, ok := sc.doc.files[mediaPath]
	if !ok {
		return nil
	}
	ext := strings.TrimPrefix(strings.ToLower(path.Ext(mediaPath)), ".")

	props := Props{Src: encodeDataURL(data, ext), Fit: "fill"}
	// srcRect crops the source before it is stretched into the frame
	if sr := blipFill.first("srcRect"); sr != nil {
		l := atofDefault(sr.attr("l"), 0) / 100000
		t := atofDefault(sr.attr("t"), 0) / 100000
		r := atofDefault(sr.attr("r"), 0) / 100000
		b := atofDefault(sr.attr("b"), 0) / 100000
		if l != 0 || t != 0 || r != 0 || b != 0 {
			props.Crop = []float64{round4(l), round4(t), round4(r), round4(b)}
		}
	}
	if blipFill.first("stretch") == nil && blipFill.first("tile") == nil {
		// a blipFill with neither is still stretched by PowerPoint
		props.Fit = "fill"
	}
	prst := ""
	if g := spPr.first("prstGeom"); g != nil {
		prst = g.attr("prst")
	}
	// a picture drawn through a preset geometry is a shaped crop
	if kind, ok := prstToShapeKind[prst]; ok && kind != "rect" {
		props.Mask = kind
	}
	if rad := sc.cornerRadius(spPr, prst, box); rad > 0 {
		props.Radius = round2(rad)
	}
	if am := blip.first("alphaModFix"); am != nil {
		if v := am.attr("amt"); v != "" {
			if o := clamp01(atofDefault(v, 100000) / 100000); o < 1 {
				props.Opacity = round2(o)
			}
		}
	}
	return &Object{
		Type: "image", X: box.X, Y: box.Y, W: box.W, H: box.H, Rot: box.Rot,
		Props: props,
	}
}

func round4(v float64) float64 {
	return float64(int64(v*10000+copySign(0.5, v))) / 10000
}

/* ---------------- tables ---------------- */

// parseGraphicFrame handles p:graphicFrame - tables (charts are skipped)
func (sc *slideCtx) parseGraphicFrame(node *xnode, cm coordMap) *Object {
	box := parseXfrm(node.first("xfrm"), cm)
	if !box.OK || box.W <= 0 || box.H <= 0 {
		return nil
	}
	gdata := node.path("graphic", "graphicData")
	tbl := gdata.first("tbl")
	if tbl == nil {
		// the other graphicData the editor can model is a chart
		return sc.parseChartFrame(gdata, box)
	}
	headerRow := false
	if tp := tbl.first("tblPr"); tp != nil {
		headerRow = tp.attr("firstRow") == "1"
	}
	// column proportions from the grid definition
	var colW []float64
	var totalW float64
	if grid := tbl.first("tblGrid"); grid != nil {
		var ws []float64
		for _, gc := range grid.all("gridCol") {
			v := atofDefault(gc.attr("w"), 0)
			ws = append(ws, v)
			totalW += v
		}
		if totalW > 0 && len(ws) > 1 {
			for _, v := range ws {
				colW = append(colW, round2(v/totalW*100.0))
			}
		}
	}
	trs := tbl.all("tr")
	var rowH []float64
	var totalH float64
	for _, tr := range trs {
		totalH += atofDefault(tr.attr("h"), 0)
	}
	// a table sizes itself from its own grid, not from the frame's ext -
	// Google Slides writes a fixed dummy ext there and PowerPoint ignores it
	if totalW > 0 {
		box.W, _ = cm.size(totalW, 0)
	}
	if totalH > 0 {
		_, box.H = cm.size(0, totalH)
	}

	// table text has no placeholder of its own; it falls back to the
	// master's "other" style, which is where a deck states its table size
	var chain []*xnode
	if ts := sc.master.path("txStyles", "otherStyle"); ts != nil {
		chain = append(chain, ts)
	}
	var rows [][]string
	var cellFill [][]string
	var cellPad []float64
	fontSize := 0.0
	color := ""
	for _, tr := range trs {
		if totalH > 0 {
			rowH = append(rowH, round2(atofDefault(tr.attr("h"), 0)/totalH*100.0))
		}
		var row, fills []string
		for _, tc := range tr.all("tc") {
			tcPr := tc.first("tcPr")
			fill := ""
			if c := sc.cc.fillColorOf(tcPr); c != "" && c != "none" {
				fill = c
			}
			fills = append(fills, fill)
			if cellPad == nil && tcPr != nil {
				cellPad = []float64{
					round2(atofDefault(tcPr.attr("marT"), 45720) * cm.ky),
					round2(atofDefault(tcPr.attr("marR"), 91440) * cm.kx),
					round2(atofDefault(tcPr.attr("marB"), 45720) * cm.ky),
					round2(atofDefault(tcPr.attr("marL"), 91440) * cm.kx),
				}
			}
			if tc.attr("hMerge") == "1" || tc.attr("vMerge") == "1" {
				// continuation of a merged cell - the editor has no merge
				// model for tables, so it becomes an empty cell
				row = append(row, "")
				continue
			}
			bp := sc.resolveBodyPr([]*xnode{tc.path("txBody", "bodyPr")}, cm)
			bp.LIns, bp.RIns, bp.TIns, bp.BIns = 0, 0, 0, 0
			res := sc.buildTextBody(tc.first("txBody"), chain, bp, cm)
			if fontSize == 0 && res.FontSize > 0 {
				fontSize = res.FontSize
			}
			if color == "" {
				color = res.First.Color
			}
			row = append(row, res.HTML)
		}
		if len(row) > 0 {
			rows = append(rows, row)
			cellFill = append(cellFill, fills)
		}
	}
	if len(rows) == 0 {
		return nil
	}
	if fontSize <= 0 {
		fontSize = 16
	}
	if !anyFilled(cellFill) {
		cellFill = nil
	}
	return &Object{
		Type: "table", X: box.X, Y: box.Y, W: box.W, H: box.H,
		Props: Props{Rows: rows, HeaderRow: headerRow, FontSize: round2(fontSize),
			Color: color, ColW: colW, RowH: rowH,
			CellFill: cellFill, CellPad: cellPad},
	}
}

// anyFilled reports whether a cell-fill grid states at least one colour
func anyFilled(grid [][]string) bool {
	for _, row := range grid {
		for _, c := range row {
			if c != "" {
				return true
			}
		}
	}
	return false
}

/* ---------------- notes ---------------- */

// extractNotes pulls the body text of the linked notesSlide part, if any.
// The slide-number and date placeholders that ride along in the same part
// are skipped - they are chrome, not the speaker's notes.
func (sc *slideCtx) extractNotes() string {
	notesPath := relTarget(sc.rels, sc.baseDir, "notesSlide", sc.doc.files)
	if notesPath == "" {
		return ""
	}
	tree := sc.doc.tree(notesPath)
	if tree == nil {
		return ""
	}
	spTree := tree.path("cSld", "spTree")
	if spTree == nil {
		return ""
	}
	var shapes []*xnode
	spTree.findAll("sp", &shapes)
	var lines []string
	for _, sp := range shapes {
		key, isPh := phOf(sp)
		if isPh && key.typ != "body" {
			continue
		}
		tx := sp.first("txBody")
		if tx == nil {
			continue
		}
		for _, p := range tx.all("p") {
			var parts []string
			for i := range p.Nodes {
				ch := &p.Nodes[i]
				if ch.XMLName.Local == "r" || ch.XMLName.Local == "fld" {
					if t := ch.first("t"); t != nil {
						parts = append(parts, t.Text)
					}
				} else if ch.XMLName.Local == "br" {
					parts = append(parts, "\n")
				}
			}
			lines = append(lines, strings.Join(parts, ""))
		}
	}
	for len(lines) > 0 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	return strings.Join(lines, "\n")
}

// partRels / partDir name the relationship scope of the part being walked,
// falling back to the slide's own when nothing else is in scope
func (sc *slideCtx) partRels() map[string]string {
	if sc.curRels != nil {
		return sc.curRels
	}
	return sc.rels
}

func (sc *slideCtx) partDir() string {
	if sc.curDir != "" {
		return sc.curDir
	}
	return sc.baseDir
}

// freeformLine turns an unfilled custGeom of straight segments into a line
// object with its polyline. Returns nil when the shape is anything else.
func (sc *slideCtx) freeformLine(node, spPr *xnode, box xfrmBox, cm coordMap) *Object {
	if c := sc.cc.fillColorOf(spPr); c != "" && c != "none" {
		return nil
	}
	stroke, strokeW, dash := sc.lineOf(spPr, cm)
	if stroke == "" || stroke == "none" {
		return nil
	}
	pathLst := spPr.path("custGeom", "pathLst")
	if pathLst == nil {
		return nil
	}
	paths := pathLst.all("path")
	if len(paths) != 1 {
		return nil
	}
	path := paths[0]
	pw := atofDefault(path.attr("w"), 0)
	ph := atofDefault(path.attr("h"), 0)
	if pw <= 0 || ph <= 0 {
		return nil
	}
	var pts [][]float64
	for i := range path.Nodes {
		seg := &path.Nodes[i]
		switch seg.XMLName.Local {
		case "moveTo", "lnTo":
			pt := seg.first("pt")
			if pt == nil {
				return nil
			}
			// path coordinates are relative to the path box, which maps
			// onto the shape's own extent
			pts = append(pts, []float64{
				round2(atofDefault(pt.attr("x"), 0) / pw * box.W),
				round2(atofDefault(pt.attr("y"), 0) / ph * box.H),
			})
		case "close", "cubicBezTo", "quadBezTo", "arcTo":
			return nil
		}
	}
	if len(pts) < 2 {
		return nil
	}
	arrowEnd, arrowStart := false, false
	if ln := spPr.first("ln"); ln != nil {
		if te := ln.first("tailEnd"); te != nil {
			arrowEnd = te.attr("type") != "" && te.attr("type") != "none"
		}
		if he := ln.first("headEnd"); he != nil {
			arrowStart = he.attr("type") != "" && he.attr("type") != "none"
		}
	}
	// the editor's line origin is the first point, so the polyline it
	// carries is relative to that
	ox, oy := pts[0][0], pts[0][1]
	for i := range pts {
		pts[i][0] = round2(pts[i][0] - ox)
		pts[i][1] = round2(pts[i][1] - oy)
	}
	last := pts[len(pts)-1]
	props := Props{Stroke: stroke, StrokeW: round2(strokeW), Dash: dash,
		ArrowEnd: arrowEnd, ArrowStart: arrowStart}
	if len(pts) > 2 {
		props.Points = pts
	}
	return &Object{
		Type: "line",
		X:    box.X + ox, Y: box.Y + oy,
		W: last[0], H: last[1],
		Props: props,
	}
}

// parseChartFrame resolves a graphicFrame that holds a DrawingML chart
func (sc *slideCtx) parseChartFrame(gdata *xnode, box xfrmBox) *Object {
	ref := gdata.first("chart")
	if ref == nil {
		return nil
	}
	rid := ref.attrNS("relationships", "id")
	if rid == "" {
		rid = ref.attr("id")
	}
	target, ok := sc.partRels()[rid]
	if !ok {
		return nil
	}
	tree := sc.doc.tree(resolvePartPath(sc.partDir(), target))
	if tree == nil {
		return nil
	}
	spec := sc.parseChartSpec(tree)
	if spec == nil {
		return nil
	}
	return &Object{
		Type: "chart", X: box.X, Y: box.Y, W: box.W, H: box.H,
		Props: Props{Spec: chartSpecJSON(spec)},
	}
}
