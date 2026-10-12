package pptx

/*
	reader.go - Parse a PowerPoint (.pptx) file into a Presentation.

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
	  - group shapes, with the child coordinate transform (which sizes the
	    children but never their type)
	  - picture cropping (srcRect) and rounded picture frames
	  - backgrounds of every kind, gradient and translucent fills, picture
	    fills (fill.go), table styles and merged cells (table.go),
	    custom geometry (custgeom.go), SmartArt (from the drawing
	    PowerPoint stores with it) and simple inline Office math

	Everything is scaled from the source slide size into the coordinate
	space of the Slides editor: 960 px wide and as tall as the deck's shape
	(540 for 16:9, 720 for 4:3), so the scale is the same both ways.
	Anything the editor cannot model - 3D effects, animations - is skipped
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

	"imuslab.com/arozos/mod/office/internal/fonts"
	"imuslab.com/arozos/mod/office/internal/media"
	"imuslab.com/arozos/mod/office/internal/units"
	"imuslab.com/arozos/mod/office/internal/xmltree"
	"imuslab.com/arozos/mod/office/metafile"
	"imuslab.com/arozos/mod/office/model"
)

// prstToShapeKind maps a PresentationML preset geometry onto the shape the
// editor draws for it. The editor's catalogue
// (web/Office/slides/slides_shapes.js) uses these very names, so most of
// this table is an identity - it exists to say which presets are covered,
// and to send the ones that are not to the nearest outline that is. Keep
// it in step with that file.
var prstToShapeKind = map[string]string{
	// drawn as themselves
	"rect":                       "rect",
	"roundRect":                  "roundRect",
	"snip1Rect":                  "snip1Rect",
	"snip2SameRect":              "snip2SameRect",
	"snip2DiagRect":              "snip2DiagRect",
	"round1Rect":                 "round1Rect",
	"round2SameRect":             "round2SameRect",
	"round2DiagRect":             "round2DiagRect",
	"ellipse":                    "ellipse",
	"triangle":                   "triangle",
	"rtTriangle":                 "rtTriangle",
	"parallelogram":              "parallelogram",
	"trapezoid":                  "trapezoid",
	"diamond":                    "diamond",
	"pentagon":                   "pentagon",
	"hexagon":                    "hexagon",
	"heptagon":                   "heptagon",
	"octagon":                    "octagon",
	"decagon":                    "decagon",
	"dodecagon":                  "dodecagon",
	"plus":                       "plus",
	"teardrop":                   "teardrop",
	"frame":                      "frame",
	"halfFrame":                  "halfFrame",
	"corner":                     "corner",
	"diagStripe":                 "diagStripe",
	"plaque":                     "plaque",
	"can":                        "can",
	"cube":                       "cube",
	"bevel":                      "bevel",
	"donut":                      "donut",
	"noSmoking":                  "noSmoking",
	"blockArc":                   "blockArc",
	"foldedCorner":               "foldedCorner",
	"smileyFace":                 "smileyFace",
	"heart":                      "heart",
	"lightningBolt":              "lightningBolt",
	"sun":                        "sun",
	"moon":                       "moon",
	"cloud":                      "cloud",
	"arc":                        "arc",
	"chord":                      "chord",
	"pie":                        "pie",
	"flowChartProcess":           "flowChartProcess",
	"flowChartAlternateProcess":  "flowChartAlternateProcess",
	"flowChartDecision":          "flowChartDecision",
	"flowChartInputOutput":       "flowChartInputOutput",
	"flowChartPredefinedProcess": "flowChartPredefinedProcess",
	"flowChartInternalStorage":   "flowChartInternalStorage",
	"flowChartDocument":          "flowChartDocument",
	"flowChartMultidocument":     "flowChartMultidocument",
	"flowChartTerminator":        "flowChartTerminator",
	"flowChartPreparation":       "flowChartPreparation",
	"flowChartManualInput":       "flowChartManualInput",
	"flowChartManualOperation":   "flowChartManualOperation",
	"flowChartConnector":         "flowChartConnector",
	"flowChartOffpageConnector":  "flowChartOffpageConnector",
	"flowChartPunchedCard":       "flowChartPunchedCard",
	"flowChartPunchedTape":       "flowChartPunchedTape",
	"flowChartSummingJunction":   "flowChartSummingJunction",
	"flowChartOr":                "flowChartOr",
	"flowChartCollate":           "flowChartCollate",
	"flowChartSort":              "flowChartSort",
	"flowChartExtract":           "flowChartExtract",
	"flowChartMerge":             "flowChartMerge",
	"flowChartDelay":             "flowChartDelay",
	"flowChartMagneticDisk":      "flowChartMagneticDisk",
	"flowChartDisplay":           "flowChartDisplay",
	"rightArrow":                 "rightArrow",
	"leftArrow":                  "leftArrow",
	"upArrow":                    "upArrow",
	"downArrow":                  "downArrow",
	"leftRightArrow":             "leftRightArrow",
	"upDownArrow":                "upDownArrow",
	"quadArrow":                  "quadArrow",
	"leftRightUpArrow":           "leftRightUpArrow",
	"bentArrow":                  "bentArrow",
	"uturnArrow":                 "uturnArrow",
	"leftUpArrow":                "leftUpArrow",
	"bentUpArrow":                "bentUpArrow",
	"stripedRightArrow":          "stripedRightArrow",
	"notchedRightArrow":          "notchedRightArrow",
	"chevron":                    "chevron",
	"homePlate":                  "homePlate",
	"curvedRightArrow":           "curvedRightArrow",
	"curvedLeftArrow":            "curvedLeftArrow",
	"curvedUpArrow":              "curvedUpArrow",
	"curvedDownArrow":            "curvedDownArrow",
	"circularArrow":              "circularArrow",
	"rightArrowCallout":          "rightArrowCallout",
	"leftArrowCallout":           "leftArrowCallout",
	"upArrowCallout":             "upArrowCallout",
	"downArrowCallout":           "downArrowCallout",
	"leftRightArrowCallout":      "leftRightArrowCallout",
	"star4":                      "star4",
	"star5":                      "star5",
	"star6":                      "star6",
	"star7":                      "star7",
	"star8":                      "star8",
	"star10":                     "star10",
	"star12":                     "star12",
	"star16":                     "star16",
	"star24":                     "star24",
	"star32":                     "star32",
	"irregularSeal1":             "irregularSeal1",
	"irregularSeal2":             "irregularSeal2",
	"ribbon":                     "ribbon",
	"ribbon2":                    "ribbon2",
	"wave":                       "wave",
	"doubleWave":                 "doubleWave",
	"verticalScroll":             "verticalScroll",
	"horizontalScroll":           "horizontalScroll",
	"wedgeRectCallout":           "wedgeRectCallout",
	"wedgeRoundRectCallout":      "wedgeRoundRectCallout",
	"wedgeEllipseCallout":        "wedgeEllipseCallout",
	"cloudCallout":               "cloudCallout",
	"mathPlus":                   "mathPlus",
	"mathMinus":                  "mathMinus",
	"mathMultiply":               "mathMultiply",
	"mathDivide":                 "mathDivide",
	"mathEqual":                  "mathEqual",
	"mathNotEqual":               "mathNotEqual",
	"leftBracket":                "leftBracket",
	"rightBracket":               "rightBracket",
	"bracketPair":                "bracketPair",
	"rightBrace":                 "rightBrace",
	"leftBrace":                  "leftBrace",
	"bracePair":                  "bracePair",

	// not drawn, so sent to the nearest outline that is
	"snipRoundRect":                    "roundRect",
	"plaque2":                          "plaque",
	"flowChartMagneticTape":            "flowChartConnector",
	"flowChartMagneticDrum":            "can",
	"flowChartOnlineStorage":           "flowChartDelay",
	"flowChartSequentialAccessStorage": "flowChartConnector",
	"flowChartOfflineStorage":          "flowChartExtract",
	"mathMinus2":                       "mathMinus",
	"bentConnector2":                   "rect",
	"callout1":                         "wedgeRectCallout",
	"callout2":                         "wedgeRectCallout",
	"callout3":                         "wedgeRectCallout",
	"accentCallout1":                   "wedgeRectCallout",
	"borderCallout1":                   "wedgeRectCallout",
	"borderCallout2":                   "wedgeRectCallout",
	"borderCallout3":                   "wedgeRectCallout",
	"swooshArrow":                      "curvedRightArrow",
	"stripedRightArrow2":               "stripedRightArrow",
	"circularArrow2":                   "circularArrow",
	"leftCircularArrow":                "circularArrow",
	"leftRightCircularArrow":           "circularArrow",
	"upDownArrowCallout":               "upArrowCallout",
	"quadArrowCallout":                 "quadArrow",
	"curvedConnector2":                 "rect",
	"gear6":                            "sun",
	"gear9":                            "sun",
	"funnel":                           "trapezoid",
	"pieWedge":                         "pie",
	"chartPlus":                        "mathPlus",
	"chartStar":                        "star4",
	"chartX":                           "mathMultiply",
	"triangleRight":                    "rtTriangle",
	"halfFrame2":                       "halfFrame",
}

// pptxDoc is the whole package plus everything shared across slides
type pptxDoc struct {
	files      map[string][]byte
	pres       *xmltree.Node
	presRels   map[string]string
	defTxStyle *xmltree.Node
	sx, sy     float64 // source EMU -> editor px scale
	// the editor size of a slide, px
	slideW, slideH float64
	// parsed part cache, keyed by part path
	trees map[string]*xmltree.Node
	rels  map[string]map[string]string
	// typefaces some run actually asks for, lower-cased - only these are
	// worth pulling out of the embedded font list
	usedFonts map[string]bool
	// slide part path -> 1-based position, for "go to slide" links
	slideIndex map[string]int
}

// slideCtx is the resolution context of one slide: its layout, master,
// theme colours and colour map
type slideCtx struct {
	doc        *pptxDoc
	baseDir    string
	rels       map[string]string
	layout     *xmltree.Node
	layoutDir  string
	layoutRels map[string]string
	master     *xmltree.Node
	masterDir  string
	masterRels map[string]string
	cc         colorCtx
	majorLatin string
	minorLatin string
	fmtScheme  *xmltree.Node
	// the theme's relationships: a background style's picture is one of
	// the theme's parts
	themeRels map[string]string
	themeDir  string
	slideNum  int
	// the part whose shapes are being walked right now - a layout's or
	// master's picture resolves through that part's own rels, not the
	// slide's
	curRels map[string]string
	curDir  string
}

// walkPart walks one part's shape tree with that part's relationships in
// scope, then restores the previous scope
func (sc *slideCtx) walkPart(tree *xmltree.Node, rels map[string]string, dir string, slide *model.Slide, z *int, phOnly bool) {
	spTree := tree.Path("cSld", "spTree")
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

// Parse converts raw .pptx bytes into a Presentation
func Parse(data []byte) (*model.Presentation, error) {
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
	pres, err := xmltree.Parse(presXML)
	if err != nil {
		return nil, errors.New("cannot parse presentation.xml: " + err.Error())
	}

	doc := &pptxDoc{
		files: files, pres: pres, sx: 1, sy: 1,
		trees:     map[string]*xmltree.Node{},
		rels:      map[string]map[string]string{},
		usedFonts: map[string]bool{},
	}
	doc.presRels = doc.relsFor("ppt/presentation.xml")
	doc.defTxStyle = pres.First("defaultTextStyle")

	// source slide size -> the editor's: 960 wide, the deck's own shape
	pw, ph := model.SlidePxW, model.SlidePxH
	if sz := pres.First("sldSz"); sz != nil {
		cx := units.AtofDefault(sz.Attr("cx"), 0)
		cy := units.AtofDefault(sz.Attr("cy"), 0)
		if cx > 0 && cy > 0 {
			pw, ph = model.SlideSizeFor(cx, cy)
			doc.sx = float64(pw) / (cx / units.EmuPerPx)
			doc.sy = float64(ph) / (cy / units.EmuPerPx)
		}
	}
	doc.slideW, doc.slideH = float64(pw), float64(ph)

	slidePaths := doc.slideOrder()
	if len(slidePaths) == 0 {
		return nil, errors.New("pptx contains no slides")
	}
	doc.slideIndex = map[string]int{}
	for i, sp := range slidePaths {
		doc.slideIndex[sp] = i + 1
	}

	out := &model.Presentation{
		Size:   []int{pw, ph},
		Theme:  "clean",
		Slides: []*model.Slide{},
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
		slide.Transition = transitionOf(tree)
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
func (d *pptxDoc) tree(part string) *xmltree.Node {
	if t, ok := d.trees[part]; ok {
		return t
	}
	raw, ok := d.files[part]
	if !ok {
		d.trees[part] = nil
		return nil
	}
	t, err := xmltree.Parse(raw)
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
		if tree, err := xmltree.Parse(raw); err == nil {
			for _, rel := range tree.All("Relationship") {
				out[rel.Attr("Id")] = rel.Attr("Target")
			}
		}
	}
	d.rels[part] = out
	return out
}

// slideOrder resolves sldIdLst into slide part paths
func (d *pptxDoc) slideOrder() []string {
	var out []string
	if lst := d.pres.First("sldIdLst"); lst != nil {
		for _, sid := range lst.All("sldId") {
			rid := sid.AttrNS("relationships", "id")
			if rid == "" {
				// some producers write r:id without a resolvable namespace
				for _, a := range sid.Attrs {
					if a.Name.Local == "id" && strings.HasPrefix(a.Value, "rId") {
						rid = a.Value
					}
				}
			}
			if target, ok := d.presRels[rid]; ok {
				out = append(out, xmltree.ResolvePart("ppt", target))
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

// relTarget finds the first relationship whose type ends with the given
// suffix and returns the part path it points at
func relTarget(rels map[string]string, baseDir, typeSuffix string, files map[string][]byte) string {
	for _, target := range rels {
		if strings.Contains(target, typeSuffix) {
			p := xmltree.ResolvePart(baseDir, target)
			if _, ok := files[p]; ok {
				return p
			}
		}
	}
	return ""
}

// slideContext resolves a slide's layout, master, theme and colour map
func (d *pptxDoc) slideContext(slidePath string, slide *xmltree.Node) *slideCtx {
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
	var theme *xmltree.Node
	if sc.masterRels != nil {
		if tp := relTarget(sc.masterRels, sc.masterDir, "theme", d.files); tp != "" {
			theme = d.tree(tp)
			sc.themeRels = d.relsFor(tp)
			sc.themeDir = path.Dir(tp)
		}
	}
	sc.cc.scheme = map[string]string{}
	if theme != nil {
		if cs := theme.Path("themeElements", "clrScheme"); cs != nil {
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
		if fs := theme.Path("themeElements", "fontScheme"); fs != nil {
			if l := fs.Path("majorFont", "latin"); l != nil {
				sc.majorLatin = l.Attr("typeface")
			}
			if l := fs.Path("minorFont", "latin"); l != nil {
				sc.minorLatin = l.Attr("typeface")
			}
		}
		sc.fmtScheme = theme.Path("themeElements", "fmtScheme")
	}
	// colour map: the master's, optionally overridden per slide
	sc.cc.clrMap = map[string]string{}
	if cm := sc.master.First("clrMap"); cm != nil {
		for _, a := range cm.Attrs {
			sc.cc.clrMap[a.Name.Local] = a.Value
		}
	}
	if ovr := slide.Path("clrMapOvr", "overrideClrMapping"); ovr != nil {
		for _, a := range ovr.Attrs {
			sc.cc.clrMap[a.Name.Local] = a.Value
		}
	}
	return sc
}

/* ---------------- slide parsing ---------------- */

