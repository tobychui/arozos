package pptx

/*
	fill.go - slide backgrounds and the fills they are made of.

	A slide's background is whatever the first of slide, layout and master
	states in its <p:bg>: either a fill of its own (<p:bgPr> holding a solid,
	gradient or picture fill) or a reference into the theme (<p:bgRef idx>,
	where 1001 and up pick the theme's background fill styles and the colour
	inside the reference stands in for "phClr" in that style).

	Pictures and gradients are the common case in real decks - a template's
	photo or texture, a soft blue gradient - and dropping them leaves white
	text on a white slide. They come through as Slide.BgImage and
	Slide.BgGrad; the editor draws them under every object, and so does the
	PDF exporter.
*/

import (
	"bytes"
	"fmt"
	"image"
	"math"
	"path"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/office/internal/htmlutil"
	"imuslab.com/arozos/mod/office/internal/media"
	"imuslab.com/arozos/mod/office/internal/units"
	"imuslab.com/arozos/mod/office/internal/xmltree"
	"imuslab.com/arozos/mod/office/metafile"
	"imuslab.com/arozos/mod/office/model"
)

// srgbClrXML writes a colour as <a:srgbClr>, with an <a:alpha> child when
// it is "#rrggbbaa" and less than opaque
func srgbClrXML(c, fallback string) string {
	hex := htmlutil.HexColor(c, fallback)
	a := htmlutil.HexAlpha(c)
	if a >= 0.998 {
		return `<a:srgbClr val="` + hex + `"/>`
	}
	return `<a:srgbClr val="` + hex + `"><a:alpha val="` +
		strconv.Itoa(int(math.Round(a*100000))) + `"/></a:srgbClr>`
}

// bgSource is one part that may state a background, with the
// relationships its picture references resolve through
type bgSource struct {
	node *xmltree.Node
	rels map[string]string
	dir  string
}

// slideBackground resolves the slide's background: its own, then its
// layout's, then its master's - the first one that states a fill wins
func (sc *slideCtx) slideBackground(tree *xmltree.Node) (string, *model.BgImage, *model.Gradient) {
	for _, src := range []bgSource{
		{tree, sc.rels, sc.baseDir},
		{sc.layout, sc.layoutRels, sc.layoutDir},
		{sc.master, sc.masterRels, sc.masterDir},
	} {
		bg := src.node.Path("cSld", "bg")
		if bg == nil {
			continue
		}
		if pr := bg.First("bgPr"); pr != nil {
			if c, img, grad, ok := sc.backgroundFill(pr, src.rels, src.dir, sc.cc); ok {
				return c, img, grad
			}
		}
		if ref := bg.First("bgRef"); ref != nil {
			if c, img, grad, ok := sc.backgroundRef(ref); ok {
				return c, img, grad
			}
		}
	}
	return "", nil, nil
}

// backgroundRef resolves <p:bgRef>: idx 1001+ is the theme's background
// fill style list, 1..999 its ordinary fill style list (0 = no fill), and
// the colour child is what the style's "phClr" means here
func (sc *slideCtx) backgroundRef(ref *xmltree.Node) (string, *model.BgImage, *model.Gradient, bool) {
	ph := ""
	for i := range ref.Nodes {
		if c := sc.cc.resolveColor(&ref.Nodes[i]); c != "" {
			ph = c
			break
		}
	}
	idx := int(units.AtofDefault(ref.Attr("idx"), 0))
	var lst *xmltree.Node
	switch {
	case idx >= 1001:
		lst = sc.fmtScheme.First("bgFillStyleLst")
		idx -= 1000
	case idx >= 1:
		lst = sc.fmtScheme.First("fillStyleLst")
	}
	if lst != nil && idx >= 1 && idx <= len(lst.Nodes) {
		// the style is a bare fill element; wrap it so it reads like the
		// fill container backgroundFill expects
		holder := &xmltree.Node{Nodes: []xmltree.Node{lst.Nodes[idx-1]}}
		cc := sc.cc
		cc.phClr = strings.TrimPrefix(ph, "#")
		if c, img, grad, ok := sc.backgroundFill(holder, sc.themeRels, sc.themeDir, cc); ok {
			return c, img, grad, true
		}
	}
	if ph != "" {
		return ph, nil, nil, true
	}
	return "", nil, nil, false
}

