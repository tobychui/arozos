package office

/*
	odt_reader.go - Parse an OpenDocument Text (.odt) file into a Document.

	Mirrors the writer's subset: headings, paragraph alignment, inline
	formatting resolved through the automatic styles, links, lists, tables,
	embedded pictures (re-inlined as data URLs), page geometry, header/
	footer text and page breaks (fo:break-before). Built on the
	order-preserving onode tree so mixed text/span content keeps its order.
*/

import (
	"encoding/base64"
	"errors"
	"strings"
)

// odtStyleInfo is the resolved subset of one automatic style
type odtStyleInfo struct {
	b, i, u, s  bool
	color       string // "#rrggbb" (lowercased)
	bg          string
	sizePt      float64
	family      string
	alignCSS    string
	breakBefore bool
	numbered    bool // list style: first level is a number format
	colWidthPx  float64
	cellBg      string
}

// ParseOdt converts raw .odt bytes into a Document
func ParseOdt(data []byte) (*Document, error) {
	files, mime, err := readOdfZip(data)
	if err != nil {
		return nil, err
	}
	if mime != "" && mime != odtMime {
		return nil, errors.New("not an OpenDocument text file (mimetype " + mime + ")")
	}
	content, ok := files["content.xml"]
	if !ok {
		return nil, errors.New("odt is missing content.xml")
	}
	tree, err := parseOdfXML(content)
	if err != nil {
		return nil, errors.New("cannot parse content.xml: " + err.Error())
	}
	docRoot := tree.first("document-content")
	if docRoot == nil {
		return nil, errors.New("content.xml has no document-content root")
	}

	cv := &odtConverter{files: files, styles: odtCollectStyles(docRoot)}
	doc := &Document{}
	if txt := docRoot.path("body", "text"); txt != nil {
		var sb strings.Builder
		for _, c := range txt.children {
			if c.el != nil {
				cv.block(c.el, &sb)
			}
		}
		doc.HTML = sb.String()
	}
	if doc.HTML == "" {
		doc.HTML = "<p><br></p>"
	}

	if raw, ok := files["styles.xml"]; ok {
		if st, err := parseOdfXML(raw); err == nil {
			if sr := st.first("document-styles"); sr != nil {
				odtReadPageStyles(sr, doc)
			}
		}
	}
	return doc, nil
}

func odtCollectStyles(root *onode) map[string]odtStyleInfo {
	out := map[string]odtStyleInfo{}
	auto := root.first("automatic-styles")
	if auto == nil {
		return out
	}
	for _, st := range auto.all("style") {
		name := st.attr("name")
		if name == "" {
			continue
		}
		info := odtStyleInfo{}
		if tp := st.first("text-properties"); tp != nil {
			if tp.attr("font-weight") == "bold" {
				info.b = true
			}
			if tp.attr("font-style") == "italic" {
				info.i = true
			}
			if v := tp.attr("text-underline-style"); v != "" && v != "none" {
				info.u = true
			}
			if v := tp.attr("text-line-through-style"); v != "" && v != "none" {
				info.s = true
			}
			if c := tp.attr("color"); strings.HasPrefix(c, "#") {
				info.color = strings.ToLower(c)
			}
			if c := tp.attr("background-color"); strings.HasPrefix(c, "#") {
				info.bg = strings.ToLower(c)
			}
			if fs := tp.attr("font-size"); strings.HasSuffix(fs, "pt") {
				info.sizePt = odfLenToPx(fs) * 72.0 / 96.0
			}
			if fn := tp.attr("font-name"); fn != "" {
				info.family = fn
			}
		}
		if pp := st.first("paragraph-properties"); pp != nil {
			switch pp.attr("text-align") {
			case "center":
				info.alignCSS = "center"
			case "end", "right":
				info.alignCSS = "right"
			case "justify":
				info.alignCSS = "justify"
			}
			if pp.attr("break-before") == "page" {
				info.breakBefore = true
			}
		}
		if cp := st.first("table-column-properties"); cp != nil {
			info.colWidthPx = odfLenToPx(cp.attr("column-width"))
		}
		if cp := st.first("table-cell-properties"); cp != nil {
			if bg := cp.attr("background-color"); strings.HasPrefix(bg, "#") {
				info.cellBg = strings.ToLower(bg)
			}
		}
		out[name] = info
	}
	for _, ls := range auto.all("list-style") {
		name := ls.attr("name")
		if name == "" {
			continue
		}
		info := odtStyleInfo{}
		if ls.first("list-level-style-number") != nil {
			info.numbered = true
		}
		out[name] = info
	}
	return out
}

