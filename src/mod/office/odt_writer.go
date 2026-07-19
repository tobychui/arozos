package office

/*
	odt_writer.go - Build an OpenDocument Text (.odt) file from a Document.

	Covers the same subset as the docx writer: paragraphs, headings (incl.
	the doc-title style), bold/italic/underline/strike, font color/size/
	family, highlight, links, bullet/number lists, tables (colgroup widths,
	cell shading), inline images (sized like the editor) and explicit page
	breaks. Page size/margins and header/footer text land in styles.xml.
*/

import (
	"fmt"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

type odtBuilder struct {
	body     strings.Builder
	styles   strings.Builder // automatic styles for content.xml
	media    []mediaEntry
	styleSeq int
	imgSeq   int
	pending  string // style applied to the NEXT paragraph (page break)
}

// BuildOdt serializes a Document into a complete .odt file
func BuildOdt(doc *Document) ([]byte, error) {
	root, err := html.Parse(strings.NewReader("<body>" + doc.HTML + "</body>"))
	if err != nil {
		return nil, err
	}
	b := &odtBuilder{}
	var bodyNode *html.Node
	var find func(n *html.Node)
	find = func(n *html.Node) {
		if n.Type == html.ElementNode && n.Data == "body" {
			bodyNode = n
			return
		}
		for c := n.FirstChild; c != nil && bodyNode == nil; c = c.NextSibling {
			find(c)
		}
	}
	find(root)
	if bodyNode != nil {
		for c := bodyNode.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode {
				b.odtBlock(c, odtFmt{})
			}
		}
	}

	content := `<?xml version="1.0" encoding="UTF-8"?>` + "\n" +
		`<office:document-content ` + odfNs + `>` +
		`<office:automatic-styles>` + b.styles.String() + odtListStyles + `</office:automatic-styles>` +
		`<office:body><office:text>` + b.body.String() + `</office:text></office:body>` +
		`</office:document-content>`

	return buildOdfZip(odtMime, map[string]string{
		"content.xml": content,
		"styles.xml":  odtStylesXML(doc),
		"meta.xml":    odfMeta(),
	}, b.media)
}

// odtFmt is the inline formatting state while walking the HTML tree
type odtFmt struct {
	b, i, u, s bool
	color      string
	bg         string
	sizePx     float64
	family     string
	link       string
}

func (b *odtBuilder) newStyle(family, props string) string {
	b.styleSeq++
	name := fmt.Sprintf("S%d", b.styleSeq)
	b.styles.WriteString(`<style:style style:name="` + name + `" style:family="` + family + `">` +
		props + `</style:style>`)
	return name
}

// textStyleFor renders a style:style for the current inline format ("" when
// the format is plain)
func (b *odtBuilder) textStyleFor(f odtFmt) string {
	var p strings.Builder
	if f.b {
		p.WriteString(` fo:font-weight="bold"`)
	}
	if f.i {
		p.WriteString(` fo:font-style="italic"`)
	}
	if f.u {
		p.WriteString(` style:text-underline-style="solid"`)
	}
	if f.s {
		p.WriteString(` style:text-line-through-style="solid"`)
	}
	if f.color != "" {
		p.WriteString(` fo:color="#` + f.color + `"`)
	}
	if f.bg != "" {
		p.WriteString(` fo:background-color="#` + f.bg + `"`)
	}
	if f.sizePx > 0 {
		p.WriteString(fmt.Sprintf(` fo:font-size="%.1fpt"`, f.sizePx*72.0/96.0))
	}
	if f.family != "" {
		p.WriteString(` style:font-name="` + xmlEscape(f.family) + `"`)
	}
	if p.Len() == 0 {
		return ""
	}
	return b.newStyle("text", `<style:text-properties`+p.String()+`/>`)
}

func (b *odtBuilder) paraStyleAttrs(n *html.Node) string {
	props := ""
	switch styleProp(htmlAttr(n, "style"), "text-align") {
	case "center":
		props += ` fo:text-align="center"`
	case "right":
		props += ` fo:text-align="end"`
	case "justify":
		props += ` fo:text-align="justify"`
	}
	if b.pending == "break" {
		props += ` fo:break-before="page"`
		b.pending = ""
	}
	if props == "" {
		return ""
	}
	name := b.newStyle("paragraph", `<style:paragraph-properties`+props+`/>`)
	return ` text:style-name="` + name + `"`
}

