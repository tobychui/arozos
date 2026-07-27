package office

/*
	pdf_doc.go - Build a PDF from a Docs Document with REAL text.

	The layout deliberately mirrors the editor's CSS
	(src/web/Office/docs/docs.css) so the exported PDF paginates exactly like
	the on-screen page preview:

	  - HTML whitespace is collapsed the way a browser collapses it (pasted
	    markup is full of hard-wrapped newlines that must NOT become line
	    breaks; <pre> keeps them),
	  - lines are wrapped by a small inline layout engine at the real text
	    width, with per-run fonts/sizes and CSS line-box heights,
	  - block margins (headings, lists, tables, ...) collapse like CSS ones,
	  - a block that would cross the bottom margin moves to the next page as a
	    whole - the rule the preview's pagination uses - instead of being cut
	    mid-paragraph by fpdf's automatic page break.

	Supported: paragraphs and headings, inline bold/italic/underline/color/
	size/font, links (clickable), lists, tables (colgroup widths, cell
	shading, rich cell content), inline images, explicit page breaks, page
	geometry and header/footer text with optional page numbers.
*/

import (
	"errors"
	"math"
	"strconv"
	"strings"

	"github.com/go-pdf/fpdf"
	"golang.org/x/net/html"
)

// metrics taken from docs.css (#editor and friends), in PDF units (mm)
const (
	ptToMM = 25.4 / 72.0

	docBaseSizePt = 11.0 // #editor font-size
	docLineFactor = 1.5  // #editor line-height

	// Arial hhea metrics per em - only used to place the baseline inside a
	// line box, never to size it (CSS line-height rules that)
	fontAscentEm  = 0.905
	fontDescentEm = 0.212
)

// pdfRun is one drawable piece of a laid-out line
type pdfRun struct {
	text   string  // already cp1252-translated
	w      float64 // mm
	sizePt float64
	family string // fpdf core family: Arial / Times / Courier
	style  string // fpdf style string (B / I / U combos)
	color  string
	hl     string // highlight (background) color
	link   string
	strike bool
	space  bool // collapsible space run (dropped at a line break)
	img    *pdfImg
}

// pdfImg is a registered image placed inline
type pdfImg struct {
	name     string
	wmm, hmm float64
}

// pdfLine is one laid-out line box
type pdfLine struct {
	runs   []pdfRun
	h      float64 // line box height
	ascent float64 // baseline offset from the top of the line box
	w      float64 // used width (trailing spaces excluded)
	spaces int     // space runs available for justification
	last   bool    // last line of its paragraph (never justified)
}

// pdfItem is one vertically stacked, page-breakable piece of the document
// (a line, a table row, a rule, a margin, ...). draw renders it with its top
// edge at y; x is baked in when the item is built.
type pdfItem struct {
	h    float64
	draw func(y float64)
	brk  bool // explicit page break
}

type docPdf struct {
	pdf    *fpdf.Fpdf
	tr     func(string) string
	imgSeq int
	textW  float64 // usable text width in mm
	topY   float64 // first usable y on a page
	botY   float64 // last usable y on a page
	pre    bool    // inside <pre>: preserve whitespace
}

