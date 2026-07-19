package office

/*
	docx_writer.go - Build a Word (.docx) file from a Document.

	The Docs editor HTML subset is converted to WordprocessingML:
	paragraphs, headings (Heading1-4 + Title styles), bold/italic/
	underline/strikethrough, font color/size, hyperlinks, bulleted and
	numbered lists (numbering.xml), block quotes, code blocks, tables,
	horizontal rules, inline images (data URLs become embedded media) and
	line breaks. Header/footer text and optional page numbers are written
	as real header/footer parts; page size/orientation/margins map to the
	section properties.
*/

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"image"
	_ "image/gif"  // natural-size probing in buildImageRun
	_ "image/jpeg" // natural-size probing in buildImageRun
	_ "image/png"  // natural-size probing in buildImageRun
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

const docxNs = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`

// runFormat is the inline formatting state while walking the HTML tree
type runFormat struct {
	b, i, u, strike bool
	color           string  // #rrggbb
	sizePx          float64 // 0 = default
	mono            bool
	link            string // href when inside <a>
}

type docxBuilder struct {
	body     strings.Builder
	rels     []string // relationship XML fragments (rId offset +100 to avoid fixed ids)
	media    []mediaEntry
	imgCount int
	hasList  bool
	// multi-column documents: blocks with class "col-span-all" (IEEE-style
	// title/author rows) are emitted into their own single-column section,
	// separated from the columned body by a continuous section break
	multiCol    bool
	sectDivider string // paragraph-embedded sectPr closing a span-all run
	lastSpan    bool
	anyBlock    bool
	usedDivider bool
}

// BuildDocx serializes a Document into a complete .docx file
func BuildDocx(doc *Document) ([]byte, error) {
	if doc == nil {
		return nil, errors.New("nil document")
	}
	root, err := html.Parse(strings.NewReader("<body>" + doc.HTML + "</body>"))
	if err != nil {
		return nil, errors.New("cannot parse document HTML: " + err.Error())
	}
	b := &docxBuilder{}
	if doc.Page != nil && doc.Page.Columns > 1 {
		b.multiCol = true
		b.sectDivider = `<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/>` +
			pgGeometry(doc.Page) + `<w:cols w:num="1"/></w:sectPr></w:pPr></w:p>`
	}
	if bodyNode := findHTMLNode(root, "body"); bodyNode != nil {
		b.walkTop(bodyNode, runFormat{})
	}

	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)
	addFile := func(name, content string) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = w.Write([]byte(content))
		return err
	}
	addBin := func(name string, data []byte) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	}

	hasHeader := strings.TrimSpace(doc.Header) != ""
	hasFooter := strings.TrimSpace(doc.Footer) != "" || doc.PageNumbers

	// [Content_Types].xml
	var ct strings.Builder
	ct.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	ct.WriteString(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`)
	ct.WriteString(`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`)
	ct.WriteString(`<Default Extension="xml" ContentType="application/xml"/>`)
	ct.WriteString(`<Default Extension="png" ContentType="image/png"/>`)
	ct.WriteString(`<Default Extension="jpeg" ContentType="image/jpeg"/>`)
	ct.WriteString(`<Default Extension="gif" ContentType="image/gif"/>`)
	ct.WriteString(`<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`)
	ct.WriteString(`<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>`)
	ct.WriteString(`<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>`)
	if hasHeader {
		ct.WriteString(`<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`)
	}
	if hasFooter {
		ct.WriteString(`<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`)
	}
	ct.WriteString(`</Types>`)
	if err := addFile("[Content_Types].xml", ct.String()); err != nil {
		return nil, err
	}

	if err := addFile("_rels/.rels",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+"\n"+
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+
			`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`+
			`</Relationships>`); err != nil {
		return nil, err
	}

	// document rels: styles + numbering + optional header/footer + images/links
	var rels strings.Builder
	rels.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	rels.WriteString(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
	rels.WriteString(`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`)
	rels.WriteString(`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>`)
	headerRef, footerRef := "", ""
	if hasHeader {
		rels.WriteString(`<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>`)
		headerRef = `<w:headerReference w:type="default" r:id="rId3"/>`
	}
	if hasFooter {
		rels.WriteString(`<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`)
		footerRef = `<w:footerReference w:type="default" r:id="rId4"/>`
	}
	for _, r := range b.rels {
		rels.WriteString(r)
	}
	rels.WriteString(`</Relationships>`)
	if err := addFile("word/_rels/document.xml.rels", rels.String()); err != nil {
		return nil, err
	}

	// section properties (page setup)
	sect := buildSectPr(doc.Page, headerRef, footerRef, b.usedDivider)

	docXML := `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<w:document ` + docxNs + `><w:body>` + b.body.String() + sect + `</w:body></w:document>`
	if err := addFile("word/document.xml", docXML); err != nil {
		return nil, err
	}
	if err := addFile("word/styles.xml", docxStyles); err != nil {
		return nil, err
	}
	if err := addFile("word/numbering.xml", docxNumbering); err != nil {
		return nil, err
	}
	if hasHeader {
		if err := addFile("word/header1.xml", buildHfPart("hdr", doc.Header, false)); err != nil {
			return nil, err
		}
	}
	if hasFooter {
		if err := addFile("word/footer1.xml", buildHfPart("ftr", doc.Footer, doc.PageNumbers)); err != nil {
			return nil, err
		}
	}
	for _, m := range b.media {
		if err := addBin(fmt.Sprintf("word/media/image%d.%s", m.index, m.ext), m.data); err != nil {
			return nil, err
		}
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func findHTMLNode(n *html.Node, tag string) *html.Node {
	if n.Type == html.ElementNode && n.Data == tag {
		return n
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if f := findHTMLNode(c, tag); f != nil {
			return f
		}
	}
	return nil
}

func htmlAttr(n *html.Node, name string) string {
	for _, a := range n.Attr {
		if a.Key == name {
			return a.Val
		}
	}
	return ""
}

// styleProp extracts one property from an inline style attribute
func styleProp(style, prop string) string {
	for _, decl := range strings.Split(style, ";") {
		kv := strings.SplitN(decl, ":", 2)
		if len(kv) == 2 && strings.TrimSpace(strings.ToLower(kv[0])) == prop {
			return strings.TrimSpace(kv[1])
		}
	}
	return ""
}

func applyInlineFormat(f runFormat, n *html.Node) runFormat {
	switch n.Data {
	case "b", "strong":
		f.b = true
	case "i", "em":
		f.i = true
	case "u":
		f.u = true
	case "s", "strike", "del":
		f.strike = true
	case "code", "tt":
		f.mono = true
	case "a":
		if href := htmlAttr(n, "href"); href != "" {
			f.link = href
		}
	case "font":
		if c := htmlAttr(n, "color"); c != "" {
			f.color = c
		}
	}
	style := htmlAttr(n, "style")
	if style != "" {
		if c := styleProp(style, "color"); c != "" {
			f.color = c
		}
		if fw := styleProp(style, "font-weight"); fw == "bold" || fw == "700" {
			f.b = true
		}
		if fs := styleProp(style, "font-style"); fs == "italic" {
			f.i = true
		}
		if td := styleProp(style, "text-decoration"); strings.Contains(td, "underline") {
			f.u = true
		} else if strings.Contains(td, "line-through") {
			f.strike = true
		}
		if sz := styleProp(style, "font-size"); strings.HasSuffix(sz, "px") {
			if v, err := strconv.ParseFloat(strings.TrimSuffix(sz, "px"), 64); err == nil {
				f.sizePx = v
			}
		} else if strings.HasSuffix(sz, "pt") {
			if v, err := strconv.ParseFloat(strings.TrimSuffix(sz, "pt"), 64); err == nil {
				f.sizePx = v / 0.75
			}
		}
	}
	return f
}

func rprFor(f runFormat) string {
	var sb strings.Builder
	sb.WriteString("<w:rPr>")
	if f.mono {
		sb.WriteString(`<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>`)
	}
	if f.b {
		sb.WriteString("<w:b/>")
	}
	if f.i {
		sb.WriteString("<w:i/>")
	}
	if f.strike {
		sb.WriteString("<w:strike/>")
	}
	if f.u {
		sb.WriteString(`<w:u w:val="single"/>`)
	}
	if f.color != "" {
		sb.WriteString(`<w:color w:val="` + hexColor(f.color, "000000") + `"/>`)
	}
	if f.link != "" {
		sb.WriteString(`<w:color w:val="1A58C2"/><w:u w:val="single"/>`)
	}
	if f.sizePx > 0 {
		hp := pxToHalfPoints(f.sizePx)
		sb.WriteString(fmt.Sprintf(`<w:sz w:val="%d"/><w:szCs w:val="%d"/>`, hp, hp))
	}
	sb.WriteString("</w:rPr>")
	return sb.String()
}

/* ---------- block walking ---------- */

// paragraph collects runs then flushes them as one w:p
type paraOut struct {
	runs  strings.Builder
	any   bool
	pPr   string
	owner *docxBuilder
}

func (p *paraOut) flush() {
	if !p.any {
		return
	}
	p.owner.body.WriteString("<w:p>" + p.pPr + p.runs.String() + "</w:p>")
	p.runs.Reset()
	p.any = false
}

// walkTop emits the direct children of <body>, inserting continuous
// single-column section breaks after runs of .col-span-all blocks so
// IEEE-style spanning titles survive in real Word multi-column layouts
func (b *docxBuilder) walkTop(n *html.Node, f runFormat) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.TextNode {
			if strings.TrimSpace(c.Data) != "" {
				p := &paraOut{owner: b}
				b.inlineRuns(c, f, p)
				p.flush()
			}
			continue
		}
		if c.Type != html.ElementNode {
			continue
		}
		if b.multiCol {
			span := strings.Contains(" "+htmlAttr(c, "class")+" ", " col-span-all ")
			if b.anyBlock && b.lastSpan && !span {
				b.body.WriteString(b.sectDivider)
				b.usedDivider = true
			}
			b.lastSpan = span
		}
		b.anyBlock = true
		b.dispatchBlock(c, f, 0, "")
	}
}