func (sc *slideCtx) rootMap() coordMap {
	return coordMap{
		kx: sc.doc.sx / units.EmuPerPx, ky: sc.doc.sy / units.EmuPerPx,
		fs: math.Sqrt(sc.doc.sx * sc.doc.sy),
	}
}

// parseSlide converts one slide part into the editor model
func (sc *slideCtx) parseSlide(tree *xmltree.Node) *model.Slide {
	slide := &model.Slide{Objects: []*model.Object{}}
	slide.Bg, slide.BgImage, slide.BgGrad = sc.slideBackground(tree)

	z := 0
	// PowerPoint paints a slide on top of its layout, and the layout on
	// top of its master. Only the decoration is inherited - a placeholder
	// on a layout or master is a prototype, not something that is drawn.
	if tree.Attr("showMasterSp") != "0" {
		if sc.master != nil && sc.layout.Attr("showMasterSp") != "0" {
			sc.walkPart(sc.master, sc.masterRels, sc.masterDir, slide, &z, true)
		}
		if sc.layout != nil {
			sc.walkPart(sc.layout, sc.layoutRels, sc.layoutDir, slide, &z, true)
		}
	}
	sc.walkPart(tree, sc.rels, sc.baseDir, slide, &z, false)
	return slide
}

// walkShapes appends every drawable descendant of a shape tree, recursing
// into group shapes with the transform their child space implies
func (sc *slideCtx) walkShapes(spTree *xmltree.Node, cm coordMap, slide *model.Slide, z *int, skipPh bool) {
	for i := range spTree.Nodes {
		node := &spTree.Nodes[i]
		if skipPh {
			if _, isPh := phOf(node); isPh {
				continue
			}
		}
		switch node.XMLName.Local {
		case "sp":
			sc.addObject(slide, sc.withLink(node, sc.parseSp(node, cm)), z)
		case "cxnSp":
			sc.addObject(slide, sc.withLink(node, sc.parseCxnSp(node, cm)), z)
		case "pic":
			sc.addObject(slide, sc.withLink(node, sc.parsePic(node, cm)), z)
		case "graphicFrame":
			if sc.walkDiagram(node, cm, slide, z) {
				continue
			}
			sc.addObject(slide, sc.withLink(node, sc.parseGraphicFrame(node, cm)), z)
		case "grpSp":
			sc.walkShapes(node, groupMap(node, cm), slide, z, false)
		case "AlternateContent":
			// mc:AlternateContent wraps a preferred and a fallback rendering.
			// The Fallback branch is plain DrawingML - for Office math it is
			// a picture of the whole text box - so it is the safe one, except
			// where the Choice is ordinary text with simple inline math in
			// it (a "≥" set as an equation), which stays editable text
			ch := node.First("Choice")
			if ch != nil && choiceReadable(ch) {
				sc.walkShapes(ch, cm, slide, z, skipPh)
			} else if fb := node.First("Fallback"); fb != nil {
				sc.walkShapes(fb, cm, slide, z, skipPh)
			} else if ch != nil {
				sc.walkShapes(ch, cm, slide, z, skipPh)
			}
		}
	}
}