// BuildDocPdf renders a Document into PDF bytes
func BuildDocPdf(doc *Document) ([]byte, error) {
	// page geometry
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
	// dims already swapped for landscape above, so always pass "P"
	// (fpdf would swap Wd/Ht again on "L")
	pdf := fpdf.NewCustom(&fpdf.InitType{
		OrientationStr: "P", UnitStr: "mm",
		Size: fpdf.SizeType{Wd: wMM, Ht: hMM},
	})
	b := &docPdf{pdf: pdf, tr: pdfTr(pdf), textW: wMM - mL - mR,
		topY: mT, botY: hMM - mB}
	pdf.SetMargins(mL, mT, mR)
	// the browser wraps text at the content edge - fpdf's default 1mm cell
	// margin would wrap it one millimetre early on both sides
	pdf.SetCellMargin(0)
	// pagination is done here (block by block, like the preview), not by
	// fpdf's line-level automatic break
	pdf.SetAutoPageBreak(false, mB)

	// header / footer text repeats on every page, minus whatever hfMode
	// suppresses (see hfOnPage); the page counter is its own option
	header := strings.TrimSpace(doc.Header)
	footer := strings.TrimSpace(doc.Footer)
	if doc.HFMode == HFModeNone {
		header, footer = "", ""
	}
	if header != "" {
		pdf.SetHeaderFuncMode(func() {
			if !hfOnPage(doc.HFMode, pdf.PageNo()) {
				return
			}
			pdf.SetFont("Arial", "", 9)
			pdf.SetTextColor(107, 112, 120)
			pdf.SetXY(mL, mT-8)
			pdf.CellFormat(b.textW, 4, b.tr(header), "", 0, "L", false, 0, "")
			pdf.SetXY(mL, mT)
		}, true)
	}
	if footer != "" || doc.PageNumbers {
		pdf.SetFooterFunc(func() {
			page := pdf.PageNo()
			txt := ""
			if hfOnPage(doc.HFMode, page) {
				txt = footer
			}
			if hfPageNumberOn(doc, page) {
				if txt != "" {
					txt += " - "
				}
				txt += strconv.Itoa(page)
			}
			if txt == "" {
				return
			}
			pdf.SetFont("Arial", "", 9)
			pdf.SetTextColor(107, 112, 120)
			pdf.SetXY(mL, hMM-mB+3)
			pdf.CellFormat(b.textW, 4, b.tr(txt), "", 0, "L", false, 0, "")
		})
	}
	pdf.AddPage()

	root, err := html.Parse(strings.NewReader("<body>" + doc.HTML + "</body>"))
	if err != nil {
		return nil, err
	}
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
	if bodyNode == nil {
		return nil, errors.New("no document content")
	}

	// top level: every block is placed as one unit, exactly like the
	// preview moves a whole block onto the next sheet
	pending := 0.0
	for _, box := range b.boxes(bodyNode, mL, b.textW, pdfSeg{sizePt: docBaseSizePt}) {
		b.place(math.Max(pending, box.mt), box.items)
		pending = box.mb
	}
	if pdf.Err() {
		return nil, pdf.Error()
	}
	return pdfOutput(pdf)
}

/* ---------------------------------------------------------------- pagination */

// place emits one block: the collapsed margin above it, then its items. The
// whole block moves to the next page when it does not fit on the rest of this
// one (and would fit on an empty page) - the preview's rule.
func (d *docPdf) place(gap float64, items []pdfItem) {
	total := 0.0
	for _, it := range items {
		total += it.h
	}
	y := d.pdf.GetY() + gap
	if y+total > d.botY && total <= d.botY-d.topY && d.pdf.GetY() > d.topY {
		d.pdf.AddPage()
		y = d.topY + gap // the margin applies again below the break
	}
	for _, it := range items {
		if it.brk {
			d.pdf.AddPage()
			y = d.topY
			continue
		}
		// blocks taller than a page still break line by line
		if y+it.h > d.botY && y > d.topY {
			d.pdf.AddPage()
			y = d.topY
		}
		if it.draw != nil {
			it.draw(y)
		}
		y += it.h
	}
	d.pdf.SetY(y)
}

/* -------------------------------------------------------------- block layout */

// pdfBox is one laid-out block with the CSS margins around it
type pdfBox struct {
	items  []pdfItem
	mt, mb float64
}

// boxes lays out the children of n: every block element becomes a box, and
// runs of inline content between them become anonymous paragraphs, exactly
// like a browser builds anonymous block boxes
func (d *docPdf) boxes(n *html.Node, x, w float64, base pdfSeg) []pdfBox {
	var out []pdfBox
	var inline []*html.Node
	flushInline := func() {
		if len(inline) == 0 {
			return
		}
		lines := d.linesOf(d.segsOf(inline, base), w, base, docLineFactor)
		out = append(out, pdfBox{items: d.lineItems(lines, x, w, "")})
		inline = nil
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		switch {
		case c.Type == html.TextNode:
			if len(inline) == 0 && strings.TrimSpace(c.Data) == "" {
				continue // whitespace between blocks is not content
			}
			inline = append(inline, c)
		case c.Type != html.ElementNode:
			continue
		case blockTags[c.Data]:
			flushInline()
			items, mt, mb := d.blockBox(c, x, w)
			out = append(out, pdfBox{items: items, mt: mt, mb: mb})
		default:
			inline = append(inline, c)
		}
	}
	flushInline()
	return out
}

// flow stacks the child boxes of n, collapsing the margins between them.
// When n establishes a block formatting context (a table cell, a padded
// quote, a list item) the outermost margins stay inside it; otherwise they
// collapse through its edges and are returned to the caller instead.
func (d *docPdf) flow(n *html.Node, x, w float64, base pdfSeg, bfc bool) ([]pdfItem, float64, float64) {
	var out []pdfItem
	mt, pending := 0.0, 0.0
	for i, bx := range d.boxes(n, x, w, base) {
		gap := bx.mt
		if i > 0 {
			gap = math.Max(pending, bx.mt)
		} else if !bfc {
			mt = gap
			gap = 0
		}
		if gap > 0 {
			out = append(out, pdfItem{h: gap})
		}
		out = append(out, bx.items...)
		pending = bx.mb
	}
	if !bfc {
		return out, mt, pending
	}
	if pending > 0 {
		out = append(out, pdfItem{h: pending})
	}
	return out, 0, 0
}

