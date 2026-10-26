package office

/*
	pptx_reader.go - Parse a PowerPoint (.pptx) file into a Presentation.

	Supports the common subset of PresentationML the Slides webapp can
	represent: text boxes, preset-geometry shapes, straight connector lines,
	pictures (embedded media becomes data URLs), tables and speaker notes.
	Everything is scaled from the source slide size into the 960x540 px
	coordinate space of the Slides editor.
*/

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"path"
	"strconv"
	"strings"
)

// xnode is a generic XML tree node - far more practical for the OOXML
// subset we consume than rigid per-element structs
type xnode struct {
	XMLName xml.Name
	Attrs   []xml.Attr `xml:",any,attr"`
	Nodes   []xnode    `xml:",any"`
	Text    string     `xml:",chardata"`
}

func (n *xnode) attr(local string) string {
	for _, a := range n.Attrs {
		if a.Name.Local == local {
			return a.Value
		}
	}
	return ""
}

// first returns the first direct child with the given local name
func (n *xnode) first(local string) *xnode {
	for i := range n.Nodes {
		if n.Nodes[i].XMLName.Local == local {
			return &n.Nodes[i]
		}
	}
	return nil
}

// path walks nested first() lookups; returns nil when any hop is missing
func (n *xnode) path(locals ...string) *xnode {
	cur := n
	for _, l := range locals {
		cur = cur.first(l)
		if cur == nil {
			return nil
		}
	}
	return cur
}

// all returns every direct child with the given local name
func (n *xnode) all(local string) []*xnode {
	var out []*xnode
	for i := range n.Nodes {
		if n.Nodes[i].XMLName.Local == local {
			out = append(out, &n.Nodes[i])
		}
	}
	return out
}

func parseXMLTree(data []byte) (*xnode, error) {
	root := xnode{}
	if err := xml.Unmarshal(data, &root); err != nil {
		return nil, err
	}
	return &root, nil
}

var prstToShapeKind = map[string]string{
	"rect":       "rect",
	"roundRect":  "round",
	"ellipse":    "ellipse",
	"triangle":   "triangle",
	"diamond":    "diamond",
	"rightArrow": "arrow",
	"star5":      "star",
	"chevron":    "chevron",
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

	// source slide size -> scale into the 960x540 editor space
	scaleX, scaleY := 1.0, 1.0
	if sz := pres.first("sldSz"); sz != nil {
		cx, _ := strconv.ParseInt(sz.attr("cx"), 10, 64)
		cy, _ := strconv.ParseInt(sz.attr("cy"), 10, 64)
		if cx > 0 {
			scaleX = float64(slidePxW) / (float64(cx) / emuPerPx)
		}
		if cy > 0 {
			scaleY = float64(slidePxH) / (float64(cy) / emuPerPx)
		}
	}

	// slide order comes from sldIdLst rIds resolved through the rels part
	presRels := parseRels(files["ppt/_rels/presentation.xml.rels"])
	var slidePaths []string
	if lst := pres.first("sldIdLst"); lst != nil {
		for _, sid := range lst.all("sldId") {
			rid := sid.attr("id")
			// r:id attribute has namespace; attr() matches by local name "id"
			// but sldId also has its own "id" - find the relationship one
			for _, a := range sid.Attrs {
				if a.Name.Local == "id" && strings.HasPrefix(a.Value, "rId") {
					rid = a.Value
				}
			}
			if target, ok := presRels[rid]; ok {
				slidePaths = append(slidePaths, resolvePartPath("ppt", target))
			}
		}
	}
	if len(slidePaths) == 0 {
		// fall back to natural order slide1..slideN
		for i := 1; ; i++ {
			p := fmt.Sprintf("ppt/slides/slide%d.xml", i)
			if _, ok := files[p]; !ok {
				break
			}
			slidePaths = append(slidePaths, p)
		}
	}
	if len(slidePaths) == 0 {
		return nil, errors.New("pptx contains no slides")
	}

	out := &Presentation{
		Size:   []int{slidePxW, slidePxH},
		Theme:  "clean",
		Slides: []*Slide{},
	}

	for si, sp := range slidePaths {
		raw, ok := files[sp]
		if !ok {
			continue
		}
		tree, err := parseXMLTree(raw)
		if err != nil {
			continue
		}
		relsPath := path.Dir(sp) + "/_rels/" + path.Base(sp) + ".rels"
		rels := parseRels(files[relsPath])
		slide := parseSlide(tree, rels, files, path.Dir(sp), scaleX, scaleY)
		slide.ID = fmt.Sprintf("s-import%d", si+1)
		slide.Notes = extractNotes(files, rels, path.Dir(sp))
		out.Slides = append(out.Slides, slide)
	}

	if len(out.Slides) == 0 {
		return nil, errors.New("no readable slides found in pptx")
	}
	return out, nil
}