func (sc *slideCtx) addObject(slide *model.Slide, obj *model.Object, z *int) {
	if obj == nil {
		return
	}
	*z++
	obj.ID = fmt.Sprintf("o-import%d", *z)
	obj.Z = *z
	slide.Objects = append(slide.Objects, obj)
}

// groupMap builds the coordinate map of a group's children
func groupMap(grp *xmltree.Node, parent coordMap) coordMap {
	xf := grp.Path("grpSpPr", "xfrm")
	if xf == nil {
		return parent
	}
	off, ext := xf.First("off"), xf.First("ext")
	chOff, chExt := xf.First("chOff"), xf.First("chExt")
	if off == nil || ext == nil || chOff == nil || chExt == nil {
		return parent
	}
	cex := units.AtofDefault(chExt.Attr("cx"), 0)
	cey := units.AtofDefault(chExt.Attr("cy"), 0)
	if cex == 0 || cey == 0 {
		return parent
	}
	rx := units.AtofDefault(ext.Attr("cx"), 0) / cex
	ry := units.AtofDefault(ext.Attr("cy"), 0) / cey
	bx, by := parent.px(units.AtofDefault(off.Attr("x"), 0), units.AtofDefault(off.Attr("y"), 0))
	// a group's scale moves and sizes its children but not their type:
	// PowerPoint draws a run at the size it states however the group is
	// stretched (its own PDF of a group at 75% keeps 33 pt titles 33 pt)
	return coordMap{
		kx: parent.kx * rx, ky: parent.ky * ry,
		bx: bx, by: by,
		cx: units.AtofDefault(chOff.Attr("x"), 0), cy: units.AtofDefault(chOff.Attr("y"), 0),
		fs: parent.fs,
	}
}

// xfrmBox is a resolved position/size/rotation in editor pixels
type xfrmBox struct {
	X, Y, W, H, Rot float64
	FlipH, FlipV    bool
	OK              bool
}

// parseXfrm extracts position/size/rotation/flips from an xfrm block
func parseXfrm(xf *xmltree.Node, cm coordMap) xfrmBox {
	if xf == nil {
		return xfrmBox{}
	}
	off, ext := xf.First("off"), xf.First("ext")
	if off == nil || ext == nil {
		return xfrmBox{}
	}
	x, y := cm.px(units.AtofDefault(off.Attr("x"), 0), units.AtofDefault(off.Attr("y"), 0))
	w, h := cm.size(units.AtofDefault(ext.Attr("cx"), 0), units.AtofDefault(ext.Attr("cy"), 0))
	b := xfrmBox{X: x, Y: y, W: w, H: h, OK: true}
	if r := xf.Attr("rot"); r != "" {
		b.Rot = units.AtofDefault(r, 0) / 60000.0
	}
	b.FlipH = xf.Attr("flipH") == "1"
	b.FlipV = xf.Attr("flipV") == "1"
	return b
}

/* ---------------- placeholder inheritance ---------------- */

// phKey identifies a placeholder: its type and its index
type phKey struct {
	typ string
	idx string
}

func phOf(node *xmltree.Node) (phKey, bool) {
	ph := node.Path("nvSpPr", "nvPr", "ph")
	if ph == nil {
		ph = node.Path("nvPicPr", "nvPr", "ph")
	}
	if ph == nil {
		ph = node.Path("nvGraphicFramePr", "nvPr", "ph")
	}
	if ph == nil {
		return phKey{}, false
	}
	t := ph.Attr("type")
	if t == "" {
		t = "body"
	}
	return phKey{typ: t, idx: ph.Attr("idx")}, true
}