// blockBox lays out one block element into items plus its CSS margins
func (d *docPdf) blockBox(n *html.Node, x, w float64) ([]pdfItem, float64, float64) {
	class := " " + htmlAttr(n, "class") + " "
	if strings.Contains(class, " doc-pagebreak ") {
		return []pdfItem{{brk: true}}, 0, 0
	}
	switch n.Data {
	case "h1", "h2", "h3", "h4", "h5", "h6":
		sizes := map[string]float64{"h1": 20, "h2": 16, "h3": 13, "h4": 11, "h5": 11, "h6": 10}
		base := pdfSeg{b: true, i: n.Data == "h4", sizePt: sizes[n.Data]}
		mt, mb := 14*ptToMM, 6*ptToMM
		factor := 1.25
		if strings.Contains(class, " doc-title ") {
			// .doc-title: 26pt, regular weight, margin 0 0 12pt
			base = pdfSeg{sizePt: 26}
			mt, mb = 0, 12*ptToMM
		}
		return d.paraItems(n, x, w, base, factor), mt, mb
	case "ul", "ol":
		return d.listItems(n, x, w, n.Data == "ol")
	case "table":
		return d.tableItems(n, x, w), 8 * ptToMM, 8 * ptToMM
	case "pre":
		return d.preItems(n, x, w), 8 * ptToMM, 8 * ptToMM
	case "blockquote":
		// border-left 3px + padding 2pt 0 2pt 12px
		indent := 15 * pxToMM
		items := d.container(n, x+indent, w-indent, pdfSeg{i: true, sizePt: docBaseSizePt})
		pad := 2 * ptToMM
		var out []pdfItem
		out = append(out, pdfItem{h: pad})
		out = append(out, items...)
		out = append(out, pdfItem{h: pad})
		total := 0.0
		for _, it := range out {
			total += it.h
		}
		bx, bw := x, total
		out[0].draw = func(y float64) {
			d.pdf.SetDrawColor(195, 199, 204)
			d.pdf.SetLineWidth(3 * pxToMM)
			d.pdf.Line(bx+1.5*pxToMM, y, bx+1.5*pxToMM, y+bw)
			d.pdf.SetLineWidth(0.2)
		}
		return out, 8 * ptToMM, 8 * ptToMM
	case "hr":
		h := 14 * ptToMM
		line := pdfItem{h: pxToMM, draw: func(y float64) {
			d.pdf.SetDrawColor(201, 205, 211)
			d.pdf.SetLineWidth(pxToMM)
			d.pdf.Line(x, y, x+w, y)
			d.pdf.SetLineWidth(0.2)
		}}
		return []pdfItem{line}, h, h
	default:
		// a plain wrapper: its children's outer margins collapse through it
		return d.containerBox(n, x, w, pdfSeg{sizePt: docBaseSizePt}, false)
	}
}

// containerBox renders a wrapper element: its block children when it has
// any, otherwise its inline content as one paragraph
func (d *docPdf) containerBox(n *html.Node, x, w float64, base pdfSeg, bfc bool) ([]pdfItem, float64, float64) {
	if hasBlockChild(n) {
		return d.flow(n, x, w, base, bfc)
	}
	return d.paraItems(n, x, w, base, docLineFactor), 0, 0
}

// container is containerBox for the callers that keep every margin inside
func (d *docPdf) container(n *html.Node, x, w float64, base pdfSeg) []pdfItem {
	items, _, _ := d.containerBox(n, x, w, base, true)
	return items
}

// preItems lays out a <pre> block: Courier 10pt / 1.45 on a light card
func (d *docPdf) preItems(n *html.Node, x, w float64) []pdfItem {
	// padding 10px 12px on a 1px bordered card
	padV, padH, bw := 10*pxToMM, 12*pxToMM, pxToMM
	d.pre = true
	base := pdfSeg{sizePt: 10, family: "Courier"}
	lines := d.paraLines(n, w-2*(padH+bw), base, 1.45)
	d.pre = false
	card := func(y, h float64) {
		d.pdf.SetFillColor(241, 243, 244)
		d.pdf.SetDrawColor(226, 229, 233)
		d.pdf.Rect(x, y, w, h, "F")
	}
	out := []pdfItem{{h: padV + bw, draw: func(y float64) { card(y, padV+bw) }}}
	for _, ln := range lines {
		l := ln
		out = append(out, pdfItem{h: l.h, draw: func(y float64) {
			card(y, l.h)
			d.drawLine(l, x+padH+bw, y, w-2*(padH+bw), "")
		}})
	}
	out = append(out, pdfItem{h: padV + bw, draw: func(y float64) { card(y, padV+bw) }})
	return out
}

