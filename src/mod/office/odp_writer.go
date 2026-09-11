package office

/*
	odp_writer.go - Build an OpenDocument Presentation (.odp) from a
	Presentation.

	Covers the pptx writer's subset: text boxes (line-flattened rich text,
	size/color/bold/italic/underline/align), images (data URLs), basic
	shapes (rect / rounded rect -> draw:rect, ellipse -> draw:ellipse,
	other kinds approximated as rectangles), lines, tables and charts via
	their client-side PNG raster (props.png). Speaker notes are kept.
	Video/audio objects are dropped by the client before export, exactly
	like the pptx path.
*/

import (
	"fmt"
	"sort"
	"strings"
)

// BuildOdp serializes a Presentation into a complete .odp file
func BuildOdp(p *Presentation) ([]byte, error) {
	b := &odpBuilder{}
	var body strings.Builder

	for si, slide := range p.Slides {
		pageAttr := ""
		bg := slide.Bg
		if bg == "" {
			if c, ok := themeBg[p.Theme]; ok {
				bg = "#" + c
			}
		}
		if strings.HasPrefix(bg, "#") {
			ps := b.newStyle("drawing-page",
				`<style:drawing-page-properties draw:fill="solid" draw:fill-color="`+bg+`"/>`)
			pageAttr = ` draw:style-name="` + ps + `"`
		}
		body.WriteString(fmt.Sprintf(`<draw:page draw:name="page%d"%s>`, si+1, pageAttr))

		objs := append([]*Object(nil), slide.Objects...)
		sort.SliceStable(objs, func(a, bIdx int) bool { return objs[a].Z < objs[bIdx].Z })
		for _, o := range objs {
			b.emitObject(&body, o, p)
		}
		if strings.TrimSpace(slide.Notes) != "" {
			body.WriteString(`<presentation:notes><draw:frame presentation:class="notes" ` +
				`svg:x="2cm" svg:y="16cm" svg:width="21cm" svg:height="10cm"><draw:text-box>`)
			for _, ln := range strings.Split(slide.Notes, "\n") {
				body.WriteString(`<text:p>` + xmlEscape(ln) + `</text:p>`)
			}
			body.WriteString(`</draw:text-box></draw:frame></presentation:notes>`)
		}
		body.WriteString(`</draw:page>`)
	}

	content := `<?xml version="1.0" encoding="UTF-8"?>` + "\n" +
		`<office:document-content ` + odfNs + `>` +
		`<office:automatic-styles>` + b.styles.String() + `</office:automatic-styles>` +
		`<office:body><office:presentation>` + body.String() + `</office:presentation></office:body>` +
		`</office:document-content>`

	// 960x540 px slide = 25.4 x 14.288 cm
	stylesXML := `<?xml version="1.0" encoding="UTF-8"?>` + "\n" +
		`<office:document-styles ` + odfNs + `>` +
		`<office:automatic-styles><style:page-layout style:name="PL1">` +
		`<style:page-layout-properties fo:page-width="25.4cm" fo:page-height="14.288cm" ` +
		`fo:margin-top="0cm" fo:margin-right="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" ` +
		`style:print-orientation="landscape"/></style:page-layout></office:automatic-styles>` +
		`<office:master-styles><style:master-page style:name="Default" style:page-layout-name="PL1"/>` +
		`</office:master-styles></office:document-styles>`

	return buildOdfZip(odpMime, map[string]string{
		"content.xml": content,
		"styles.xml":  stylesXML,
		"meta.xml":    odfMeta(),
	}, b.media)
}

type odpBuilder struct {
	styles   strings.Builder
	media    []mediaEntry
	styleSeq int
}

func (b *odpBuilder) newStyle(family, props string) string {
	b.styleSeq++
	name := fmt.Sprintf("S%d", b.styleSeq)
	b.styles.WriteString(`<style:style style:name="` + name + `" style:family="` + family + `">` +
		props + `</style:style>`)
	return name
}

func odpGeom(o *Object) string {
	return fmt.Sprintf(` svg:x="%s" svg:y="%s" svg:width="%s" svg:height="%s"`,
		pxToCm(o.X), pxToCm(o.Y), pxToCm(o.W), pxToCm(o.H))
}

func (b *odpBuilder) emitObject(body *strings.Builder, o *Object, p *Presentation) {
	switch o.Type {
	case "text":
		b.emitText(body, o, p)
	case "image":
		b.emitImage(body, o, o.Props.Src)
	case "chart":
		if o.Props.Png != "" {
			b.emitImage(body, o, o.Props.Png)
		}
	case "shape":
		b.emitShape(body, o)
	case "line":
		b.emitLine(body, o)
	case "table":
		b.emitTable(body, o)
	}
}

