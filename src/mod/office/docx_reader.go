package office

/*
	docx_reader.go - Parse a Word (.docx) file into a Document.

	Converts the common WordprocessingML subset back to the Docs editor
	HTML: paragraphs, heading/title styles, alignment, bold/italic/
	underline/strikethrough, font color/size, hyperlinks, bulleted and
	numbered lists, tables, embedded images (as data URLs), line breaks
	and page geometry from the section properties. Headers/footers come
	back as plain text. Tracked changes, footnotes, text boxes and other
	advanced features are ignored. Legacy binary .doc is rejected.
*/

import (
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"path"
	"strconv"
	"strings"
)

// ParseDocx converts raw .docx bytes into a Document
func ParseDocx(data []byte) (*Document, error) {
	if len(data) > 8 && data[0] == 0xD0 && data[1] == 0xCF {
		return nil, errors.New("legacy binary .doc files are not supported - save the file as .docx first")
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("not a valid docx (zip) file")
	}

	files := map[string][]byte{}
	for _, f := range zr.File {
		name := path.Clean(f.Name)
		if strings.HasSuffix(name, ".xml") || strings.HasSuffix(name, ".rels") ||
			strings.HasPrefix(name, "word/media/") {
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

	docXML, ok := files["word/document.xml"]
	if !ok {
		return nil, errors.New("docx is missing word/document.xml")
	}
	tree, err := parseXMLTree(docXML)
	if err != nil {
		return nil, errors.New("cannot parse document.xml: " + err.Error())
	}
	body := tree.first("body")
	if body == nil {
		return nil, errors.New("document has no body")
	}

	rels := parseRels(files["word/_rels/document.xml.rels"])
	numFmt := parseNumberingFormats(files["word/numbering.xml"])

	cv := &docxConv{files: files, rels: rels, numFmt: numFmt, bodyNode: body}

	doc := &Document{}

	// page geometry (parsed first: multi-column affects HTML conversion)
	if sect := body.first("sectPr"); sect != nil {
		pc := &PageConf{Size: "A4", Orientation: "portrait"}
		if sz := sect.first("pgSz"); sz != nil {
			w, _ := strconv.Atoi(sz.attr("w"))
			h, _ := strconv.Atoi(sz.attr("h"))
			if sz.attr("orient") == "landscape" || w > h {
				pc.Orientation = "landscape"
				w, h = h, w
			}
			best := "A4"
			bestD := 1 << 30
			for name, dim := range pageSizesTwips {
				d := abs(dim[0]-w) + abs(dim[1]-h)
				if d < bestD {
					bestD = d
					best = name
				}
			}
			pc.Size = best
		}
		if mar := sect.first("pgMar"); mar != nil {
			m := &MarginsMM{Top: 25.4, Right: 25.4, Bottom: 25.4, Left: 25.4}
			if v, err := strconv.Atoi(mar.attr("top")); err == nil {
				m.Top = round1(twipsToMm(v))
			}
			if v, err := strconv.Atoi(mar.attr("right")); err == nil {
				m.Right = round1(twipsToMm(v))
			}
			if v, err := strconv.Atoi(mar.attr("bottom")); err == nil {
				m.Bottom = round1(twipsToMm(v))
			}
			if v, err := strconv.Atoi(mar.attr("left")); err == nil {
				m.Left = round1(twipsToMm(v))
			}
			pc.Margins = m
		}
		if cols := sect.first("cols"); cols != nil {
			if n, err := strconv.Atoi(cols.attr("num")); err == nil && n > 1 {
				pc.Columns = n
				if sp, err := strconv.Atoi(cols.attr("space")); err == nil && sp > 0 {
					pc.ColGap = round1(twipsToMm(sp))
				}
			}
		}
		doc.Page = pc
	}

	// Word writes IEEE-style spanning titles as leading single-column
	// sections; map those blocks back to .col-span-all
	if doc.Page != nil && doc.Page.Columns > 1 {
		cv.markSpanSections(body)
	}
	doc.HTML = cv.blocksToHTML(body)

	// header / footer text (first part of each kind)
	for name, raw := range files {
		if strings.HasPrefix(name, "word/header") && strings.HasSuffix(name, ".xml") && doc.Header == "" {
			doc.Header = partPlainText(raw)
		}
		if strings.HasPrefix(name, "word/footer") && strings.HasSuffix(name, ".xml") && doc.Footer == "" {
			txt, hasPage := footerTextAndPageField(raw)
			doc.Footer = txt
			doc.PageNumbers = doc.PageNumbers || hasPage
		}
	}
	return doc, nil
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}

func partPlainText(raw []byte) string {
	tree, err := parseXMLTree(raw)
	if err != nil {
		return ""
	}
	var texts []string
	collectText(tree, &texts)
	return strings.TrimSpace(strings.Join(texts, " "))
}

// footerTextAndPageField extracts footer text and whether it has a PAGE field
func footerTextAndPageField(raw []byte) (string, bool) {
	tree, err := parseXMLTree(raw)
	if err != nil {
		return "", false
	}
	hasPage := false
	var walk func(n *xnode)
	var texts []string
	walk = func(n *xnode) {
		if n.XMLName.Local == "instrText" {
			if strings.Contains(strings.ToUpper(n.Text), "PAGE") {
				hasPage = true
			}
			return
		}
		if n.XMLName.Local == "t" {
			texts = append(texts, n.Text)
			return
		}
		for i := range n.Nodes {
			walk(&n.Nodes[i])
		}
	}
	walk(tree)
	txt := strings.TrimSpace(strings.Join(texts, ""))
	txt = strings.TrimSuffix(txt, "-")
	return strings.TrimSpace(txt), hasPage
}

// parseNumberingFormats maps numId -> "bullet"|"decimal" (level 0 format)
func parseNumberingFormats(raw []byte) map[string]string {
	out := map[string]string{}
	if raw == nil {
		return out
	}
	tree, err := parseXMLTree(raw)
	if err != nil {
		return out
	}
	abstract := map[string]string{} // abstractNumId -> fmt
	for _, an := range tree.all("abstractNum") {
		id := an.attr("abstractNumId")
		if lvl := an.first("lvl"); lvl != nil {
			if nf := lvl.first("numFmt"); nf != nil {
				if nf.attr("val") == "bullet" {
					abstract[id] = "bullet"
				} else {
					abstract[id] = "decimal"
				}
			}
		}
	}
	for _, num := range tree.all("num") {
		id := num.attr("numId")
		if ref := num.first("abstractNumId"); ref != nil {
			if f, ok := abstract[ref.attr("val")]; ok {
				out[id] = f
			}
		}
	}
	return out
}

/* ---------- conversion ---------- */

type docxConv struct {
	files    map[string][]byte
	rels     map[string]string
	numFmt   map[string]string
	bodyNode *xnode
	spanIdx  map[int]bool // top-level block indexes that span all columns
	skipIdx  map[int]bool // empty section-divider paragraphs to drop
}

// markSpanSections finds paragraph-embedded sectPr elements (section
// dividers). Blocks belonging to a single-column section of a multi-column
// document are IEEE-style spanning blocks.
func (cv *docxConv) markSpanSections(body *xnode) {
	cv.spanIdx = map[int]bool{}
	cv.skipIdx = map[int]bool{}
	var pending []int
	for i := range body.Nodes {
		n := &body.Nodes[i]
		local := n.XMLName.Local
		if local != "p" && local != "tbl" {
			continue
		}
		if local == "p" {
			if pPr := n.first("pPr"); pPr != nil {
				if sp := pPr.first("sectPr"); sp != nil {
					single := true
					if cols := sp.first("cols"); cols != nil {
						if num, err := strconv.Atoi(cols.attr("num")); err == nil && num > 1 {
							single = false
						}
					}
					if single {
						for _, j := range pending {
							cv.spanIdx[j] = true
						}
						cv.spanIdx[i] = true
					}
					if strings.TrimSpace(cv.runsToHTML(n)) == "" {
						cv.skipIdx[i] = true // pure divider paragraph
					}
					pending = nil
					continue
				}
			}
		}
		pending = append(pending, i)
	}
}

// blocksToHTML renders the children of w:body (or a table cell)
func (cv *docxConv) blocksToHTML(parent *xnode) string {
	var sb strings.Builder
	listOpen := "" // "" | "ul" | "ol"
	closeList := func() {
		if listOpen != "" {
			sb.WriteString("</" + listOpen + ">")
			listOpen = ""
		}
	}
	isTop := parent == cv.bodyNode
	for i := range parent.Nodes {
		n := &parent.Nodes[i]
		if isTop && cv.skipIdx != nil && cv.skipIdx[i] {
			continue
		}
		spanAll := isTop && cv.spanIdx != nil && cv.spanIdx[i]
		switch n.XMLName.Local {
		case "p":
			listKind := "" // "ul" | "ol"
			if pPr := n.first("pPr"); pPr != nil {
				if numPr := pPr.first("numPr"); numPr != nil {
					if nid := numPr.first("numId"); nid != nil {
						if cv.numFmt[nid.attr("val")] == "decimal" {
							listKind = "ol"
						} else {
							listKind = "ul"
						}
					}
				}
				// style-based lists (e.g. python-docx "List Bullet")
				if listKind == "" {
					if ps := pPr.first("pStyle"); ps != nil {
						v := ps.attr("val")
						if strings.HasPrefix(v, "ListBullet") {
							listKind = "ul"
						} else if strings.HasPrefix(v, "ListNumber") {
							listKind = "ol"
						}
					}
				}
			}
			if listKind != "" {
				if listOpen != listKind {
					closeList()
					sb.WriteString("<" + listKind + ">")
					listOpen = listKind
				}
				sb.WriteString("<li>" + cv.runsToHTML(n) + "</li>")
				continue
			}
			closeList()
			sb.WriteString(cv.paragraphToHTML(n, spanAll))
		case "tbl":
			closeList()
			sb.WriteString(cv.tableToHTML(n))
		}
	}
	closeList()
	return sb.String()
}

func (cv *docxConv) paragraphToHTML(p *xnode, spanAll bool) string {
	tag := "p"
	var classes []string
	if spanAll {
		classes = append(classes, "col-span-all")
	}
	align := ""
	if pPr := p.first("pPr"); pPr != nil {
		if ps := pPr.first("pStyle"); ps != nil {
			v := ps.attr("val")
			switch {
			case strings.HasPrefix(v, "Heading") && len(v) == 8 && v[7] >= '1' && v[7] <= '6':
				tag = "h" + string(v[7])
			case v == "Title":
				tag = "h1"
				classes = append(classes, "doc-title")
			}
		}
		if jc := pPr.first("jc"); jc != nil {
			switch jc.attr("val") {
			case "center":
				align = "center"
			case "right", "end":
				align = "right"
			case "both":
				align = "justify"
			}
		}
		if ind := pPr.first("ind"); ind != nil && tag == "p" {
			if l, err := strconv.Atoi(ind.attr("left")); err == nil && l >= 600 {
				tag = "blockquote"
			}
		}
	}
	cls := ""
	if len(classes) > 0 {
		cls = ` class="` + strings.Join(classes, " ") + `"`
	}
	style := ""
	if align != "" {
		style = ` style="text-align:` + align + `;"`
	}
	inner := cv.runsToHTML(p)
	if inner == "" {
		inner = "<br>"
	}
	return "<" + tag + cls + style + ">" + inner + "</" + tag + ">"
}

// runsToHTML renders the runs (and hyperlinks) of a paragraph
func (cv *docxConv) runsToHTML(p *xnode) string {
	var sb strings.Builder
	for i := range p.Nodes {
		n := &p.Nodes[i]
		switch n.XMLName.Local {
		case "r":
			sb.WriteString(cv.runToHTML(n))
		case "hyperlink":
			href := ""
			for _, a := range n.Attrs {
				if a.Name.Local == "id" {
					href = cv.rels[a.Value]
				}
			}
			var inner strings.Builder
			for j := range n.Nodes {
				if n.Nodes[j].XMLName.Local == "r" {
					inner.WriteString(cv.runToHTML(&n.Nodes[j]))
				}
			}
			if href != "" {
				sb.WriteString(`<a href="` + xmlEscape(href) + `">` + inner.String() + "</a>")
			} else {
				sb.WriteString(inner.String())
			}
		}
	}
	return sb.String()
}

func (cv *docxConv) runToHTML(r *xnode) string {
	var open, close string
	var styleProps []string
	if rPr := r.first("rPr"); rPr != nil {
		if rPr.first("b") != nil && rPr.first("b").attr("val") != "0" && rPr.first("b").attr("val") != "false" {
			open += "<b>"
			close = "</b>" + close
		}
		if rPr.first("i") != nil {
			open += "<i>"
			close = "</i>" + close
		}
		if u := rPr.first("u"); u != nil && u.attr("val") != "none" {
			open += "<u>"
			close = "</u>" + close
		}
		if rPr.first("strike") != nil {
			open += "<s>"
			close = "</s>" + close
		}
		if c := rPr.first("color"); c != nil {
			v := c.attr("val")
			if len(v) == 6 && v != "000000" && strings.ToUpper(v) != "AUTO" {
				styleProps = append(styleProps, "color:#"+strings.ToLower(v))
			}
		}
		if sz := rPr.first("sz"); sz != nil {
			if hp, err := strconv.ParseFloat(sz.attr("val"), 64); err == nil && hp > 0 && hp != 22 {
				px := halfPointsToPx(hp)
				styleProps = append(styleProps, "font-size:"+strconv.Itoa(int(px+0.5))+"px")
			}
		}
	}
	var body strings.Builder
	for i := range r.Nodes {
		n := &r.Nodes[i]
		switch n.XMLName.Local {
		case "t":
			body.WriteString(xmlEscape(n.Text))
		case "br", "cr":
			if n.attr("type") == "page" {
				// explicit page break -> the editor's page break block
				body.WriteString(`<div class="doc-pagebreak" contenteditable="false"></div>`)
			} else {
				body.WriteString("<br>")
			}
		case "tab":
			body.WriteString("&nbsp;&nbsp;&nbsp;&nbsp;")
		case "drawing", "pict", "object":
			body.WriteString(cv.imageToHTML(n))
		}
	}
	out := body.String()
	if out == "" {
		return ""
	}
	if len(styleProps) > 0 {
		open += `<span style="` + strings.Join(styleProps, ";") + `;">`
		close = "</span>" + close
	}
	return open + out + close
}

// imageToHTML finds the blip relationship inside a drawing and inlines it
func (cv *docxConv) imageToHTML(n *xnode) string {
	rid := ""
	var wPx int
	var findBlip func(x *xnode)
	findBlip = func(x *xnode) {
		if x.XMLName.Local == "blip" {
			for _, a := range x.Attrs {
				if a.Name.Local == "embed" {
					rid = a.Value
				}
			}
		}
		if x.XMLName.Local == "extent" && wPx == 0 {
			if cx, err := strconv.ParseInt(x.attr("cx"), 10, 64); err == nil {
				wPx = int(emuToPx(cx, 1.0))
			}
		}
		for i := range x.Nodes {
			findBlip(&x.Nodes[i])
		}
	}
	findBlip(n)
	if rid == "" {
		return ""
	}
	target, ok := cv.rels[rid]
	if !ok {
		return ""
	}
	mediaPath := resolvePartPath("word", target)
	data, ok2 := cv.files[mediaPath]
	if !ok2 {
		return ""
	}
	ext := strings.TrimPrefix(strings.ToLower(path.Ext(mediaPath)), ".")
	attrs := ""
	if wPx > 10 {
		attrs = ` style="width:` + strconv.Itoa(wPx) + `px;"`
	}
	return `<img src="` + encodeDataURL(data, ext) + `"` + attrs + ">"
}

func (cv *docxConv) tableToHTML(tbl *xnode) string {
	var sb strings.Builder
	// table width: tblW pct (fiftieths of a percent) or dxa (twips of the
	// ~9026-twip text column); auto/absent = the editor's default 100%
	widthStyle := ""
	if tblPr := tbl.first("tblPr"); tblPr != nil {
		if tw := tblPr.first("tblW"); tw != nil {
			if v, err := strconv.ParseFloat(tw.attr("w"), 64); err == nil && v > 0 {
				pct := 0.0
				switch tw.attr("type") {
				case "pct":
					pct = v / 50.0
				case "dxa":
					pct = v * 100 / 9026.0
				}
				if pct > 100 {
					pct = 100
				}
				// full-width tables need no inline style
				if pct > 1 && pct < 99.5 {
					widthStyle = ` style="width:` + trimFloat(pct) + `%;"`
				}
			}
		}
	}
	sb.WriteString(`<table class="of-table"` + widthStyle + `>`)
	// column proportions -> the editor's colgroup
	if grid := tbl.first("tblGrid"); grid != nil {
		var ws []float64
		sum := 0.0
		for _, gc := range grid.all("gridCol") {
			if v, err := strconv.ParseFloat(gc.attr("w"), 64); err == nil && v > 0 {
				ws = append(ws, v)
				sum += v
			}
		}
		if len(ws) > 1 && sum > 0 {
			sb.WriteString("<colgroup>")
			for _, w := range ws {
				sb.WriteString(`<col style="width:` + trimFloat(w*100/sum) + `%">`)
			}
			sb.WriteString("</colgroup>")
		}
	}
	for i := range tbl.Nodes {
		tr := &tbl.Nodes[i]
		if tr.XMLName.Local != "tr" {
			continue
		}
		sb.WriteString("<tr>")
		for j := range tr.Nodes {
			tc := &tr.Nodes[j]
			if tc.XMLName.Local != "tc" {
				continue
			}
			// cell shading survives as an inline background
			tdStyle := ""
			if tcPr := tc.first("tcPr"); tcPr != nil {
				if shd := tcPr.first("shd"); shd != nil {
					if fill := shd.attr("fill"); len(fill) == 6 && fill != "auto" {
						tdStyle = ` style="background-color:#` + strings.ToLower(fill) + `;"`
					}
				}
			}
			inner := cv.blocksToHTML(tc)
			// unwrap a single plain paragraph for cleaner cells
			if strings.HasPrefix(inner, "<p>") && strings.HasSuffix(inner, "</p>") &&
				strings.Count(inner, "<p>") == 1 {
				inner = strings.TrimSuffix(strings.TrimPrefix(inner, "<p>"), "</p>")
			}
			sb.WriteString("<td" + tdStyle + ">" + inner + "</td>")
		}
		sb.WriteString("</tr>")
	}
	sb.WriteString("</table>")
	return sb.String()
}