// listItems lays out <ul>/<ol>: 28px content indent with a hanging marker,
// 4pt/8pt outer margins and 2pt between items (all collapsed as CSS does)
func (d *docPdf) listItems(n *html.Node, x, w float64, numbered bool) ([]pdfItem, float64, float64) {
	indent := 28 * pxToMM
	checklist := strings.Contains(" "+htmlAttr(n, "class")+" ", " of-checklist ")
	liGap := 2 * ptToMM // li { margin: 2pt 0 } - 3pt on checklists
	if checklist {
		liGap = 3 * ptToMM
	}
	var out []pdfItem
	idx := 0
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type != html.ElementNode || c.Data != "li" {
			continue
		}
		idx++
		base := pdfSeg{sizePt: docBaseSizePt}
		done := checklist && strings.Contains(" "+htmlAttr(c, "class")+" ", " checked ")
		if done {
			// li.checked { text-decoration: line-through; color: #9aa0a6 }
			base.strike = true
			base.color = "#9aa0a6"
		}
		items := d.container(c, x+indent, w-indent, base)
		if len(items) > 0 {
			switch {
			case checklist:
				d.attachCheckbox(&items[0], x+indent, done)
			case numbered:
				d.attachMarker(&items[0], d.tr(strconv.Itoa(idx)+"."), x+indent)
			default:
				d.attachMarker(&items[0], d.tr("•"), x+indent)
			}
		}
		if len(out) > 0 {
			out = append(out, pdfItem{h: liGap})
		}
		out = append(out, items...)
	}
	return out, math.Max(4*ptToMM, liGap), math.Max(8*ptToMM, liGap)
}

// attachMarker draws a list marker right-aligned just before the first line
// of an item, without disturbing that line's own drawing
func (d *docPdf) attachMarker(it *pdfItem, marker string, contentX float64) {
	inner := it.draw
	it.draw = func(y float64) {
		d.pdf.SetFont("Arial", "", docBaseSizePt)
		d.pdf.SetTextColor(31, 35, 40)
		w := d.pdf.GetStringWidth(marker)
		_, asc := lineMetrics(docBaseSizePt*ptToMM, docLineFactor)
		d.pdf.Text(contentX-w-1.5, y+asc, marker)
		if inner != nil {
			inner(y)
		}
	}
}

// attachCheckbox draws a checklist item's box (and its tick when done) the
// way the editor's ::before rule paints it - never an emoji glyph
func (d *docPdf) attachCheckbox(it *pdfItem, contentX float64, checked bool) {
	inner := it.draw
	it.draw = func(y float64) {
		pdf := d.pdf
		box := 13 * pxToMM
		bx := contentX - 22*pxToMM
		by := y + 0.22*docBaseSizePt*ptToMM
		pdf.SetLineWidth(1.5 * pxToMM)
		if checked {
			pdf.SetFillColor(26, 115, 232)
			pdf.SetDrawColor(26, 115, 232)
		} else {
			pdf.SetFillColor(255, 255, 255)
			pdf.SetDrawColor(138, 143, 152)
		}
		pdf.RoundedRect(bx, by, box, box, 3*pxToMM, "1234", "FD")
		if checked { // tick
			pdf.SetDrawColor(255, 255, 255)
			pdf.SetLineWidth(1.4 * pxToMM)
			pdf.Line(bx+box*0.25, by+box*0.52, bx+box*0.43, by+box*0.72)
			pdf.Line(bx+box*0.43, by+box*0.72, bx+box*0.76, by+box*0.28)
		}
		pdf.SetLineWidth(0.2)
		if inner != nil {
			inner(y)
		}
	}
}

// lineItems turns laid-out lines into page items
func (d *docPdf) lineItems(lines []pdfLine, x, w float64, align string) []pdfItem {
	out := make([]pdfItem, 0, len(lines))
	for _, ln := range lines {
		l := ln
		out = append(out, pdfItem{h: l.h, draw: func(y float64) {
			d.drawLine(l, x, y, w, align)
		}})
	}
	return out
}