/* ---------- blocks ---------- */

func (b *odtBuilder) odtBlock(n *html.Node, f odtFmt) {
	if strings.Contains(" "+htmlAttr(n, "class")+" ", " doc-pagebreak ") {
		b.pending = "break" // applied to the next paragraph
		return
	}
	switch n.Data {
	case "h1", "h2", "h3", "h4", "h5", "h6":
		lvl := string(n.Data[1])
		hf := f
		hf.b = true
		b.body.WriteString(`<text:h text:outline-level="` + lvl + `"` + b.paraStyleAttrs(n) + `>`)
		b.odtInline(n, hf)
		b.body.WriteString(`</text:h>`)
	case "ul":
		b.odtList(n, f, "OL_UL")
	case "ol":
		b.odtList(n, f, "OL_OL")
	case "table":
		b.odtTable(n, f)
	case "pre":
		b.body.WriteString(`<text:p` + b.paraStyleAttrs(n) + `>`)
		b.odtInline(n, f)
		b.body.WriteString(`</text:p>`)
	case "blockquote":
		qf := f
		qf.i = true
		b.odtBlockOrPara(n, qf)
	case "hr":
		b.body.WriteString(`<text:p/>`)
	default: // p, div, anything block-ish
		b.odtBlockOrPara(n, f)
	}
}

func odtHasBlockChild(n *html.Node) bool {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode && blockTags[c.Data] {
			return true
		}
	}
	return false
}

func (b *odtBuilder) odtBlockOrPara(n *html.Node, f odtFmt) {
	if odtHasBlockChild(n) {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode {
				b.odtBlock(c, f)
			} else if c.Type == html.TextNode && strings.TrimSpace(c.Data) != "" {
				b.body.WriteString(`<text:p>` + xmlEscape(c.Data) + `</text:p>`)
			}
		}
		return
	}
	b.body.WriteString(`<text:p` + b.paraStyleAttrs(n) + `>`)
	b.odtInline(n, f)
	b.body.WriteString(`</text:p>`)
}

func (b *odtBuilder) odtList(n *html.Node, f odtFmt, style string) {
	b.body.WriteString(`<text:list text:style-name="` + style + `">`)
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type != html.ElementNode || c.Data != "li" {
			continue
		}
		b.body.WriteString(`<text:list-item>`)
		if odtHasBlockChild(c) {
			for cc := c.FirstChild; cc != nil; cc = cc.NextSibling {
				if cc.Type == html.ElementNode {
					b.odtBlock(cc, f)
				}
			}
		} else {
			b.body.WriteString(`<text:p>`)
			b.odtInline(c, f)
			b.body.WriteString(`</text:p>`)
		}
		b.body.WriteString(`</text:list-item>`)
	}
	b.body.WriteString(`</text:list>`)
}

func (b *odtBuilder) odtTable(n *html.Node, f odtFmt) {
	cols := 0
	var count func(node *html.Node)
	count = func(node *html.Node) {
		for c := node.FirstChild; c != nil && cols == 0; c = c.NextSibling {
			if c.Type != html.ElementNode {
				continue
			}
			switch c.Data {
			case "thead", "tbody", "tfoot":
				count(c)
			case "tr":
				for td := c.FirstChild; td != nil; td = td.NextSibling {
					if td.Type == html.ElementNode && (td.Data == "td" || td.Data == "th") {
						cols++
					}
				}
			}
		}
	}
	count(n)
	if cols == 0 {
		cols = 1
	}
	pcts := tableColPercents(n, cols)
	// honor the table's own width (after a column resize), like docx
	tableWpx := 620.0 * tableWidthPct(n) / 100
	b.body.WriteString(`<table:table>`)
	for i := 0; i < cols; i++ {
		cs := b.newStyle("table-column",
			`<style:table-column-properties style:column-width="`+pxToCm(tableWpx*pcts[i]/100)+`"/>`)
		b.body.WriteString(`<table:table-column table:style-name="` + cs + `"/>`)
	}
	var walkRows func(node *html.Node)
	walkRows = func(node *html.Node) {
		for c := node.FirstChild; c != nil; c = c.NextSibling {
			if c.Type != html.ElementNode {
				continue
			}
			switch c.Data {
			case "thead", "tbody", "tfoot":
				walkRows(c)
			case "tr":
				b.body.WriteString(`<table:table-row>`)
				for td := c.FirstChild; td != nil; td = td.NextSibling {
					if td.Type != html.ElementNode || (td.Data != "td" && td.Data != "th") {
						continue
					}
					cf := f
					st := htmlAttr(td, "style")
					if td.Data == "th" || styleProp(st, "font-weight") == "700" ||
						styleProp(st, "font-weight") == "bold" {
						cf.b = true
					}
					if c := cssColorHex(styleProp(st, "color")); c != "" {
						cf.color = c
					}
					cellProps := `fo:border="0.5pt solid #999999"`
					if bg := cssColorHex(styleProp(st, "background-color")); bg != "" {
						cellProps += ` fo:background-color="#` + bg + `"`
					}
					cs := b.newStyle("table-cell", `<style:table-cell-properties `+cellProps+`/>`)
					b.body.WriteString(`<table:table-cell table:style-name="` + cs + `"><text:p>`)
					b.odtInline(td, cf)
					b.body.WriteString(`</text:p></table:table-cell>`)
				}
				b.body.WriteString(`</table:table-row>`)
			}
		}
	}
	walkRows(n)
	b.body.WriteString(`</table:table>`)
}