// backgroundFill reads one fill container as a background. ok is false
// when it states nothing usable, so the next part down gets its turn.
func (sc *slideCtx) backgroundFill(pr *xmltree.Node, rels map[string]string, dir string, cc colorCtx) (string, *model.BgImage, *model.Gradient, bool) {
	if pr.First("noFill") != nil {
		return "#ffffff", nil, nil, true
	}
	if c := cc.solidFillOf(pr); c != "" {
		return c, nil, nil, true
	}
	if gf := pr.First("gradFill"); gf != nil {
		if g := cc.gradientOf(gf); g != nil {
			// the first stop doubles as the plain colour, for anything
			// that cannot draw the gradient itself
			return opaqueHex(g.Stops[0].Color), nil, g, true
		}
	}
	if bf := pr.First("blipFill"); bf != nil {
		if img := sc.backgroundPicture(bf, rels, dir); img != nil {
			return "", img, nil, true
		}
	}
	if fg := pr.Path("pattFill", "fgClr"); fg != nil {
		for i := range fg.Nodes {
			if c := cc.resolveColor(&fg.Nodes[i]); c != "" {
				return c, nil, nil, true
			}
		}
	}
	return "", nil, nil, false
}

// backgroundPicture places a background blipFill on the slide: stretched
// into the slide inset by <a:fillRect> (negative insets reach past the
// edges), the source first cropped by <a:srcRect>, or tiled
func (sc *slideCtx) backgroundPicture(bf *xmltree.Node, rels map[string]string, dir string) *model.BgImage {
	blip := bf.First("blip")
	src, pxW, pxH, ok := sc.doc.blipSource(blip, rels, dir)
	if !ok {
		return nil
	}
	W, H := sc.doc.slideW, sc.doc.slideH
	img := &model.BgImage{Src: src, X: 0, Y: 0, W: W, H: H}
	if am := blip.First("alphaModFix"); am != nil {
		if o := clamp01(units.AtofDefault(am.Attr("amt"), 100000) / 100000); o < 1 {
			img.Opacity = units.Round2(o)
		}
	}
	if tile := bf.First("tile"); tile != nil && pxW > 0 && pxH > 0 {
		// a tile is the picture at its own size (taken as 96 dpi, which is
		// how PowerPoint sizes a picture with no resolution of its own),
		// scaled by sx / sy, the first one offset by tx / ty
		kx := units.AtofDefault(tile.Attr("sx"), 100000) / 100000
		ky := units.AtofDefault(tile.Attr("sy"), 100000) / 100000
		img.Tile = true
		img.W = units.Round2(float64(pxW) * kx * sc.doc.sx)
		img.H = units.Round2(float64(pxH) * ky * sc.doc.sy)
		img.X = units.Round2(units.AtofDefault(tile.Attr("tx"), 0) / units.EmuPerPx * sc.doc.sx)
		img.Y = units.Round2(units.AtofDefault(tile.Attr("ty"), 0) / units.EmuPerPx * sc.doc.sy)
		if img.W < 1 || img.H < 1 {
			img.Tile, img.X, img.Y, img.W, img.H = false, 0, 0, W, H
		}
		return img
	}
	x, y, w, h := 0.0, 0.0, W, H
	if fr := bf.Path("stretch", "fillRect"); fr != nil {
		l := units.AtofDefault(fr.Attr("l"), 0) / 100000
		t := units.AtofDefault(fr.Attr("t"), 0) / 100000
		r := units.AtofDefault(fr.Attr("r"), 0) / 100000
		b := units.AtofDefault(fr.Attr("b"), 0) / 100000
		x, y = l*W, t*H
		w, h = W*(1-l-r), H*(1-t-b)
	}
	// a cropped source is the whole picture drawn larger, with the kept
	// part landing on the rectangle - the slide's edges clip the rest
	if sr := bf.First("srcRect"); sr != nil {
		l := units.AtofDefault(sr.Attr("l"), 0) / 100000
		t := units.AtofDefault(sr.Attr("t"), 0) / 100000
		r := units.AtofDefault(sr.Attr("r"), 0) / 100000
		b := units.AtofDefault(sr.Attr("b"), 0) / 100000
		if kw, kh := 1-l-r, 1-t-b; kw > 0.001 && kh > 0.001 {
			fw, fh := w/kw, h/kh
			x, y, w, h = x-l*fw, y-t*fh, fw, fh
		}
	}
	if w <= 0 || h <= 0 {
		x, y, w, h = 0, 0, W, H
	}
	img.X, img.Y, img.W, img.H = units.Round2(x), units.Round2(y), units.Round2(w), units.Round2(h)
	return img
}