// paraItems lays out one paragraph and wraps its lines into page items
func (d *docPdf) paraItems(n *html.Node, x, w float64, base pdfSeg, factor float64) []pdfItem {
	if lh := styleProp(htmlAttr(n, "style"), "line-height"); lh != "" {
		if v, err := strconv.ParseFloat(strings.TrimSuffix(lh, "px"), 64); err == nil && v > 0 && v < 5 {
			factor = v
		}
	}
	align := ""
	switch styleProp(htmlAttr(n, "style"), "text-align") {
	case "center":
		align = "C"
	case "right":
		align = "R"
	case "justify":
		align = "J"
	}
	return d.lineItems(d.paraLines(n, w, base, factor), x, w, align)
}

/* ------------------------------------------------------------ inline layout */

// pdfSeg is one styled run of inline content before line breaking
type pdfSeg struct {
	text    string
	b, i, u bool
	strike  bool
	family  string
	color   string
	hl      string // text highlight (background) color
	sizePt  float64
	link    string
	img     *html.Node // inline image instead of text
	brk     bool       // <br>
}

func (s pdfSeg) fontStyle() string { return pdfStyleStr(s.b, s.i, s.u) }

func (s pdfSeg) fontFamily() string {
	if s.family != "" {
		return s.family
	}
	return "Arial"
}

// collapseWS folds every run of HTML whitespace into a single space, the way
// a browser does. Without it the hard newlines that pasted markup is full of
// would each become a real line break in the PDF.
func collapseWS(s string) string {
	var sb strings.Builder
	sb.Grow(len(s))
	sp := false
	for i := 0; i < len(s); i++ {
		switch s[i] {
		case ' ', '\t', '\n', '\r', '\f', '\v':
			sp = true
		default:
			if sp {
				// a leading space is kept here and collapsed away later,
				// when it lands at the start of a line
				sb.WriteByte(' ')
			}
			sp = false
			sb.WriteByte(s[i])
		}
	}
	if sp {
		sb.WriteByte(' ')
	}
	return sb.String()
}

// cssFontFamily maps a CSS font stack onto the PDF core font that is closest
func cssFontFamily(f string) string {
	f = strings.ToLower(f)
	switch {
	case f == "":
		return ""
	case strings.Contains(f, "courier"), strings.Contains(f, "consolas"),
		strings.Contains(f, "mono"):
		return "Courier"
	case strings.Contains(f, "times"), strings.Contains(f, "georgia"),
		strings.Contains(f, "serif") && !strings.Contains(f, "sans-serif"):
		return "Times"
	}
	return "Arial"
}

// collectSegs flattens the inline content of n into styled runs
func (d *docPdf) collectSegs(n *html.Node, cur pdfSeg, out *[]pdfSeg) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		d.collectNode(c, cur, out)
	}
}

// segsOf flattens a list of sibling inline nodes (an anonymous block)
func (d *docPdf) segsOf(nodes []*html.Node, base pdfSeg) []pdfSeg {
	var out []pdfSeg
	for _, n := range nodes {
		d.collectNode(n, base, &out)
	}
	return out
}

func (d *docPdf) collectNode(c *html.Node, cur pdfSeg, out *[]pdfSeg) {
	if c.Type == html.TextNode {
		txt := c.Data
		if !d.pre {
			txt = collapseWS(txt)
		}
		if txt != "" {
			seg := cur
			seg.text = txt
			*out = append(*out, seg)
		}
		return
	}
	if c.Type != html.ElementNode {
		return
	}
	if c.Data == "br" {
		seg := cur
		seg.brk = true
		*out = append(*out, seg)
		return
	}
	if c.Data == "img" {
		*out = append(*out, pdfSeg{img: c, sizePt: cur.sizePt})
		return
	}
	cf := cur
	st := htmlAttr(c, "style")
	switch c.Data {
	case "b", "strong":
		cf.b = true
	case "i", "em":
		cf.i = true
	case "u", "ins":
		cf.u = true
	case "s", "strike", "del":
		cf.strike = true
	case "a":
		cf.link = htmlAttr(c, "href")
		cf.color = "#1a58c2"
		cf.u = true
	case "font":
		if col := htmlAttr(c, "color"); col != "" {
			cf.color = col
		}
		if fam := cssFontFamily(htmlAttr(c, "face")); fam != "" {
			cf.family = fam
		}
	case "mark":
		cf.hl = "#ffff00"
	}
	if col := styleProp(st, "color"); col != "" {
		cf.color = col
	}
	if bgc := styleProp(st, "background-color"); bgc != "" {
		cf.hl = bgc
	}
	if fam := cssFontFamily(styleProp(st, "font-family")); fam != "" {
		cf.family = fam
	}
	if fw := styleProp(st, "font-weight"); fw == "700" || fw == "bold" || fw == "600" {
		cf.b = true
	}
	if styleProp(st, "font-style") == "italic" {
		cf.i = true
	}
	if fs := styleProp(st, "font-size"); strings.HasSuffix(fs, "px") {
		if v, err := strconv.ParseFloat(strings.TrimSuffix(fs, "px"), 64); err == nil && v > 0 {
			cf.sizePt = v * 72.0 / 96.0
		}
	} else if strings.HasSuffix(fs, "pt") {
		if v, err := strconv.ParseFloat(strings.TrimSuffix(fs, "pt"), 64); err == nil && v > 0 {
			cf.sizePt = v
		}
	}
	if td := styleProp(st, "text-decoration"); td != "" {
		if strings.Contains(td, "underline") {
			cf.u = true
		}
		if strings.Contains(td, "line-through") {
			cf.strike = true
		}
	}
	d.collectSegs(c, cf, out)
}