func (b *odpBuilder) textStyleFor(o *Object, p *Presentation) string {
	props := ""
	if o.Props.Bold {
		props += ` fo:font-weight="bold"`
	}
	if o.Props.Italic {
		props += ` fo:font-style="italic"`
	}
	if o.Props.Underline {
		props += ` style:text-underline-style="solid"`
	}
	color := o.Props.Color
	if color == "" {
		if c, ok := themeText[p.Theme]; ok {
			color = "#" + c
		}
	}
	if strings.HasPrefix(color, "#") {
		props += ` fo:color="` + color + `"`
	}
	size := o.Props.FontSize
	if size <= 0 {
		size = 24
	}
	props += fmt.Sprintf(` fo:font-size="%.1fpt"`, size*72.0/96.0)
	align := ""
	switch o.Props.Align {
	case "center":
		align = `<style:paragraph-properties fo:text-align="center"/>`
	case "right":
		align = `<style:paragraph-properties fo:text-align="end"/>`
	}
	return b.newStyle("paragraph", align+`<style:text-properties`+props+`/>`)
}

// emitText writes a text object as a draw:frame, one text:p per paragraph
// and one text:span per run, so the per-run typography an imported deck
// carries survives a save into .odp instead of flattening to plain lines
func (b *odpBuilder) emitText(body *strings.Builder, o *Object, p *Presentation) {
	body.WriteString(`<draw:frame draw:style-name="` + b.frameStyleFor(o) + `"` +
		odpGeom(o) + `><draw:text-box>`)
	b.emitParagraphs(body, o, p)
	body.WriteString(`</draw:text-box></draw:frame>`)
}

// emitParagraphs renders the object's rich HTML into ODF paragraphs
func (b *odpBuilder) emitParagraphs(body *strings.Builder, o *Object, p *Presentation) {
	base := inlineStyle{
		sizePx: o.Props.FontSize,
		font:   firstFontFamily(o.Props.FontFamily),
		bold:   o.Props.Bold, italic: o.Props.Italic, underline: o.Props.Underline,
		color: o.Props.Color,
	}
	if base.color == "" {
		base.color = o.Props.TextColor
	}
	if base.color == "" {
		if c, ok := themeText[p.Theme]; ok {
			base.color = "#" + c
		}
	}
	if base.sizePx <= 0 {
		base.sizePx = 24
	}
	for _, para := range parseStorageHTML(o.Props.HTML, base) {
		align := para.Align
		if align == "" {
			align = o.Props.Align
		}
		ps := b.paraStyleFor(align, para, o.Props.LineHeight)
		body.WriteString(`<text:p text:style-name="` + ps + `">`)
		if para.Bullet != "" {
			body.WriteString(xmlEscape(para.Bullet) + " ")
		}
		for _, r := range para.Runs {
			if r.Break {
				body.WriteString(`<text:line-break/>`)
				continue
			}
			if r.Text == "" {
				continue
			}
			body.WriteString(`<text:span text:style-name="` + b.runStyleFor(r, base) + `">` +
				xmlEscape(r.Text) + `</text:span>`)
		}
		body.WriteString(`</text:p>`)
	}
}

// paraStyleFor mints the automatic paragraph style of one paragraph
func (b *odpBuilder) paraStyleFor(align string, para htmlPara, objLineHeight float64) string {
	props := ""
	switch align {
	case "center":
		props += ` fo:text-align="center"`
	case "right":
		props += ` fo:text-align="end"`
	case "justify":
		props += ` fo:text-align="justify"`
	}
	lh := para.LineHeight
	if lh <= 0 {
		lh = objLineHeight
	}
	if lh > 0 {
		props += fmt.Sprintf(` fo:line-height="%d%%"`, int(lh/pptxLineHeightFactor*100))
	}
	if para.MarginTop > 0 {
		props += ` fo:margin-top="` + pxToCm(para.MarginTop) + `"`
	}
	if para.MarginBot > 0 {
		props += ` fo:margin-bottom="` + pxToCm(para.MarginBot) + `"`
	}
	if para.PadLeft != 0 {
		props += ` fo:margin-left="` + pxToCm(para.PadLeft) + `"`
	}
	if para.Indent != 0 {
		// a bulleted paragraph writes its marker inline, so the negative
		// first-line indent is what puts the marker in the hanging position
		props += ` fo:text-indent="` + pxToCm(para.Indent) + `"`
	}
	return b.newStyle("paragraph", `<style:paragraph-properties`+props+`/>`)
}