// parseRels maps rId -> target path from a .rels part
func parseRels(data []byte) map[string]string {
	out := map[string]string{}
	if data == nil {
		return out
	}
	tree, err := parseXMLTree(data)
	if err != nil {
		return out
	}
	for _, rel := range tree.all("Relationship") {
		out[rel.attr("Id")] = rel.attr("Target")
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

// extractNotes pulls the plain text of the linked notesSlide part, if any
func extractNotes(files map[string][]byte, rels map[string]string, baseDir string) string {
	for _, target := range rels {
		if !strings.Contains(target, "notesSlide") {
			continue
		}
		p := resolvePartPath(baseDir, target)
		raw, ok := files[p]
		if !ok {
			continue
		}
		tree, err := parseXMLTree(raw)
		if err != nil {
			continue
		}
		var texts []string
		collectText(tree, &texts)
		return strings.Join(texts, "\n")
	}
	return ""
}

// collectText gathers every <a:t> text node under n
func collectText(n *xnode, out *[]string) {
	if n.XMLName.Local == "t" {
		if strings.TrimSpace(n.Text) != "" {
			*out = append(*out, n.Text)
		}
		return
	}
	for i := range n.Nodes {
		collectText(&n.Nodes[i], out)
	}
}

// parseSlide converts one slide part into the editor model
func parseSlide(tree *xnode, rels map[string]string, files map[string][]byte, baseDir string, sx, sy float64) *Slide {
	slide := &Slide{Objects: []*Object{}}

	// explicit background color
	if bg := tree.path("cSld", "bg", "bgPr", "solidFill", "srgbClr"); bg != nil {
		if v := bg.attr("val"); v != "" {
			slide.Bg = "#" + strings.ToLower(v)
		}
	}

	spTree := tree.path("cSld", "spTree")
	if spTree == nil {
		return slide
	}

	z := 1
	for i := range spTree.Nodes {
		node := &spTree.Nodes[i]
		var obj *Object
		switch node.XMLName.Local {
		case "sp":
			obj = parseSp(node, sx, sy)
		case "cxnSp":
			obj = parseCxnSp(node, sx, sy)
		case "pic":
			obj = parsePic(node, rels, files, baseDir, sx, sy)
		case "graphicFrame":
			obj = parseGraphicFrame(node, sx, sy)
		}
		if obj != nil {
			obj.ID = fmt.Sprintf("o-import%d", z)
			obj.Z = z
			z++
			slide.Objects = append(slide.Objects, obj)
		}
	}
	return slide
}

// parseXfrm extracts position/size/rotation/flips from an xfrm block
func parseXfrm(xf *xnode, sx, sy float64) (x, y, w, h, rot float64, flipH, flipV bool, ok bool) {
	if xf == nil {
		return 0, 0, 0, 0, 0, false, false, false
	}
	off := xf.first("off")
	ext := xf.first("ext")
	if off == nil || ext == nil {
		return 0, 0, 0, 0, 0, false, false, false
	}
	ox, _ := strconv.ParseInt(off.attr("x"), 10, 64)
	oy, _ := strconv.ParseInt(off.attr("y"), 10, 64)
	cx, _ := strconv.ParseInt(ext.attr("cx"), 10, 64)
	cy, _ := strconv.ParseInt(ext.attr("cy"), 10, 64)
	x = emuToPx(ox, sx)
	y = emuToPx(oy, sy)
	w = emuToPx(cx, sx)
	h = emuToPx(cy, sy)
	if r := xf.attr("rot"); r != "" {
		rv, _ := strconv.ParseInt(r, 10, 64)
		rot = float64(rv) / 60000.0
	}
	flipH = xf.attr("flipH") == "1"
	flipV = xf.attr("flipV") == "1"
	return x, y, w, h, rot, flipH, flipV, true
}

// parseTxBody flattens a txBody into html lines + first-run formatting
func parseTxBody(tx *xnode) (html string, fontSize float64, color string, bold, italic, underline bool, align string) {
	var lines []string
	fontSize = 0
	for _, p := range tx.all("p") {
		if ppr := p.first("pPr"); ppr != nil && align == "" {
			switch ppr.attr("algn") {
			case "ctr":
				align = "center"
			case "r":
				align = "right"
			case "just":
				align = "justify"
			}
		}
		var parts []string
		for _, r := range p.all("r") {
			if t := r.first("t"); t != nil {
				parts = append(parts, t.Text)
			}
			if rpr := r.first("rPr"); rpr != nil {
				if fontSize == 0 {
					if szv, err := strconv.ParseFloat(rpr.attr("sz"), 64); err == nil && szv > 0 {
						// hundredths of a point -> px (96dpi)
						fontSize = szv / 100.0 / 0.75
					}
				}
				if rpr.attr("b") == "1" {
					bold = true
				}
				if rpr.attr("i") == "1" {
					italic = true
				}
				if u := rpr.attr("u"); u != "" && u != "none" {
					underline = true
				}
				if color == "" {
					if c := rpr.path("solidFill", "srgbClr"); c != nil {
						if v := c.attr("val"); v != "" {
							color = "#" + strings.ToLower(v)
						}
					}
				}
			}
		}
		lines = append(lines, strings.Join(parts, ""))
	}
	// drop empty trailing lines
	for len(lines) > 1 && strings.TrimSpace(lines[len(lines)-1]) == "" {
		lines = lines[:len(lines)-1]
	}
	html = linesToHTML(lines)
	return html, fontSize, color, bold, italic, underline, align
}

// parseSp handles p:sp - a text box or a preset-geometry shape
func parseSp(node *xnode, sx, sy float64) *Object {
	spPr := node.first("spPr")
	if spPr == nil {
		return nil
	}
	x, y, w, h, rot, _, _, ok := parseXfrm(spPr.first("xfrm"), sx, sy)
	if !ok || w <= 0 || h <= 0 {
		return nil
	}

	prst := ""
	if g := spPr.first("prstGeom"); g != nil {
		prst = g.attr("prst")
	}
	fill := ""
	if c := spPr.path("solidFill", "srgbClr"); c != nil {
		if v := c.attr("val"); v != "" {
			fill = "#" + strings.ToLower(v)
		}
	}

	tx := node.first("txBody")
	var html string
	var fontSize float64
	var color, align string
	var bold, italic, underline bool
	if tx != nil {
		html, fontSize, color, bold, italic, underline, align = parseTxBody(tx)
	}

	kind, isShape := prstToShapeKind[prst]
	// an sp with a visible fill or a non-rect preset is treated as a shape;
	// an unfilled rect with text is a plain text box
	if fill != "" || (isShape && prst != "rect") {
		if !isShape {
			kind = "rect"
		}
		strokeW := 0.0
		stroke := ""
		if ln := spPr.first("ln"); ln != nil {
			if wAttr := ln.attr("w"); wAttr != "" {
				lv, _ := strconv.ParseInt(wAttr, 10, 64)
				strokeW = float64(lv) / emuPerPx
			}
			if c := ln.path("solidFill", "srgbClr"); c != nil {
				if v := c.attr("val"); v != "" {
					stroke = "#" + strings.ToLower(v)
				}
			}
		}
		if fill == "" {
			fill = "#e07b1f"
		}
		text := ""
		if html != "" {
			// shapes carry plain text only
			text = strings.ReplaceAll(html, "<br>", "\n")
			text = strings.ReplaceAll(text, "&amp;", "&")
			text = strings.ReplaceAll(text, "&lt;", "<")
			text = strings.ReplaceAll(text, "&gt;", ">")
			text = strings.ReplaceAll(text, "&quot;", "\"")
			text = strings.ReplaceAll(text, "&apos;", "'")
		}
		fs := fontSize
		if fs <= 0 {
			fs = 18
		}
		return &Object{
			Type: "shape", X: x, Y: y, W: w, H: h, Rot: rot,
			Props: Props{
				Kind: kind, Fill: fill, Stroke: stroke, StrokeW: strokeW,
				Text: text, TextColor: color, FontSize: fs, Bold: bold,
			},
		}
	}

	// plain text box
	if tx == nil {
		return nil
	}
	fs := fontSize
	if fs <= 0 {
		fs = 24
	}
	if align == "" {
		align = "left"
	}
	return &Object{
		Type: "text", X: x, Y: y, W: w, H: h, Rot: rot,
		Props: Props{
			HTML: html, FontSize: fs, Color: color, Align: align,
			Bold: bold, Italic: italic, Underline: underline,
		},
	}
}

// parseCxnSp handles p:cxnSp - straight connector lines
func parseCxnSp(node *xnode, sx, sy float64) *Object {
	spPr := node.first("spPr")
	if spPr == nil {
		return nil
	}
	x, y, w, h, _, flipH, flipV, ok := parseXfrm(spPr.first("xfrm"), sx, sy)
	if !ok {
		return nil
	}
	stroke := "#202124"
	strokeW := 2.0
	dash := false
	arrowEnd := false
	if ln := spPr.first("ln"); ln != nil {
		if wAttr := ln.attr("w"); wAttr != "" {
			lv, _ := strconv.ParseInt(wAttr, 10, 64)
			if lv > 0 {
				strokeW = float64(lv) / emuPerPx
			}
		}
		if c := ln.path("solidFill", "srgbClr"); c != nil {
			if v := c.attr("val"); v != "" {
				stroke = "#" + strings.ToLower(v)
			}
		}
		if d := ln.first("prstDash"); d != nil && d.attr("val") != "solid" {
			dash = true
		}
		if te := ln.first("tailEnd"); te != nil && te.attr("type") != "none" && te.attr("type") != "" {
			arrowEnd = true
		}
	}
	// the editor stores lines as start point + vector; flips give direction
	ox, oy, vw, vh := x, y, w, h
	if flipH {
		ox = x + w
		vw = -w
	}
	if flipV {
		oy = y + h
		vh = -h
	}
	return &Object{
		Type: "line", X: ox, Y: oy, W: vw, H: vh,
		Props: Props{Stroke: stroke, StrokeW: strokeW, Dash: dash, ArrowEnd: arrowEnd},
	}
}

// parsePic handles p:pic - embedded pictures become data URLs
func parsePic(node *xnode, rels map[string]string, files map[string][]byte, baseDir string, sx, sy float64) *Object {
	spPr := node.first("spPr")
	if spPr == nil {
		return nil
	}
	x, y, w, h, rot, _, _, ok := parseXfrm(spPr.first("xfrm"), sx, sy)
	if !ok || w <= 0 || h <= 0 {
		return nil
	}
	blip := node.path("blipFill", "blip")
	if blip == nil {
		return nil
	}
	rid := ""
	for _, a := range blip.Attrs {
		if a.Name.Local == "embed" {
			rid = a.Value
		}
	}
	target, ok2 := rels[rid]
	if !ok2 {
		return nil
	}
	mediaPath := resolvePartPath(baseDir, target)
	data, ok3 := files[mediaPath]
	if !ok3 {
		return nil
	}
	ext := strings.TrimPrefix(strings.ToLower(path.Ext(mediaPath)), ".")
	return &Object{
		Type: "image", X: x, Y: y, W: w, H: h, Rot: rot,
		Props: Props{Src: encodeDataURL(data, ext), Fit: "fill"},
	}
}

// parseGraphicFrame handles p:graphicFrame - tables (charts are skipped)
func parseGraphicFrame(node *xnode, sx, sy float64) *Object {
	x, y, w, h, _, _, _, ok := parseXfrm(node.first("xfrm"), sx, sy)
	if !ok || w <= 0 || h <= 0 {
		return nil
	}
	tbl := node.path("graphic", "graphicData", "tbl")
	if tbl == nil {
		return nil
	}
	headerRow := false
	if tp := tbl.first("tblPr"); tp != nil {
		headerRow = tp.attr("firstRow") == "1"
	}
	// column proportions from the grid definition
	var colW []float64
	if grid := tbl.first("tblGrid"); grid != nil {
		var ws []float64
		var sum float64
		for _, gc := range grid.all("gridCol") {
			v, _ := strconv.ParseFloat(gc.attr("w"), 64)
			ws = append(ws, v)
			sum += v
		}
		if sum > 0 && len(ws) > 1 {
			for _, v := range ws {
				colW = append(colW, v/sum*100.0)
			}
		}
	}
	var rows [][]string
	fontSize := 0.0
	color := ""
	for _, tr := range tbl.all("tr") {
		var row []string
		for _, tc := range tr.all("tc") {
			var texts []string
			if tx := tc.first("txBody"); tx != nil {
				for _, p := range tx.all("p") {
					var parts []string
					for _, r := range p.all("r") {
						if t := r.first("t"); t != nil {
							parts = append(parts, t.Text)
						}
						if rpr := r.first("rPr"); rpr != nil && fontSize == 0 {
							if szv, err := strconv.ParseFloat(rpr.attr("sz"), 64); err == nil && szv > 0 {
								fontSize = szv / 100.0 / 0.75
							}
							if c := rpr.path("solidFill", "srgbClr"); c != nil && color == "" {
								if v := c.attr("val"); v != "" {
									color = "#" + strings.ToLower(v)
								}
							}
						}
					}
					texts = append(texts, strings.Join(parts, ""))
				}
			}
			// cells store an HTML subset in the editor - escape and join
			row = append(row, linesToHTML(texts))
		}
		if len(row) > 0 {
			rows = append(rows, row)
		}
	}
	if len(rows) == 0 {
		return nil
	}
	if fontSize <= 0 {
		fontSize = 16
	}
	return &Object{
		Type: "table", X: x, Y: y, W: w, H: h,
		Props: Props{Rows: rows, HeaderRow: headerRow, FontSize: fontSize, Color: color, ColW: colW},
	}
}
