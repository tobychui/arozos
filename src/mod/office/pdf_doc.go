package office

/*
	pdf_doc.go - Build a PDF from a Docs Document with REAL text.

	Walks the same HTML subset as the docx writer: paragraphs and headings
	(with the editor's Arial 11pt / 1.5 line-height typography), inline
	bold/italic/underline/color/size, links (clickable), lists, tables
	(colgroup widths, cell shading), inline images, explicit page breaks,
	page geometry, and header/footer text with optional page numbers.
*/

import (
	"errors"
	"strconv"
	"strings"

	"github.com/go-pdf/fpdf"
	"golang.org/x/net/html"
)

type docPdf struct {
	pdf    *fpdf.Fpdf
	tr     func(string) string
	imgSeq int
	textW  float64 // usable text width in mm
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
	b := &docPdf{pdf: pdf, tr: pdfTr(pdf), textW: wMM - mL - mR}
	pdf.SetMargins(mL, mT, mR)
	pdf.SetAutoPageBreak(true, mB)

	header := strings.TrimSpace(doc.Header)
	footer := strings.TrimSpace(doc.Footer)
	pageNumbers := doc.PageNumbers
	if header != "" {
		pdf.SetHeaderFuncMode(func() {
			pdf.SetFont("Arial", "", 9)
			pdf.SetTextColor(107, 112, 120)
			pdf.SetXY(mL, mT-8)
			pdf.CellFormat(b.textW, 4, b.tr(header), "", 0, "L", false, 0, "")
			pdf.SetXY(mL, mT)
		}, true)
	}
	if footer != "" || pageNumbers {
		pdf.SetFooterFunc(func() {
			pdf.SetFont("Arial", "", 9)
			pdf.SetTextColor(107, 112, 120)
			pdf.SetXY(mL, hMM-mB+3)
			txt := footer
			if pageNumbers {
				if txt != "" {
					txt += " - "
				}
				txt += strconv.Itoa(pdf.PageNo())
			}
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
	for c := bodyNode.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode {
			b.block(c, 0)
		}
	}
	if pdf.Err() {
		return nil, pdf.Error()
	}
	return pdfOutput(pdf)
}

// pdfSeg is one styled run within a paragraph
type pdfSeg struct {
	text    string
	b, i, u bool
	color   string
	hl      string // text highlight (background) color
	sizePt  float64
	link    string
	img     *html.Node // inline image instead of text
}

func (d *docPdf) block(n *html.Node, indentMM float64) {
	if strings.Contains(" "+htmlAttr(n, "class")+" ", " doc-pagebreak ") {
		d.pdf.AddPage()
		return
	}
	switch n.Data {
	case "h1", "h2", "h3", "h4", "h5", "h6":
		sizes := map[string]float64{"h1": 20, "h2": 16, "h3": 13, "h4": 11, "h5": 11, "h6": 10}
		size := sizes[n.Data]
		italic := n.Data == "h4"
		if strings.Contains(" "+htmlAttr(n, "class")+" ", " doc-title ") {
			size = 26
			italic = false
		}
		d.pdf.Ln(4.9) // 14pt before
		d.paragraph(n, indentMM, pdfSeg{b: true, i: italic, sizePt: size}, 1.25)
		d.pdf.Ln(2.1) // 6pt after
	case "ul":
		d.list(n, indentMM, false)
	case "ol":
		d.list(n, indentMM, true)
	case "table":
		d.table(n)
	case "pre":
		d.paragraph(n, indentMM, pdfSeg{sizePt: 10}, 1.4)
	case "blockquote":
		d.blocksOrParagraph(n, indentMM+8, pdfSeg{i: true, sizePt: 11})
	case "hr":
		y := d.pdf.GetY() + 2
		ml, _, mr, _ := d.pdf.GetMargins()
		w, _ := d.pdf.GetPageSize()
		d.pdf.SetDrawColor(170, 170, 170)
		d.pdf.Line(ml, y, w-mr, y)
		d.pdf.SetY(y + 2)
	default:
		d.blocksOrParagraph(n, indentMM, pdfSeg{sizePt: 11})
	}
}

func (d *docPdf) blocksOrParagraph(n *html.Node, indentMM float64, base pdfSeg) {
	if hasBlockChild(n) {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.ElementNode {
				d.block(c, indentMM)
			}
		}
		return
	}
	d.paragraph(n, indentMM, base, 1.5)
}

func (d *docPdf) list(n *html.Node, indentMM float64, numbered bool) {
	idx := 0
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type != html.ElementNode || c.Data != "li" {
			continue
		}
		idx++
		marker := "• "
		if numbered {
			marker = strconv.Itoa(idx) + ". "
		}
		d.paragraphWithPrefix(c, indentMM+6, marker, pdfSeg{sizePt: 11}, 1.5)
	}
}