// runStyleFor mints the automatic text style of one run
func (b *odpBuilder) runStyleFor(r htmlRun, base inlineStyle) string {
	size := r.SizePx
	if size <= 0 {
		size = base.sizePx
	}
	props := fmt.Sprintf(` fo:font-size="%.1fpt"`, size*72.0/96.0)
	if r.Bold {
		props += ` fo:font-weight="bold"`
	}
	if r.Italic {
		props += ` fo:font-style="italic"`
	}
	if r.Underline {
		props += ` style:text-underline-style="solid"`
	}
	if r.Strike {
		props += ` style:text-line-through-style="solid"`
	}
	color := r.Color
	if color == "" {
		color = base.color
	}
	if strings.HasPrefix(color, "#") {
		props += ` fo:color="` + color + `"`
	}
	if strings.HasPrefix(r.Highlight, "#") {
		props += ` fo:background-color="` + r.Highlight + `"`
	}
	font := r.Font
	if font == "" {
		font = base.font
	}
	if font != "" {
		props += ` style:font-name="` + xmlEscape(font) + `"`
	}
	return b.newStyle("text", `<style:text-properties`+props+`/>`)
}

// frameStyleFor carries a text object's vertical anchor and insets
func (b *odpBuilder) frameStyleFor(o *Object) string {
	props := ` draw:fill="none" draw:stroke="none"`
	switch o.Props.VAlign {
	case "middle":
		props += ` draw:textarea-vertical-align="middle"`
	case "bottom":
		props += ` draw:textarea-vertical-align="bottom"`
	default:
		props += ` draw:textarea-vertical-align="top"`
	}
	if len(o.Props.Pad) == 4 {
		props += ` fo:padding-top="` + pxToCm(o.Props.Pad[0]) + `"` +
			` fo:padding-right="` + pxToCm(o.Props.Pad[1]) + `"` +
			` fo:padding-bottom="` + pxToCm(o.Props.Pad[2]) + `"` +
			` fo:padding-left="` + pxToCm(o.Props.Pad[3]) + `"`
	}
	return b.newStyle("graphic", `<style:graphic-properties`+props+`/>`)
}

func (b *odpBuilder) emitImage(body *strings.Builder, o *Object, src string) {
	pic := odfPicture(src, &b.media)
	if pic == "" {
		return
	}
	clip := ""
	if len(o.Props.Crop) == 4 {
		// fo:clip lists the insets top, right, bottom, left
		clip = fmt.Sprintf(` fo:clip="rect(%.2f%% %.2f%% %.2f%% %.2f%%)"`,
			o.Props.Crop[1]*100, o.Props.Crop[2]*100,
			o.Props.Crop[3]*100, o.Props.Crop[0]*100)
	}
	body.WriteString(`<draw:frame` + odpGeom(o) + clip + `>` +
		`<draw:image xlink:href="` + pic + `" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` +
		`</draw:frame>`)
}

// odpShapeTypes maps the editor's shape kinds onto ODF enhanced-geometry
// types, for everything a plain draw:rect / draw:ellipse cannot express
var odpShapeTypes = map[string]string{
	"triangle":      "isosceles-triangle",
	"rtTriangle":    "right-triangle",
	"diamond":       "diamond",
	"arrow":         "right-arrow",
	"leftArrow":     "left-arrow",
	"upArrow":       "up-arrow",
	"downArrow":     "down-arrow",
	"star":          "star5",
	"chevron":       "pentagon-right",
	"pentagon":      "pentagon-right",
	"hexagon":       "hexagon",
	"parallelogram": "parallelogram",
	"trapezoid":     "trapezoid",
	"plus":          "cross",
}

func (b *odpBuilder) emitShape(body *strings.Builder, o *Object) {
	props := ""
	// the fill is always stated: leaving it out lets a reader apply the
	// format's own default, which is not what the object says
	if strings.HasPrefix(o.Props.Fill, "#") {
		props += ` draw:fill="solid" draw:fill-color="` + o.Props.Fill + `"`
	} else {
		props += ` draw:fill="none"`
	}
	if strings.HasPrefix(o.Props.Stroke, "#") && o.Props.StrokeW > 0 {
		dash := "solid"
		if o.Props.Dash {
			dash = "dash"
		}
		props += fmt.Sprintf(` draw:stroke="%s" svg:stroke-color="%s" svg:stroke-width="%s"`,
			dash, o.Props.Stroke, pxToCm(o.Props.StrokeW))
	} else {
		props += ` draw:stroke="none"`
	}
	switch o.Props.VAlign {
	case "top":
		props += ` draw:textarea-vertical-align="top"`
	case "bottom":
		props += ` draw:textarea-vertical-align="bottom"`
	default:
		props += ` draw:textarea-vertical-align="middle"`
	}
	if len(o.Props.Pad) == 4 {
		props += ` fo:padding-top="` + pxToCm(o.Props.Pad[0]) + `"` +
			` fo:padding-right="` + pxToCm(o.Props.Pad[1]) + `"` +
			` fo:padding-bottom="` + pxToCm(o.Props.Pad[2]) + `"` +
			` fo:padding-left="` + pxToCm(o.Props.Pad[3]) + `"`
	}
	gs := b.newStyle("graphic", `<style:graphic-properties`+props+`/>`)

	tag := "draw:rect"
	extra := ""
	geomType := ""
	switch o.Props.Kind {
	case "ellipse":
		tag = "draw:ellipse"
	case "round":
		r := o.Props.Radius
		if r <= 0 {
			r = minF(o.W, o.H) * 0.15
		}
		extra = ` draw:corner-radius="` + pxToCm(r) + `"`
	default:
		if t, ok := odpShapeTypes[o.Props.Kind]; ok {
			tag = "draw:custom-shape"
			geomType = t
		}
	}
	body.WriteString(`<` + tag + ` draw:style-name="` + gs + `"` + odpGeom(o) + extra + `>`)
	if o.Props.HTML != "" {
		b.emitParagraphs(body, o, &Presentation{})
	} else if strings.TrimSpace(o.Props.Text) != "" {
		body.WriteString(`<text:p>` + xmlEscape(o.Props.Text) + `</text:p>`)
	}
	if geomType != "" {
		body.WriteString(`<draw:enhanced-geometry draw:type="` + geomType + `"/>`)
	}
	body.WriteString(`</` + tag + `>`)
}