/* ---------- inline ---------- */

func (b *odtBuilder) odtInline(n *html.Node, f odtFmt) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.TextNode {
			b.emitOdtText(c.Data, f)
			continue
		}
		if c.Type != html.ElementNode {
			continue
		}
		cf := f
		st := htmlAttr(c, "style")
		switch c.Data {
		case "br":
			b.body.WriteString(`<text:line-break/>`)
			continue
		case "img":
			b.emitOdtImage(c)
			continue
		case "b", "strong":
			cf.b = true
		case "i", "em":
			cf.i = true
		case "u", "ins":
			cf.u = true
		case "s", "strike", "del":
			cf.s = true
		case "a":
			cf.link = htmlAttr(c, "href")
		case "font":
			if col := cssColorHex(htmlAttr(c, "color")); col != "" {
				cf.color = col
			}
			if face := htmlAttr(c, "face"); face != "" {
				cf.family = strings.Split(face, ",")[0]
			}
		case "sub", "sup":
			// pass through as plain text (subset)
		}
		if col := cssColorHex(styleProp(st, "color")); col != "" {
			cf.color = col
		}
		if bg := cssColorHex(styleProp(st, "background-color")); bg != "" {
			cf.bg = bg
		}
		if fw := styleProp(st, "font-weight"); fw == "700" || fw == "bold" {
			cf.b = true
		}
		if fs := styleProp(st, "font-size"); strings.HasSuffix(fs, "px") {
			if v, err := strconv.ParseFloat(strings.TrimSuffix(fs, "px"), 64); err == nil {
				cf.sizePx = v
			}
		}
		if ff := styleProp(st, "font-family"); ff != "" {
			cf.family = strings.Trim(strings.Split(ff, ",")[0], `"' `)
		}
		if td := styleProp(st, "text-decoration"); strings.Contains(td, "underline") {
			cf.u = true
		} else if strings.Contains(td, "line-through") {
			cf.s = true
		}
		b.odtInline(c, cf)
	}
}

func (b *odtBuilder) emitOdtText(text string, f odtFmt) {
	if text == "" {
		return
	}
	open, close := "", ""
	if sn := b.textStyleFor(f); sn != "" {
		open = `<text:span text:style-name="` + sn + `">`
		close = `</text:span>`
	}
	if f.link != "" {
		open = `<text:a xlink:type="simple" xlink:href="` + xmlEscape(f.link) + `">` + open
		close = close + `</text:a>`
	}
	b.body.WriteString(open + xmlEscape(text) + close)
}

func (b *odtBuilder) emitOdtImage(n *html.Node) {
	src := htmlAttr(n, "src")
	pic := odfPicture(src, &b.media)
	if pic == "" {
		return
	}
	data, _, _ := decodeDataURL(src)
	wPx, hPx := odfImageSizePx(n, data)
	b.imgSeq++
	b.body.WriteString(fmt.Sprintf(
		`<draw:frame draw:name="Image%d" text:anchor-type="as-char" svg:width="%s" svg:height="%s">`+
			`<draw:image xlink:href="%s" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>`+
			`</draw:frame>`, b.imgSeq, pxToCm(wPx), pxToCm(hPx), pic))
}