// blipSource reads the picture an <a:blip r:embed> points at, through the
// given part's relationships, as a data URL the browser can show, plus its
// size in pixels when the format says (0 otherwise)
func (d *pptxDoc) blipSource(blip *xmltree.Node, rels map[string]string, dir string) (string, int, int, bool) {
	if blip == nil || rels == nil {
		return "", 0, 0, false
	}
	rid := blip.AttrNS("relationships", "embed")
	if rid == "" {
		for _, a := range blip.Attrs {
			if a.Name.Local == "embed" {
				rid = a.Value
			}
		}
	}
	target, ok := rels[rid]
	if !ok {
		return "", 0, 0, false
	}
	mediaPath := xmltree.ResolvePart(dir, target)
	data, ok := d.files[mediaPath]
	if !ok || len(data) == 0 {
		return "", 0, 0, false
	}
	ext := strings.TrimPrefix(strings.ToLower(path.Ext(mediaPath)), ".")
	data, ext, _ = metafile.BrowserPicture(data, ext)
	w, h := 0, 0
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(data)); err == nil {
		w, h = cfg.Width, cfg.Height
	}
	return media.EncodeDataURL(data, ext), w, h, true
}

// gradientOf reads an <a:gradFill>: its stops in order, and either a
// linear direction (<a:lin ang>, 60000ths of a degree clockwise from
// pointing right) or a radial centre (<a:path> with the <a:fillToRect>
// focus). Path gradients run from the focus (stop 0) outwards.
func (cc *colorCtx) gradientOf(gf *xmltree.Node) *model.Gradient {
	lst := gf.First("gsLst")
	if lst == nil {
		return nil
	}
	g := &model.Gradient{Kind: "linear", Angle: 90}
	for _, gs := range lst.All("gs") {
		for i := range gs.Nodes {
			if c := cc.resolveColor(&gs.Nodes[i]); c != "" {
				g.Stops = append(g.Stops, model.GradientStop{
					Pos:   units.Round4(clamp01(units.AtofDefault(gs.Attr("pos"), 0) / 100000)),
					Color: withAlpha(c, colorAlpha(&gs.Nodes[i])),
				})
				break
			}
		}
	}
	if len(g.Stops) == 0 {
		return nil
	}
	// stops may be listed in any order
	for i := 1; i < len(g.Stops); i++ {
		for j := i; j > 0 && g.Stops[j].Pos < g.Stops[j-1].Pos; j-- {
			g.Stops[j], g.Stops[j-1] = g.Stops[j-1], g.Stops[j]
		}
	}
	if lin := gf.First("lin"); lin != nil {
		// DrawingML's 0 points right; CSS's points up
		g.Angle = units.Round2(math.Mod(units.AtofDefault(lin.Attr("ang"), 0)/60000+90, 360))
	} else if p := gf.First("path"); p != nil {
		g.Kind = "radial"
		g.Angle = 0
		g.CX, g.CY = 0.5, 0.5
		if fr := p.First("fillToRect"); fr != nil {
			l := units.AtofDefault(fr.Attr("l"), 0) / 100000
			t := units.AtofDefault(fr.Attr("t"), 0) / 100000
			r := units.AtofDefault(fr.Attr("r"), 0) / 100000
			b := units.AtofDefault(fr.Attr("b"), 0) / 100000
			g.CX = units.Round4((l + 1 - r) / 2)
			g.CY = units.Round4((t + 1 - b) / 2)
		}
	}
	return g
}