// walkBlocks emits block-level content. listLevel/listType track nesting.
func (b *docxBuilder) walkBlocks(n *html.Node, f runFormat, listLevel int, listType string) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.TextNode {
			if strings.TrimSpace(c.Data) != "" {
				// stray text: wrap into a paragraph
				p := &paraOut{owner: b}
				b.inlineRuns(c, f, p)
				p.flush()
			}
			continue
		}
		if c.Type != html.ElementNode {
			continue
		}
		b.dispatchBlock(c, f, listLevel, listType)
	}
}

// dispatchBlock emits ONE block-level element
func (b *docxBuilder) dispatchBlock(c *html.Node, f runFormat, listLevel int, listType string) {
	// explicit page break inserted in the editor (Insert > Page break)
	if strings.Contains(" "+htmlAttr(c, "class")+" ", " doc-pagebreak ") {
		b.body.WriteString(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`)
		return
	}
	switch c.Data {
	case "p", "div":
		b.emitParagraph(c, f, paraProps(c, ""), listLevel, listType)
	case "h1", "h2", "h3", "h4", "h5", "h6":
		style := "Heading" + string(c.Data[1])
		if strings.Contains(" "+htmlAttr(c, "class")+" ", " doc-title ") {
			style = "Title"
		}
		b.emitParagraph(c, f, paraProps(c, style), 0, "")
	case "blockquote":
		qf := f
		qf.i = true
		inner := paraProps(c, "")
		inner = strings.Replace(inner, "</w:pPr>", `<w:ind w:left="720"/></w:pPr>`, 1)
		b.walkBlocksOrParagraph(c, qf, inner)
	case "pre":
		b.emitPre(c, f)
	case "ul":
		b.walkList(c, f, listLevel, "bullet")
	case "ol":
		b.walkList(c, f, listLevel, "decimal")
	case "table":
		b.emitTable(c, f)
	case "hr":
		b.body.WriteString(`<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="AAAAAA"/></w:pBdr></w:pPr></w:p>`)
	default:
		// unknown block-ish or inline at top level: treat as paragraph
		b.emitParagraph(c, f, paraProps(c, ""), listLevel, listType)
	}
}

// walkBlocksOrParagraph handles containers that may hold either inline
// content or nested blocks (blockquote, li)
func (b *docxBuilder) walkBlocksOrParagraph(n *html.Node, f runFormat, pPr string) {
	if hasBlockChild(n) {
		b.walkBlocks(n, f, 0, "")
	} else {
		p := &paraOut{owner: b, pPr: pPr}
		b.inlineRuns(n, f, p)
		if !p.any {
			p.any = true // keep empty paragraphs (spacing)
		}
		p.flush()
	}
}

var blockTags = map[string]bool{
	"p": true, "div": true, "h1": true, "h2": true, "h3": true, "h4": true,
	"h5": true, "h6": true, "ul": true, "ol": true, "table": true,
	"blockquote": true, "pre": true, "hr": true, "li": true,
}

func hasBlockChild(n *html.Node) bool {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode && blockTags[c.Data] {
			return true
		}
	}
	return false
}

func paraProps(n *html.Node, style string) string {
	var sb strings.Builder
	sb.WriteString("<w:pPr>")
	if style != "" {
		sb.WriteString(`<w:pStyle w:val="` + style + `"/>`)
	}
	st := htmlAttr(n, "style")
	switch styleProp(st, "text-align") {
	case "center":
		sb.WriteString(`<w:jc w:val="center"/>`)
	case "right":
		sb.WriteString(`<w:jc w:val="right"/>`)
	case "justify":
		sb.WriteString(`<w:jc w:val="both"/>`)
	}
	sb.WriteString("</w:pPr>")
	return sb.String()
}

func (b *docxBuilder) emitParagraph(n *html.Node, f runFormat, pPr string, listLevel int, listType string) {
	if hasBlockChild(n) {
		b.walkBlocks(n, f, listLevel, listType)
		return
	}
	p := &paraOut{owner: b, pPr: pPr}
	b.inlineRuns(n, f, p)
	p.any = true // keep empties: they are visible blank lines in the editor
	p.flush()
}

func (b *docxBuilder) emitPre(n *html.Node, f runFormat) {
	mono := f
	mono.mono = true
	text := textContent(n)
	lines := strings.Split(strings.TrimRight(text, "\n"), "\n")
	for _, line := range lines {
		b.body.WriteString(`<w:p><w:pPr><w:shd w:val="clear" w:color="auto" w:fill="F1F3F4"/></w:pPr>` +
			`<w:r>` + rprFor(mono) + `<w:t xml:space="preserve">` + xmlEscape(line) + `</w:t></w:r></w:p>`)
	}
}

func (b *docxBuilder) walkList(n *html.Node, f runFormat, level int, listType string) {
	if level > 3 {
		level = 3
	}
	numID := "1" // bullet
	if listType == "decimal" {
		numID = "2"
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type != html.ElementNode || c.Data != "li" {
			continue
		}
		b.hasList = true
		pPr := fmt.Sprintf(`<w:pPr><w:numPr><w:ilvl w:val="%d"/><w:numId w:val="%s"/></w:numPr></w:pPr>`, level, numID)
		// checklist items render their state as a leading glyph run
		p := &paraOut{owner: b, pPr: pPr}
		b.inlineRuns(c, f, p)
		p.any = true
		p.flush()
		// nested lists inside this li
		for gc := c.FirstChild; gc != nil; gc = gc.NextSibling {
			if gc.Type == html.ElementNode && gc.Data == "ul" {
				b.walkList(gc, f, level+1, "bullet")
			} else if gc.Type == html.ElementNode && gc.Data == "ol" {
				b.walkList(gc, f, level+1, "decimal")
			}
		}
	}
}

func (b *docxBuilder) emitTable(n *html.Node, f runFormat) {
	// the spec requires w:tblGrid with one gridCol per column
	cols := 0
	var countCols func(node *html.Node)
	countCols = func(node *html.Node) {
		for c := node.FirstChild; c != nil && cols == 0; c = c.NextSibling {
			if c.Type != html.ElementNode {
				continue
			}
			switch c.Data {
			case "thead", "tbody", "tfoot":
				countCols(c)
			case "tr":
				for td := c.FirstChild; td != nil; td = td.NextSibling {
					if td.Type == html.ElementNode && (td.Data == "td" || td.Data == "th") {
						cols++
					}
				}
			}
		}
	}
	countCols(n)
	if cols == 0 {
		cols = 1
	}
	// mirror the editor: fixed layout, the table's own width (inline px/%
	// after a resize, 100% otherwise) and per-column widths from the
	// colgroup (px or %, equal split when absent)
	pcts := tableColPercents(n, cols)
	tblPct := tableWidthPct(n)
	const tblTwips = 9026.0 // A4 text width (210mm - 2x25.4mm margins)
	var grid strings.Builder
	grid.WriteString("<w:tblGrid>")
	for i := 0; i < cols; i++ {
		grid.WriteString(fmt.Sprintf(`<w:gridCol w:w="%d"/>`, int(tblTwips*(tblPct/100)*pcts[i]/100)))
	}
	grid.WriteString("</w:tblGrid>")

	b.body.WriteString(`<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>` +
		fmt.Sprintf(`<w:tblW w:w="%d" w:type="pct"/><w:tblLayout w:type="fixed"/>`, int(tblPct*50)) +
		`<w:tblBorders><w:top w:val="single" w:sz="4" w:color="999999"/><w:left w:val="single" w:sz="4" w:color="999999"/>` +
		`<w:bottom w:val="single" w:sz="4" w:color="999999"/><w:right w:val="single" w:sz="4" w:color="999999"/>` +
		`<w:insideH w:val="single" w:sz="4" w:color="999999"/><w:insideV w:val="single" w:sz="4" w:color="999999"/></w:tblBorders></w:tblPr>` +
		grid.String())
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
				b.body.WriteString("<w:tr>")
				ci := 0
				for td := c.FirstChild; td != nil; td = td.NextSibling {
					if td.Type != html.ElementNode || (td.Data != "td" && td.Data != "th") {
						continue
					}
					cf := f
					if td.Data == "th" {
						cf.b = true
					}
					st := htmlAttr(td, "style")
					if fw := styleProp(st, "font-weight"); fw == "700" || fw == "bold" {
						cf.b = true
					}
					pct := 100.0 / float64(cols)
					if ci < len(pcts) {
						pct = pcts[ci]
					}
					// tcW in fiftieths of a percent keeps the editor's
					// column proportions under the fixed layout
					tcPr := fmt.Sprintf(`<w:tcW w:w="%d" w:type="pct"/>`, int(pct*50))
					if bg := cssColorHex(styleProp(st, "background-color")); bg != "" {
						tcPr += `<w:shd w:val="clear" w:color="auto" w:fill="` + bg + `"/>`
					}
					b.body.WriteString(`<w:tc><w:tcPr>` + tcPr + `</w:tcPr>`)
					p := &paraOut{owner: b}
					b.inlineRuns(td, cf, p)
					p.any = true
					p.flush()
					b.body.WriteString("</w:tc>")
					ci++
				}
				b.body.WriteString("</w:tr>")
			}
		}
	}
	walkRows(n)
	b.body.WriteString("</w:tbl>")
}

// tableColPercents reads the editor's <colgroup><col> widths (percent OR
// pixel units - the column resizer writes px), normalized to 100; equal
// split when absent or malformed
func tableColPercents(tbl *html.Node, cols int) []float64 {
	out := make([]float64, cols)
	got := 0
	for cg := tbl.FirstChild; cg != nil; cg = cg.NextSibling {
		if cg.Type != html.ElementNode || cg.Data != "colgroup" {
			continue
		}
		for col := cg.FirstChild; col != nil && got < cols; col = col.NextSibling {
			if col.Type != html.ElementNode || col.Data != "col" {
				continue
			}
			ws := strings.TrimSpace(styleProp(htmlAttr(col, "style"), "width"))
			num := strings.TrimSuffix(strings.TrimSuffix(ws, "%"), "px")
			if (strings.HasSuffix(ws, "%") || strings.HasSuffix(ws, "px")) && num != ws {
				if v, err := strconv.ParseFloat(num, 64); err == nil && v > 0 {
					out[got] = v // any unit: normalized by the sum below
					got++
					continue
				}
			}
			got = 0 // one bad entry: fall back to the equal split
			break
		}
		break
	}
	if got != cols {
		for i := range out {
			out[i] = 100.0 / float64(cols)
		}
		return out
	}
	sum := 0.0
	for _, v := range out {
		sum += v
	}
	if sum > 0 {
		for i := range out {
			out[i] = out[i] * 100 / sum
		}
	}
	return out
}

// tableWidthPct reads the table's own inline width (set by the editor's
// column resizer in px, or a percent) as a percentage of the text width;
// 100 when absent
func tableWidthPct(tbl *html.Node) float64 {
	const textWpx = 620.0
	ws := strings.TrimSpace(styleProp(htmlAttr(tbl, "style"), "width"))
	if strings.HasSuffix(ws, "%") {
		if v, err := strconv.ParseFloat(strings.TrimSuffix(ws, "%"), 64); err == nil && v > 1 {
			if v > 100 {
				v = 100
			}
			return v
		}
	}
	if strings.HasSuffix(ws, "px") {
		if v, err := strconv.ParseFloat(strings.TrimSuffix(ws, "px"), 64); err == nil && v > 10 {
			pct := v * 100 / textWpx
			if pct > 100 {
				pct = 100
			}
			return pct
		}
	}
	return 100
}

// cssColorHex normalizes "#rgb", "#rrggbb" or "rgb(r, g, b)" to "RRGGBB"
// ("" when unparseable or transparent)
func cssColorHex(c string) string {
	c = strings.TrimSpace(c)
	if c == "" || c == "transparent" {
		return ""
	}
	if strings.HasPrefix(c, "#") {
		h := hexColor(c, "")
		return h
	}
	if strings.HasPrefix(c, "rgb") {
		open := strings.Index(c, "(")
		close := strings.Index(c, ")")
		if open < 0 || close <= open {
			return ""
		}
		parts := strings.Split(c[open+1:close], ",")
		if len(parts) < 3 {
			return ""
		}
		out := ""
		for i := 0; i < 3; i++ {
			v, err := strconv.Atoi(strings.TrimSpace(parts[i]))
			if err != nil || v < 0 || v > 255 {
				return ""
			}
			out += fmt.Sprintf("%02X", v)
		}
		return out
	}
	return ""
}

/* ---------- inline runs ---------- */

func (b *docxBuilder) inlineRuns(n *html.Node, f runFormat, p *paraOut) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.TextNode {
			t := strings.ReplaceAll(c.Data, "\n", " ")
			if t == "" {
				continue
			}
			p.any = true
			run := `<w:r>` + rprFor(f) + `<w:t xml:space="preserve">` + xmlEscape(t) + `</w:t></w:r>`
			if f.link != "" {
				rid := b.addLinkRel(f.link)
				run = `<w:hyperlink r:id="` + rid + `">` + run + `</w:hyperlink>`
			}
			p.runs.WriteString(run)
			continue
		}
		if c.Type != html.ElementNode {
			continue
		}
		switch c.Data {
		case "br":
			p.any = true
			p.runs.WriteString("<w:r><w:br/></w:r>")
		case "img":
			if x := b.buildImageRun(c); x != "" {
				p.any = true
				p.runs.WriteString(x)
			}
		case "ul", "ol", "table", "p", "div", "blockquote", "pre":
			// nested block inside an inline context: flush and emit it alone
			p.flush()
			b.dispatchBlock(c, f, 0, "")
		default:
			b.inlineRuns(c, applyInlineFormat(f, c), p)
		}
	}
}

func (b *docxBuilder) addLinkRel(href string) string {
	rid := fmt.Sprintf("rId%d", 100+len(b.rels))
	b.rels = append(b.rels, `<Relationship Id="`+rid+
		`" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="`+
		xmlEscape(href)+`" TargetMode="External"/>`)
	return rid
}

func (b *docxBuilder) buildImageRun(n *html.Node) string {
	src := htmlAttr(n, "src")
	data, ext, ok := decodeDataURL(src)
	if !ok {
		return "" // non-inlined images are skipped (webapp inlines before export)
	}
	b.imgCount++
	idx := b.imgCount
	rid := fmt.Sprintf("rId%d", 100+len(b.rels))
	b.rels = append(b.rels, fmt.Sprintf(`<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image%d.%s"/>`, rid, idx, ext))
	b.media = append(b.media, mediaEntry{index: idx, ext: ext, data: data})

	// natural pixel size from the image bytes - the truth for aspect ratio
	natW, natH := 0, 0
	if imgCfg, _, err := image.DecodeConfig(bytes.NewReader(data)); err == nil {
		natW, natH = imgCfg.Width, imgCfg.Height
	}
	pxAttr := func(name string) float64 {
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
	wPx := pxAttr("width")
	hPx := pxAttr("height")
	// derive the missing dimension from the natural aspect (the editor
	// resizes with height:auto, so usually only width is present)
	switch {
	case wPx > 0 && hPx <= 0:
		if natW > 0 && natH > 0 {
			hPx = wPx * float64(natH) / float64(natW)
		} else {
			hPx = wPx * 3 / 4
		}
	case hPx > 0 && wPx <= 0:
		if natW > 0 && natH > 0 {
			wPx = hPx * float64(natW) / float64(natH)
		} else {
			wPx = hPx * 4 / 3
		}
	case wPx <= 0 && hPx <= 0:
		if natW > 0 && natH > 0 {
			wPx, hPx = float64(natW), float64(natH)
		} else {
			wPx, hPx = 400, 300
		}
	}
	// keep the picture inside the text column (A4 with default margins)
	const maxWpx = 620.0
	if wPx > maxWpx {
		hPx = hPx * maxWpx / wPx
		wPx = maxWpx
	}
	cx, cy := pxToEmu(wPx), pxToEmu(hPx)

	return fmt.Sprintf(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">`+
		`<wp:extent cx="%d" cy="%d"/><wp:docPr id="%d" name="Picture %d"/>`+
		`<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`+
		`<pic:pic><pic:nvPicPr><pic:cNvPr id="%d" name="Picture %d"/><pic:cNvPicPr/></pic:nvPicPr>`+
		`<pic:blipFill><a:blip r:embed="%s"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>`+
		`<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm>`+
		`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic>`+
		`</a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`,
		cx, cy, idx, idx, idx, idx, rid, cx, cy)
}

func textContent(n *html.Node) string {
	var sb strings.Builder
	var walk func(*html.Node)
	walk = func(x *html.Node) {
		if x.Type == html.TextNode {
			sb.WriteString(x.Data)
			return
		}
		if x.Type == html.ElementNode && x.Data == "br" {
			sb.WriteString("\n")
		}
		for c := x.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(n)
	return sb.String()
}

/* ---------- section / header / footer ---------- */

// pgGeometry renders the pgSz + pgMar pair for a page config
func pgGeometry(pc *PageConf) string {
	size := "A4"
	orient := "portrait"
	mT, mR, mB, mL := 25.4, 25.4, 25.4, 25.4
	if pc != nil {
		if _, ok := pageSizesTwips[pc.Size]; ok {
			size = pc.Size
		}
		if pc.Orientation == "landscape" {
			orient = "landscape"
		}
		if pc.Margins != nil {
			mT, mR, mB, mL = pc.Margins.Top, pc.Margins.Right, pc.Margins.Bottom, pc.Margins.Left
		}
	}
	dim := pageSizesTwips[size]
	w, h := dim[0], dim[1]
	orientAttr := ""
	if orient == "landscape" {
		w, h = h, w
		orientAttr = ` w:orient="landscape"`
	}
	return fmt.Sprintf(`<w:pgSz w:w="%d" w:h="%d"%s/>`+
		`<w:pgMar w:top="%d" w:right="%d" w:bottom="%d" w:left="%d" w:header="720" w:footer="720"/>`,
		w, h, orientAttr,
		mmToTwips(mT), mmToTwips(mR), mmToTwips(mB), mmToTwips(mL))
}

func buildSectPr(pc *PageConf, headerRef, footerRef string, continuous bool) string {
	typ := ""
	if continuous {
		// the columned body continues on the same page as the spanning
		// title section it follows
		typ = `<w:type w:val="continuous"/>`
	}
	cols := ""
	if pc != nil && pc.Columns > 1 {
		gap := pc.ColGap
		if gap <= 0 {
			gap = 8
		}
		cols = fmt.Sprintf(`<w:cols w:num="%d" w:space="%d"/>`, pc.Columns, mmToTwips(gap))
	}
	return `<w:sectPr>` + headerRef + footerRef + typ + pgGeometry(pc) + cols + `</w:sectPr>`
}

// buildHfPart renders a header (root "hdr") or footer ("ftr") part
func buildHfPart(root, text string, pageNumbers bool) string {
	var runs strings.Builder
	if strings.TrimSpace(text) != "" {
		runs.WriteString(`<w:r><w:t xml:space="preserve">` + xmlEscape(text) + `</w:t></w:r>`)
	}
	if pageNumbers {
		if runs.Len() > 0 {
			runs.WriteString(`<w:r><w:t xml:space="preserve"> - </w:t></w:r>`)
		}
		runs.WriteString(`<w:r><w:fldChar w:fldCharType="begin"/></w:r>` +
			`<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>` +
			`<w:r><w:fldChar w:fldCharType="end"/></w:r>`)
	}
	// no <w:jc>: the editor renders header/footer text left aligned, so the
	// export must not silently centre it
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<w:` + root + ` ` + docxNs + `><w:p>` +
		runs.String() + `</w:p></w:` + root + `>`
}

/* ---------- static parts ---------- */

// The style sheet pins the EDITOR's typography explicitly (Arial 11pt,
// 1.5 line height, zero paragraph spacing; headings 14pt/6pt margins at
// 1.25) so Word cannot substitute its own Normal defaults - that
// substitution is what made exported pages break earlier than the
// editor's page preview. Spacing units: half-points for sz, twentieths
// of a point for spacing, 240ths of a line for w:line (auto rule).
const docxStyles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:sz w:val="22"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:before="0" w:after="0" w:line="360" w:lineRule="auto"/></w:pPr></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="280" w:after="120" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="52"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="280" w:after="120" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:sz w:val="40"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="280" w:after="120" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="280" w:after="120" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading4"><w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:before="280" w:after="120" w:line="300" w:lineRule="auto"/></w:pPr><w:rPr><w:b/><w:i/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading5"><w:name w:val="heading 5"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="22"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading6"><w:name w:val="heading 6"/><w:basedOn w:val="Normal"/><w:rPr><w:b/><w:sz w:val="20"/></w:rPr></w:style></w:styles>`

const docxNumbering = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="bullet"/><w:lvlText w:val="◦"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="2"><w:numFmt w:val="bullet"/><w:lvlText w:val="-"/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="3"><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:pPr><w:ind w:left="2880" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="lowerLetter"/><w:lvlText w:val="%2."/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="2"><w:numFmt w:val="lowerRoman"/><w:lvlText w:val="%3."/><w:pPr><w:ind w:left="2160" w:hanging="360"/></w:pPr></w:lvl><w:lvl w:ilvl="3"><w:numFmt w:val="decimal"/><w:lvlText w:val="%4."/><w:pPr><w:ind w:left="2880" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`