// lineMetrics returns the line-box height and baseline offset of one run
func lineMetrics(sizeMM, factor float64) (h, ascent float64) {
	h = sizeMM * factor
	ascent = (h-(fontAscentEm+fontDescentEm)*sizeMM)/2 + fontAscentEm*sizeMM
	return
}

// paraLines collects the inline content of n and breaks it into lines that
// fit availW, the way the browser's line breaker does
func (d *docPdf) paraLines(n *html.Node, availW float64, base pdfSeg, factor float64) []pdfLine {
	if base.sizePt <= 0 {
		base.sizePt = docBaseSizePt
	}
	var segs []pdfSeg
	d.collectSegs(n, base, &segs)
	return d.linesOf(segs, availW, base, factor)
}

// linesOf breaks collected segments into lines, applying the two browser
// rules for near-empty blocks: a block with no content at all has no line
// box (height 0), while a lone or trailing <br> still leaves one empty line
func (d *docPdf) linesOf(segs []pdfSeg, availW float64, base pdfSeg, factor float64) []pdfLine {
	content := false
	for _, s := range segs {
		if s.img != nil || s.brk || strings.TrimSpace(s.text) != "" {
			content = true
			break
		}
	}
	if !content {
		return nil
	}
	// a <br> at the very end of a block adds no line in a browser
	for len(segs) > 0 && segs[len(segs)-1].brk {
		segs = segs[:len(segs)-1]
	}
	return d.layoutSegs(segs, availW, base, factor)
}

func (d *docPdf) layoutSegs(segs []pdfSeg, availW float64, base pdfSeg, factor float64) []pdfLine {
	baseH, baseAsc := lineMetrics(base.sizePt*ptToMM, factor)
	if availW < 1 {
		availW = 1
	}
	var lines []pdfLine
	cur := pdfLine{h: baseH, ascent: baseAsc}
	used := 0.0 // width including any trailing spaces

	grow := func(r pdfRun) {
		var h, asc float64
		if r.img != nil {
			h, asc = r.img.hmm, r.img.hmm
		} else {
			h, asc = lineMetrics(r.sizePt*ptToMM, factor)
		}
		desc := math.Max(cur.h-cur.ascent, h-asc)
		cur.ascent = math.Max(cur.ascent, asc)
		cur.h = cur.ascent + desc
	}
	flush := func(last bool) {
		// trailing spaces do not occupy the end of a line
		for len(cur.runs) > 0 && cur.runs[len(cur.runs)-1].space {
			cur.runs = cur.runs[:len(cur.runs)-1]
		}
		cur.w = 0
		cur.spaces = 0
		for i, r := range cur.runs {
			cur.w += r.w
			if r.space && i < len(cur.runs)-1 {
				cur.spaces++
			}
		}
		cur.last = last
		lines = append(lines, cur)
		cur = pdfLine{h: baseH, ascent: baseAsc}
		used = 0
	}
	add := func(r pdfRun) {
		cur.runs = append(cur.runs, r)
		used += r.w
		grow(r)
	}

	for _, s := range segs {
		if s.brk {
			flush(true)
			continue
		}
		if s.img != nil {
			img := d.inlineImage(s.img, availW)
			if img == nil {
				continue
			}
			if used+img.wmm > availW+0.01 && len(cur.runs) > 0 {
				flush(false)
			}
			add(pdfRun{img: img, w: img.wmm, sizePt: base.sizePt,
				family: base.fontFamily()})
			continue
		}
		sizePt := s.sizePt
		if sizePt <= 0 {
			sizePt = base.sizePt
		}
		family, style := s.fontFamily(), s.fontStyle()
		d.pdf.SetFont(family, style, sizePt)
		parts := strings.Split(d.tr(s.text), "\n") // \n only survives in <pre>
		for li, part := range parts {
			if li > 0 {
				flush(true)
			}
			for _, tok := range splitTokens(part, d.pre) {
				isSpace := strings.TrimLeft(tok, " ") == ""
				if isSpace && len(cur.runs) == 0 {
					continue // whitespace at the start of a line collapses away
				}
				w := d.pdf.GetStringWidth(tok)
				if !isSpace && used+w > availW+0.01 && len(cur.runs) > 0 {
					flush(false)
				}
				if !isSpace && w > availW {
					// a single word wider than the line (word-wrap: break-word)
					for _, piece := range d.breakWord(tok, availW, &used) {
						if piece.brk {
							flush(false)
							continue
						}
						add(pdfRun{text: piece.text, w: piece.w, sizePt: sizePt,
							family: family, style: style, color: s.color,
							hl: s.hl, link: s.link, strike: s.strike})
					}
					continue
				}
				add(pdfRun{text: tok, w: w, sizePt: sizePt, family: family,
					style: style, color: s.color, hl: s.hl, link: s.link,
					strike: s.strike, space: isSpace})
			}
		}
	}
	flush(true)
	return lines
}