// opaqueHex drops the alpha of a "#rrggbbaa" colour
func opaqueHex(c string) string {
	if len(c) == 9 && c[0] == '#' {
		return c[:7]
	}
	return c
}

// shapeFill resolves a shape's fill: the colour (or "none"), plus the
// gradient when the fill is one. A shape that states no fill of its own
// takes the theme style its <p:style><a:fillRef> points at - the style
// matrix entry, with the reference's colour as its phClr.
func (sc *slideCtx) shapeFill(node, spPr *xmltree.Node) (string, *model.Gradient) {
	if spPr != nil {
		if gf := spPr.First("gradFill"); gf != nil && spPr.First("noFill") == nil {
			if g := sc.cc.gradientOf(gf); g != nil {
				return opaqueHex(g.Stops[0].Color), g
			}
		}
		if c := sc.cc.fillColorOf(spPr); c != "" {
			return c, nil
		}
	}
	return sc.styleRefFill(node)
}

// styleRefFill resolves <p:style><a:fillRef idx> through the theme's fill
// style list (idx 1..3, 0 = no fill; 1001+ are background styles)
func (sc *slideCtx) styleRefFill(node *xmltree.Node) (string, *model.Gradient) {
	ref := node.Path("style", "fillRef")
	if ref == nil {
		return "", nil
	}
	return sc.fillRefFill(ref)
}

// fillRefFill resolves one <a:fillRef idx> (a shape style's, or a table
// style part's) through the theme's fill style lists
func (sc *slideCtx) fillRefFill(ref *xmltree.Node) (string, *model.Gradient) {
	idx := int(units.AtofDefault(ref.Attr("idx"), 0))
	if idx == 0 {
		return "none", nil
	}
	ph := ""
	for i := range ref.Nodes {
		if c := sc.cc.resolveColor(&ref.Nodes[i]); c != "" {
			ph = c
			break
		}
	}
	var lst *xmltree.Node
	if idx >= 1001 {
		lst = sc.fmtScheme.First("bgFillStyleLst")
		idx -= 1000
	} else {
		lst = sc.fmtScheme.First("fillStyleLst")
	}
	if lst != nil && idx >= 1 && idx <= len(lst.Nodes) {
		style := &lst.Nodes[idx-1]
		cc := sc.cc
		cc.phClr = strings.TrimPrefix(ph, "#")
		holder := &xmltree.Node{Nodes: []xmltree.Node{*style}}
		switch style.XMLName.Local {
		case "gradFill":
			if g := cc.gradientOf(style); g != nil {
				return opaqueHex(g.Stops[0].Color), g
			}
		case "noFill":
			return "none", nil
		default:
			if c := cc.fillColorOf(holder); c != "" {
				return c, nil
			}
		}
	}
	return ph, nil
}

// hasFillChoice reports whether a shape properties block states a fill
func hasFillChoice(spPr *xmltree.Node) bool {
	for _, k := range []string{"noFill", "solidFill", "gradFill", "blipFill", "pattFill", "grpFill"} {
		if spPr.First(k) != nil {
			return true
		}
	}
	return false
}