func (b *odpBuilder) emitLine(body *strings.Builder, o *Object) {
	stroke := o.Props.Stroke
	if !strings.HasPrefix(stroke, "#") {
		stroke = "#333333"
	}
	sw := o.Props.StrokeW
	if sw <= 0 {
		sw = 2
	}
	gs := b.newStyle("graphic", fmt.Sprintf(
		`<style:graphic-properties draw:stroke="solid" svg:stroke-color="%s" svg:stroke-width="%s"/>`,
		stroke, pxToCm(sw)))
	body.WriteString(fmt.Sprintf(
		`<draw:line draw:style-name="%s" svg:x1="%s" svg:y1="%s" svg:x2="%s" svg:y2="%s"/>`,
		gs, pxToCm(o.X), pxToCm(o.Y), pxToCm(o.X+o.W), pxToCm(o.Y+o.H)))
}

func (b *odpBuilder) emitTable(body *strings.Builder, o *Object) {
	rows := o.Props.Rows
	if len(rows) == 0 {
		return
	}
	cols := len(rows[0])
	if cols == 0 {
		cols = 1
	}
	body.WriteString(`<draw:frame` + odpGeom(o) + `><table:table>`)
	for c := 0; c < cols; c++ {
		pct := 100.0 / float64(cols)
		if c < len(o.Props.ColW) && o.Props.ColW[c] > 0 {
			pct = o.Props.ColW[c]
		}
		cs := b.newStyle("table-column",
			`<style:table-column-properties style:column-width="`+pxToCm(o.W*pct/100)+`"/>`)
		body.WriteString(`<table:table-column table:style-name="` + cs + `"/>`)
	}
	fs := o.Props.FontSize
	if fs <= 0 {
		fs = 16
	}
	for ri, row := range rows {
		rs := ""
		if ri < len(o.Props.RowH) && o.Props.RowH[ri] > 0 {
			rs = ` table:style-name="` + b.newStyle("table-row",
				`<style:table-row-properties style:row-height="`+
					pxToCm(o.H*o.Props.RowH[ri]/100)+`"/>`) + `"`
		}
		body.WriteString(`<table:table-row` + rs + `>`)
		for ci := 0; ci < cols; ci++ {
			cell := ""
			if ci < len(row) {
				cell = row[ci]
			}
			base := inlineStyle{
				sizePx: fs, color: o.Props.Color,
				bold: o.Props.HeaderRow && ri == 0,
			}
			cellStyle := ""
			if ri < len(o.Props.CellFill) && ci < len(o.Props.CellFill[ri]) &&
				strings.HasPrefix(o.Props.CellFill[ri][ci], "#") {
				cellStyle = ` table:style-name="` + b.newStyle("table-cell",
					`<style:table-cell-properties fo:background-color="`+
						o.Props.CellFill[ri][ci]+`"/>`) + `"`
			}
			body.WriteString(`<table:table-cell` + cellStyle + `>`)
			// cells hold the same rich HTML text objects do
			for _, para := range parseStorageHTML(cell, base) {
				body.WriteString(`<text:p text:style-name="` +
					b.paraStyleFor(para.Align, para, 0) + `">`)
				for _, r := range para.Runs {
					if r.Break {
						body.WriteString(`<text:line-break/>`)
						continue
					}
					if r.Text == "" {
						continue
					}
					body.WriteString(`<text:span text:style-name="` +
						b.runStyleFor(r, base) + `">` + xmlEscape(r.Text) + `</text:span>`)
				}
				body.WriteString(`</text:p>`)
			}
			body.WriteString(`</table:table-cell>`)
		}
		body.WriteString(`</table:table-row>`)
	}
	body.WriteString(`</table:table></draw:frame>`)
}