// splitTokens cuts text into wrap tokens: words and the single spaces that
// separate them (inside <pre>, runs of spaces are kept as one token)
func splitTokens(s string, pre bool) []string {
	var out []string
	i := 0
	for i < len(s) {
		j := i
		if s[i] == ' ' {
			for j < len(s) && s[j] == ' ' {
				j++
			}
			if !pre {
				for ; i < j; i++ {
					out = append(out, " ")
				}
				continue
			}
		} else {
			for j < len(s) && s[j] != ' ' {
				j++
			}
		}
		out = append(out, s[i:j])
		i = j
	}
	return out
}

type wordPiece struct {
	text string
	w    float64
	brk  bool
}

// breakWord splits a word that cannot fit on one line into line-sized pieces
func (d *docPdf) breakWord(tok string, availW float64, used *float64) []wordPiece {
	var out []wordPiece
	start, w := 0, 0.0
	for i := 0; i < len(tok); i++ {
		cw := d.pdf.GetStringWidth(tok[i : i+1])
		if w+cw > availW-*used && i > start {
			out = append(out, wordPiece{text: tok[start:i], w: w})
			out = append(out, wordPiece{brk: true})
			start, w = i, 0
			*used = 0
		}
		w += cw
	}
	if start < len(tok) {
		out = append(out, wordPiece{text: tok[start:], w: w})
	}
	return out
}

// inlineImage registers an image and returns its placed size
func (d *docPdf) inlineImage(n *html.Node, availW float64) *pdfImg {
	src := htmlAttr(n, "src")
	name, _, ok := pdfImageFromDataURL(d.pdf, src, &d.imgSeq)
	if !ok {
		return nil
	}
	data, _, _ := decodeDataURL(src)
	wPx, hPx := odfImageSizePx(n, data)
	// #editor img { height: auto } - the stylesheet beats a height attribute,
	// so unless the height is pinned inline the aspect ratio rules
	if !strings.HasSuffix(styleProp(htmlAttr(n, "style"), "height"), "px") {
		if cfg, _, err := imageConfigOf(data); err == nil && cfg.Width > 0 {
			hPx = wPx * float64(cfg.Height) / float64(cfg.Width)
		}
	}
	wmm, hmm := wPx*pxToMM, hPx*pxToMM
	if wmm > availW && wmm > 0 { // #editor img { max-width: 100% }
		hmm = hmm * availW / wmm
		wmm = availW
	}
	return &pdfImg{name: name, wmm: wmm, hmm: hmm}
}

/* ---------------------------------------------------------------- rendering */