// odfImageSizePx mirrors the docx sizing rules (attrs/style, natural
// aspect fallback, text-width cap)
func odfImageSizePx(n *html.Node, data []byte) (float64, float64) {
	natW, natH := 0, 0
	if cfg, _, err := imageConfigOf(data); err == nil {
		natW, natH = cfg.Width, cfg.Height
	}
	px := func(name string) float64 {
		if a := htmlAttr(n, name); a != "" {
			if v, err := strconv.ParseFloat(strings.TrimSuffix(a, "px"), 64); err == nil && v > 0 {
				return v
			}
		}
		if s := styleProp(htmlAttr(n, "style"), name); strings.HasSuffix(s, "px") {
			if v, err := strconv.ParseFloat(strings.TrimSuffix(s, "px"), 64); err == nil && v > 0 {
				return v
			}
		}
		return 0
	}
	w, h := px("width"), px("height")
	switch {
	case w > 0 && h <= 0:
		if natW > 0 && natH > 0 {
			h = w * float64(natH) / float64(natW)
		} else {
			h = w * 3 / 4
		}
	case h > 0 && w <= 0:
		if natW > 0 && natH > 0 {
			w = h * float64(natW) / float64(natH)
		} else {
			w = h * 4 / 3
		}
	case w <= 0 && h <= 0:
		if natW > 0 && natH > 0 {
			w, h = float64(natW), float64(natH)
		} else {
			w, h = 400, 300
		}
	}
	if w > 620 {
		h = h * 620 / w
		w = 620
	}
	return w, h
}

/* ---------- styles.xml (page geometry + header/footer) ---------- */

func odtStylesXML(doc *Document) string {
	wMM, hMM := 210.0, 297.0
	mT, mR, mB, mL := 25.4, 25.4, 25.4, 25.4
	if doc.Page != nil {
		if dim, ok := pageSizesMM[doc.Page.Size]; ok {
			wMM, hMM = dim[0], dim[1]
		}
		if doc.Page.Orientation == "landscape" {
			wMM, hMM = hMM, wMM
		}
		if doc.Page.Margins != nil {
			mT, mR, mB, mL = doc.Page.Margins.Top, doc.Page.Margins.Right,
				doc.Page.Margins.Bottom, doc.Page.Margins.Left
		}
	}
	hf := ""
	if strings.TrimSpace(doc.Header) != "" {
		hf += `<style:header><text:p>` + xmlEscape(doc.Header) + `</text:p></style:header>`
	}
	footer := strings.TrimSpace(doc.Footer)
	if footer != "" || doc.PageNumbers {
		inner := xmlEscape(footer)
		if doc.PageNumbers {
			if inner != "" {
				inner += " - "
			}
			inner += `<text:page-number text:select-page="current"/>`
		}
		hf += `<style:footer><text:p>` + inner + `</text:p></style:footer>`
	}
	return `<?xml version="1.0" encoding="UTF-8"?>` + "\n" +
		`<office:document-styles ` + odfNs + `>` +
		`<office:automatic-styles>` +
		`<style:page-layout style:name="PL1"><style:page-layout-properties ` +
		`fo:page-width="` + mmToCm(wMM) + `" fo:page-height="` + mmToCm(hMM) + `" ` +
		`fo:margin-top="` + mmToCm(mT) + `" fo:margin-right="` + mmToCm(mR) + `" ` +
		`fo:margin-bottom="` + mmToCm(mB) + `" fo:margin-left="` + mmToCm(mL) + `"/>` +
		`</style:page-layout></office:automatic-styles>` +
		`<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="PL1">` +
		hf + `</style:master-page></office:master-styles>` +
		`</office:document-styles>`
}

// list styles shared by every exported list
const odtListStyles = `<text:list-style style:name="OL_UL">` +
	`<text:list-level-style-bullet text:level="1" text:bullet-char="&#8226;"/>` +
	`<text:list-level-style-bullet text:level="2" text:bullet-char="&#9702;"/>` +
	`<text:list-level-style-bullet text:level="3" text:bullet-char="-"/>` +
	`</text:list-style>` +
	`<text:list-style style:name="OL_OL">` +
	`<text:list-level-style-number text:level="1" style:num-format="1" style:num-suffix="."/>` +
	`<text:list-level-style-number text:level="2" style:num-format="a" style:num-suffix="."/>` +
	`<text:list-level-style-number text:level="3" style:num-format="i" style:num-suffix="."/>` +
	`</text:list-style>`