// findPh looks for the shape carrying a matching placeholder in a layout
// or master. An exact type+index match wins; a type match is next; an
// index match last, which is how PowerPoint pairs body placeholders whose
// type was omitted.
func findPh(root *xmltree.Node, want phKey) *xmltree.Node {
	spTree := root.Path("cSld", "spTree")
	if spTree == nil {
		return nil
	}
	var shapes []*xmltree.Node
	spTree.FindAll("sp", &shapes)
	var byType, byIdx *xmltree.Node
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

// phRole is what a text placeholder is for, in the editor's terms (props.ph):
// "title", "subtitle" or "body"; "" for anything else, a date or a slide
// number placeholder included
func phRole(node *xmltree.Node) string {
	key, ok := phOf(node)
	if !ok {
		return ""
	}
	switch key.typ {
	case "title", "ctrTitle":
		return "title"
	case "subTitle":
		return "subtitle"
	case "body", "obj":
		return "body"
	}
	return ""
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
func (sc *slideCtx) phChain(node *xmltree.Node) (layoutSp, masterSp *xmltree.Node) {
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
func (sc *slideCtx) masterTxStyle(key phKey, isPh bool) *xmltree.Node {
	ts := sc.master.First("txStyles")
	if ts == nil {
		return nil
	}
	if !isPh {
		return ts.First("otherStyle")
	}
	switch key.typ {
	case "title", "ctrTitle":
		return ts.First("titleStyle")
	case "body", "subTitle", "obj", "":
		return ts.First("bodyStyle")
	}
	return ts.First("otherStyle")
}

// styleChain builds the list of <a:lstStyle>-shaped nodes to fold, lowest
// priority first, for the text inside one shape
func (sc *slideCtx) styleChain(node, layoutSp, masterSp *xmltree.Node) []*xmltree.Node {
	key, isPh := phOf(node)
	var chain []*xmltree.Node
	if !isPh && sc.doc.defTxStyle != nil {
		chain = append(chain, sc.doc.defTxStyle)
	}
	if s := sc.masterTxStyle(key, isPh); s != nil {
		chain = append(chain, s)
	}
	if masterSp != nil {
		if l := masterSp.Path("txBody", "lstStyle"); l != nil {
			chain = append(chain, l)
		}
	}
	if layoutSp != nil {
		if l := layoutSp.Path("txBody", "lstStyle"); l != nil {
			chain = append(chain, l)
		}
	}
	if l := node.Path("txBody", "lstStyle"); l != nil {
		chain = append(chain, l)
	}
	return chain
}

// firstNonNil returns the first node in the list that is not nil
func firstNonNil(nodes ...*xmltree.Node) *xmltree.Node {
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
	// spcFirstLastPara: the first paragraph's space before and the last
	// one's space after count too (PowerPoint drops them otherwise)
	SpcFirstLast bool
}

// pptx default text insets, in EMU (0.1" left/right, 0.05" top/bottom)
const (
	defaultLIns = 91440
	defaultTIns = 45720
)

func (sc *slideCtx) resolveBodyPr(nodes []*xmltree.Node, cm coordMap) bodyProps {
	bp := bodyProps{Anchor: "t", FontScale: 1, LnSpcScale: 1, Wrap: true,
		LIns: defaultLIns, TIns: defaultTIns, RIns: defaultLIns, BIns: defaultTIns}
	for _, n := range nodes {
		if n == nil {
			continue
		}
		if v := n.Attr("anchor"); v != "" {
			bp.Anchor = v
		}
		if v := n.Attr("lIns"); v != "" {
			bp.LIns = units.AtofDefault(v, defaultLIns)
		}
		if v := n.Attr("rIns"); v != "" {
			bp.RIns = units.AtofDefault(v, defaultLIns)
		}
		if v := n.Attr("tIns"); v != "" {
			bp.TIns = units.AtofDefault(v, defaultTIns)
		}
		if v := n.Attr("bIns"); v != "" {
			bp.BIns = units.AtofDefault(v, defaultTIns)
		}
		if v := n.Attr("wrap"); v != "" {
			bp.Wrap = v != "none"
		}
		if v := n.Attr("spcFirstLastPara"); v != "" {
			bp.SpcFirstLast = v == "1" || v == "true"
		}
		if na := n.First("normAutofit"); na != nil {
			bp.FontScale = units.AtofDefault(na.Attr("fontScale"), 100000) / 100000
			bp.LnSpcScale = 1 - units.AtofDefault(na.Attr("lnSpcReduction"), 0)/100000
		}
		if n.First("noAutofit") != nil || n.First("spAutoFit") != nil {
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
	// the whole box is bold / italic / underlined: every run of text is.
	// The editor applies these to the box itself, and a descendant cannot
	// take an underline off again, so the first run alone must not decide.
	Bold, Italic, Underline bool
}

// buildTextBody renders a <p:txBody> into the editor's storage HTML
func (sc *slideCtx) buildTextBody(tx *xmltree.Node, chain []*xmltree.Node, bp bodyProps, cm coordMap) textResult {
	res := textResult{Empty: true, Align: "left"}
	if tx == nil {
		return res
	}
	// normAutofit's fontScale is not drawn as a fraction: PowerPoint sets
	// each run at the scaled size rounded to a whole point (20 pt at 92.5%
	// is 19 pt, at 77.5% 16 pt - measured on its own PDFs), so the scale
	// goes into the sizes, rounded, rather than into the CSS
	scale := cm.fs
	fitSize := func(pt float64) float64 {
		if bp.FontScale > 0 && bp.FontScale < 1 && pt > 0 {
			return math.Max(1, math.Floor(pt*bp.FontScale+0.5))
		}
		return pt
	}
	var sb strings.Builder
	var plain []string
	autoNum := map[int]int{}
	firstSet := false
	anyText, allBold, allItalic, allUnder := false, true, true, true
	paras := tx.All("p")
	for pi, p := range paras {
		pPr := p.First("pPr")
		lvl := int(units.AtofDefault(pPr.Attr("lvl"), 0))
		ps := resolveParaStyle(chain, pPr, lvl, &sc.cc)
		sc.resolveThemeFonts(&ps.DefRun)

		// runs
		var runs strings.Builder
		var lineText strings.Builder
		maxSizePt := 0.0
		minSizePt := 0.0
		var firstRun, lastRun runStyle
		haveRun := false
		for _, ch := range paraItems(p) {
			switch ch.XMLName.Local {
			case "r", "fld":
				t := ch.First("t")
				if t == nil {
					continue
				}
				rs := ps.DefRun
				applyRPr(&rs, ch.First("rPr"), &sc.cc)
				rs.SizePt = fitSize(rs.SizePt)
				sc.resolveThemeFonts(&rs)
				txt := t.Text
				// text set in the Symbol font is Greek and maths written
				// with Latin codes ("a" is alpha): it goes in as the
				// characters it shows, in the paragraph's own font
				if strings.EqualFold(strings.TrimSpace(rs.Latin), "symbol") {
					txt = fonts.SymbolText(txt)
					rs.Latin, rs.EastAsian = ps.DefRun.Latin, ps.DefRun.EastAsian
					sc.resolveThemeFonts(&rs)
				}
				maxSizePt, minSizePt = spanSizes(rs.SizePt, maxSizePt, minSizePt)
				if !haveRun {
					firstRun = rs
					haveRun = true
				}
				lastRun = rs
				if ch.XMLName.Local == "fld" &&
					strings.EqualFold(ch.Attr("type"), "slidenum") {
					// the stored text is the producer's placeholder glyph
					// ("<#>"); what belongs on the slide is its number
					txt = strconv.Itoa(sc.slideNum)
				}
				if txt == "" {
					continue
				}
				anyText = true
				allBold = allBold && rs.Bold
				allItalic = allItalic && rs.Italic
				allUnder = allUnder && rs.Underline
				runs.WriteString(`<span style="` + runCSS(rs, scale) + `">` +
					xmltree.Escape(txt) + `</span>`)
				lineText.WriteString(txt)
			case "br":
				// a break with no properties of its own opens a line as
				// tall as the run before it, not as the box default
				rs := ps.DefRun
				if haveRun {
					rs = lastRun
				} else {
					rs.SizePt = fitSize(rs.SizePt)
				}
				if br := ch.First("rPr"); br != nil && br.Attr("sz") != "" {
					applyRPr(&rs, br, &sc.cc)
					rs.SizePt = fitSize(rs.SizePt)
				} else {
					applyRPr(&rs, br, &sc.cc)
				}
				sc.resolveThemeFonts(&rs)
				maxSizePt, minSizePt = spanSizes(rs.SizePt, maxSizePt, minSizePt)
				runs.WriteString("<br>" + lineSpacerFor(rs, scale))
				lineText.WriteString("\n")
			}
		}
		if !haveRun {
			// an empty paragraph still occupies a line, sized by endParaRPr
			rs := ps.DefRun
			applyRPr(&rs, p.First("endParaRPr"), &sc.cc)
			rs.SizePt = fitSize(rs.SizePt)
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

		// bullet marker - PowerPoint draws none on an empty paragraph, and
		// does not count one in a numbered list
		bullet := ""
		hasText := strings.TrimSpace(strings.ReplaceAll(lineText.String(), "\u200b", "")) != ""
		if (ps.BuType == "char" || ps.BuType == "autonum") && !hasText {
			// keeps the numbering where it is
		} else if ps.BuType == "char" || ps.BuType == "autonum" {
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
					bs.SizePt = fitSize(ps.BuSizePt)
				} else if ps.BuSizePct > 0 {
					bs.SizePt = firstRun.SizePt * ps.BuSizePct
				}
				if ps.BuColor != "" {
					bs.Color = ps.BuColor
				}
				// a number is set in the text's font when the marker font
				// is a symbol font (the master's Wingdings bullet font
				// reaching a numbered paragraph): digits in Wingdings are
				// pictographs
				if ps.BuFont != "" && !(ps.BuType == "autonum" && fonts.IsSymbolFont(ps.BuFont)) {
					bs.Latin, bs.EastAsian = ps.BuFont, ps.BuFont
				}
				// a symbol-font marker (Wingdings "l") is a letter in any
				// other font: it goes in as the character it draws, in the
				// text's own font
				if uni, k, ok := fonts.SymbolBullet(ps.BuFont, marker); ok {
					marker = uni
					bs.Latin, bs.EastAsian = firstRun.Latin, firstRun.EastAsian
					bs.SizePt *= k
				}
				// a geometric bullet (● ○ ■) the bullet font has no glyph
				// for is drawn by PowerPoint and Google Slides in Arial,
				// where it is a small shape. Left to the shipped fallbacks
				// it lands on the CJK face, whose full-width circle is twice
				// that size - so Arimo (Arial's metric twin, shipped and
				// embeddable in a PDF) comes right after the bullet font,
				// ahead of any East Asian font the deck names
				if ps.BuType == "char" {
					bs.EastAsian = fonts.BulletFallback
				}
				bs.Underline, bs.Strike, bs.Highlight = false, false, ""
				left := (ps.MarLeft + ps.Indent) * cm.kx
				// the outer span is a line of the paragraph's own text -
				// its size, font and line height - so the marker inside it
				// sits on the first line's baseline whatever its own size
				strut := firstRun
				strut.Bold, strut.Italic, strut.Underline, strut.Strike, strut.Highlight = false, false, false, false, ""
				bullet = `<span style="position:absolute;left:` + units.FmtPx(left) + `;top:0;` +
					`line-height:` + strconv.FormatFloat(units.Round2(lineHeightOf(ps, bp)), 'f', -1, 64) + `;` +
					runCSS(strut, scale) + `"><span style="` + runCSS(bs, scale) + `">` +
					xmltree.Escape(marker) + `</span></span>`
			}
		} else {
			autoNum = map[int]int{}
		}

		// paragraph box
		var css strings.Builder
		css.WriteString("text-align:" + algnToCSS(ps.Align) + ";")
		// a tab goes to the next default stop, an inch apart unless the
		// deck says otherwise (CSS's own default is eight spaces)
		if ps.DefTabSz > 0 && strings.Contains(lineText.String(), "\t") {
			css.WriteString("tab-size:" + units.FmtPx(ps.DefTabSz*cm.kx) + ";")
		}
		lh := lineHeightOf(ps, bp)
		css.WriteString("line-height:" + strconv.FormatFloat(units.Round2(lh), 'f', -1, 64) + ";")
		// PowerPoint scales a whole line with its spacing, so the baseline
		// moves with it; CSS keeps the font's ascent and centres it in the
		// line box instead. Single spacing is made to agree by the fonts
		// themselves (common/fonts.js, the PowerPoint line model); any
		// other spacing leaves every line of the paragraph off by the same
		// amount, which is moved back here
		if haveRun || firstRun.SizePt > 0 {
			sizePx := units.PtToPx(firstRun.SizePt) * scale
			if dy := (model.LineHeightFactor - lh) * (2*ascentRatio(firstRun.Latin) - 1) / 2 * sizePx; math.Abs(dy) > 0.3 {
				if bullet == "" {
					css.WriteString("position:relative;")
				}
				css.WriteString("top:" + units.FmtPx(-dy) + ";")
			}
		}
		// the block's own font size is a floor under every line box in it,
		// so it has to be the paragraph's *smallest* run - otherwise a
		// small line under a big one inherits the big line's height
		css.WriteString("font-size:" + units.FmtPx(units.PtToPx(minSizePt)*scale) + ";")
		// PowerPoint drops the first paragraph's space before and the last
		// one's space after, unless the body says spcFirstLastPara
		if pi > 0 || bp.SpcFirstLast {
			if before := spaceOf(ps.SpcBefPt, ps.SpcBefPct, maxSizePt) * scale; before > 0 {
				css.WriteString("margin-top:" + units.FmtPx(units.PtToPx(before)) + ";")
			}
		}
		if pi < len(paras)-1 || bp.SpcFirstLast {
			if after := spaceOf(ps.SpcAftPt, ps.SpcAftPct, maxSizePt) * scale; after > 0 {
				css.WriteString("margin-bottom:" + units.FmtPx(units.PtToPx(after)) + ";")
			}
		}
		// PowerPoint counts tab stops from the edge of the text box, CSS
		// from the paragraph's content box - which a hanging indent's
		// padding moves. With a tab in the line, the indent is turned
		// round: the content box starts where the first line does and the
		// other lines hang from it (text-indent ... hanging), so the stops
		// land where PowerPoint puts them and the lines where they were.
		hanging := bullet == "" && ps.Indent < 0 && ps.MarLeft+ps.Indent > -0.5 &&
			strings.Contains(lineText.String(), "\t")
		if hanging {
			if first := (ps.MarLeft + ps.Indent) * cm.kx; first > 0.01 {
				css.WriteString("padding-left:" + units.FmtPx(first) + ";")
			}
		} else if ps.MarLeft != 0 {
			css.WriteString("padding-left:" + units.FmtPx(ps.MarLeft*cm.kx) + ";")
		}
		if ps.MarRight != 0 {
			css.WriteString("padding-right:" + units.FmtPx(ps.MarRight*cm.kx) + ";")
		}
		if bullet != "" {
			css.WriteString("position:relative;")
		} else if hanging {
			css.WriteString("text-indent:" + units.FmtPx(-ps.Indent*cm.kx) + " hanging;")
		} else if ps.Indent != 0 {
			css.WriteString("text-indent:" + units.FmtPx(ps.Indent*cm.kx) + ";")
		}
		body := runs.String()
		// PowerPoint's first tab stop in a hanging paragraph is the indent
		// itself, so a leading tab goes there before the default stops; the
		// tab keeps its place in the text inside a box that wide
		if hanging && strings.HasPrefix(lineText.String(), "\t") {
			body = strings.Replace(body, `">`+"\t", `"><span style="display:inline-block;width:`+
				units.FmtPx(-ps.Indent*cm.kx)+`;">`+"\t"+`</span>`, 1)
		}
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
		ps := resolveParaStyle(chain, paras[0].First("pPr"), 0, &sc.cc)
		// no text at all: what the box types in is its endParaRPr
		rs := ps.DefRun
		applyRPr(&rs, paras[0].First("endParaRPr"), &sc.cc)
		sc.resolveThemeFonts(&rs)
		res.First = rs
		res.Align = algnToCSS(ps.Align)
		res.LineH = lineHeightOf(ps, bp)
	}
	if anyText {
		res.Bold, res.Italic, res.Underline = allBold, allItalic, allUnder
	} else {
		res.Bold, res.Italic, res.Underline = res.First.Bold, res.First.Italic, res.First.Underline
	}
	res.FontCSS = fonts.StackFor(res.First.Latin, res.First.EastAsian)
	res.FontSize = units.PtToPx(res.First.SizePt) * scale
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
	return pct * model.LineHeightFactor * bp.LnSpcScale
}

// spaceOf resolves a paragraph space to points, given the paragraph's
// largest run size for the percentage form
func spaceOf(pts, pct, sizePt float64) float64 {
	if pts > 0 {
		return pts
	}
	if pct > 0 {
		// a percentage is of the line, not of the type: 20% before a
		// 28 pt paragraph is 20% of its 33.6 pt single line (measured
		// against PowerPoint's own PDF output)
		return pct * sizePt * model.LineHeightFactor
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
func (sc *slideCtx) parseSp(node *xmltree.Node, cm coordMap) *model.Object {
	// a shape drawn with a line or connector preset is a line, whatever
	// element it came in - and a straight one is routinely zero wide or
	// zero tall, which the box test below would throw away
	if g := node.Path("spPr", "prstGeom"); g != nil && isLinePreset(g.Attr("prst")) {
		return sc.parseCxnSp(node, cm)
	}
	layoutSp, masterSp := sc.phChain(node)

	// geometry: the shape's own, else the placeholder it inherits from
	box := parseXfrm(node.Path("spPr", "xfrm"), cm)
	if !box.OK && layoutSp != nil {
		box = parseXfrm(layoutSp.Path("spPr", "xfrm"), cm)
	}
	if !box.OK && masterSp != nil {
		box = parseXfrm(masterSp.Path("spPr", "xfrm"), cm)
	}
	if !box.OK || box.W <= 0 || box.H <= 0 {
		return nil
	}

	spPr := node.First("spPr")
	prst := ""
	if g := spPr.First("prstGeom"); g != nil {
		prst = g.Attr("prst")
	} else if spPr.First("custGeom") == nil {
		// no geometry of its own: a placeholder takes the shape its
		// prototype states, and anything else is a plain rectangle
		for _, src := range []*xmltree.Node{layoutSp, masterSp} {
			if g := src.Path("spPr", "prstGeom"); g != nil {
				prst = g.Attr("prst")
				break
			}
		}
		if prst == "" {
			prst = "rect"
		}
	} else if spPr.First("custGeom") != nil {
		// an unfilled freeform made only of straight segments is a
		// polyline, which the editor draws as a line - that is also how
		// this package writes a bent connector back out
		if obj := sc.freeformLine(node, spPr, box, cm); obj != nil {
			return obj
		}
		prst = "custom"
	}

	// a placeholder that states no fill or outline of its own wears its
	// prototype's: a footer bar's colour is set once, on the master
	fillPr, linePr := spPr, spPr
	for _, proto := range []*xmltree.Node{layoutSp, masterSp} {
		if fillPr != nil && hasFillChoice(fillPr) {
			break
		}
		if pp := proto.First("spPr"); pp != nil && hasFillChoice(pp) {
			fillPr = pp
		}
	}
	for _, proto := range []*xmltree.Node{layoutSp, masterSp} {
		if linePr != nil && linePr.First("ln") != nil {
			break
		}
		if pp := proto.First("spPr"); pp != nil && pp.First("ln") != nil {
			linePr = pp
		}
	}
	fill, fillGrad := sc.shapeFill(node, fillPr)
	stroke, strokeW, dash := sc.lineOf(linePr, cm)
	// a shape filled with a picture is a picture in that outline (and the
	// Fallback of an Office-math text box is one: the whole box, drawn)
	if bf := fillPr.First("blipFill"); bf != nil && !hasVisibleText(node.First("txBody")) {
		if obj := sc.pictureFillObject(bf, prst, box, stroke, strokeW, dash); obj != nil {
			return obj
		}
	}
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
	bp := sc.resolveBodyPr([]*xmltree.Node{
		masterSp.Path("txBody", "bodyPr"),
		layoutSp.Path("txBody", "bodyPr"),
		node.Path("txBody", "bodyPr"),
	}, cm)
	// Google Slides writes spcFirstLastPara="1" on every shape it exports
	// but never draws the first paragraph's space before (or the last
	// one's space after) itself - its decks would open lower than they
	// were made. PowerPoint does honour the flag, so only Google's own
	// shapes are read the way Google draws them.
	if isGoogleShape(node) {
		bp.SpcFirstLast = false
	}
	tr := sc.buildTextBody(node.First("txBody"), chain, bp, cm)

	kind, known := prstToShapeKind[prst]
	var geom *model.CustomGeom
	if prst == "custom" {
		ext := spPr.Path("xfrm", "ext")
		if geom = parseCustGeom(spPr.First("custGeom"), units.AtofDefault(ext.Attr("cx"), 0), units.AtofDefault(ext.Attr("cy"), 0)); geom != nil {
			kind, known = "custom", true
		}
	}
	if !known {
		kind = "rect"
	}
	hasFill := fill != "" && fill != "none"
	hasLine := stroke != "" && stroke != "none" && strokeW > 0
	// a shape is drawn as a shape when it has a visible body; a bare
	// rectangle with only text in it is a text box
	isShape := hasFill || hasLine || (known && kind != "rect") || !known

	pad := []float64{
		units.Round2(bp.TIns), units.Round2(bp.RIns), units.Round2(bp.BIns), units.Round2(bp.LIns),
	}
	// a SmartArt drawing places a shape's text in a rectangle of its own
	// (dsp:txXfrm) inside the outline: the difference is more inset
	if tx := parseXfrm(node.First("txXfrm"), cm); tx.OK && tx.W > 0 && tx.H > 0 {
		pad[0] = units.Round2(math.Max(0, tx.Y-box.Y) + bp.TIns)
		pad[1] = units.Round2(math.Max(0, box.X+box.W-tx.X-tx.W) + bp.RIns)
		pad[2] = units.Round2(math.Max(0, box.Y+box.H-tx.Y-tx.H) + bp.BIns)
		pad[3] = units.Round2(math.Max(0, tx.X-box.X) + bp.LIns)
	}

	if !isShape {
		role := phRole(node)
		// an empty placeholder is kept: the editor shows its prompt
		if tr.HTML == "" && role == "" {
			return nil
		}
		return &model.Object{
			Type: "text", X: box.X, Y: box.Y, W: box.W, H: box.H, Rot: box.Rot,
			Props: model.Props{
				Ph:   role,
				HTML: tr.HTML, FontSize: units.Round2(tr.FontSize), Color: tr.First.Color,
				Align: tr.Align, Bold: tr.Bold, Italic: tr.Italic,
				Underline: tr.Underline, FontFamily: tr.FontCSS,
				VAlign: anchorToVAlign(bp.Anchor), Pad: pad,
				LineHeight: units.Round2(tr.LineH),
			},
		}
	}

	if !hasFill {
		fill, fillGrad = "none", nil
	}
	if !hasLine {
		stroke, strokeW = "", 0
	}
	radius := units.Round2(sc.cornerRadius(spPr, prst, box))
	if kind == "roundRect" && radius <= 0 {
		// adj 0: square corners. A zero radius is not stored (omitempty),
		// and a roundRect without one is drawn with the default rounding
		kind = "rect"
	}
	return &model.Object{
		Type: "shape", X: box.X, Y: box.Y, W: box.W, H: box.H, Rot: box.Rot,
		Props: model.Props{
			Kind: kind, Geom: geom, Fill: fill, FillGrad: fillGrad, Stroke: stroke, StrokeW: units.Round2(strokeW),
			Dash: dash, DashStyle: dashStyleOfLn(spPr), Radius: radius,
			Adj:  adjForKind(prst, kind, spPr),
			HTML: tr.HTML, Text: tr.Plain, TextColor: tr.First.Color,
			FontSize: units.Round2(tr.FontSize), FontFamily: tr.FontCSS,
			Bold: tr.Bold, Italic: tr.Italic,
			Align: tr.Align, VAlign: anchorToVAlign(bp.Anchor), Pad: pad,
			LineHeight: units.Round2(tr.LineH),
		},
	}
}

// cornerRadius resolves the corner radius of a rounded rectangle, in px
func (sc *slideCtx) cornerRadius(spPr *xmltree.Node, prst string, box xfrmBox) float64 {
	if !strings.Contains(strings.ToLower(prst), "round") {
		return 0
	}
	adj := 16667.0 // the DrawingML default for roundRect
	// the guide that rounds the corner: roundRect's "adj", a rounded
	// callout's "adj3" (its adj1/adj2 place the tip, and read as a radius
	// they made the corners enormous), adj1 for the other rounded presets
	want := "adj1"
	switch prst {
	case "roundRect":
		want = "adj"
	case "wedgeRoundRectCallout":
		want = "adj3"
	}
	if g := spPr.First("prstGeom"); g != nil {
		if av := g.First("avLst"); av != nil {
			for _, gd := range av.All("gd") {
				if gd.Attr("name") == want {
					if v := strings.TrimPrefix(gd.Attr("fmla"), "val "); v != gd.Attr("fmla") {
						adj = units.AtofDefault(v, adj)
					}
				}
			}
		}
	}
	return math.Min(box.W, box.H) * adj / 100000
}

// styleRefColor resolves the colour of a <p:style> fillRef / lnRef, which
// is how PowerPoint's shape gallery states a theme fill
func (sc *slideCtx) styleRefColor(node *xmltree.Node, ref string) string {
	st := node.First("style")
	if st == nil {
		return ""
	}
	r := st.First(ref)
	if r == nil {
		return ""
	}
	if r.Attr("idx") == "0" {
		return "none"
	}
	for i := range r.Nodes {
		if c := sc.cc.resolveColor(&r.Nodes[i]); c != "" {
			return c
		}
	}
	return ""
}

// dashStyleOfLn is the editor's dash style for an <a:ln> ("" for solid)
func dashStyleOfLn(spPr *xmltree.Node) string {
	if ln := spPr.First("ln"); ln != nil {
		if d := ln.First("prstDash"); d != nil {
			return dashStyleForPrst(d.Attr("val"))
		}
	}
	return ""
}

// lineOf resolves an <a:ln> into colour, width (px) and dash
func (sc *slideCtx) lineOf(spPr *xmltree.Node, cm coordMap) (string, float64, bool) {
	ln := spPr.First("ln")
	if ln == nil {
		return "", 0, false
	}
	if ln.First("noFill") != nil {
		return "none", 0, false
	}
	color := sc.cc.solidColorOf(ln)
	width := 0.0
	if w := ln.Attr("w"); w != "" {
		width = units.AtofDefault(w, 0) * cm.kx
	}
	if color != "" && width == 0 {
		width = 1 // DrawingML's default hairline
	}
	dash := false
	if d := ln.First("prstDash"); d != nil {
		v := d.Attr("val")
		dash = v != "" && v != "solid"
	}
	return color, width, dash
}

// parseCxnSp handles p:cxnSp - connectors, drawn as straight lines
func (sc *slideCtx) parseCxnSp(node *xmltree.Node, cm coordMap) *model.Object {
	spPr := node.First("spPr")
	if spPr == nil {
		return nil
	}
	box := parseXfrm(spPr.First("xfrm"), cm)
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
	prst := ""
	if g := spPr.First("prstGeom"); g != nil {
		prst = g.Attr("prst")
	}
	pts := connectorPath(prst, spPr, box)

	// the editor stores a line as a start point plus a vector to the far
	// end; anything with a bend carries the full polyline alongside it
	ox, oy := pts[0][0], pts[0][1]
	last := pts[len(pts)-1]
	props := model.Props{Stroke: stroke, StrokeW: units.Round2(strokeW), Dash: dash}
	readLineEnds(spPr.First("ln"), &props)
	if len(pts) > 2 {
		rel := make([][]float64, len(pts))
		for i, p := range pts {
			rel[i] = []float64{units.Round2(p[0] - ox), units.Round2(p[1] - oy)}
		}
		props.Points = rel
	}
	return &model.Object{
		Type: "line", X: ox, Y: oy, W: last[0] - ox, H: last[1] - oy,
		Props: props,
	}
}

// isLinePreset reports whether a preset geometry is a line rather than an
// area: the straight line and every connector
func isLinePreset(prst string) bool {
	return prst == "line" || prst == "lineInv" || strings.HasSuffix(prst, "Connector1") ||
		strings.HasPrefix(prst, "bentConnector") || strings.HasPrefix(prst, "curvedConnector")
}

// connectorPath builds the polyline a connector follows, in absolute
// editor pixels: the preset's own path, mirrored by the flips and turned
// by the shape's rotation about the centre of its bounding box.
func connectorPath(prst string, spPr *xmltree.Node, box xfrmBox) [][2]float64 {
	w, h := box.W, box.H
	var local [][2]float64
	switch prst {
	case "bentConnector2":
		local = [][2]float64{{0, 0}, {w, 0}, {w, h}}
	case "bentConnector3", "bentConnector4", "bentConnector5":
		a := 0.5
		if g := spPr.First("prstGeom"); g != nil {
			if av := g.First("avLst"); av != nil {
				for _, gd := range av.All("gd") {
					if gd.Attr("name") == "adj1" {
						if v := strings.TrimPrefix(gd.Attr("fmla"), "val "); v != gd.Attr("fmla") {
							a = units.AtofDefault(v, 50000) / 100000
						}
					}
				}
			}
		}
		local = [][2]float64{{0, 0}, {a * w, 0}, {a * w, h}, {w, h}}
	case "lineInv":
		// the other diagonal: bottom left to top right
		local = [][2]float64{{0, h}, {w, 0}}
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
		out[i] = [2]float64{units.Round2(box.X + local[i][0]), units.Round2(box.Y + local[i][1])}
	}
	return out
}

// parsePic handles p:pic - embedded pictures become data URLs
func (sc *slideCtx) parsePic(node *xmltree.Node, cm coordMap) *model.Object {
	spPr := node.First("spPr")
	if spPr == nil {
		return nil
	}
	box := parseXfrm(spPr.First("xfrm"), cm)
	if !box.OK {
		if layoutSp, masterSp := sc.phChain(node); layoutSp != nil || masterSp != nil {
			box = parseXfrm(firstNonNil(layoutSp, masterSp).Path("spPr", "xfrm"), cm)
		}
	}
	if !box.OK || box.W <= 0 || box.H <= 0 {
		return nil
	}
	blipFill := node.First("blipFill")
	blip := blipFill.First("blip")
	if blip == nil {
		return nil
	}
	rid := blip.AttrNS("relationships", "embed")
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
	mediaPath := xmltree.ResolvePart(sc.partDir(), target)
	data, ok := sc.doc.files[mediaPath]
	if !ok {
		return nil
	}
	ext := strings.TrimPrefix(strings.ToLower(path.Ext(mediaPath)), ".")
	// a Windows metafile (old decks store scans as .wmf) is rendered to a
	// bitmap the browser can show
	data, ext, _ = metafile.BrowserPicture(data, ext)

	props := model.Props{Src: media.EncodeDataURL(data, ext), Fit: "fill"}
	// srcRect crops the source before it is stretched into the frame
	if sr := blipFill.First("srcRect"); sr != nil {
		l := units.AtofDefault(sr.Attr("l"), 0) / 100000
		t := units.AtofDefault(sr.Attr("t"), 0) / 100000
		r := units.AtofDefault(sr.Attr("r"), 0) / 100000
		b := units.AtofDefault(sr.Attr("b"), 0) / 100000
		if l != 0 || t != 0 || r != 0 || b != 0 {
			props.Crop = []float64{units.Round4(l), units.Round4(t), units.Round4(r), units.Round4(b)}
		}
	}
	if blipFill.First("stretch") == nil && blipFill.First("tile") == nil {
		// a blipFill with neither is still stretched by PowerPoint
		props.Fit = "fill"
	}
	prst := ""
	if g := spPr.First("prstGeom"); g != nil {
		prst = g.Attr("prst")
	}
	// a picture drawn through a preset geometry is a shaped crop
	if kind, ok := prstToShapeKind[prst]; ok && kind != "rect" {
		props.Mask = kind
		// the guides it states reshape it, when the editor draws it as
		// itself (roundRect's corner is props.Radius instead)
		if kind == prst && kind != "roundRect" {
			props.Adj = statedAdj(spPr)
		}
	}
	if rad := sc.cornerRadius(spPr, prst, box); rad > 0 {
		props.Radius = units.Round2(rad)
	}
	props.FlipH, props.FlipV = box.FlipH, box.FlipV
	// a frame drawn around the picture (screenshots often carry one)
	if stroke, sw, dash := sc.lineOf(spPr, cm); stroke != "" && stroke != "none" && sw > 0 {
		props.Stroke, props.StrokeW, props.Dash = stroke, units.Round2(sw), dash
		readLineEnds(spPr.First("ln"), &props)
		props.StartHead, props.EndHead, props.ArrowStart, props.ArrowEnd = "", "", false, false
	}
	readPictureEffects(blip, &props)
	// a fill on the picture's frame shows wherever the picture is
	// transparent (or does not reach, under a negative crop)
	if c, g := sc.shapeFill(node, spPr); c != "" && c != "none" {
		props.Fill, props.FillGrad = c, g
	}
	return &model.Object{
		Type: "image", X: box.X, Y: box.Y, W: box.W, H: box.H, Rot: box.Rot,
		Props: props,
	}
}

/* ---------------- tables ---------------- */

// parseGraphicFrame handles p:graphicFrame - tables (charts are skipped)
func (sc *slideCtx) parseGraphicFrame(node *xmltree.Node, cm coordMap) *model.Object {
	box := parseXfrm(node.First("xfrm"), cm)
	if !box.OK || box.W <= 0 || box.H <= 0 {
		return nil
	}
	gdata := node.Path("graphic", "graphicData")
	tbl := gdata.First("tbl")
	if tbl == nil {
		// the other graphicData the editor can model is a chart
		return sc.parseChartFrame(gdata, box)
	}
	headerRow := false
	tblPr := tbl.First("tblPr")
	if tblPr != nil {
		headerRow = tblPr.Attr("firstRow") == "1"
	}
	flags := readTblFlags(tblPr)
	style := sc.tableStyleFor(tbl)
	// column proportions from the grid definition
	var colW []float64
	var totalW float64
	if grid := tbl.First("tblGrid"); grid != nil {
		var ws []float64
		for _, gc := range grid.All("gridCol") {
			v := units.AtofDefault(gc.Attr("w"), 0)
			ws = append(ws, v)
			totalW += v
		}
		if totalW > 0 && len(ws) > 1 {
			for _, v := range ws {
				colW = append(colW, units.Round2(v/totalW*100.0))
			}
		}
	}
	trs := tbl.All("tr")
	var rowH []float64
	var totalH float64
	for _, tr := range trs {
		totalH += units.AtofDefault(tr.Attr("h"), 0)
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
	var chain []*xmltree.Node
	if ts := sc.master.Path("txStyles", "otherStyle"); ts != nil {
		chain = append(chain, ts)
	}
	var rows [][]string
	var cellFill [][]string
	var cellPad []float64
	fontSize := 0.0
	color := ""
	var merges [][]int
	var cellAnchor [][]string
	nCols := 0
	for _, tr := range trs {
		if n := len(tr.All("tc")); n > nCols {
			nCols = n
		}
	}
	for ri, tr := range trs {
		if totalH > 0 {
			rowH = append(rowH, units.Round2(units.AtofDefault(tr.Attr("h"), 0)/totalH*100.0))
		}
		var row, fills, anchors []string
		for ci, tc := range tr.All("tc") {
			tcPr := tc.First("tcPr")
			anchors = append(anchors, map[string]string{"ctr": "middle", "b": "bottom"}[tcPr.Attr("anchor")])
			// the table style's look for this cell, then the cell's own fill
			var look cellLook
			if style != nil {
				look = sc.lookOf(styleParts(style, flags, ri, ci, len(trs), nCols))
			}
			fill := look.fill
			if c := sc.cc.fillColorOf(tcPr); c == "none" {
				fill = ""
			} else if c != "" {
				fill = c
			}
			fills = append(fills, fill)
			if cellPad == nil && tcPr != nil {
				cellPad = []float64{
					units.Round2(units.AtofDefault(tcPr.Attr("marT"), 45720) * cm.ky),
					units.Round2(units.AtofDefault(tcPr.Attr("marR"), 91440) * cm.kx),
					units.Round2(units.AtofDefault(tcPr.Attr("marB"), 45720) * cm.ky),
					units.Round2(units.AtofDefault(tcPr.Attr("marL"), 91440) * cm.kx),
				}
			}
			if tc.Attr("hMerge") == "1" || tc.Attr("vMerge") == "1" {
				// covered by a merged cell: kept as an empty cell, which the
				// merge's span draws over
				row = append(row, "")
				continue
			}
			rs := int(units.AtofDefault(tc.Attr("rowSpan"), 1))
			cs := int(units.AtofDefault(tc.Attr("gridSpan"), 1))
			if rs > 1 || cs > 1 {
				merges = append(merges, []int{ri, ci, max(rs, 1), max(cs, 1)})
			}
			bp := sc.resolveBodyPr([]*xmltree.Node{tc.Path("txBody", "bodyPr")}, cm)
			bp.LIns, bp.RIns, bp.TIns, bp.BIns = 0, 0, 0, 0
			cellChain := chain
			if ls := lookTextStyle(look); ls != nil {
				cellChain = append(append([]*xmltree.Node{}, chain...), ls)
			}
			res := sc.buildTextBody(tc.First("txBody"), cellChain, bp, cm)
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
			cellAnchor = append(cellAnchor, anchors)
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
	if !anyFilled(cellAnchor) {
		cellAnchor = nil
	}
	props := model.Props{Rows: rows, HeaderRow: headerRow, FontSize: units.Round2(fontSize),
		Color: color, ColW: colW, RowH: rowH,
		CellFill: cellFill, CellPad: cellPad, Merges: merges, CellAnchor: cellAnchor}
	if style != nil {
		// the style is the whole look: the editor's own heading shading and
		// bold heading row stay off, and the rules are the style's
		props.Styled = true
		props.Stroke, props.StrokeW = sc.tableBorder(style, cm)
		if props.Stroke == "" {
			props.Stroke, props.StrokeW = sc.cellBorder(tbl, cm)
		}
	}
	return &model.Object{
		Type: "table", X: box.X, Y: box.Y, W: box.W, H: box.H,
		Props: props,
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
	spTree := tree.Path("cSld", "spTree")
	if spTree == nil {
		return ""
	}
	var shapes []*xmltree.Node
	spTree.FindAll("sp", &shapes)
	var lines []string
	for _, sp := range shapes {
		key, isPh := phOf(sp)
		if isPh && key.typ != "body" {
			continue
		}
		tx := sp.First("txBody")
		if tx == nil {
			continue
		}
		for _, p := range tx.All("p") {
			var parts []string
			for i := range p.Nodes {
				ch := &p.Nodes[i]
				if ch.XMLName.Local == "r" || ch.XMLName.Local == "fld" {
					if t := ch.First("t"); t != nil {
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
func (sc *slideCtx) freeformLine(node, spPr *xmltree.Node, box xfrmBox, cm coordMap) *model.Object {
	if c := sc.cc.fillColorOf(spPr); c != "" && c != "none" {
		return nil
	}
	stroke, strokeW, dash := sc.lineOf(spPr, cm)
	if stroke == "" || stroke == "none" {
		return nil
	}
	pathLst := spPr.Path("custGeom", "pathLst")
	if pathLst == nil {
		return nil
	}
	paths := pathLst.All("path")
	if len(paths) != 1 {
		return nil
	}
	path := paths[0]
	pw := units.AtofDefault(path.Attr("w"), 0)
	ph := units.AtofDefault(path.Attr("h"), 0)
	if pw <= 0 || ph <= 0 {
		return nil
	}
	var pts [][]float64
	for i := range path.Nodes {
		seg := &path.Nodes[i]
		switch seg.XMLName.Local {
		case "moveTo", "lnTo":
			pt := seg.First("pt")
			if pt == nil {
				return nil
			}
			// path coordinates are relative to the path box, which maps
			// onto the shape's own extent
			pts = append(pts, []float64{
				units.Round2(units.AtofDefault(pt.Attr("x"), 0) / pw * box.W),
				units.Round2(units.AtofDefault(pt.Attr("y"), 0) / ph * box.H),
			})
		case "close", "cubicBezTo", "quadBezTo", "arcTo":
			return nil
		}
	}
	if len(pts) < 2 {
		return nil
	}
	// the editor's line origin is the first point, so the polyline it
	// carries is relative to that
	ox, oy := pts[0][0], pts[0][1]
	for i := range pts {
		pts[i][0] = units.Round2(pts[i][0] - ox)
		pts[i][1] = units.Round2(pts[i][1] - oy)
	}
	last := pts[len(pts)-1]
	props := model.Props{Stroke: stroke, StrokeW: units.Round2(strokeW), Dash: dash}
	readLineEnds(spPr.First("ln"), &props)
	if len(pts) > 2 {
		props.Points = pts
	}
	return &model.Object{
		Type: "line",
		X:    box.X + ox, Y: box.Y + oy,
		W: last[0], H: last[1],
		Props: props,
	}
}

// parseChartFrame resolves a graphicFrame that holds a DrawingML chart
func (sc *slideCtx) parseChartFrame(gdata *xmltree.Node, box xfrmBox) *model.Object {
	ref := gdata.First("chart")
	if ref == nil {
		return nil
	}
	rid := ref.AttrNS("relationships", "id")
	if rid == "" {
		rid = ref.Attr("id")
	}
	target, ok := sc.partRels()[rid]
	if !ok {
		return nil
	}
	tree := sc.doc.tree(xmltree.ResolvePart(sc.partDir(), target))
	if tree == nil {
		return nil
	}
	spec := sc.parseChartSpec(tree)
	if spec == nil {
		return nil
	}
	return &model.Object{
		Type: "chart", X: box.X, Y: box.Y, W: box.W, H: box.H,
		Props: model.Props{Spec: chartSpecJSON(spec)},
	}
}

// readPictureEffects reads the colour effects DrawingML allows on a
// picture's blip: transparency, a greyscale wash, a duotone tint and the
// luminance (brightness / contrast) pair. They map onto the editor's
// re-colour presets and adjustment offsets.
func readPictureEffects(blip *xmltree.Node, props *model.Props) {
	if blip == nil {
		return
	}
	if am := blip.First("alphaModFix"); am != nil {
		if v := am.Attr("amt"); v != "" {
			if o := clamp01(units.AtofDefault(v, 100000) / 100000); o < 1 {
				props.Opacity = units.Round2(o)
			}
		}
	}
	if blip.First("grayscl") != nil {
		props.Recolor = "gray"
	}
	if blip.First("biLevel") != nil {
		props.Recolor = "black-white"
	}
	if dt := blip.First("duotone"); dt != nil {
		// the second stop is the colour the picture is washed into
		plain := colorCtx{}
		var hexes []string
		for i := range dt.Nodes {
			if c := plain.resolveColor(&dt.Nodes[i]); c != "" {
				hexes = append(hexes, c)
			}
		}
		if len(hexes) > 0 {
			props.Recolor = nearestRecolor(hexes[len(hexes)-1])
		}
	}
	if lum := blip.First("lum"); lum != nil {
		if v := lum.Attr("bright"); v != "" {
			props.Bright = units.Round2(units.AtofDefault(v, 0) / 100000)
		}
		if v := lum.Attr("contrast"); v != "" {
			props.Contrast = units.Round2(units.AtofDefault(v, 0) / 100000)
		}
	}
}

// recolorTints is the colour each re-colour preset washes a picture into,
// shared by the reader (nearest match on a duotone) and the writer
var recolorTints = map[string]string{
	"blue-light": "#9fc5f8", "blue-dark": "#1c4587", "teal": "#12b5cb",
	"green": "#34a853", "lime": "#b7e1a1", "yellow": "#ffd966",
	"orange": "#f6b26b", "red": "#e06666", "purple": "#8e7cc3",
	"pink": "#ea9999", "sepia": "#b5814f", "washout": "#d9d9d9",
}

// nearestRecolor picks the preset whose tint is closest to a colour
func nearestRecolor(hex string) string {
	r, g, b := hexToRGB(hex)
	best, bestD := "gray", 0.0
	first := true
	for key, tint := range recolorTints {
		tr, tg, tb := hexToRGB(tint)
		d := (r-tr)*(r-tr) + (g-tg)*(g-tg) + (b-tb)*(b-tb)
		if first || d < bestD {
			best, bestD, first = key, d, false
		}
	}
	return best
}

/* ---------------- transitions and click links ---------------- */

// transitionOf maps a slide's <p:transition> onto the editor's three:
// fade, slide (anything that moves the slide in) and zoom. PowerPoint 2010
// and later wrap it in mc:AlternateContent, with a plain fallback.
func transitionOf(sld *xmltree.Node) string {
	tr := sld.First("transition")
	if tr == nil {
		if ac := sld.First("AlternateContent"); ac != nil {
			if fb := ac.First("Fallback"); fb != nil {
				tr = fb.First("transition")
			}
			if tr == nil {
				if ch := ac.First("Choice"); ch != nil {
					tr = ch.First("transition")
				}
			}
		}
	}
	if tr == nil {
		return ""
	}
	for i := range tr.Nodes {
		switch tr.Nodes[i].XMLName.Local {
		case "fade", "dissolve", "cut":
			return "fade"
		case "push", "cover", "pull", "wipe", "split", "strips", "randomBar", "blinds", "checker", "comb", "wheel", "wedge", "circle", "diamond", "plus", "newsflash", "random", "vortex", "ripple", "flip", "gallery", "cube", "doors", "box", "conveyor", "pan", "glitter", "honeycomb", "flash", "shred", "switch", "ferris", "flythrough", "warp", "reveal", "prism":
			return "slide"
		case "zoom":
			return "zoom"
		case "sndAc", "extLst":
			continue
		default:
			return "fade"
		}
	}
	return ""
}

// isGoogleShape reports whether Google Slides made this shape: its export
// names every one "Google Shape;<id>;<page>", and no other producer does
func isGoogleShape(node *xmltree.Node) bool {
	for i := range node.Nodes {
		if strings.HasPrefix(node.Nodes[i].XMLName.Local, "nv") {
			if c := node.Nodes[i].First("cNvPr"); c != nil {
				return strings.HasPrefix(c.Attr("name"), "Google Shape;")
			}
			return false
		}
	}
	return false
}

// withLink reads a shape's click action into props.link: a jump to another
// slide becomes "#N", an external address stays as it is (http(s) only)
func (sc *slideCtx) withLink(node *xmltree.Node, obj *model.Object) *model.Object {
	if obj == nil {
		return nil
	}
	var cNvPr *xmltree.Node
	for i := range node.Nodes {
		if strings.HasPrefix(node.Nodes[i].XMLName.Local, "nv") {
			cNvPr = node.Nodes[i].First("cNvPr")
			break
		}
	}
	hl := cNvPr.First("hlinkClick")
	if hl == nil {
		return obj
	}
	rid := hl.AttrNS("relationships", "id")
	target := sc.partRels()[rid]
	action := hl.Attr("action")
	switch {
	case strings.Contains(action, "hlinksldjump"):
		if n, ok := sc.doc.slideIndex[xmltree.ResolvePart(sc.partDir(), target)]; ok {
			obj.Props.Link = "#" + strconv.Itoa(n)
		}
	case strings.Contains(action, "hlinkshowjump"):
		// first / last / next / previous slide: no absolute target to keep
	case action == "" && target != "":
		low := strings.ToLower(target)
		if strings.HasPrefix(low, "http://") || strings.HasPrefix(low, "https://") {
			obj.Props.Link = target
		}
	}
	return obj
}