// drawLine paints one laid-out line with its top edge at y
func (d *docPdf) drawLine(ln pdfLine, x, y, availW float64, align string) {
	pdf := d.pdf
	extra := 0.0 // per-space padding for justified text
	switch align {
	case "C":
		x += (availW - ln.w) / 2
	case "R":
		x += availW - ln.w
	case "J":
		if !ln.last && ln.spaces > 0 && ln.w < availW {
			extra = (availW - ln.w) / float64(ln.spaces)
		}
	}
	baseline := y + ln.ascent
	// neighbouring runs that share their styling are drawn as one text
	// object, so the PDF keeps whole words and sentences intact
	for i := 0; i < len(ln.runs); i++ {
		r := ln.runs[i]
		if r.img != nil {
			pdf.ImageOptions(r.img.name, x, baseline-r.img.hmm, r.img.wmm,
				r.img.hmm, false, fpdf.ImageOptions{}, 0, "")
			x += r.img.wmm
			continue
		}
		txt, w := r.text, r.w
		if r.space && extra > 0 && i < len(ln.runs)-1 {
			w += extra
		} else {
			for j := i + 1; j < len(ln.runs); j++ {
				nx := ln.runs[j]
				if nx.img != nil || !sameStyle(r, nx) ||
					(extra > 0 && nx.space && j < len(ln.runs)-1) {
					break
				}
				txt += nx.text
				w += nx.w
				i = j
			}
		}
		sz := r.sizePt * ptToMM
		if r.hl != "" && pdfSetFillHex(pdf, r.hl) {
			pdf.Rect(x, baseline-fontAscentEm*sz, w, (fontAscentEm+fontDescentEm)*sz, "F")
		}
		if strings.TrimSpace(txt) != "" {
			pdf.SetFont(r.family, r.style, r.sizePt)
			pdfSetTextHex(pdf, r.color, 31, 35, 40)
			pdf.Text(x, baseline, txt)
		}
		if r.strike && strings.TrimSpace(txt) != "" {
			pdf.SetLineWidth(math.Max(0.15, sz*0.06))
			pdf.Line(x, baseline-sz*0.27, x+w, baseline-sz*0.27)
			pdf.SetLineWidth(0.2)
		}
		if r.link != "" && strings.HasPrefix(r.link, "http") {
			pdf.LinkString(x, baseline-fontAscentEm*sz, w,
				(fontAscentEm+fontDescentEm)*sz, r.link)
		}
		x += w
	}
}

// sameStyle reports whether two runs can share one text object
func sameStyle(a, b pdfRun) bool {
	return a.sizePt == b.sizePt && a.family == b.family && a.style == b.style &&
		a.color == b.color && a.hl == b.hl && a.link == b.link &&
		a.strike == b.strike
}

/* -------------------------------------------------------------------- tables */

// tableItems lays out a table as one item per row (CSS: border-collapse,
// 1px #b9bec7 borders, 4px/8px cell padding, top aligned cells)
func (d *docPdf) tableItems(n *html.Node, x, w float64) []pdfItem {
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
		return nil
	}
	pcts := tableColPercents(n, cols)
	tblW := w * tableWidthPct(n) / 100
	widths := make([]float64, cols)
	for i := range widths {
		widths[i] = tblW * pcts[i] / 100
	}

	padV, padH := 4*pxToMM, 8*pxToMM
	bw := pxToMM // collapsed 1px border, shared between neighbouring rows
	var out []pdfItem
	var rows func(node *html.Node)
	rows = func(node *html.Node) {
		for c := node.FirstChild; c != nil; c = c.NextSibling {
			if c.Type != html.ElementNode {
				continue
			}
			switch c.Data {
			case "thead", "tbody", "tfoot":
				rows(c)
			case "tr":
				type cellBox struct {
					items []pdfItem
					x, w  float64
					bg    string
					h     float64
				}
				var cells []cellBox
				cx, ci := x, 0
				rowH := 0.0
				for td := c.FirstChild; td != nil && ci < cols; td = td.NextSibling {
					if td.Type != html.ElementNode || (td.Data != "td" && td.Data != "th") {
						continue
					}
					st := htmlAttr(td, "style")
					base := pdfSeg{sizePt: docBaseSizePt,
						b: td.Data == "th" || styleProp(st, "font-weight") == "700" ||
							styleProp(st, "font-weight") == "600" ||
							styleProp(st, "font-weight") == "bold",
						color: styleProp(st, "color")}
					bg := styleProp(st, "background-color")
					if bg == "" && td.Data == "th" {
						bg = "#f1f3f4"
					}
					cw := widths[ci]
					items := d.container(td, cx+padH, cw-2*padH, base)
					h := 2 * padV
					for _, it := range items {
						h += it.h
					}
					cells = append(cells, cellBox{items: items, x: cx, w: cw, bg: bg, h: h})
					rowH = math.Max(rowH, h)
					cx += cw
					ci++
				}
				if len(cells) == 0 {
					continue
				}
				boxes := cells
				h := rowH + bw
				out = append(out, pdfItem{h: h, draw: func(y float64) {
					d.pdf.SetDrawColor(185, 190, 199)
					d.pdf.SetLineWidth(bw)
					for _, cb := range boxes {
						mode := "D"
						if pdfSetFillHex(d.pdf, cb.bg) {
							mode = "FD"
						}
						d.pdf.Rect(cb.x, y, cb.w, h, mode)
						cy := y + bw + padV
						for _, it := range cb.items {
							if it.draw != nil {
								it.draw(cy)
							}
							cy += it.h
						}
					}
					d.pdf.SetLineWidth(0.2)
				}})
			}
		}
	}
	rows(n)
	if len(out) > 0 {
		out = append(out, pdfItem{h: bw}) // the table's own bottom border
	}
	return out
}