type odtConverter struct {
	files  map[string][]byte
	styles map[string]odtStyleInfo
}

func (cv *odtConverter) styleOf(n *onode) odtStyleInfo {
	return cv.styles[n.attr("style-name")]
}

func (cv *odtConverter) block(n *onode, sb *strings.Builder) {
	switch n.name {
	case "h":
		lvl := n.attr("outline-level")
		if len(lvl) != 1 || lvl < "1" || lvl > "4" {
			lvl = "2"
		}
		st := cv.styleOf(n)
		if st.breakBefore {
			sb.WriteString(`<div class="doc-pagebreak" contenteditable="false"></div>`)
		}
		sb.WriteString("<h" + lvl + alignAttrOf(st) + ">")
		cv.inline(n, sb)
		sb.WriteString("</h" + lvl + ">")
	case "p":
		st := cv.styleOf(n)
		if st.breakBefore {
			sb.WriteString(`<div class="doc-pagebreak" contenteditable="false"></div>`)
		}
		sb.WriteString("<p" + alignAttrOf(st) + ">")
		cv.inline(n, sb)
		sb.WriteString("</p>")
	case "list":
		tag := "ul"
		if cv.styles[n.attr("style-name")].numbered {
			tag = "ol"
		}
		sb.WriteString("<" + tag + ">")
		for _, item := range n.all("list-item") {
			sb.WriteString("<li>")
			var inner strings.Builder
			for _, c := range item.children {
				if c.el != nil {
					cv.block(c.el, &inner)
				}
			}
			sb.WriteString(unwrapSinglePara(inner.String()))
			sb.WriteString("</li>")
		}
		sb.WriteString("</" + tag + ">")
	case "table":
		cv.table(n, sb)
	}
}

func alignAttrOf(st odtStyleInfo) string {
	if st.alignCSS == "" {
		return ""
	}
	return ` style="text-align:` + st.alignCSS + `;"`
}

// unwrapSinglePara removes the <p> wrapper when the content is exactly one
// paragraph (list items / table cells hold inline HTML in the editor)
func unwrapSinglePara(html string) string {
	if strings.HasPrefix(html, "<p>") && strings.HasSuffix(html, "</p>") &&
		strings.Count(html, "<p>") == 1 {
		return strings.TrimSuffix(strings.TrimPrefix(html, "<p>"), "</p>")
	}
	return html
}

func (cv *odtConverter) table(n *onode, sb *strings.Builder) {
	var widths []float64
	total := 0.0
	for _, col := range n.all("table-column") {
		w := cv.styles[col.attr("style-name")].colWidthPx
		if w <= 0 {
			w = 100
		}
		rep := repeatOf(col.attr("number-columns-repeated"), 64)
		for i := 0; i < rep; i++ {
			widths = append(widths, w)
			total += w
		}
	}
	sb.WriteString(`<table class="of-table">`)
	if len(widths) > 0 && total > 0 {
		sb.WriteString("<colgroup>")
		for _, w := range widths {
			sb.WriteString(`<col style="width:` + trimFloat(w*100/total) + `%">`)
		}
		sb.WriteString("</colgroup>")
	}
	sb.WriteString("<tbody>")
	for _, row := range n.all("table-row") {
		sb.WriteString("<tr>")
		for _, c := range row.children {
			if c.el == nil || c.el.name != "table-cell" {
				continue // covered cells skipped
			}
			style := ""
			if bg := cv.styles[c.el.attr("style-name")].cellBg; bg != "" {
				style = ` style="background-color:` + bg + `;"`
			}
			sb.WriteString("<td" + style + ">")
			var inner strings.Builder
			for _, cc := range c.el.children {
				if cc.el != nil {
					cv.block(cc.el, &inner)
				}
			}
			html := unwrapSinglePara(inner.String())
			if html == "" {
				html = "<br>"
			}
			sb.WriteString(html)
			sb.WriteString("</td>")
		}
		sb.WriteString("</tr>")
	}
	sb.WriteString("</tbody></table>")
}