// pictureFillObject turns a picture-filled shape into a picture masked to
// the shape's outline. The picture is placed by <a:stretch><a:fillRect>
// (insets of the frame, negative ones reaching past it) after <a:srcRect>
// cropped its source; both fold into the editor's single crop.
func (sc *slideCtx) pictureFillObject(bf *xmltree.Node, prst string, box xfrmBox, stroke string, strokeW float64, dash bool) *model.Object {
	blip := bf.First("blip")
	src, _, _, ok := sc.doc.blipSource(blip, sc.partRels(), sc.partDir())
	if !ok {
		return nil
	}
	props := model.Props{Src: src, Fit: "fill"}
	sl, st, sr, sb := 0.0, 0.0, 0.0, 0.0
	if r := bf.First("srcRect"); r != nil {
		sl = units.AtofDefault(r.Attr("l"), 0) / 100000
		st = units.AtofDefault(r.Attr("t"), 0) / 100000
		sr = units.AtofDefault(r.Attr("r"), 0) / 100000
		sb = units.AtofDefault(r.Attr("b"), 0) / 100000
	}
	fl, ft, fr, fb := 0.0, 0.0, 0.0, 0.0
	if r := bf.Path("stretch", "fillRect"); r != nil {
		fl = units.AtofDefault(r.Attr("l"), 0) / 100000
		ft = units.AtofDefault(r.Attr("t"), 0) / 100000
		fr = units.AtofDefault(r.Attr("r"), 0) / 100000
		fb = units.AtofDefault(r.Attr("b"), 0) / 100000
	}
	kw, kh := 1-fl-fr, 1-ft-fb
	if kw > 0.001 && kh > 0.001 {
		// the frame's edges as fractions of the cropped source, then of
		// the whole picture
		cw, ch := 1-sl-sr, 1-st-sb
		l := sl + (-fl/kw)*cw
		r := sr + (-fr/kw)*cw
		t := st + (-ft/kh)*ch
		b := sb + (-fb/kh)*ch
		if math.Abs(l)+math.Abs(r)+math.Abs(t)+math.Abs(b) > 0.0001 {
			props.Crop = []float64{units.Round4(l), units.Round4(t), units.Round4(r), units.Round4(b)}
		}
	}
	if kind, ok := prstToShapeKind[prst]; ok && kind != "rect" {
		props.Mask = kind
	}
	props.FlipH, props.FlipV = box.FlipH, box.FlipV
	if stroke != "" && stroke != "none" && strokeW > 0 {
		props.Stroke, props.StrokeW, props.Dash = stroke, units.Round2(strokeW), dash
	}
	readPictureEffects(blip, &props)
	return &model.Object{
		Type: "image", X: box.X, Y: box.Y, W: box.W, H: box.H, Rot: box.Rot,
		Props: props,
	}
}

// hasVisibleText reports whether a text body has any text that shows
// (a run with <a:noFill/> does not)
func hasVisibleText(tx *xmltree.Node) bool {
	if tx == nil {
		return false
	}
	for _, p := range tx.All("p") {
		for _, r := range paraItems(p) {
			t := r.First("t")
			if t == nil || strings.TrimSpace(t.Text) == "" {
				continue
			}
			if rp := r.First("rPr"); rp != nil && rp.First("noFill") != nil {
				continue
			}
			return true
		}
	}
	return false
}

// walkDiagram draws a SmartArt graphic frame from the drawing PowerPoint
// stored with it (ppt/diagrams/drawingN.xml): ordinary shapes, laid out
// relative to the frame, which the reader walks like any other shapes.
// Reports false when the frame is not a diagram or has no drawing, so the
// caller treats it as the frame it is.
func (sc *slideCtx) walkDiagram(frame *xmltree.Node, cm coordMap, slide *model.Slide, z *int) bool {
	gdata := frame.Path("graphic", "graphicData")
	if gdata == nil || !strings.HasSuffix(gdata.Attr("uri"), "/diagram") {
		return false
	}
	ids := gdata.First("relIds")
	rels := sc.partRels()
	dir := sc.partDir()
	// the data part names its drawing (dsp:dataModelExt relId) among the
	// slide's relationships; failing that, the slide's only drawing
	drawingPath := ""
	var data *xmltree.Node
	if ids != nil {
		if target, ok := rels[ids.AttrNS("relationships", "dm")]; ok {
			if data = sc.doc.tree(xmltree.ResolvePart(dir, target)); data != nil {
				var ext []*xmltree.Node
				data.FindAll("dataModelExt", &ext)
				if len(ext) > 0 {
					if t, ok := rels[ext[0].Attr("relId")]; ok {
						drawingPath = xmltree.ResolvePart(dir, t)
					}
				}
			}
		}
	}
	if drawingPath == "" {
		for _, t := range rels {
			if strings.Contains(t, "diagrams/drawing") {
				if drawingPath != "" {
					return false // two drawings, and nothing to tell them apart
				}
				drawingPath = xmltree.ResolvePart(dir, t)
			}
		}
	}
	drawing := sc.doc.tree(drawingPath)
	spTree := drawing.First("spTree")
	if spTree == nil {
		return false
	}
	box := parseXfrm(frame.First("xfrm"), cm)
	if !box.OK {
		return false
	}
	// the drawing's coordinates start at the frame's corner, at the scale
	// of the space the frame sits in
	dcm := cm
	dcm.bx, dcm.by = box.X, box.Y
	dcm.cx, dcm.cy = 0, 0
	// the diagram's own background and outline (dgm:bg / dgm:whole) fill
	// the whole frame, under its shapes
	if data != nil {
		if bg := data.First("bg"); bg != nil {
			fill, grad := sc.shapeFill(&xmltree.Node{}, bg)
			stroke, sw, dash := sc.lineOf(data.First("whole"), cm)
			if (fill != "" && fill != "none") || (stroke != "" && stroke != "none" && sw > 0) {
				if fill == "" {
					fill = "none"
				}
				if stroke == "none" {
					stroke, sw = "", 0
				}
				sc.addObject(slide, &model.Object{Type: "shape", X: box.X, Y: box.Y, W: box.W, H: box.H,
					Props: model.Props{Kind: "rect", Fill: fill, FillGrad: grad, Stroke: stroke, StrokeW: units.Round2(sw), Dash: dash}}, z)
			}
		}
	}
	prevRels, prevDir := sc.curRels, sc.curDir
	sc.curRels, sc.curDir = sc.doc.relsFor(drawingPath), path.Dir(drawingPath)
	sc.walkShapes(spTree, dcm, slide, z, false)
	sc.curRels, sc.curDir = prevRels, prevDir
	return true
}

