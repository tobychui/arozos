package office

/*
	odp_reader.go - Parse an OpenDocument Presentation (.odp) into a
	Presentation, scaled into the 960x540 editor space.

	Frames with text boxes become text objects (paragraph lines joined with
	<br>), draw:image frames become image objects (pictures re-inlined as
	data URLs), draw:rect / draw:ellipse become shapes, draw:line lines and
	framed tables become table objects. Slide backgrounds and speaker
	notes are kept.
*/

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strings"
)

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

	// source page size -> scale into the 960x540 editor space
	scaleX, scaleY := 1.0, 1.0
	if raw, ok := files["styles.xml"]; ok {
		if st, err := parseOdfXML(raw); err == nil {
			if pp := st.path("document-styles", "automatic-styles", "page-layout", "page-layout-properties"); pp != nil {
				if wPx := odfLenToPx(pp.attr("page-width")); wPx > 0 {
					scaleX = float64(slidePxW) / wPx
				}
				if hPx := odfLenToPx(pp.attr("page-height")); hPx > 0 {
					scaleY = float64(slidePxH) / hPx
				}
			}
		}
	}

	pageBg := map[string]string{}
	shapeStyle := map[string]*onode{}
	if auto := root.first("automatic-styles"); auto != nil {
		for _, st := range auto.all("style") {
			name := st.attr("name")
			if name == "" {
				continue
			}
			switch st.attr("family") {
			case "drawing-page":
				if dp := st.first("drawing-page-properties"); dp != nil {
					if c := dp.attr("fill-color"); strings.HasPrefix(c, "#") {
						pageBg[name] = strings.ToLower(c)
					}
				}
			case "graphic", "presentation":
				shapeStyle[name] = st
			}
		}
	}

	pres := root.path("body", "presentation")
	if pres == nil {
		return nil, errors.New("odp has no presentation body")
	}
	out := &Presentation{Size: []int{slidePxW, slidePxH}, Slides: []*Slide{}}
	cv := &odpConverter{files: files, sx: scaleX, sy: scaleY, shapeStyle: shapeStyle}
	for pi, page := range pres.all("page") {
		slide := &Slide{ID: fmt.Sprintf("s-odp-%d", pi+1), Objects: []*Object{}}
		if bg, ok := pageBg[page.attr("style-name")]; ok {
			slide.Bg = bg
		}
		for _, c := range page.children {
			if c.el == nil {
				continue
			}
			switch c.el.name {
			case "frame":
				cv.frame(c.el, slide)
			case "rect", "ellipse", "custom-shape":
				cv.shape(c.el, slide)
			case "line":
				cv.line(c.el, slide)
			case "notes":
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
	files      map[string][]byte
	sx, sy     float64
	shapeStyle map[string]*onode
	seq        int
}

func (cv *odpConverter) geom(n *onode) (x, y, w, h float64) {
	return odfLenToPx(n.attr("x")) * cv.sx, odfLenToPx(n.attr("y")) * cv.sy,
		odfLenToPx(n.attr("width")) * cv.sx, odfLenToPx(n.attr("height")) * cv.sy
}

func (cv *odpConverter) nextID() string {
	cv.seq++
	return fmt.Sprintf("o-odp-%d", cv.seq)
}

func (cv *odpConverter) frame(n *onode, slide *Slide) {
	x, y, w, h := cv.geom(n)
	if w <= 0 || h <= 0 {
		w, h = 200, 100
	}
	if img := n.first("image"); img != nil {
		raw, ok := cv.files[strings.TrimPrefix(img.attr("href"), "./")]
		if !ok {
			return
		}
		ext := strings.TrimPrefix(strings.ToLower(pathExtOf(img.attr("href"))), ".")
		if ext == "jpg" {
			ext = "jpeg"
		}
		if ext != "png" && ext != "jpeg" && ext != "gif" {
			return
		}
		slide.Objects = append(slide.Objects, &Object{
			ID: cv.nextID(), Type: "image", X: x, Y: y, W: w, H: h,
			Z: len(slide.Objects) + 1,
			Props: Props{Src: "data:image/" + ext + ";base64," +
				base64.StdEncoding.EncodeToString(raw), Fit: "contain"},
		})
		return
	}
	if tbl := n.first("table"); tbl != nil {
		cv.table(tbl, slide, x, y, w, h)
		return
	}
	if tb := n.first("text-box"); tb != nil {
		var lines []string
		for _, p := range tb.all("p") {
			lines = append(lines, p.allText())
		}
		if len(lines) == 0 {
			return
		}
		slide.Objects = append(slide.Objects, &Object{
			ID: cv.nextID(), Type: "text", X: x, Y: y, W: w, H: h,
			Z:     len(slide.Objects) + 1,
			Props: Props{HTML: linesToHTML(lines), FontSize: 24, Align: "left"},
		})
	}
}

func (cv *odpConverter) styleFill(n *onode) (fill, stroke string, strokeW float64) {
	st, ok := cv.shapeStyle[n.attr("style-name")]
	if !ok {
		return "", "", 0
	}
	gp := st.first("graphic-properties")
	if gp == nil {
		return "", "", 0
	}
	if c := gp.attr("fill-color"); strings.HasPrefix(c, "#") {
		fill = strings.ToLower(c)
	}
	if c := gp.attr("stroke-color"); strings.HasPrefix(c, "#") {
		stroke = strings.ToLower(c)
	}
	strokeW = odfLenToPx(gp.attr("stroke-width"))
	return fill, stroke, strokeW
}

func (cv *odpConverter) shape(n *onode, slide *Slide) {
	x, y, w, h := cv.geom(n)
	if w <= 0 || h <= 0 {
		return
	}
	kind := "rect"
	if n.name == "ellipse" {
		kind = "ellipse"
	} else if n.attr("corner-radius") != "" {
		kind = "round"
	}
	fill, stroke, sw := cv.styleFill(n)
	if fill == "" {
		fill = "#e07b1f"
	}
	slide.Objects = append(slide.Objects, &Object{
		ID: cv.nextID(), Type: "shape", X: x, Y: y, W: w, H: h,
		Z: len(slide.Objects) + 1,
		Props: Props{Kind: kind, Fill: fill, Stroke: stroke, StrokeW: sw,
			Text: strings.TrimSpace(n.allText())},
	})
}

func (cv *odpConverter) line(n *onode, slide *Slide) {
	x1 := odfLenToPx(n.attr("x1")) * cv.sx
	y1 := odfLenToPx(n.attr("y1")) * cv.sy
	x2 := odfLenToPx(n.attr("x2")) * cv.sx
	y2 := odfLenToPx(n.attr("y2")) * cv.sy
	_, stroke, sw := cv.styleFill(n)
	if stroke == "" {
		stroke = "#333333"
	}
	if sw <= 0 {
		sw = 2
	}
	slide.Objects = append(slide.Objects, &Object{
		ID: cv.nextID(), Type: "line", X: x1, Y: y1, W: x2 - x1, H: y2 - y1,
		Z:     len(slide.Objects) + 1,
		Props: Props{Stroke: stroke, StrokeW: sw},
	})
}

func (cv *odpConverter) table(tbl *onode, slide *Slide, x, y, w, h float64) {
	var rows [][]string
	for _, tr := range tbl.all("table-row") {
		var row []string
		for _, c := range tr.children {
			if c.el == nil || c.el.name != "table-cell" {
				continue
			}
			row = append(row, xmlEscape(strings.TrimSpace(c.el.allText())))
		}
		if len(row) > 0 {
			rows = append(rows, row)
		}
	}
	if len(rows) == 0 {
		return
	}
	slide.Objects = append(slide.Objects, &Object{
		ID: cv.nextID(), Type: "table", X: x, Y: y, W: w, H: h,
		Z:     len(slide.Objects) + 1,
		Props: Props{Rows: rows, FontSize: 16},
	})
}
