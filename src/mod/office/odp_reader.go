package office

/*
	odp_reader.go - Parse an OpenDocument Presentation (.odp) into a
	Presentation, scaled into the 960x540 editor space.

	ODF states appearance the same way PresentationML does: almost never on
	the element itself. A paragraph names a style, that style names a parent,
	the parent lives in styles.xml, and a frame with presentation:class="title"
	takes its position and its typography from the matching placeholder on the
	master page. Reading only what a shape spells out - which is what the
	first version of this reader did - gives every text box the same 24px
	default and drops the deck's whole design.

	So the reader resolves, lowest priority first:

	    styles.xml   office:styles       the named style and its parents
	    styles.xml   automatic-styles    the master page's own styles
	    content.xml  automatic-styles    the per-document generated styles
	    the paragraph's style, then the span's

	and draws each page on top of its master page's decoration, the way an
	ODF viewer does.
*/

import (
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// odpStyle is a resolved ODF style: the graphic, paragraph and text
// properties that matter to the editor, folded down the parent chain
type odpStyle struct {
	// text
	SizePt    float64
	Font      string
	Bold      bool
	Italic    bool
	Underline bool
	Strike    bool
	Color     string
	Highlight string
	// paragraph
	Align      string
	LineHeight float64 // unitless
	SpaceTop   float64 // px
	SpaceBot   float64 // px
	MarginLeft float64 // px
	Indent     float64 // px
	// graphic
	Fill      string // "" unset, "none", or "#rrggbb"
	Stroke    string
	StrokeW   float64
	Dash      bool
	VAlign    string // top | middle | bottom
	PadT      float64
	PadR      float64
	PadB      float64
	PadL      float64
	HasPad    bool
	AutoGrow  bool
	Rotation  float64
	ArrowEnd  bool
	ArrowHead bool
}

var odpDefaultStyle = odpStyle{SizePt: 18, Align: "left", Color: "#000000"}

// ParseOdp converts raw .odp bytes into a Presentation
func ParseOdp(data []byte) (*Presentation, error) {
	files, mime, err := readOdfZip(data)
	if err != nil {
		return nil, err
	}
	if mime != "" && mime != odpMime {
		return nil, errors.New("not an OpenDocument presentation (mimetype " + mime + ")")
	}
	content, ok := files["content.xml"]
	if !ok {
		return nil, errors.New("odp is missing content.xml")
	}
	tree, err := parseOdfXML(content)
	if err != nil {
		return nil, errors.New("cannot parse content.xml: " + err.Error())
	}
	root := tree.first("document-content")
	if root == nil {
		return nil, errors.New("content.xml has no document-content root")
	}

	cv := &odpConverter{
		files:  files,
		sx:     1,
		sy:     1,
		styles: map[string]*onode{},
		lists:  map[string]*onode{},
		pageBg: map[string]string{},
	}

	var stylesRoot *onode
	if raw, ok := files["styles.xml"]; ok {
		if st, err := parseOdfXML(raw); err == nil {
			stylesRoot = st.first("document-styles")
		}
	}
	if stylesRoot != nil {
		// source page size -> scale into the 960x540 editor space
		for _, auto := range []*onode{stylesRoot.first("automatic-styles")} {
			if auto == nil {
				continue
			}
			for _, pl := range auto.all("page-layout") {
				pp := pl.first("page-layout-properties")
				if pp == nil {
					continue
				}
				if wPx := odfLenToPx(pp.attr("page-width")); wPx > 0 {
					cv.sx = float64(slidePxW) / wPx
				}
				if hPx := odfLenToPx(pp.attr("page-height")); hPx > 0 {
					cv.sy = float64(slidePxH) / hPx
				}
			}
		}
		cv.collectStyles(stylesRoot.first("styles"))
		cv.collectStyles(stylesRoot.first("automatic-styles"))
		if ms := stylesRoot.first("master-styles"); ms != nil {
			cv.masters = map[string]*onode{}
			for _, mp := range ms.all("master-page") {
				cv.masters[mp.attr("name")] = mp
			}
		}
	}
	cv.collectStyles(root.first("automatic-styles"))

	pres := root.path("body", "presentation")
	if pres == nil {
		return nil, errors.New("odp has no presentation body")
	}
	out := &Presentation{Size: []int{slidePxW, slidePxH}, Slides: []*Slide{}}
	for pi, page := range pres.all("page") {
		slide := &Slide{ID: fmt.Sprintf("s-odp-%d", pi+1), Objects: []*Object{}}
		master := cv.masterOf(page)
		slide.Bg = cv.backgroundOf(page, master)
		cv.master = master
		// the master page's own drawing sits underneath the slide's
		if master != nil {
			cv.walkPage(master, slide, true)
		}
		cv.walkPage(page, slide, false)
		for _, c := range page.children {
			if c.el != nil && c.el.name == "notes" {
				slide.Notes = strings.TrimSpace(c.el.allText())
			}
		}
		out.Slides = append(out.Slides, slide)
	}
	if len(out.Slides) == 0 {
		return nil, errors.New("no slides found in odp")
	}
	return out, nil
}

type odpConverter struct {
	files   map[string][]byte
	sx, sy  float64
	styles  map[string]*onode
	lists   map[string]*onode
	masters map[string]*onode
	master  *onode
	pageBg  map[string]string
	seq     int
}

// collectStyles indexes every style:style and text:list-style in a container
func (cv *odpConverter) collectStyles(container *onode) {
	if container == nil {
		return
	}
	for _, st := range container.all("style") {
		if n := st.attr("name"); n != "" {
			cv.styles[n] = st
		}
	}
	for _, st := range container.all("list-style") {
		if n := st.attr("name"); n != "" {
			cv.lists[n] = st
		}
	}
	for _, st := range container.all("default-style") {
		if f := st.attr("family"); f != "" {
			cv.styles["#default-"+f] = st
		}
	}
	for _, dp := range container.all("style") {
		if dp.attr("family") != "drawing-page" {
			continue
		}
		if props := dp.first("drawing-page-properties"); props != nil {
			if c := props.attr("fill-color"); strings.HasPrefix(c, "#") {
				cv.pageBg[dp.attr("name")] = strings.ToLower(c)
			}
		}
	}
}

func (cv *odpConverter) masterOf(page *onode) *onode {
	if cv.masters == nil {
		return nil
	}
	return cv.masters[page.attr("master-page-name")]
}

// backgroundOf resolves a page's fill, falling back to its master's
func (cv *odpConverter) backgroundOf(page, master *onode) string {
	if bg, ok := cv.pageBg[page.attr("style-name")]; ok {
		return bg
	}
	if master != nil {
		if bg, ok := cv.pageBg[master.attr("style-name")]; ok {
			return bg
		}
		if bg, ok := cv.pageBg[master.attr("page-layout-name")]; ok {
			return bg
		}
	}
	return ""
}

// walkPage draws every shape on a page. When masterOnly is set the
// placeholders are skipped: on a master page they are prototypes that
// state where a slide's title and body go, not content of their own.
func (cv *odpConverter) walkPage(page *onode, slide *Slide, masterOnly bool) {
	for _, c := range page.children {
		if c.el == nil {
			continue
		}
		if masterOnly && c.el.attr("class") != "" {
			continue
		}
		cv.drawShape(c.el, slide, 0, 0, 1, 1)
	}
}

// drawShape converts one drawing element, recursing into groups. ox/oy and
// kx/ky carry the transform a draw:g imposes on its children.
func (cv *odpConverter) drawShape(n *onode, slide *Slide, ox, oy, kx, ky float64) {
	switch n.name {
	case "frame":
		cv.frame(n, slide, ox, oy, kx, ky)
	case "rect", "ellipse", "circle", "custom-shape", "polygon", "regular-polygon":
		cv.shape(n, slide, ox, oy, kx, ky)
	case "line", "connector":
		cv.line(n, slide, ox, oy, kx, ky)
	case "g":
		// a group has no transform of its own in ODF - its children carry
		// absolute coordinates - so it is simply flattened
		for _, c := range n.children {
			if c.el != nil {
				cv.drawShape(c.el, slide, ox, oy, kx, ky)
			}
		}
	}
}

/* ---------------- style resolution ---------------- */

// resolveStyle folds a style and its parent chain into one odpStyle
func (cv *odpConverter) resolveStyle(name string, base odpStyle) odpStyle {
	if name == "" {
		return base
	}
	// walk to the root of the parent chain first, then apply downwards so
	// the most specific style wins
	var chain []*onode
	seen := map[string]bool{}
	for cur := name; cur != "" && !seen[cur]; {
		seen[cur] = true
		st, ok := cv.styles[cur]
		if !ok {
			break
		}
		chain = append([]*onode{st}, chain...)
		cur = st.attr("parent-style-name")
	}
	out := base
	for _, st := range chain {
		cv.applyStyleNode(&out, st)
	}
	return out
}

// applyStyleNode folds one style:style element's properties into dst
func (cv *odpConverter) applyStyleNode(dst *odpStyle, st *onode) {
	if tp := st.first("text-properties"); tp != nil {
		applyOdfTextProps(dst, tp)
	}
	if pp := st.first("paragraph-properties"); pp != nil {
		cv.applyOdfParaProps(dst, pp)
	}
	if gp := st.first("graphic-properties"); gp != nil {
		cv.applyOdfGraphicProps(dst, gp)
	}
}

func applyOdfTextProps(dst *odpStyle, tp *onode) {
	if v := tp.attr("font-size"); v != "" {
		if pt := odfFontSizePt(v, dst.SizePt); pt > 0 {
			dst.SizePt = pt
		}
	}
	if v := tp.attr("font-name"); v != "" {
		dst.Font = v
	}
	if v := tp.attr("font-family"); v != "" {
		dst.Font = strings.Trim(v, "'\"")
	}
	if v := tp.attr("font-weight"); v != "" {
		dst.Bold = v == "bold" || parseNum(v) >= 600
	}
	if v := tp.attr("font-style"); v != "" {
		dst.Italic = v == "italic" || v == "oblique"
	}
	if v := tp.attr("text-underline-style"); v != "" {
		dst.Underline = v != "none"
	}
	if v := tp.attr("text-line-through-style"); v != "" {
		dst.Strike = v != "none"
	}
	if v := tp.attr("color"); strings.HasPrefix(v, "#") {
		dst.Color = strings.ToLower(v)
	}
	if v := tp.attr("background-color"); strings.HasPrefix(v, "#") {
		dst.Highlight = strings.ToLower(v)
	}
}

func (cv *odpConverter) applyOdfParaProps(dst *odpStyle, pp *onode) {
	switch pp.attr("text-align") {
	case "center":
		dst.Align = "center"
	case "end", "right":
		dst.Align = "right"
	case "justify":
		dst.Align = "justify"
	case "start", "left":
		dst.Align = "left"
	}
	if v := pp.attr("line-height"); v != "" {
		if strings.HasSuffix(v, "%") {
			dst.LineHeight = parseNum(v) / 100 * pptxLineHeightFactor
		} else if px := odfLenToPx(v); px > 0 && dst.SizePt > 0 {
			dst.LineHeight = px / ptToPx(dst.SizePt)
		}
	}
	if v := pp.attr("margin-top"); v != "" {
		dst.SpaceTop = odfLenToPx(v) * cv.sy
	}
	if v := pp.attr("margin-bottom"); v != "" {
		dst.SpaceBot = odfLenToPx(v) * cv.sy
	}
	if v := pp.attr("margin-left"); v != "" {
		dst.MarginLeft = odfLenToPx(v) * cv.sx
	}
	if v := pp.attr("text-indent"); v != "" {
		dst.Indent = odfLenToPx(v) * cv.sx
	}
}

func (cv *odpConverter) applyOdfGraphicProps(dst *odpStyle, gp *onode) {
	switch gp.attr("fill") {
	case "none":
		dst.Fill = "none"
	case "solid", "bitmap", "gradient", "hatch":
		if c := gp.attr("fill-color"); strings.HasPrefix(c, "#") {
			dst.Fill = strings.ToLower(c)
		}
	default:
		if c := gp.attr("fill-color"); strings.HasPrefix(c, "#") {
			dst.Fill = strings.ToLower(c)
		}
	}
	switch gp.attr("stroke") {
	case "none":
		dst.Stroke = "none"
		dst.StrokeW = 0
	case "dash":
		dst.Dash = true
		fallthrough
	case "solid":
		if c := gp.attr("stroke-color"); strings.HasPrefix(c, "#") {
			dst.Stroke = strings.ToLower(c)
		} else if dst.Stroke == "" || dst.Stroke == "none" {
			dst.Stroke = "#000000"
		}
		if w := odfLenToPx(gp.attr("stroke-width")) * cv.sx; w > 0 {
			dst.StrokeW = w
		} else if dst.StrokeW <= 0 {
			dst.StrokeW = 1
		}
	}
	switch gp.attr("textarea-vertical-align") {
	case "middle":
		dst.VAlign = "middle"
	case "bottom":
		dst.VAlign = "bottom"
	case "top":
		dst.VAlign = "top"
	}
	for attr, field := range map[string]*float64{
		"padding-top": &dst.PadT, "padding-right": &dst.PadR,
		"padding-bottom": &dst.PadB, "padding-left": &dst.PadL,
	} {
		if v := gp.attr(attr); v != "" {
			*field = odfLenToPx(v) * cv.sx
			dst.HasPad = true
		}
	}
	if v := gp.attr("padding"); v != "" {
		p := odfLenToPx(v) * cv.sx
		dst.PadT, dst.PadR, dst.PadB, dst.PadL = p, p, p, p
		dst.HasPad = true
	}
	if v := gp.attr("marker-end"); v != "" && v != "none" {
		dst.ArrowEnd = true
	}
	if v := gp.attr("marker-start"); v != "" && v != "none" {
		dst.ArrowHead = true
	}
}

// odfFontSizePt reads a font size, which may be relative ("120%")
func odfFontSizePt(v string, current float64) float64 {
	if strings.HasSuffix(v, "%") {
		return current * parseNum(v) / 100
	}
	if strings.HasSuffix(v, "pt") {
		return parseNum(v)
	}
	if px := odfLenToPx(v); px > 0 {
		return px * 0.75
	}
	return 0
}

/* ---------------- geometry ---------------- */

func (cv *odpConverter) geom(n *onode, ox, oy, kx, ky float64) (x, y, w, h float64) {
	x = ox + odfLenToPx(n.attr("x"))*cv.sx*kx
	y = oy + odfLenToPx(n.attr("y"))*cv.sy*ky
	w = odfLenToPx(n.attr("width")) * cv.sx * kx
	h = odfLenToPx(n.attr("height")) * cv.sy * ky
	return x, y, w, h
}

// odfRotation reads the rotation out of a draw:transform attribute, in
// degrees clockwise (ODF states radians counter-clockwise)
func odfRotation(n *onode) (deg float64, tx, ty float64) {
	t := n.attr("transform")
	if t == "" {
		return 0, 0, 0
	}
	if i := strings.Index(t, "rotate"); i >= 0 {
		if open := strings.Index(t[i:], "("); open >= 0 {
			rest := t[i+open+1:]
			if close := strings.Index(rest, ")"); close >= 0 {
				deg = -parseNum(strings.TrimSpace(rest[:close])) * 180 / math.Pi
			}
		}
	}
	if i := strings.Index(t, "translate"); i >= 0 {
		if open := strings.Index(t[i:], "("); open >= 0 {
			rest := t[i+open+1:]
			if close := strings.Index(rest, ")"); close >= 0 {
				parts := strings.Fields(strings.TrimSpace(rest[:close]))
				if len(parts) == 2 {
					tx, ty = odfLenToPx(parts[0]), odfLenToPx(parts[1])
				}
			}
		}
	}
	return deg, tx, ty
}

func (cv *odpConverter) nextID() string {
	cv.seq++
	return fmt.Sprintf("o-odp-%d", cv.seq)
}

func (cv *odpConverter) add(slide *Slide, o *Object) {
	o.ID = cv.nextID()
	o.Z = len(slide.Objects) + 1
	slide.Objects = append(slide.Objects, o)
}

// styleOf resolves the drawing style of a shape, including the
// presentation style a placeholder inherits
func (cv *odpConverter) styleOf(n *onode) odpStyle {
	st := odpDefaultStyle
	st = cv.resolveStyle("#default-graphic", st)
	if ps := n.attr("class"); ps != "" && cv.master != nil {
		// a placeholder takes the master's matching frame's style
		if mf := cv.masterFrame(ps); mf != nil {
			st = cv.resolveStyle(mf.attr("style-name"), st)
			st = cv.resolveStyle(mf.attr("text-style-name"), st)
		}
	}
	st = cv.resolveStyle(n.attr("style-name"), st)
	st = cv.resolveStyle(n.attr("text-style-name"), st)
	return st
}

// masterFrame finds the placeholder frame of a given class on the master
func (cv *odpConverter) masterFrame(class string) *onode {
	if cv.master == nil {
		return nil
	}
	for _, c := range cv.master.children {
		if c.el != nil && c.el.name == "frame" && c.el.attr("class") == class {
			return c.el
		}
	}
	return nil
}

/* ---------------- shapes ---------------- */

func (cv *odpConverter) frame(n *onode, slide *Slide, ox, oy, kx, ky float64) {
	x, y, w, h := cv.geom(n, ox, oy, kx, ky)
	if (w <= 0 || h <= 0) && n.attr("class") != "" {
		// a placeholder with no geometry of its own takes the master's
		if mf := cv.masterFrame(n.attr("class")); mf != nil {
			x, y, w, h = cv.geom(mf, ox, oy, kx, ky)
		}
	}
	if w <= 0 || h <= 0 {
		return
	}
	rot, _, _ := odfRotation(n)
	st := cv.styleOf(n)

	if img := n.first("image"); img != nil {
		href := strings.TrimPrefix(img.attr("href"), "./")
		raw, ok := cv.files[href]
		if !ok {
			return
		}
		ext := strings.TrimPrefix(strings.ToLower(pathExtOf(href)), ".")
		if ext == "jpg" {
			ext = "jpeg"
		}
		if ext != "png" && ext != "jpeg" && ext != "gif" {
			return
		}
		props := Props{Src: "data:image/" + ext + ";base64," +
			base64.StdEncoding.EncodeToString(raw), Fit: "fill"}
		if c := odfClipFractions(n.attr("clip")); c != nil {
			props.Crop = c
		}
		cv.add(slide, &Object{Type: "image", X: x, Y: y, W: w, H: h, Rot: rot, Props: props})
		return
	}
	if tbl := n.first("table"); tbl != nil {
		cv.table(tbl, slide, x, y, w, h, st)
		return
	}
	if tb := n.first("text-box"); tb != nil {
		res := cv.buildText(tb, st)
		if res.HTML == "" {
			return
		}
		cv.add(slide, &Object{Type: "text", X: x, Y: y, W: w, H: h, Rot: rot,
			Props: cv.textProps(res, st)})
	}
}

// textProps assembles the editor properties of a text body
func (cv *odpConverter) textProps(res odpText, st odpStyle) Props {
	p := Props{
		HTML: res.HTML, FontSize: round2(ptToPx(res.First.SizePt)),
		Color: res.First.Color, Align: res.First.Align,
		Bold: res.First.Bold, Italic: res.First.Italic,
		Underline:  res.First.Underline,
		FontFamily: fontStackFor(res.First.Font, res.First.Font),
		VAlign:     st.VAlign,
		LineHeight: round2(odpLineHeight(res.First)),
	}
	if p.VAlign == "" {
		p.VAlign = "top"
	}
	if st.HasPad {
		p.Pad = []float64{round2(st.PadT), round2(st.PadR), round2(st.PadB), round2(st.PadL)}
	}
	return p
}

func odpLineHeight(st odpStyle) float64 {
	if st.LineHeight > 0 {
		return st.LineHeight
	}
	return pptxLineHeightFactor
}

func (cv *odpConverter) shape(n *onode, slide *Slide, ox, oy, kx, ky float64) {
	x, y, w, h := cv.geom(n, ox, oy, kx, ky)
	if w <= 0 || h <= 0 {
		return
	}
	rot, _, _ := odfRotation(n)
	st := cv.styleOf(n)
	kind := "rect"
	switch n.name {
	case "ellipse", "circle":
		kind = "ellipse"
	case "polygon", "regular-polygon":
		kind = "diamond"
	case "custom-shape":
		kind = odpCustomShapeKind(n)
	default:
		if n.attr("corner-radius") != "" {
			kind = "round"
		}
	}
	fill := st.Fill
	if fill == "" {
		fill = "#e07b1f"
	}
	stroke := st.Stroke
	if stroke == "none" {
		stroke = ""
	}
	res := cv.buildText(n, st)
	props := Props{Kind: kind, Fill: fill, Stroke: stroke, StrokeW: round2(st.StrokeW),
		Dash: st.Dash, HTML: res.HTML, Text: res.Plain,
		TextColor: res.First.Color, FontSize: round2(ptToPx(res.First.SizePt)),
		FontFamily: fontStackFor(res.First.Font, res.First.Font),
		Bold:       res.First.Bold, Italic: res.First.Italic,
		Align: res.First.Align, VAlign: st.VAlign,
		LineHeight: round2(odpLineHeight(res.First)),
	}
	if props.VAlign == "" {
		props.VAlign = "middle"
	}
	if st.HasPad {
		props.Pad = []float64{round2(st.PadT), round2(st.PadR), round2(st.PadB), round2(st.PadL)}
	}
	if r := odfLenToPx(n.attr("corner-radius")) * cv.sx; r > 0 {
		props.Radius = round2(r)
	}
	cv.add(slide, &Object{Type: "shape", X: x, Y: y, W: w, H: h, Rot: rot, Props: props})
}

// odpCustomShapeKind maps a draw:custom-shape's enhanced geometry type
func odpCustomShapeKind(n *onode) string {
	eg := n.first("enhanced-geometry")
	if eg == nil {
		return "rect"
	}
	switch eg.attr("type") {
	case "ellipse", "circle":
		return "ellipse"
	case "round-rectangle", "rounded-rectangle":
		return "round"
	case "isosceles-triangle", "triangle":
		return "triangle"
	case "right-triangle":
		return "rtTriangle"
	case "diamond":
		return "diamond"
	case "right-arrow":
		return "arrow"
	case "left-arrow":
		return "leftArrow"
	case "up-arrow":
		return "upArrow"
	case "down-arrow":
		return "downArrow"
	case "star5", "star":
		return "star"
	case "pentagon", "pentagon-right":
		return "chevron"
	case "hexagon":
		return "hexagon"
	case "parallelogram":
		return "parallelogram"
	case "trapezoid":
		return "trapezoid"
	case "cross":
		return "plus"
	}
	return "rect"
}

func (cv *odpConverter) line(n *onode, slide *Slide, ox, oy, kx, ky float64) {
	x1 := ox + odfLenToPx(n.attr("x1"))*cv.sx*kx
	y1 := oy + odfLenToPx(n.attr("y1"))*cv.sy*ky
	x2 := ox + odfLenToPx(n.attr("x2"))*cv.sx*kx
	y2 := oy + odfLenToPx(n.attr("y2"))*cv.sy*ky
	st := cv.styleOf(n)
	stroke := st.Stroke
	if stroke == "" || stroke == "none" {
		stroke = "#333333"
	}
	sw := st.StrokeW
	if sw <= 0 {
		sw = 2
	}
	cv.add(slide, &Object{Type: "line", X: x1, Y: y1, W: x2 - x1, H: y2 - y1,
		Props: Props{Stroke: stroke, StrokeW: round2(sw), Dash: st.Dash,
			ArrowEnd: st.ArrowEnd, ArrowStart: st.ArrowHead}})
}

func (cv *odpConverter) table(tbl *onode, slide *Slide, x, y, w, h float64, st odpStyle) {
	var rows [][]string
	var fills [][]string
	// relative column widths, so a table keeps its proportions
	var colW []float64
	var colSum float64
	for _, col := range tbl.all("table-column") {
		cw := 0.0
		if cs, ok := cv.styles[col.attr("style-name")]; ok {
			if tp := cs.first("table-column-properties"); tp != nil {
				cw = odfLenToPx(tp.attr("column-width"))
			}
		}
		colW = append(colW, cw)
		colSum += cw
	}
	if colSum <= 0 {
		colW = nil
	} else {
		for i := range colW {
			colW[i] = round2(colW[i] / colSum * 100)
		}
	}

	for _, tr := range tbl.all("table-row") {
		var row, rowFills []string
		for _, c := range tr.children {
			if c.el == nil || c.el.name != "table-cell" {
				continue
			}
			cellStyle := cv.resolveStyle(c.el.attr("style-name"), st)
			fill := ""
			if cs, ok := cv.styles[c.el.attr("style-name")]; ok {
				if tp := cs.first("table-cell-properties"); tp != nil {
					if v := tp.attr("background-color"); strings.HasPrefix(v, "#") {
						fill = strings.ToLower(v)
					}
				}
			}
			res := cv.buildText(c.el, cellStyle)
			row = append(row, res.HTML)
			rowFills = append(rowFills, fill)
			// a spanned cell occupies the columns it covers
			for i := 1; i < int(atofDefault(c.el.attr("number-columns-spanned"), 1)); i++ {
				row = append(row, "")
				rowFills = append(rowFills, fill)
			}
		}
		if len(row) > 0 {
			rows = append(rows, row)
			fills = append(fills, rowFills)
		}
	}
	if len(rows) == 0 {
		return
	}
	if !anyFilled(fills) {
		fills = nil
	}
	cv.add(slide, &Object{Type: "table", X: x, Y: y, W: w, H: h,
		Props: Props{Rows: rows, FontSize: round2(ptToPx(st.SizePt)),
			ColW: colW, CellFill: fills}})
}

/* ---------------- text ---------------- */

// odpText is the rendered HTML of a text body plus its first run's style
type odpText struct {
	HTML  string
	Plain string
	First odpStyle
}

// buildText renders every paragraph and list under a container into the
// editor's storage HTML, resolving each paragraph's and span's styles
func (cv *odpConverter) buildText(container *onode, base odpStyle) odpText {
	out := odpText{First: base}
	var sb strings.Builder
	var plain []string
	first := true
	counters := map[int]int{}

	var walk func(n *onode, depth int, listStyle string)
	walk = func(n *onode, depth int, listStyle string) {
		for _, c := range n.children {
			if c.el == nil {
				continue
			}
			switch c.el.name {
			case "p", "h":
				ps := cv.resolveStyle(c.el.attr("style-name"), base)
				bullet := ""
				if depth > 0 {
					bullet, counters = odpListMarker(cv.lists[listStyle], depth, counters)
				}
				html, text, firstRun := cv.paragraphHTML(c.el, ps, bullet, depth)
				if first && strings.TrimSpace(text) != "" {
					out.First = firstRun
					first = false
				}
				sb.WriteString(html)
				plain = append(plain, text)
			case "list":
				ls := c.el.attr("style-name")
				if ls == "" {
					ls = listStyle
				}
				if depth == 0 {
					counters = map[int]int{}
				}
				for _, item := range c.el.all("list-item") {
					walk(item, depth+1, ls)
				}
			case "text-box":
				walk(c.el, depth, listStyle)
			}
		}
	}
	walk(container, 0, "")

	out.HTML = sb.String()
	out.Plain = strings.Join(plain, "\n")
	if strings.TrimSpace(out.Plain) == "" {
		out.HTML = ""
	}
	return out
}

// paragraphHTML renders one text:p / text:h into a storage-HTML block
func (cv *odpConverter) paragraphHTML(p *onode, ps odpStyle, bullet string, depth int) (string, string, odpStyle) {
	var runs strings.Builder
	var text strings.Builder
	firstRun := ps
	haveRun := false
	minSize := 0.0

	var emit func(n *onode, st odpStyle)
	emit = func(n *onode, st odpStyle) {
		for _, c := range n.children {
			if c.el == nil {
				if c.text == "" {
					continue
				}
				if !haveRun {
					firstRun = st
					haveRun = true
				}
				if minSize == 0 || st.SizePt < minSize {
					minSize = st.SizePt
				}
				runs.WriteString(`<span style="` + odpRunCSS(st) + `">` +
					xmlEscape(c.text) + `</span>`)
				text.WriteString(c.text)
				continue
			}
			switch c.el.name {
			case "span":
				emit(c.el, cv.resolveStyle(c.el.attr("style-name"), st))
			case "a":
				emit(c.el, st)
			case "line-break":
				runs.WriteString("<br>")
				text.WriteString("\n")
			case "tab":
				runs.WriteString(`<span style="` + odpRunCSS(st) + `">&#9;</span>`)
				text.WriteString("\t")
			case "s":
				n := int(atofDefault(c.el.attr("c"), 1))
				runs.WriteString(strings.Repeat(" ", n))
				text.WriteString(strings.Repeat(" ", n))
			default:
				emit(c.el, st)
			}
		}
	}
	emit(p, ps)
	if minSize <= 0 {
		minSize = ps.SizePt
	}

	var css strings.Builder
	css.WriteString("text-align:" + ps.Align + ";")
	css.WriteString("line-height:" + strconv.FormatFloat(round2(odpLineHeight(ps)), 'f', -1, 64) + ";")
	css.WriteString("font-size:" + fmtPx(ptToPx(minSize)) + ";")
	if ps.SpaceTop > 0 {
		css.WriteString("margin-top:" + fmtPx(ps.SpaceTop) + ";")
	}
	if ps.SpaceBot > 0 {
		css.WriteString("margin-bottom:" + fmtPx(ps.SpaceBot) + ";")
	}
	marL := ps.MarginLeft
	if depth > 0 && marL == 0 {
		marL = float64(depth) * 24
	}
	if marL != 0 {
		css.WriteString("padding-left:" + fmtPx(marL) + ";")
	}
	body := runs.String()
	marker := ""
	if bullet != "" {
		indent := ps.Indent
		if indent == 0 {
			indent = -18
		}
		css.WriteString("position:relative;")
		bs := firstRun
		bs.Underline, bs.Strike, bs.Highlight = false, false, ""
		marker = `<span style="position:absolute;left:` + fmtPx(marL+indent) + `;` +
			odpRunCSS(bs) + `">` + xmlEscape(bullet) + `</span>`
	} else if ps.Indent != 0 {
		css.WriteString("text-indent:" + fmtPx(ps.Indent) + ";")
	}
	if body == "" {
		body = `<span style="font-size:` + fmtPx(ptToPx(minSize)) + `">&#8203;</span>`
	}
	return `<div style="` + css.String() + `">` + marker + body + `</div>`,
		text.String(), firstRun
}

// odpRunCSS renders the inline style of one text run
func odpRunCSS(st odpStyle) string {
	var sb strings.Builder
	sb.WriteString("font-size:" + fmtPx(ptToPx(st.SizePt)) + ";")
	if st.Font != "" {
		sb.WriteString("font-family:" + fontStackFor(st.Font, st.Font) + ";")
	}
	weight := 0
	if st.Bold {
		weight = 700
	} else if w := fontWeightOf(st.Font); w != 0 {
		weight = w
	}
	if weight != 0 {
		sb.WriteString("font-weight:" + strconv.Itoa(weight) + ";")
	}
	if st.Italic {
		sb.WriteString("font-style:italic;")
	}
	deco := ""
	if st.Underline {
		deco = "underline"
	}
	if st.Strike {
		if deco != "" {
			deco += " "
		}
		deco += "line-through"
	}
	if deco != "" {
		sb.WriteString("text-decoration:" + deco + ";")
	}
	if st.Color != "" {
		sb.WriteString("color:" + st.Color + ";")
	}
	if st.Highlight != "" {
		sb.WriteString("background-color:" + st.Highlight + ";")
	}
	return sb.String()
}

// odpListMarker renders the marker of a list level, advancing the counter
// of a numbered list
func odpListMarker(listStyle *onode, depth int, counters map[int]int) (string, map[int]int) {
	bullet := "•"
	if listStyle != nil {
		for _, lvl := range listStyle.children {
			if lvl.el == nil {
				continue
			}
			if int(atofDefault(lvl.el.attr("level"), 0)) != depth {
				continue
			}
			switch lvl.el.name {
			case "list-level-style-bullet":
				if c := lvl.el.attr("bullet-char"); c != "" {
					bullet = c
				}
			case "list-level-style-number":
				counters[depth]++
				return numberedMarker(lvl.el, counters[depth]), counters
			}
		}
	}
	return bullet, counters
}

func numberedMarker(lvl *onode, n int) string {
	format := lvl.attr("num-format")
	prefix := lvl.attr("num-prefix")
	suffix := lvl.attr("num-suffix")
	if suffix == "" {
		suffix = "."
	}
	var body string
	switch format {
	case "a":
		body = alphaMarker(n, 'a')
	case "A":
		body = alphaMarker(n, 'A')
	case "i":
		body = strings.ToLower(romanMarker(n))
	case "I":
		body = romanMarker(n)
	default:
		body = strconv.Itoa(n)
	}
	return prefix + body + suffix
}

// odfClipFractions turns an fo:clip rect into the editor's crop fractions.
// ODF states the clip as inset lengths, which is only convertible into
// fractions when the frame states them as percentages.
func odfClipFractions(clip string) []float64 {
	clip = strings.TrimSpace(clip)
	if !strings.HasPrefix(clip, "rect(") || !strings.HasSuffix(clip, ")") {
		return nil
	}
	parts := strings.FieldsFunc(clip[5:len(clip)-1], func(r rune) bool {
		return r == ',' || r == ' '
	})
	if len(parts) != 4 {
		return nil
	}
	out := make([]float64, 4)
	// fo:clip lists top, right, bottom, left; the editor wants l,t,r,b
	order := []int{3, 0, 1, 2}
	for i, src := range order {
		v := strings.TrimSpace(parts[src])
		if !strings.HasSuffix(v, "%") {
			return nil
		}
		out[i] = round4(parseNum(v) / 100)
	}
	return out
}