// collectSegs flattens inline content into styled runs
func (d *docPdf) collectSegs(n *html.Node, cur pdfSeg, out *[]pdfSeg) {
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.TextNode {
			if c.Data != "" {
				seg := cur
				seg.text = c.Data
				*out = append(*out, seg)
			}
			continue
		}
		if c.Type != html.ElementNode {
			continue
		}
		if c.Data == "br" {
			seg := cur
			seg.text = "\n"
			*out = append(*out, seg)
			continue
		}
		if c.Data == "img" {
			*out = append(*out, pdfSeg{img: c})
			continue
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
		case "a":
			cf.link = htmlAttr(c, "href")
			cf.color = "#1a58c2"
			cf.u = true
		case "font":
			if col := htmlAttr(c, "color"); col != "" {
				cf.color = col
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
		if fw := styleProp(st, "font-weight"); fw == "700" || fw == "bold" {
			cf.b = true
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
		if td := styleProp(st, "text-decoration"); strings.Contains(td, "underline") {
			cf.u = true
		}
		d.collectSegs(c, cf, out)
	}
}

func (d *docPdf) paragraph(n *html.Node, indentMM float64, base pdfSeg, lineFactor float64) {
	d.paragraphWithPrefix(n, indentMM, "", base, lineFactor)
}

func (d *docPdf) paragraphWithPrefix(n *html.Node, indentMM float64, prefix string, base pdfSeg, lineFactor float64) {
	if base.sizePt <= 0 {
		base.sizePt = 11
	}
	var segs []pdfSeg
	d.collectSegs(n, base, &segs)

	align := ""
	switch styleProp(htmlAttr(n, "style"), "text-align") {
	case "center":
		align = "C"
	case "right":
		align = "R"
	case "justify":
		align = "J"
	}

	pdf := d.pdf
	ml, _, _, _ := pdf.GetMargins()
	lineH := base.sizePt * lineFactor * 0.3528
	pdf.SetLeftMargin(ml + indentMM)
	pdf.SetX(ml + indentMM)

	if prefix != "" {
		pdf.SetFont("Arial", pdfStyleStr(base.b, base.i, base.u), base.sizePt)
		pdfSetTextHex(pdf, base.color, 31, 35, 40)
		pdf.Write(lineH, d.tr(prefix))
	}

	if len(segs) == 0 {
		pdf.Ln(lineH) // empty paragraph keeps its height
		pdf.SetLeftMargin(ml)
		return
	}

	if align != "" {
		// aligned paragraphs: render as one run in the base style (inline
		// styling inside centered text is an accepted simplification)
		var texts []string
		for _, s := range segs {
			if s.img == nil {
				texts = append(texts, s.text)
			}
		}
		pdf.SetFont("Arial", pdfStyleStr(base.b, base.i, base.u), base.sizePt)
		pdfSetTextHex(pdf, base.color, 31, 35, 40)
		pdf.MultiCell(d.textW-indentMM, lineH, d.tr(strings.Join(texts, "")), "", align, false)
		pdf.SetLeftMargin(ml)
		return
	}

	for _, s := range segs {
		if s.img != nil {
			d.inlineImage(s.img, lineH)
			continue
		}
		if s.text == "\n" {
			pdf.Ln(lineH)
			continue
		}
		sz := s.sizePt
		if sz <= 0 {
			sz = base.sizePt
		}
		pdf.SetFont("Arial", pdfStyleStr(s.b, s.i, s.u), sz)
		pdfSetTextHex(pdf, s.color, 31, 35, 40)
		if s.hl != "" {
			d.writeHighlighted(d.tr(s.text), lineH, s.hl)
		} else if s.link != "" && strings.HasPrefix(s.link, "http") {
			pdf.WriteLinkString(lineH, d.tr(s.text), s.link)
		} else {
			pdf.Write(lineH, d.tr(s.text))
		}
	}
	pdf.Ln(lineH)
	pdf.SetLeftMargin(ml)
}

// writeHighlighted writes a text run with a filled background color,
// wrapping word-by-word at the right margin (fpdf has no native text
// background, so each word is drawn as a filled cell)
func (d *docPdf) writeHighlighted(trText string, lineH float64, hl string) {
	pdf := d.pdf
	if !pdfSetFillHex(pdf, hl) {
		pdf.Write(lineH, trText)
		return
	}
	pageW, _ := pdf.GetPageSize()
	_, _, mr, _ := pdf.GetMargins()
	for _, w := range strings.SplitAfter(trText, " ") {
		if w == "" {
			continue
		}
		ww := pdf.GetStringWidth(w)
		if pdf.GetX()+ww > pageW-mr {
			pdf.Ln(lineH)
		}
		pdf.CellFormat(ww, lineH, w, "", 0, "L", true, 0, "")
	}
}

func (d *docPdf) inlineImage(n *html.Node, lineH float64) {
	src := htmlAttr(n, "src")
	name, _, ok := pdfImageFromDataURL(d.pdf, src, &d.imgSeq)
	if !ok {
		return
	}
	data, _, _ := decodeDataURL(src)
	wPx, hPx := odfImageSizePx(n, data)
	wmm, hmm := wPx*pxToMM, hPx*pxToMM
	if wmm > d.textW {
		hmm = hmm * d.textW / wmm
		wmm = d.textW
	}
	pdf := d.pdf
	// small images (rasterized emoji etc.) flow inline with the text
	if hmm <= 8 && wmm <= 12 {
		pageW, _ := pdf.GetPageSize()
		_, _, mr, _ := pdf.GetMargins()
		if pdf.GetX()+wmm > pageW-mr {
			pdf.Ln(lineH)
		}
		yOff := (lineH - hmm) / 2
		if yOff < 0 {
			yOff = 0
		}
		pdf.ImageOptions(name, pdf.GetX(), pdf.GetY()+yOff, wmm, hmm, false,
			fpdf.ImageOptions{}, 0, "")
		pdf.SetX(pdf.GetX() + wmm)
		return
	}
	// block image: own line, manual page break (images do not auto-break)
	_, pageH := pdf.GetPageSize()
	_, _, _, mb := pdf.GetMargins()
	if pdf.GetY()+hmm > pageH-mb {
		pdf.AddPage()
	}
	ml, _, _, _ := pdf.GetMargins()
	pdf.ImageOptions(name, ml, pdf.GetY(), wmm, hmm, false,
		fpdf.ImageOptions{}, 0, "")
	pdf.SetY(pdf.GetY() + hmm + 2)
}

func (d *docPdf) table(n *html.Node) {
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
		return
	}
	pcts := tableColPercents(n, cols)
	tblW := d.textW * tableWidthPct(n) / 100
	widths := make([]float64, cols)
	for i := range widths {
		widths[i] = tblW * pcts[i] / 100
	}

	pdf := d.pdf
	const cellPad = 1.5
	lineH := 11 * 1.35 * 0.3528
	var renderRows func(node *html.Node)
	renderRows = func(node *html.Node) {
		for c := node.FirstChild; c != nil; c = c.NextSibling {
			if c.Type != html.ElementNode {
				continue
			}
			switch c.Data {
			case "thead", "tbody", "tfoot":
				renderRows(c)
			case "tr":
				// measure the row height first (wrapped lines + images per cell)
				type cellInfo struct {
					lines   []string
					imgs    []pdfCellImg
					bold    bool
					bg      string
					fgColor string
				}
				var cells []cellInfo
				ci := 0
				rowH := lineH
				for td := c.FirstChild; td != nil && ci < cols; td = td.NextSibling {
					if td.Type != html.ElementNode || (td.Data != "td" && td.Data != "th") {
						continue
					}
					st := htmlAttr(td, "style")
					info := cellInfo{
						bold: td.Data == "th" || styleProp(st, "font-weight") == "700" ||
							styleProp(st, "font-weight") == "bold",
						bg:      styleProp(st, "background-color"),
						fgColor: styleProp(st, "color"),
					}
					availW := widths[ci] - 2*cellPad
					pdf.SetFont("Arial", pdfStyleStr(info.bold, false, false), 11)
					txt := d.tr(strings.TrimSpace(cellText(td)))
					if txt != "" {
						// keep the cell's block structure: wrap each
						// logical line separately
						for _, para := range strings.Split(txt, "\n") {
							seg := pdfSplitTr(pdf, para, availW)
							if len(seg) == 0 {
								seg = []string{""}
							}
							info.lines = append(info.lines, seg...)
						}
					}
					info.imgs = d.cellImages(td, availW)
					h := float64(len(info.lines))*lineH + 2*cellPad
					for _, im := range info.imgs {
						h += im.hmm + 1
					}
					if h > rowH {
						rowH = h
					}
					cells = append(cells, info)
					ci++
				}
				// page break for the whole row
				_, pageH := pdf.GetPageSize()
				_, _, _, mb := pdf.GetMargins()
				if pdf.GetY()+rowH > pageH-mb {
					pdf.AddPage()
				}
				ml, _, _, _ := pdf.GetMargins()
				x := ml
				y := pdf.GetY()
				pdf.SetDrawColor(153, 153, 153)
				for i, info := range cells {
					fill := pdfSetFillHex(pdf, info.bg)
					pdf.Rect(x, y, widths[i], rowH, map[bool]string{true: "FD", false: "D"}[fill])
					pdf.SetFont("Arial", pdfStyleStr(info.bold, false, false), 11)
					pdfSetTextHex(pdf, info.fgColor, 31, 35, 40)
					ty := y + cellPad
					for _, ln := range info.lines {
						pdf.Text(x+cellPad, ty+lineH*0.8, ln)
						ty += lineH
					}
					for _, im := range info.imgs {
						pdf.ImageOptions(im.name, x+cellPad, ty, im.wmm, im.hmm,
							false, fpdf.ImageOptions{}, 0, "")
						ty += im.hmm + 1
					}
					x += widths[i]
				}
				pdf.SetY(y + rowH)
			}
		}
	}
	renderRows(n)
	pdf.Ln(2)
}

// pdfCellImg is an image rendered inside a table cell
type pdfCellImg struct {
	name     string
	wmm, hmm float64
}

// cellText flattens a table cell to plain text, preserving its block
// structure: paragraphs, headings and <br> become line breaks, list
// items get a bullet / number marker
func cellText(n *html.Node) string {
	var sb strings.Builder
	blockBreak := func() {
		s := sb.String()
		if s != "" && !strings.HasSuffix(s, "\n") {
			sb.WriteString("\n")
		}
	}
	var walk func(x *html.Node, listIdx *int)
	walk = func(x *html.Node, listIdx *int) {
		for c := x.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.TextNode {
				sb.WriteString(c.Data)
				continue
			}
			if c.Type != html.ElementNode {
				continue
			}
			switch c.Data {
			case "br":
				sb.WriteString("\n")
			case "img":
				// images are collected separately by cellImages
			case "p", "div", "h1", "h2", "h3", "h4", "h5", "h6",
				"blockquote", "pre", "ul", "tr":
				blockBreak()
				walk(c, nil)
				blockBreak()
			case "ol":
				blockBreak()
				idx := 0
				walk(c, &idx)
				blockBreak()
			case "li":
				blockBreak()
				if listIdx != nil {
					*listIdx++
					sb.WriteString(strconv.Itoa(*listIdx) + ". ")
				} else {
					sb.WriteString("• ")
				}
				walk(c, nil)
				blockBreak()
			default:
				walk(c, listIdx)
			}
		}
	}
	walk(n, nil)
	return sb.String()
}

// cellImages registers every image inside a table cell and returns them
// sized to fit the cell width
func (d *docPdf) cellImages(n *html.Node, availW float64) []pdfCellImg {
	var out []pdfCellImg
	var walk func(x *html.Node)
	walk = func(x *html.Node) {
		for c := x.FirstChild; c != nil; c = c.NextSibling {
			if c.Type != html.ElementNode {
				continue
			}
			if c.Data == "img" {
				src := htmlAttr(c, "src")
				name, _, ok := pdfImageFromDataURL(d.pdf, src, &d.imgSeq)
				if !ok {
					continue
				}
				data, _, _ := decodeDataURL(src)
				wPx, hPx := odfImageSizePx(c, data)
				wmm, hmm := wPx*pxToMM, hPx*pxToMM
				if availW > 0 && wmm > availW {
					hmm = hmm * availW / wmm
					wmm = availW
				}
				// keep a very tall image from overflowing the page
				if hmm > 150 {
					wmm = wmm * 150 / hmm
					hmm = 150
				}
				out = append(out, pdfCellImg{name: name, wmm: wmm, hmm: hmm})
				continue
			}
			walk(c)
		}
	}
	walk(n)
	return out
}
