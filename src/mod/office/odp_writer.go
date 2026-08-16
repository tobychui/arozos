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

func (b *odpBuilder) emitText(body *strings.Builder, o *Object, p *Presentation) {
	ps := b.textStyleFor(o, p)
	body.WriteString(`<draw:frame` + odpGeom(o) + `><draw:text-box>`)
	for _, ln := range htmlToLines(o.Props.HTML) {
		body.WriteString(`<text:p text:style-name="` + ps + `">` + xmlEscape(ln) + `</text:p>`)
	}
	body.WriteString(`</draw:text-box></draw:frame>`)
}

func (b *odpBuilder) emitImage(body *strings.Builder, o *Object, src string) {
	pic := odfPicture(src, &b.media)
	if pic == "" {
		return
	}
	body.WriteString(`<draw:frame` + odpGeom(o) + `>` +
		`<draw:image xlink:href="` + pic + `" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>` +
		`</draw:frame>`)
}

func (b *odpBuilder) emitShape(body *strings.Builder, o *Object) {
	props := ""
	if strings.HasPrefix(o.Props.Fill, "#") {
		props += ` draw:fill="solid" draw:fill-color="` + o.Props.Fill + `"`
	}
	if strings.HasPrefix(o.Props.Stroke, "#") && o.Props.StrokeW > 0 {
		props += fmt.Sprintf(` draw:stroke="solid" svg:stroke-color="%s" svg:stroke-width="%s"`,
			o.Props.Stroke, pxToCm(o.Props.StrokeW))
	} else {
		props += ` draw:stroke="none"`
	}
	gs := b.newStyle("graphic", `<style:graphic-properties`+props+`/>`)
	tag := "draw:rect"
	extra := ""
	switch o.Props.Kind {
	case "ellipse":
		tag = "draw:ellipse"
	case "round":
		extra = ` draw:corner-radius="0.3cm"`
	}
	body.WriteString(`<` + tag + ` draw:style-name="` + gs + `"` + odpGeom(o) + extra + `>`)
	if strings.TrimSpace(o.Props.Text) != "" {
		body.WriteString(`<text:p>` + xmlEscape(o.Props.Text) + `</text:p>`)
	}
	body.WriteString(`</` + strings.Split(tag, " ")[0] + `>`)
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
	for ri, row := range rows {
		body.WriteString(`<table:table-row>`)
		for ci := 0; ci < cols; ci++ {
			cell := ""
			if ci < len(row) {
				cell = strings.Join(htmlToLines(row[ci]), " ")
			}
			bold := o.Props.HeaderRow && ri == 0
			inner := xmlEscape(cell)
			if bold && inner != "" {
				ts := b.newStyle("text", `<style:text-properties fo:font-weight="bold"/>`)
				inner = `<text:span text:style-name="` + ts + `">` + inner + `</text:span>`
			}
			body.WriteString(`<table:table-cell><text:p>` + inner + `</text:p></table:table-cell>`)
		}
		body.WriteString(`</table:table-row>`)
	}
	body.WriteString(`</table:table></draw:frame>`)
}