func (cv *odtConverter) inline(n *onode, sb *strings.Builder) {
	for _, c := range n.children {
		if c.el == nil {
			sb.WriteString(xmlEscape(c.text))
			continue
		}
		el := c.el
		switch el.name {
		case "span":
			st := cv.styleOf(el)
			open, close := odtSpanTags(st)
			sb.WriteString(open)
			cv.inline(el, sb)
			sb.WriteString(close)
		case "a":
			sb.WriteString(`<a href="` + xmlEscape(el.attr("href")) + `">`)
			cv.inline(el, sb)
			sb.WriteString(`</a>`)
		case "line-break":
			sb.WriteString("<br>")
		case "tab":
			sb.WriteString("&nbsp;&nbsp;&nbsp;&nbsp;")
		case "s":
			sb.WriteString(" ")
		case "frame":
			cv.frameImage(el, sb)
		case "page-number":
			// header/footer field; nothing in body
		default:
			cv.inline(el, sb)
		}
	}
}

func odtSpanTags(st odtStyleInfo) (string, string) {
	open, close := "", ""
	wrap := func(tag string) {
		open += "<" + tag + ">"
		close = "</" + tag + ">" + close
	}
	if st.b {
		wrap("b")
	}
	if st.i {
		wrap("i")
	}
	if st.u {
		wrap("u")
	}
	if st.s {
		wrap("s")
	}
	css := ""
	if st.color != "" {
		css += "color:" + st.color + ";"
	}
	if st.bg != "" {
		css += "background-color:" + st.bg + ";"
	}
	if st.sizePt > 0 {
		css += "font-size:" + trimFloat(st.sizePt*96.0/72.0) + "px;"
	}
	if st.family != "" {
		css += "font-family:" + st.family + ";"
	}
	if css != "" {
		open += `<span style="` + css + `">`
		close = "</span>" + close
	}
	return open, close
}

func (cv *odtConverter) frameImage(frame *onode, sb *strings.Builder) {
	img := frame.first("image")
	if img == nil {
		return
	}
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
	attr := ""
	if w := odfLenToPx(frame.attr("width")); w > 0 {
		attr = ` width="` + trimFloat(w) + `"`
	}
	sb.WriteString(`<img src="data:image/` + ext + `;base64,` +
		base64.StdEncoding.EncodeToString(raw) + `"` + attr + `>`)
}

func odtReadPageStyles(root *onode, doc *Document) {
	if auto := root.first("automatic-styles"); auto != nil {
		if pl := auto.first("page-layout"); pl != nil {
			if pp := pl.first("page-layout-properties"); pp != nil {
				wMM := odfLenToPx(pp.attr("page-width")) * 25.4 / 96.0
				hMM := odfLenToPx(pp.attr("page-height")) * 25.4 / 96.0
				pc := &PageConf{Size: "A4", Orientation: "portrait", Margins: &MarginsMM{
					Top: 25.4, Right: 25.4, Bottom: 25.4, Left: 25.4}}
				long, short := hMM, wMM
				if wMM > hMM {
					pc.Orientation = "landscape"
					long, short = wMM, hMM
				}
				for name, dim := range pageSizesMM {
					if absF(dim[0]-short) < 2 && absF(dim[1]-long) < 2 {
						pc.Size = name
					}
				}
				if v := odfLenToPx(pp.attr("margin-top")) * 25.4 / 96.0; v > 0 {
					pc.Margins.Top = v
				}
				if v := odfLenToPx(pp.attr("margin-right")) * 25.4 / 96.0; v > 0 {
					pc.Margins.Right = v
				}
				if v := odfLenToPx(pp.attr("margin-bottom")) * 25.4 / 96.0; v > 0 {
					pc.Margins.Bottom = v
				}
				if v := odfLenToPx(pp.attr("margin-left")) * 25.4 / 96.0; v > 0 {
					pc.Margins.Left = v
				}
				doc.Page = pc
			}
		}
	}
	if mp := root.path("master-styles", "master-page"); mp != nil {
		if hd := mp.first("header"); hd != nil {
			doc.Header = strings.TrimSpace(hd.allText())
		}
		if ft := mp.first("footer"); ft != nil {
			txt := ft.allText()
			if p := ft.first("p"); p != nil && p.first("page-number") != nil {
				doc.PageNumbers = true
				txt = strings.TrimSuffix(strings.TrimSpace(txt), "-")
			}
			doc.Footer = strings.TrimSpace(txt)
		}
	}
}

func atoiSafe(s string) int {
	n := 0
	for _, r := range s {
		if r < '0' || r > '9' {
			return 0
		}
		n = n*10 + int(r-'0')
	}
	return n
}

func absF(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}

func pathExtOf(p string) string {
	i := strings.LastIndex(p, ".")
	if i < 0 {
		return ""
	}
	return p[i:]
}