// gradFillXML writes a gradient as <a:gradFill>: the stops, and either the
// direction (CSS angle back to DrawingML's, 0 pointing right) or the centre
// of a radial one as a point-sized fillToRect
func gradFillXML(g *model.Gradient) string {
	var sb strings.Builder
	sb.WriteString(`<a:gradFill rotWithShape="1"><a:gsLst>`)
	for _, st := range g.Stops {
		sb.WriteString(fmt.Sprintf(`<a:gs pos="%d">%s</a:gs>`, int(math.Round(clamp01(st.Pos)*100000)), srgbClrXML(st.Color, "FFFFFF")))
	}
	sb.WriteString(`</a:gsLst>`)
	if g.Kind == "radial" {
		cx, cy := int(math.Round(g.CX*100000)), int(math.Round(g.CY*100000))
		sb.WriteString(fmt.Sprintf(`<a:path path="circle"><a:fillToRect l="%d" t="%d" r="%d" b="%d"/></a:path>`,
			cx, cy, 100000-cx, 100000-cy))
	} else {
		ang := math.Mod(g.Angle-90+360, 360)
		sb.WriteString(fmt.Sprintf(`<a:lin ang="%d" scaled="0"/>`, int(math.Round(ang*60000))))
	}
	sb.WriteString(`</a:gradFill>`)
	return sb.String()
}

// bgPictureXML writes a picture background, stretched to where the slide
// places it (fillRect insets, negative past the edges)
func bgPictureXML(im *model.BgImage, rid string, p *model.Presentation) string {
	W, H := p.Dims()
	w, h := float64(W), float64(H)
	blip := `<a:blip r:embed="` + rid + `">`
	if im.Opacity > 0 && im.Opacity < 1 {
		blip += fmt.Sprintf(`<a:alphaModFix amt="%d"/>`, int(math.Round(im.Opacity*100000)))
	}
	blip += `</a:blip>`
	if im.Tile || im.W <= 0 || im.H <= 0 {
		return `<a:blipFill rotWithShape="1">` + blip + `<a:stretch><a:fillRect/></a:stretch></a:blipFill>`
	}
	frac := func(v float64) int { return int(math.Round(v * 100000)) }
	return fmt.Sprintf(`<a:blipFill rotWithShape="1">%s<a:stretch><a:fillRect l="%d" t="%d" r="%d" b="%d"/></a:stretch></a:blipFill>`,
		blip, frac(im.X/w), frac(im.Y/h), frac((w-im.X-im.W)/w), frac((h-im.Y-im.H)/h))
}
