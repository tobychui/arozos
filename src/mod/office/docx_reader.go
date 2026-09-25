package office

/*
	docx_reader.go - Parse a Word (.docx) file into a Document.

	The goal is that an imported document LOOKS like it did where it came
	from (Word, Google Docs), so formatting is resolved the way Word
	resolves it - docDefaults, style chains, numbering definitions, table
	styles - and written out as explicit inline CSS on the editor HTML
	(see docx_props.go for the inheritance and docs_layout.js for the half
	of the layout that can only be computed in the browser).

	The HTML vocabulary this produces is the Docs "rich model", also what
	the docx writer consumes:

	  blocks   p / h1-h6 (.doc-title, .doc-subtitle) with
	             style: margin-bottom (spacing after), margin-top on headings
	                    and padding-top elsewhere (spacing before: Google
	                    Docs collapses a heading's with the spacing above it
	                    the way CSS margins collapse, and adds a body
	                    paragraph's), margin-left/-right (indents),
	                    text-indent, text-align, font-*, color,
	                    background-color, white-space:pre-wrap when the text
	                    relies on repeated spaces
	             data-ls="1.15"       auto line spacing (multiple of single)
	             data-lsexact="15pt"  exact line height
	             data-lsmin="15pt"    at-least line height
	             data-keep-next / data-keep-lines / data-widow = "1"
	             data-page-break-before="1"
	             data-tabs="right:451.28:dot;left:36:none" (pt from the
	                    text column's left edge)
	  lists    ol / ul .doc-list with data-fmt, data-lvltext, start,
	             style padding-left + --doc-hang; nested lists sit directly
	             inside their parent list (what execCommand("indent") makes)
	  runs     span style=font-*, color, background-color, text-decoration,
	             font-variant, text-transform; sup / sub; a (links, with
	             color/decoration inherited so the runs decide),
	             span.doc-tab (a real tab character), br,
	             sup.doc-fnref[data-fn] (footnote reference),
	             span.doc-field[data-field=PAGE|NUMPAGES]
	  images   img style=width/height in pt, object-view-box for a crop,
	             border for a picture outline; img.doc-anchor (display:block,
	             margin offsets) for anchored top-and-bottom pictures
	  tables   table.of-table style=width/margin-left, colgroup of pt
	             widths, td/th with explicit border-*, padding,
	             vertical-align, background-color, colspan/rowspan
	  breaks   div.doc-pagebreak

	Headers/footers come back as HTML (headerHtml/footerHtml) plus plain
	text for older consumers, footnotes as body.footnotes. Legacy binary
	.doc is rejected.
*/

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"io"
	"path"
	"regexp"
	"sort"
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
			strings.HasPrefix(name, "word/media/") || strings.HasPrefix(name, "media/") {
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

	cv := &docxConv{
		files:    files,
		ss:       parseStyleSheet(files["word/styles.xml"]),
		nb:       parseNumbering(files["word/numbering.xml"]),
		bodyNode: body,
		fnNumber: map[string]int{},
		rv:       docxReview{used: map[string]bool{}},
	}
	docPart := cv.part("word/document.xml")
	// Google Docs writes every rsid as zeros and numbers paragraphs from 1
	cv.gdocs = bytes.Contains(docXML, []byte(`w:rsidR="00000000"`)) &&
		bytes.Contains(docXML, []byte(`w14:paraId="00000001"`))

	doc := &Document{}

	// the document-wide line spacing every paragraph inherits unless it
	// says otherwise (Google Docs: 1.15, Word: 1.08 or single)
	cv.defaultLS = 1
	if dp, _ := cv.ss.paraStyle(""); dp != nil && dp.line.set && (dp.lineRule == "" || dp.lineRule == "auto") && dp.line.v > 0 {
		cv.defaultLS = round3(dp.line.v / 240)
	}
	doc.LineSpacing = cv.defaultLS

	// page geometry (parsed first: margins place anchored pictures and
	// multi-column layouts change the HTML conversion)
	sect := body.first("sectPr")
	if sect != nil {
		doc.Page = parseSectPage(sect)
		cv.marginL = twipsAttr(sect.first("pgMar"), "left", 1440) / 20
		cv.textW = (twipsAttr(sect.first("pgSz"), "w", 11906) -
			twipsAttr(sect.first("pgMar"), "left", 1440) -
			twipsAttr(sect.first("pgMar"), "right", 1440)) / 20
		if sect.first("titlePg") != nil && onOff(sect.first("titlePg")).v {
			doc.HFMode = HFModeExceptFirst
		}
	} else {
		cv.marginL, cv.textW = 72, 451.3
	}

	// Word writes IEEE-style spanning titles as leading single-column
	// sections; map those blocks back to .col-span-all
	if doc.Page != nil && doc.Page.Columns > 1 {
		cv.markSpanSections(body)
	}
	cv.collectSectionBreaks(body)
	doc.HTML = cv.blocks(body, docPart, blockCtx{top: true})

	// footnotes, in the order the text references them
	if len(cv.fnOrder) > 0 {
		if raw, ok := files["word/footnotes.xml"]; ok {
			if ft, err := parseXMLTree(raw); err == nil {
				fnPart := cv.part("word/footnotes.xml")
				byID := map[string]*xnode{}
				for _, fn := range ft.all("footnote") {
					byID[fn.attr("id")] = fn
				}
				for _, id := range cv.fnOrder {
					fn := byID[id]
					if fn == nil {
						continue
					}
					doc.Footnotes = append(doc.Footnotes, Footnote{
						ID:   id,
						HTML: cv.blocks(fn, fnPart, blockCtx{footnote: true}),
					})
				}
			}
		}
	}

	// header / footer: the section's default parts, plus "different first
	// page" when it is on
	if sect != nil {
		hdr := cv.hfPart(sect, "headerReference", "default")
		ftr := cv.hfPart(sect, "footerReference", "default")
		if hdr != "" {
			doc.HeaderHTML, doc.Header = cv.hfHTML(hdr)
		}
		if ftr != "" {
			doc.FooterHTML, doc.Footer = cv.hfHTML(ftr)
			doc.PageNumbers = doc.PageNumbers || strings.Contains(doc.FooterHTML, `data-field="PAGE"`)
		}
		doc.PageNumbers = doc.PageNumbers || cv.autoPageNumber
		if doc.HFMode == HFModeExceptFirst {
			// a first-page part with real content is a different header,
			// not a missing one; the editor only models "blank on page one"
			if fh := cv.hfPart(sect, "headerReference", "first"); fh != "" {
				if h, txt := cv.hfHTML(fh); txt != "" || strings.Contains(h, "<img") {
					doc.HFMode = ""
				}
			}
		}
	}
	// review: the comments the text anchors, and whether Word was tracking
	doc.Comments = parseDocxComments(files, cv.rv.used)
	if raw, ok := files["word/settings.xml"]; ok {
		if st, err := parseXMLTree(raw); err == nil {
			if tr := st.first("trackRevisions"); tr != nil && onOff(tr).v {
				doc.TrackChanges = true
			}
		}
	}
	return doc, nil
}

func round1(v float64) float64 {
	return float64(int(v*10+0.5)) / 10
}

func round3(v float64) float64 {
	if v < 0 {
		return -round3(-v)
	}
	return float64(int(v*1000+0.5)) / 1000
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func twipsAttr(n *xnode, name string, def float64) float64 {
	if v := numAttr(n, name); v.set {
		return v.v
	}
	return def
}

// parseSectPage reads page size, orientation, margins, header/footer
// distances and columns from a sectPr
func parseSectPage(sect *xnode) *PageConf {
	pc := &PageConf{Size: "A4", Orientation: "portrait"}
	if sz := sect.first("pgSz"); sz != nil {
		w := int(twipsAttr(sz, "w", 11906))
		h := int(twipsAttr(sz, "h", 16838))
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
		pc.Margins = &MarginsMM{
			Top:    round1(twipsToMmF(twipsAttr(mar, "top", 1440))),
			Right:  round1(twipsToMmF(twipsAttr(mar, "right", 1440))),
			Bottom: round1(twipsToMmF(twipsAttr(mar, "bottom", 1440))),
			Left:   round1(twipsToMmF(twipsAttr(mar, "left", 1440))),
		}
		// Word's top/bottom margin may be negative ("do not move the text
		// for the header") - the editor has no such notion
		if pc.Margins.Top < 0 {
			pc.Margins.Top = -pc.Margins.Top
		}
		if pc.Margins.Bottom < 0 {
			pc.Margins.Bottom = -pc.Margins.Bottom
		}
		if v := numAttr(mar, "header"); v.set {
			d := round1(twipsToMmF(v.v))
			pc.HeaderDist = &d
		}
		if v := numAttr(mar, "footer"); v.set {
			d := round1(twipsToMmF(v.v))
			pc.FooterDist = &d
		}
	}
	if cols := sect.first("cols"); cols != nil {
		if n, err := strconv.Atoi(cols.attr("num")); err == nil && n > 1 {
			pc.Columns = n
			if sp := numAttr(cols, "space"); sp.set && sp.v > 0 {
				pc.ColGap = round1(twipsToMmF(sp.v))
			}
		}
	}
	return pc
}

func twipsToMmF(tw float64) float64 { return tw * 25.4 / 1440.0 }

/* ---------------- conversion state ---------------- */

type docxPartCtx struct {
	name string
	rels map[string]string
	ext  map[string]bool // rId -> TargetMode External
}

type blockCtx struct {
	top      bool // direct children of w:body
	cell     bool
	hf       bool
	footnote bool
}

type fieldFrame struct {
	instr    string
	inResult bool
}

type docxConv struct {
	files     map[string][]byte
	ss        *docxStyleSheet
	nb        *docxNumDefs
	bodyNode  *xnode
	spanIdx   map[int]bool // top-level block indexes that span all columns
	skipIdx   map[int]bool // empty section-divider paragraphs to drop
	breakIdx  map[int]bool // paragraphs ending a section that starts a new page
	defaultLS float64
	marginL   float64 // pt
	textW     float64 // pt
	fields    []fieldFrame
	fnNumber  map[string]int
	fnOrder   []string
	parts     map[string]*docxPartCtx
	// Google Docs exports: a handful of its layout habits are imitated so
	// the import matches its own PDF (see the gdocs uses)
	gdocs bool
	// spacing-before the next paragraph gives back (see paragraph)
	reduceBefore float64
	// a footer carried the page number our export adds (see hfHTML)
	autoPageNumber bool
	// review state: open comment ranges and the revision mark being walked
	// (docx_review.go)
	rv     docxReview
	curRev string // "" | "ins" | "del"
}

// editorTableStyle marks a table BuildDocx wrote from an editor-made one
const editorTableStyle = "ArozEditorTable"

// autoRuleStyle marks the paragraph BuildDocx writes an <hr> as
const autoRuleStyle = "ArozHorizontalRule"

// isAutoRule reports a horizontal rule written by BuildDocx: its style and
// no text
func isAutoRule(p *xnode) bool {
	pPr := p.first("pPr")
	if pPr == nil {
		return false
	}
	ps := pPr.first("pStyle")
	if ps == nil || ps.attr("val") != autoRuleStyle {
		return false
	}
	var texts []string
	collectText(p, &texts)
	return strings.TrimSpace(strings.Join(texts, "")) == ""
}

// autoPageNumberStyle marks the page-number paragraph BuildDocx adds to a
// footer, so an import turns it back into Document.PageNumbers
const autoPageNumberStyle = "ArozPageNumber"

// part loads the relationships of one XML part
func (cv *docxConv) part(name string) *docxPartCtx {
	if cv.parts == nil {
		cv.parts = map[string]*docxPartCtx{}
	}
	if p, ok := cv.parts[name]; ok {
		return p
	}
	dir, file := path.Split(name)
	relsName := dir + "_rels/" + file + ".rels"
	p := &docxPartCtx{name: name, rels: map[string]string{}, ext: map[string]bool{}}
	if raw, ok := cv.files[relsName]; ok {
		if tree, err := parseXMLTree(raw); err == nil {
			for _, r := range tree.all("Relationship") {
				p.rels[r.attr("Id")] = r.attr("Target")
				if strings.EqualFold(r.attr("TargetMode"), "External") {
					p.ext[r.attr("Id")] = true
				}
			}
		}
	}
	cv.parts[name] = p
	return p
}

// hfPart finds the part path a header/footer reference points at
func (cv *docxConv) hfPart(sect *xnode, kind, typ string) string {
	docPart := cv.part("word/document.xml")
	for _, ref := range sect.all(kind) {
		t := ref.attr("type")
		if t == "" {
			t = "default"
		}
		if t != typ {
			continue
		}
		target := docPart.rels[ref.attrNS("relationships", "id")]
		if target == "" {
			continue
		}
		return resolvePartPath("word", target)
	}
	return ""
}

// hfHTML converts a header/footer part; returns its HTML and plain text
func (cv *docxConv) hfHTML(partName string) (string, string) {
	raw, ok := cv.files[partName]
	if !ok {
		return "", ""
	}
	tree, err := parseXMLTree(raw)
	if err != nil {
		return "", ""
	}
	// the page number our own export adds is the editor's page-number
	// switch, not footer content
	kept := tree.Nodes[:0]
	for _, c := range tree.Nodes {
		if c.XMLName.Local == "p" {
			if pPr := c.first("pPr"); pPr != nil {
				if ps := pPr.first("pStyle"); ps != nil && ps.attr("val") == autoPageNumberStyle {
					cv.autoPageNumber = true
					continue
				}
			}
		}
		kept = append(kept, c)
	}
	tree.Nodes = kept
	saved := cv.fields
	cv.fields = nil
	htmlOut := cv.blocks(tree, cv.part(partName), blockCtx{hf: true})
	cv.fields = saved
	var texts []string
	collectText(tree, &texts)
	txt := strings.TrimSpace(strings.Join(texts, ""))
	// a header that is only empty paragraphs is no header
	if txt == "" && !strings.Contains(htmlOut, "<img") {
		return "", ""
	}
	// the editor's plain header, as BuildDocx writes it, stays plain
	if m := plainHFRe.FindStringSubmatch(htmlOut); m != nil && !strings.Contains(m[1], "<") {
		return "", txt
	}
	return htmlOut, txt
}

var plainHFRe = regexp.MustCompile(`^<p><span style="font-size:9pt;color:#6b7078;">(.*)</span></p>$`)

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
					if paragraphIsEmpty(n) {
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

// collectSectionBreaks marks the paragraphs that close a section whose
// successor starts on a new page (single-column documents only - the
// multi-column mapping above owns those)
func (cv *docxConv) collectSectionBreaks(body *xnode) {
	if cv.spanIdx != nil {
		return
	}
	type sp struct {
		idx int
		typ string
	}
	var list []sp
	for i := range body.Nodes {
		n := &body.Nodes[i]
		if n.XMLName.Local == "p" {
			if s := n.path("pPr", "sectPr"); s != nil {
				list = append(list, sp{i, sectType(s)})
			}
		}
	}
	if len(list) == 0 {
		return
	}
	cv.breakIdx = map[int]bool{}
	for k, s := range list {
		nextType := "nextPage"
		if k+1 < len(list) {
			nextType = list[k+1].typ
		} else if bs := body.first("sectPr"); bs != nil {
			nextType = sectType(bs)
		}
		if nextType != "continuous" {
			cv.breakIdx[s.idx] = true
		}
	}
}

func sectType(s *xnode) string {
	if t := s.first("type"); t != nil && t.attr("val") != "" {
		return t.attr("val")
	}
	return "nextPage"
}

func paragraphIsEmpty(p *xnode) bool {
	var texts []string
	collectText(p, &texts)
	if strings.TrimSpace(strings.Join(texts, "")) != "" {
		return false
	}
	var d []*xnode
	p.findAll("drawing", &d)
	return len(d) == 0
}

/* ---------------- blocks ---------------- */

type listFrame struct {
	tag   string // ol | ul
	numID string
	ilvl  int
	indL  float64 // pt from the container's left edge
}

// blocks renders the block children of w:body, a table cell, a header,
// footer or footnote
func (cv *docxConv) blocks(parent *xnode, part *docxPartCtx, ctx blockCtx) string {
	var sb strings.Builder
	var lists []listFrame
	lastPara := -1 // where the last plain paragraph starts in sb
	closeLists := func(depth int) {
		for len(lists) > depth {
			sb.WriteString("</" + lists[len(lists)-1].tag + ">")
			lists = lists[:len(lists)-1]
		}
	}
	var walk func(children []xnode, top bool)
	walk = func(children []xnode, top bool) {
		for i := range children {
			n := &children[i]
			if top && ctx.top {
				if cv.skipIdx != nil && cv.skipIdx[i] {
					continue
				}
			}
			switch n.XMLName.Local {
			case "p":
				if isAutoRule(n) {
					closeLists(0)
					lastPara = -1
					sb.WriteString("<hr>")
					continue
				}
				spanAll := top && ctx.top && cv.spanIdx != nil && cv.spanIdx[i]
				item := cv.paragraph(n, part, ctx, spanAll)
				if item.list != nil {
					cv.placeListItem(&sb, &lists, item)
				} else {
					closeLists(0)
					lastPara = sb.Len()
					sb.WriteString(item.html)
				}
				if top && ctx.top && cv.breakIdx != nil && cv.breakIdx[i] {
					closeLists(0)
					sb.WriteString(pageBreakDiv)
				}
			case "tbl":
				closeLists(0)
				spanAll := top && ctx.top && cv.spanIdx != nil && cv.spanIdx[i]
				cv.reduceBefore = 0
				// Google Docs gives no spacing-after to an empty paragraph
				// right above a table
				if cv.gdocs && lastPara >= 0 && emptyBlockHTML(sb.String()[lastPara:]) {
					cur := sb.String()
					tail := dropMarginBottom(cur[lastPara:])
					if tail != cur[lastPara:] {
						sb.Reset()
						sb.WriteString(cur[:lastPara])
						sb.WriteString(tail)
					}
				}
				sb.WriteString(cv.table(n, part, spanAll))
			case "sdt":
				if c := n.first("sdtContent"); c != nil {
					walk(c.Nodes, false)
				}
			case "customXml", "ins", "moveTo", "smartTag":
				walk(n.Nodes, false)
			case "AlternateContent":
				if c := n.first("Choice"); c != nil {
					walk(c.Nodes, false)
				} else if f := n.first("Fallback"); f != nil {
					walk(f.Nodes, false)
				}
			}
		}
	}
	walk(parent.Nodes, true)
	closeLists(0)
	return sb.String()
}

var marginBottomRe = regexp.MustCompile(`margin-bottom:[^;"]*;`)

var emptyBlockRe = regexp.MustCompile(`^<[a-z0-9]+[^>]*><br></[a-z0-9]+>$`)

// emptyBlockHTML reports whether s is one block holding nothing but its
// empty line
func emptyBlockHTML(s string) bool {
	return emptyBlockRe.MatchString(s)
}

// dropMarginBottom removes the spacing-after from the opening tag of the
// block HTML that starts s (only when s is a single block)
func dropMarginBottom(s string) string {
	end := strings.Index(s, ">")
	if end < 0 {
		return s
	}
	return marginBottomRe.ReplaceAllString(s[:end], "margin-bottom:0pt;") + s[end:]
}

const pageBreakDiv = `<div class="doc-pagebreak" contenteditable="false"></div>`

type paraOutput struct {
	html    string // complete block HTML (non-list paragraphs)
	list    *docxListItem
	liAttrs string
	liInner string
}

type docxListItem struct {
	numID   string
	ilvl    int
	fmt     string
	text    string
	start   int
	value   int
	indL    float64 // pt
	hang    float64 // pt
	ordered bool
}

// placeListItem opens/closes list elements around one list paragraph
func (cv *docxConv) placeListItem(sb *strings.Builder, lists *[]listFrame, it paraOutput) {
	li := it.list
	// a different list instance closes the current one entirely
	if len(*lists) > 0 && (*lists)[0].numID != li.numID {
		for len(*lists) > 0 {
			sb.WriteString("</" + (*lists)[len(*lists)-1].tag + ">")
			*lists = (*lists)[:len(*lists)-1]
		}
	}
	for len(*lists) > 0 && (*lists)[len(*lists)-1].ilvl > li.ilvl {
		sb.WriteString("</" + (*lists)[len(*lists)-1].tag + ">")
		*lists = (*lists)[:len(*lists)-1]
	}
	tag := "ul"
	if li.ordered {
		tag = "ol"
	}
	if n := len(*lists); n > 0 && (*lists)[n-1].ilvl == li.ilvl && (*lists)[n-1].tag != tag {
		sb.WriteString("</" + (*lists)[n-1].tag + ">")
		*lists = (*lists)[:n-1]
	}
	if len(*lists) == 0 || (*lists)[len(*lists)-1].ilvl < li.ilvl {
		parentL := 0.0
		if len(*lists) > 0 {
			parentL = (*lists)[len(*lists)-1].indL
		}
		pad := li.indL - parentL
		attrs := ` class="doc-list" data-num="` + xmlEscape(li.numID) + `" data-fmt="` + li.fmt + `"`
		if li.text != "" {
			attrs += ` data-lvltext="` + xmlEscape(li.text) + `"`
		}
		if li.ordered && li.value != 1 {
			attrs += ` start="` + strconv.Itoa(li.value) + `"`
		}
		attrs += ` style="padding-left:` + ptStr(pad) + `;--doc-hang:` + ptStr(li.hang) + `;"`
		sb.WriteString("<" + tag + attrs + ">")
		*lists = append(*lists, listFrame{tag: tag, numID: li.numID, ilvl: li.ilvl, indL: li.indL})
	}
	sb.WriteString("<li" + it.liAttrs + ">" + it.liInner + "</li>")
}

// ptStr formats a length in points
func ptStr(v float64) string {
	return trimFloat(round2(v)) + "pt"
}

/* ---------------- paragraphs ---------------- */

// paragraph converts one w:p
func (cv *docxConv) paragraph(p *xnode, part *docxPartCtx, ctx blockCtx, spanAll bool) paraOutput {
	direct := parsePPr(p.first("pPr"))
	styleP, styleR := cv.ss.paraStyle(direct.style)
	eff := *styleP
	eff.merge(direct)
	baseR := *styleR
	baseR.merge(direct.mark)
	if cv.reduceBefore > 0 && !ctx.cell {
		b := 0.0
		if eff.before.set {
			b = eff.before.v - cv.reduceBefore*20
		}
		if b < 0 {
			b = 0
		}
		eff.before = optNum{set: true, v: b}
	}
	cv.reduceBefore = 0

	level := cv.ss.headingLevel(direct.style)
	if direct.style == "" {
		level = cv.ss.headingLevel(cv.ss.defPara)
	}

	// list membership (numbering from the paragraph or its style)
	var li *docxListItem
	if eff.numSet && cv.nb.exists(eff.numID) && !ctx.hf {
		ilvl := 0
		if eff.ilvl.set {
			ilvl = int(eff.ilvl.v)
		}
		def := cv.nb.level(eff.numID, ilvl)
		li = &docxListItem{numID: eff.numID, ilvl: ilvl, fmt: "bullet", start: 1}
		if def != nil {
			li.fmt = htmlListFormat(def.fmt)
			li.text = def.text
			li.start = def.start
			// numbering indents sit between the style's and the paragraph's own
			ind := *styleP
			if def.indL.set {
				ind.indL = def.indL
			}
			if def.indHang.set || def.indFirst.set {
				ind.indHang, ind.indFirst = def.indHang, def.indFirst
			}
			ind.merge(direct)
			eff.indL, eff.indHang, eff.indFirst = ind.indL, ind.indHang, ind.indFirst
		}
		li.ordered = li.fmt != "bullet"
		li.value = cv.nb.next(eff.numID, ilvl)
		li.indL = eff.indL.v / 20
		if eff.indHang.set && eff.indHang.v > 0 {
			li.hang = eff.indHang.v / 20
		} else if eff.indFirst.set && eff.indFirst.v < 0 {
			li.hang = -eff.indFirst.v / 20
		} else {
			li.hang = 18
		}
	}

	// a run takes its look from the paragraph style and its own rPr; the
	// paragraph mark's rPr formats only the mark (the empty line's height,
	// a list number), so runs must not inherit it - but they are written
	// against the block, which does
	runs := cv.runs(p, part, *styleR, baseR)

	tag := "p"
	var classes []string
	switch {
	case level >= 1 && level <= 6 && li == nil:
		tag = "h" + strconv.Itoa(level)
	case level == -1 && li == nil:
		tag = "h1"
		classes = append(classes, "doc-title")
	case level == -2 && li == nil:
		classes = append(classes, "doc-subtitle")
	}
	if spanAll {
		classes = append(classes, "col-span-all")
	}

	style, data := cv.blockStyle(tag, eff, baseR, li != nil, level, runs.preWrap)
	attrs := ""
	if runs.bookmark != "" {
		attrs += ` id="` + xmlEscape(runs.bookmark) + `"`
	}
	if len(classes) > 0 {
		attrs += ` class="` + strings.Join(classes, " ") + `"`
	}
	if style != "" {
		attrs += ` style="` + style + `"`
	}
	attrs += data

	if li != nil {
		inner := strings.Join(runs.segments, "")
		if strings.TrimSpace(stripTags(inner)) == "" && !strings.Contains(inner, "<img") {
			inner += "<br>"
		}
		return paraOutput{list: li, liAttrs: attrs, liInner: inner}
	}

	var sb strings.Builder
	for i, seg := range runs.segments {
		if i > 0 {
			sb.WriteString(pageBreakDiv)
		}
		// an anchored picture sits above/below the text, so a paragraph
		// holding only that still has its own (empty) line
		flow := anchorImgRe.ReplaceAllString(seg, "")
		empty := strings.TrimSpace(stripTags(flow)) == "" && !strings.Contains(flow, "<img") &&
			!strings.Contains(flow, "doc-tab")
		anchorsOnly := empty && flow != seg
		if anchorsOnly {
			seg += "<br>"
			empty = false
		}
		if len(runs.segments) > 1 && empty {
			// the part of a paragraph before or after a page break that
			// holds nothing takes no line (how Google Docs lays it out)
			continue
		}
		if empty && !strings.Contains(seg, "<br>") {
			seg += "<br>"
		} else if strings.HasSuffix(seg, "<br>") && !anchorsOnly {
			// a trailing line break opens one more (empty) line
			seg += "<br>"
		}
		segAttrs := attrs
		if i > 0 {
			segAttrs = strings.Replace(segAttrs, ` id="`+xmlEscape(runs.bookmark)+`"`, "", 1)
			// the text after a page break carries on the paragraph that
			// began on the page before: its spacing-before was spent there
			noBefore := eff
			noBefore.before = optNum{set: true, v: 0}
			st2, _ := cv.blockStyle(tag, noBefore, baseR, false, level, runs.preWrap)
			if style != "" {
				segAttrs = strings.Replace(segAttrs, ` style="`+style+`"`, ` style="`+st2+`"`, 1)
			}
		}
		sb.WriteString("<" + tag + segAttrs + ">" + seg + "</" + tag + ">")
	}
	// A paragraph that ends in a page break leaves an empty remainder on
	// the next page that takes no line - but Google Docs still counts its
	// spacing-after against the spacing-before of what follows (a heading
	// after a page-break heading starts 4pt higher than one after a
	// page-break body paragraph)
	if n := len(runs.segments); n > 1 && !ctx.cell && eff.after.set {
		last := runs.segments[n-1]
		if strings.TrimSpace(stripTags(last)) == "" && !strings.Contains(last, "<img") {
			cv.reduceBefore = eff.after.v / 20
		}
	}
	return paraOutput{html: sb.String()}
}

// the editor's own defaults for body text (docs.css) - anything else is
// stated inline
const (
	editorBodyPt    = 11.0
	editorBodyColor = "000000"
)

var editorFontStack = docxFontStack("Arial", "")

var anchorImgRe = regexp.MustCompile(`<img[^>]*class="doc-anchor"[^>]*>`)

// font names that stand for another face in practice: Google Docs writes
// "Arial Unicode MS" for runs holding symbols and lays them out in Arial,
// while a Windows machine that has the old Office font installed would draw
// them 20% taller and wider
var docxFontAlias = map[string]string{
	"arial unicode ms": "Arial",
}

// metric twins a word processor substitutes for a font it does not have
var docxMetricFallback = map[string]string{
	"sans": "Arial", "serif": "'Times New Roman'", "mono": "'Courier New'",
}

// docxFontStack is fontStackFor with the substitution Google Docs and Word
// make for a font they do not have: a metric-compatible core font right
// behind it. Without that the browser falls through to the shipped Noto
// faces, which are wider and taller, and every line wraps and stacks
// differently from the source.
func docxFontStack(latin, ea string) string {
	if alias, ok := docxFontAlias[strings.ToLower(latin)]; ok {
		latin = alias
	}
	if alias, ok := docxFontAlias[strings.ToLower(ea)]; ok {
		ea = alias
	}
	if ea == latin {
		ea = ""
	}
	stack := fontStackFor(latin, ea)
	l := strings.ToLower(latin)
	kind := "sans"
	switch {
	case strings.Contains(l, "courier"), strings.Contains(l, "mono"), strings.Contains(l, "consolas"):
		kind = "mono"
	case strings.Contains(l, "times"), strings.Contains(l, "georgia"), strings.Contains(l, "garamond"),
		strings.Contains(l, "cambria"), strings.Contains(l, "book antiqua"),
		strings.Contains(l, "serif") && !strings.Contains(l, "sans"):
		kind = "serif"
	}
	fb := docxMetricFallback[kind]
	if strings.EqualFold(strings.Trim(fb, "'"), latin) {
		return stack
	}
	first := quoteFontName(latin)
	if ea != "" && ea != latin {
		first += "," + quoteFontName(ea)
	}
	if strings.HasPrefix(stack, first+",") {
		return first + "," + fb + stack[len(first):]
	}
	return stack
}

// blockStyle renders a paragraph's layout properties as inline CSS plus
// data attributes
func (cv *docxConv) blockStyle(tag string, eff docxPPr, r docxRPr, isList bool, level int, preWrap bool) (string, string) {
	var css []string
	add := func(k, v string) { css = append(css, k+":"+v) }
	heading := tag != "p"

	// a paragraph border sits between the spacing and the text: the text
	// keeps its indent and the rule is drawn "space" points outside it
	edge := func(side string) (float64, bool) {
		b, ok := eff.borders[side]
		if !ok || !b.visible() {
			return 0, false
		}
		return borderWidthPt(b) + b.space, true
	}
	bordered := false
	for _, side := range []string{"top", "right", "bottom", "left"} {
		if _, ok := edge(side); ok {
			bordered = true
		}
	}
	before, after := 0.0, 0.0
	if eff.before.set {
		before = eff.before.v / 20
	}
	if eff.after.set {
		after = eff.after.v / 20
	}
	if before != 0 || heading {
		// Google Docs collapses a heading's spacing-before with the
		// spacing-after above it (the larger wins) but adds a body
		// paragraph's to it - margin collapses in CSS, padding does not
		if heading || bordered {
			// (a bordered paragraph's spacing is outside its rule)
			add("margin-top", ptStr(before))
		} else {
			add("padding-top", ptStr(before))
		}
	}
	if after != 0 || heading {
		add("margin-bottom", ptStr(after))
	}
	if !isList {
		left := 0.0
		if eff.indL.set {
			left = eff.indL.v / 20
		}
		if shift, ok := edge("left"); ok {
			left -= shift
		}
		if left != 0 {
			add("margin-left", ptStr(left))
		}
		first := 0.0
		if eff.indHang.set && eff.indHang.v != 0 {
			first = -eff.indHang.v / 20
		} else if eff.indFirst.set {
			first = eff.indFirst.v / 20
		}
		if first != 0 {
			add("text-indent", ptStr(first))
		}
	}
	right := 0.0
	if eff.indR.set {
		right = eff.indR.v / 20
	}
	if shift, ok := edge("right"); ok && !isList {
		right -= shift
	}
	if right != 0 {
		add("margin-right", ptStr(right))
	}
	switch eff.jc {
	case "center":
		add("text-align", "center")
	case "right", "end":
		add("text-align", "right")
	case "both", "distribute":
		add("text-align", "justify")
	}

	// run defaults of the block
	fc := rPrCSS(r)
	if fc["font-family"] != editorFontStack || heading {
		add("font-family", fc["font-family"])
	}
	if fc["font-size"] != ptStr(editorBodyPt) || heading {
		add("font-size", fc["font-size"])
	}
	if fc["font-weight"] != "400" || heading {
		add("font-weight", fc["font-weight"])
	}
	if fc["font-style"] != "normal" || heading {
		add("font-style", fc["font-style"])
	}
	if fc["color"] != "#"+strings.ToLower(editorBodyColor) || heading {
		add("color", fc["color"])
	}
	for _, k := range []string{"text-decoration", "font-variant", "text-transform", "background-color"} {
		if v := fc[k]; v != "" && v != "none" && v != "normal" {
			add(k, v)
		}
	}
	if eff.shd != "" && eff.shd != "auto" {
		add("background-color", "#"+strings.ToLower(eff.shd))
	}
	for _, side := range []string{"top", "right", "bottom", "left"} {
		b, ok := eff.borders[side]
		if !ok || !b.visible() {
			continue
		}
		add("border-"+side, borderCSS(b))
		if b.space > 0 {
			add("padding-"+side, ptStr(b.space))
		}
	}
	if preWrap {
		add("white-space", "pre-wrap")
	}

	var data strings.Builder
	switch {
	case eff.line.set && eff.lineRule == "exact":
		data.WriteString(` data-lsexact="` + ptStr(eff.line.v/20) + `"`)
	case eff.line.set && eff.lineRule == "atLeast":
		data.WriteString(` data-lsmin="` + ptStr(eff.line.v/20) + `"`)
	case eff.line.set && eff.line.v > 0:
		if ls := round3(eff.line.v / 240); ls != cv.defaultLS {
			data.WriteString(` data-ls="` + trimFloat(ls) + `"`)
		}
	case cv.defaultLS != 1:
		data.WriteString(` data-ls="1"`)
	}
	if eff.keepNext.v {
		data.WriteString(` data-keep-next="1"`)
	}
	if eff.keepLines.v {
		data.WriteString(` data-keep-lines="1"`)
	}
	// widow/orphan control is on unless a paragraph turns it off (Word's
	// Normal style and Google Docs both keep two lines together)
	if eff.widow.set && !eff.widow.v {
		data.WriteString(` data-widow="0"`)
	}
	if eff.pageBreakBefore.v {
		data.WriteString(` data-page-break-before="1"`)
	}
	if len(eff.tabs) > 0 {
		tabs := append([]docxTab(nil), eff.tabs...)
		sort.Slice(tabs, func(i, j int) bool { return tabs[i].pos < tabs[j].pos })
		var parts []string
		for _, t := range tabs {
			if t.align == "clear" {
				continue
			}
			align := t.align
			switch align {
			case "start", "":
				align = "left"
			case "end":
				align = "right"
			}
			leader := t.leader
			if leader == "" {
				leader = "none"
			}
			parts = append(parts, align+":"+trimFloat(round2(t.pos/20))+":"+leader)
		}
		if len(parts) > 0 {
			data.WriteString(` data-tabs="` + strings.Join(parts, ";") + `"`)
		}
	}
	if len(css) == 0 {
		return "", data.String()
	}
	return xmlEscape(strings.Join(css, ";") + ";"), data.String()
}

// borderWidthPt is the width a border is drawn at, in points
func borderWidthPt(b docxBorder) float64 {
	w := b.sz / 8
	if w <= 0 {
		w = 0.5
	}
	if b.val == "double" && w < 2.25 {
		w = 2.25
	}
	return w
}

func borderCSS(b docxBorder) string {
	w := borderWidthPt(b)
	style := "solid"
	switch b.val {
	case "dotted":
		style = "dotted"
	case "dashed", "dashSmallGap", "dotDash", "dotDotDash":
		style = "dashed"
	case "double":
		style = "double"
	}
	col := b.color
	if len(col) != 6 {
		col = "000000"
	}
	return ptStr(w) + " " + style + " #" + strings.ToLower(col)
}

var highlightColors = map[string]string{
	"yellow": "ffff00", "green": "00ff00", "cyan": "00ffff", "magenta": "ff00ff",
	"blue": "0000ff", "red": "ff0000", "darkBlue": "000080", "darkCyan": "008080",
	"darkGreen": "008000", "darkMagenta": "800080", "darkRed": "800000",
	"darkYellow": "808000", "darkGray": "808080", "lightGray": "c0c0c0",
	"black": "000000", "white": "ffffff",
}

// rPrCSS renders a fully resolved run's formatting as CSS values
func rPrCSS(r docxRPr) map[string]string {
	out := map[string]string{}
	font := r.fontASCII
	if font == "" {
		font = "Arial"
	}
	ea := r.fontEA
	if ea == font {
		ea = ""
	}
	out["font-family"] = docxFontStack(font, ea)
	sz := 20.0 // Word's built-in default is 10pt
	if r.sz.set && r.sz.v > 0 {
		sz = r.sz.v
	}
	out["font-size"] = ptStr(sz / 2)
	out["font-weight"] = "400"
	if r.b.v {
		out["font-weight"] = "700"
	}
	out["font-style"] = "normal"
	if r.i.v {
		out["font-style"] = "italic"
	}
	var deco []string
	if r.u != "" && r.u != "none" {
		deco = append(deco, "underline")
	}
	if r.strike.v || r.dstrike.v {
		deco = append(deco, "line-through")
	}
	out["text-decoration"] = "none"
	if len(deco) > 0 {
		out["text-decoration"] = strings.Join(deco, " ")
	}
	col := r.color
	if len(col) != 6 {
		col = editorBodyColor
	}
	out["color"] = "#" + strings.ToLower(col)
	if r.highlight != "" && r.highlight != "none" {
		if h, ok := highlightColors[r.highlight]; ok {
			out["background-color"] = "#" + h
		}
	} else if r.shd != "" && r.shd != "auto" {
		out["background-color"] = "#" + strings.ToLower(r.shd)
	}
	if r.smallCaps.v {
		out["font-variant"] = "small-caps"
	}
	if r.caps.v {
		out["text-transform"] = "uppercase"
	}
	return out
}

var cssRunKeys = []string{"font-family", "font-size", "font-weight", "font-style",
	"text-decoration", "color", "background-color", "font-variant", "text-transform"}

// runCSSDiff renders the properties in which a run differs from its block
func runCSSDiff(run, block map[string]string) string {
	var parts []string
	for _, k := range cssRunKeys {
		rv, bv := run[k], block[k]
		if rv == bv {
			continue
		}
		if rv == "" {
			switch k {
			case "background-color":
				rv = "transparent"
			case "font-variant", "text-transform":
				rv = "normal"
				if k == "text-transform" {
					rv = "none"
				}
			default:
				continue
			}
		}
		parts = append(parts, k+":"+rv)
	}
	if len(parts) == 0 {
		return ""
	}
	return strings.Join(parts, ";") + ";"
}

/* ---------------- runs ---------------- */

type runsResult struct {
	segments []string // inline HTML, split at page breaks
	preWrap  bool
	bookmark string
	midText  bool // the text so far ends in a non-space, so a leading space is kept
}

type inlinePiece struct {
	css  string // run style diff
	vert string
	link string
	rev  string // "ins" | "del": a tracked change
	cmt  string // the comment anchored here (editor id)
	html string
	raw  bool // html is a complete element (no span wrapping)
}

// runs renders the inline content of a paragraph
func (cv *docxConv) runs(p *xnode, part *docxPartCtx, baseR, blockR docxRPr) runsResult {
	res := runsResult{}
	blockCSS := rPrCSS(blockR)
	var pieces []inlinePiece
	var segments []string
	flush := func() {
		segments = append(segments, joinPieces(pieces))
		pieces = nil
	}

	var walk func(n *xnode, link string)
	walk = func(n *xnode, link string) {
		for i := range n.Nodes {
			c := &n.Nodes[i]
			switch c.XMLName.Local {
			case "r":
				cv.run(c, part, baseR, blockCSS, link, &pieces, &res, flush)
			case "hyperlink":
				href := ""
				if id := c.attrNS("relationships", "id"); id != "" {
					href = part.rels[id]
				}
				if a := c.attr("anchor"); a != "" && href == "" {
					href = "#" + a
				}
				walk(c, href)
			case "fldSimple":
				instr := strings.ToUpper(strings.TrimSpace(c.attr("instr")))
				cv.fields = append(cv.fields, fieldFrame{instr: instr, inResult: true})
				walk(c, link)
				cv.fields = cv.fields[:len(cv.fields)-1]
			case "smartTag", "customXml", "bdo", "dir":
				walk(c, link)
			case "ins", "moveTo", "del", "moveFrom":
				prev := cv.curRev
				if cv.curRev == "" {
					cv.curRev = "ins"
					if c.XMLName.Local == "del" || c.XMLName.Local == "moveFrom" {
						cv.curRev = "del"
					}
				}
				walk(c, link)
				cv.curRev = prev
			case "commentRangeStart":
				cv.rv.start(c.attr("id"))
			case "commentRangeEnd":
				cv.rv.end(c.attr("id"))
			case "sdt":
				if sc := c.first("sdtContent"); sc != nil {
					walk(sc, link)
				}
			case "AlternateContent":
				if ch := c.first("Choice"); ch != nil {
					walk(ch, link)
				} else if fb := c.first("Fallback"); fb != nil {
					walk(fb, link)
				}
			case "bookmarkStart":
				name := c.attr("name")
				if res.bookmark == "" && name != "" && name != "_GoBack" {
					res.bookmark = name
				}
			}
		}
	}
	walk(p, "")
	flush()
	res.segments = segments
	return res
}

// fieldHidden reports whether we are inside a field's instruction text
func (cv *docxConv) fieldHidden() bool {
	for _, f := range cv.fields {
		if !f.inResult {
			return true
		}
	}
	return false
}

// fieldKind names the innermost PAGE / NUMPAGES field being shown
func (cv *docxConv) fieldKind() string {
	for i := len(cv.fields) - 1; i >= 0; i-- {
		w := strings.Fields(cv.fields[i].instr)
		if len(w) > 0 && (w[0] == "PAGE" || w[0] == "NUMPAGES") {
			return w[0]
		}
	}
	return ""
}

func (cv *docxConv) run(r *xnode, part *docxPartCtx, baseR docxRPr, blockCSS map[string]string,
	link string, pieces *[]inlinePiece, res *runsResult, pageBreak func()) {

	direct := parseRPr(r.first("rPr"))
	eff := baseR
	if direct.rStyle != "" {
		eff.merge(cv.ss.charStyle(direct.rStyle))
	}
	eff.merge(direct)
	if eff.vanish.v {
		return
	}
	css := runCSSDiff(rPrCSS(eff), blockCSS)
	vert := ""
	if eff.vert == "superscript" || eff.vert == "subscript" {
		vert = eff.vert
	}
	emit := func(html string, raw bool) {
		if kind := cv.fieldKind(); kind != "" && !raw {
			html = `<span class="doc-field" data-field="` + kind + `">` + html + `</span>`
		}
		*pieces = append(*pieces, cv.reviewed(inlinePiece{css: css, vert: vert, link: link, html: html, raw: raw}))
	}
	for i := range r.Nodes {
		c := &r.Nodes[i]
		switch c.XMLName.Local {
		case "fldChar":
			switch c.attr("fldCharType") {
			case "begin":
				cv.fields = append(cv.fields, fieldFrame{})
			case "separate":
				if n := len(cv.fields); n > 0 {
					cv.fields[n-1].inResult = true
				}
			case "end":
				if n := len(cv.fields); n > 0 {
					cv.fields = cv.fields[:n-1]
				}
			}
			continue
		case "instrText":
			if n := len(cv.fields); n > 0 && !cv.fields[n-1].inResult {
				cv.fields[n-1].instr += strings.ToUpper(c.Text)
				cv.fields[n-1].instr = strings.TrimSpace(cv.fields[n-1].instr)
			}
			continue
		}
		if cv.fieldHidden() {
			continue
		}
		switch c.XMLName.Local {
		case "t", "delText":
			t := c.Text
			if t == "" {
				continue
			}
			if strings.Contains(t, "  ") || strings.Contains(t, "\t") || (strings.HasPrefix(t, " ") && !res.midText) {
				res.preWrap = true
			}
			res.midText = !strings.HasSuffix(t, " ")
			emit(xmlEscape(t), false)
		case "tab":
			emit(`<span class="doc-tab">`+"\t"+`</span>`, false)
		case "ptab":
			emit(`<span class="doc-tab">`+"\t"+`</span>`, false)
		case "br", "cr":
			if c.attr("type") == "page" {
				pageBreak()
				continue
			}
			emit("<br>", true)
			res.midText = false
		case "noBreakHyphen":
			emit("\u2011", false)
		case "softHyphen":
			emit("\u00ad", false)
		case "sym":
			if v, err := strconv.ParseUint(c.attr("char"), 16, 32); err == nil {
				// symbol fonts map glyphs into the private use area
				if v >= 0xF000 && v <= 0xF0FF {
					v -= 0xF000
				}
				if v >= 32 {
					emit(xmlEscape(string(rune(v))), false)
				}
			}
		case "footnoteReference":
			id := c.attr("id")
			if onOff2(c.attr("customMarkFollows")) {
				continue
			}
			num, ok := cv.fnNumber[id]
			if !ok {
				num = len(cv.fnOrder) + 1
				cv.fnNumber[id] = num
				cv.fnOrder = append(cv.fnOrder, id)
			}
			// the reference is its own superscript: the run's vertAlign
			// must not wrap it in a second one
			*pieces = append(*pieces, cv.reviewed(inlinePiece{css: css, link: link, raw: true,
				html: `<sup class="doc-fnref" data-fn="` + xmlEscape(id) + `" contenteditable="false">` + strconv.Itoa(num) + `</sup>`}))
		case "footnoteRef":
			// the number inside the footnote itself - the editor draws it
			continue
		case "drawing":
			if img := cv.drawing(c, part); img != "" {
				emit(img, true)
			}
		case "pict", "object":
			if img := cv.vmlImage(c, part); img != "" {
				emit(img, true)
			}
		case "AlternateContent":
			if ch := c.first("Choice"); ch != nil {
				if d := ch.first("drawing"); d != nil {
					if img := cv.drawing(d, part); img != "" {
						emit(img, true)
					}
				}
			}
		case "ruby":
			var texts []string
			collectText(c.first("rubyBase"), &texts)
			if s := strings.Join(texts, ""); s != "" {
				emit(xmlEscape(s), false)
			}
		}
	}
}

// reviewed stamps the review state in force onto a piece
func (cv *docxConv) reviewed(p inlinePiece) inlinePiece {
	p.rev = cv.curRev
	p.cmt = cv.rv.current()
	if p.cmt != "" {
		cv.rv.used[p.cmt] = true
	}
	return p
}

// joinPieces merges adjacent pieces sharing one format into one span.
// Nesting, outermost first: comment anchor, link, tracked change, style.
func joinPieces(pieces []inlinePiece) string {
	var sb strings.Builder
	groupBy(len(pieces), func(a, b int) bool { return pieces[a].cmt == pieces[b].cmt }, func(i, j int) {
		inner := joinLinks(pieces[i:j])
		if cmt := pieces[i].cmt; cmt != "" {
			sb.WriteString(`<span class="doc-cmt" data-cid="` + xmlEscape(cmt) + `">` + inner + `</span>`)
		} else {
			sb.WriteString(inner)
		}
	})
	return sb.String()
}

// groupBy calls emit(i, j) for every run [i, j) of neighbours same says
// belong together
func groupBy(n int, same func(a, b int) bool, emit func(i, j int)) {
	i := 0
	for i < n {
		j := i + 1
		for j < n && same(i, j) {
			j++
		}
		emit(i, j)
		i = j
	}
}

func joinLinks(pieces []inlinePiece) string {
	var sb strings.Builder
	groupBy(len(pieces), func(a, b int) bool { return pieces[a].link == pieces[b].link }, func(i, j int) {
		var inner strings.Builder
		groupBy(j-i, func(a, b int) bool { return pieces[i+a].rev == pieces[i+b].rev }, func(ri, rj int) {
			h := joinStyled(pieces[i+ri : i+rj])
			switch pieces[i+ri].rev {
			case "ins":
				h = `<ins class="doc-ins">` + h + `</ins>`
			case "del":
				h = `<del class="doc-del">` + h + `</del>`
			}
			inner.WriteString(h)
		})
		if link := pieces[i].link; link != "" {
			sb.WriteString(`<a href="` + xmlEscape(link) + `" style="color:inherit;text-decoration:inherit;">` + inner.String() + `</a>`)
		} else {
			sb.WriteString(inner.String())
		}
	})
	return sb.String()
}

func joinStyled(pieces []inlinePiece) string {
	var sb strings.Builder
	groupBy(len(pieces), func(a, b int) bool {
		return pieces[a].css == pieces[b].css && pieces[a].vert == pieces[b].vert
	}, func(i, j int) {
		var text strings.Builder
		for k := i; k < j; k++ {
			text.WriteString(pieces[k].html)
		}
		h := text.String()
		if css := pieces[i].css; css != "" {
			h = `<span style="` + xmlEscape(css) + `">` + h + `</span>`
		}
		switch pieces[i].vert {
		case "superscript":
			h = "<sup>" + h + "</sup>"
		case "subscript":
			h = "<sub>" + h + "</sub>"
		}
		sb.WriteString(h)
	})
	return sb.String()
}

func stripTags(s string) string {
	return tagRe.ReplaceAllString(s, "")
}

/* ---------------- pictures ---------------- */

func (cv *docxConv) mediaData(part *docxPartCtx, rid string) (string, bool) {
	data, ext, ok := cv.mediaBytes(part, rid)
	if !ok {
		return "", false
	}
	return encodeDataURL(data, ext), true
}

// mediaBytes resolves an embedded picture to its bytes and image format
func (cv *docxConv) mediaBytes(part *docxPartCtx, rid string) ([]byte, string, bool) {
	target, ok := part.rels[rid]
	if !ok || part.ext[rid] {
		return nil, "", false
	}
	dir := path.Dir(part.name)
	mediaPath := resolvePartPath(dir, target)
	data, ok := cv.files[mediaPath]
	if !ok {
		return nil, "", false
	}
	ext := strings.TrimPrefix(strings.ToLower(path.Ext(mediaPath)), ".")
	switch ext {
	case "jpg":
		ext = "jpeg"
	case "emf", "wmf", "tif", "tiff":
		// browsers cannot show these - keep the space, lose the picture
		return nil, "", false
	}
	return data, ext, true
}

// drawing converts a DrawingML picture (inline or anchored)
func (cv *docxConv) drawing(n *xnode, part *docxPartCtx) string {
	holder := n.first("inline")
	anchor := false
	if holder == nil {
		holder = n.first("anchor")
		anchor = holder != nil
	}
	if holder == nil {
		return ""
	}
	var blips []*xnode
	holder.findAll("blip", &blips)
	if len(blips) == 0 {
		return ""
	}
	rid := blips[0].attrNS("relationships", "embed")
	if rid == "" {
		rid = blips[0].attr("embed")
	}
	data, format, ok := cv.mediaBytes(part, rid)
	if !ok {
		return ""
	}
	wPt, hPt := 0.0, 0.0
	if ext := holder.first("extent"); ext != nil {
		wPt = twipsAttr(ext, "cx", 0) / emuPerPt
		hPt = twipsAttr(ext, "cy", 0) / emuPerPt
	}
	// a picture turned by quarter turns or mirrored: bake it into the bitmap
	turns, flipH, flipV := 0, false, false
	if spPr := findFirst(holder, "spPr"); spPr != nil {
		if xf := spPr.first("xfrm"); xf != nil {
			if t, ok := pictureTurns(twipsAttr(xf, "rot", 0)); ok {
				turns = t
			}
			flipH, flipV = onOff2(xf.attr("flipH")), onOff2(xf.attr("flipV"))
		}
	}
	if turns != 0 || flipH || flipV {
		if d, f, ok := orientPicture(data, format, turns, flipH, flipV); ok {
			data, format = d, f
			if turns%2 == 1 {
				wPt, hPt = hPt, wPt
			}
		} else {
			turns, flipH, flipV = 0, false, false
		}
	}
	src := encodeDataURL(data, format)
	var css []string
	if wPt > 0 && hPt > 0 {
		css = append(css, "width:"+ptStr(wPt), "height:"+ptStr(hPt))
	}
	// crop: srcRect is in thousandths of a percent of the source
	var rects []*xnode
	holder.findAll("srcRect", &rects)
	if len(rects) > 0 {
		t := twipsAttr(rects[0], "t", 0) / 1000
		r := twipsAttr(rects[0], "r", 0) / 1000
		b := twipsAttr(rects[0], "b", 0) / 1000
		l := twipsAttr(rects[0], "l", 0) / 1000
		if t != 0 || r != 0 || b != 0 || l != 0 {
			o := orientInsets([4]float64{t, r, b, l}, turns, flipH, flipV)
			t, r, b, l = o[0], o[1], o[2], o[3]
			css = append(css, fmt.Sprintf("object-fit:fill;object-view-box:inset(%s%% %s%% %s%% %s%%)",
				trimFloat(round3(t)), trimFloat(round3(r)), trimFloat(round3(b)), trimFloat(round3(l))))
		}
	}
	// a picture outline
	borderPt := 0.0
	if spPr := findFirst(holder, "spPr"); spPr != nil {
		if ln := spPr.first("ln"); ln != nil && ln.first("noFill") == nil {
			if fill := ln.first("solidFill"); fill != nil {
				col := "000000"
				if c := fill.first("srgbClr"); c != nil && len(c.attr("val")) == 6 {
					col = strings.ToLower(c.attr("val"))
				}
				w := twipsAttr(ln, "w", 9525) / emuPerPt
				css = append(css, "border:"+ptStr(w)+" solid #"+col)
				borderPt = w
			}
		}
	}
	if !anchor {
		// room beside the frame: the effect extent beyond the outline (what
		// the docx writer stores a picture's side margins in), else Google
		// Docs' own 1.5pt (the space above and below a picture is the
		// layout engine's business - see pictureLines in docs_layout.js)
		ml, mr := 0.0, 0.0
		if ee := holder.first("effectExtent"); ee != nil && turns%2 == 0 {
			// (a quarter-turned frame keeps its turn in the extent instead)
			ml = twipsAttr(ee, "l", 0)/emuPerPt - borderPt
			mr = twipsAttr(ee, "r", 0)/emuPerPt - borderPt
		}
		if ml < 0.05 && mr < 0.05 && cv.gdocs {
			ml, mr = 1.5, 1.5
		}
		if ml >= 0.05 {
			css = append(css, "margin-left:"+ptStr(ml))
		}
		if mr >= 0.05 {
			css = append(css, "margin-right:"+ptStr(mr))
		}
	}
	alt := ""
	if dp := holder.first("docPr"); dp != nil {
		alt = dp.attr("descr")
	}
	cls := ""
	if anchor {
		x, y := 0.0, 0.0
		if ph := holder.first("positionH"); ph != nil {
			if off := ph.first("posOffset"); off != nil {
				if v, err := strconv.ParseFloat(strings.TrimSpace(off.Text), 64); err == nil {
					x = v / emuPerPt
				}
			}
			switch ph.attr("relativeFrom") {
			case "page":
				x -= cv.marginL
			}
			if al := ph.first("align"); al != nil {
				switch strings.TrimSpace(al.Text) {
				case "center":
					x = (cv.textW - wPt) / 2
				case "right":
					x = cv.textW - wPt
				}
			}
		}
		if pv := holder.first("positionV"); pv != nil {
			if off := pv.first("posOffset"); off != nil && (pv.attr("relativeFrom") == "paragraph" || pv.attr("relativeFrom") == "line") {
				if v, err := strconv.ParseFloat(strings.TrimSpace(off.Text), 64); err == nil {
					y = v / emuPerPt
				}
			}
		}
		square := holder.first("wrapSquare") != nil || holder.first("wrapTight") != nil ||
			holder.first("wrapThrough") != nil
		if square {
			// text flows around it: float to the side it sits on
			side := "left"
			if x+wPt/2 > cv.textW/2 {
				side = "right"
			}
			css = append(css, "float:"+side, "max-width:none")
			if side == "left" && x > 0 {
				css = append(css, "margin-left:"+ptStr(x))
			}
			css = append(css, "margin-right:9pt", "margin-left:9pt")
		} else {
			css = append(css, "display:block", "max-width:none")
			if x != 0 {
				css = append(css, "margin-left:"+ptStr(x))
			}
			if y != 0 {
				css = append(css, "margin-top:"+ptStr(y))
			}
		}
		cls = ` class="doc-anchor"`
	}
	out := `<img src="` + src + `"` + cls
	if alt != "" {
		out += ` alt="` + xmlEscape(alt) + `"`
	}
	if len(css) > 0 {
		out += ` style="` + strings.Join(css, ";") + `;"`
	}
	return out + ">"
}

func findFirst(n *xnode, local string) *xnode {
	var all []*xnode
	n.findAll(local, &all)
	if len(all) == 0 {
		return nil
	}
	return all[0]
}

// vmlImage converts a legacy VML picture (w:pict / w:object)
func (cv *docxConv) vmlImage(n *xnode, part *docxPartCtx) string {
	var datas []*xnode
	n.findAll("imagedata", &datas)
	if len(datas) == 0 {
		return ""
	}
	rid := datas[0].attrNS("relationships", "id")
	if rid == "" {
		rid = datas[0].attr("id")
	}
	src, ok := cv.mediaData(part, rid)
	if !ok {
		return ""
	}
	style := ""
	var shapes []*xnode
	n.findAll("shape", &shapes)
	if len(shapes) > 0 {
		st := shapes[0].attr("style")
		w := cssLengthPt(styleProp(st, "width"))
		h := cssLengthPt(styleProp(st, "height"))
		if w > 0 && h > 0 {
			style = ` style="width:` + ptStr(w) + `;height:` + ptStr(h) + `;"`
		}
	}
	return `<img src="` + src + `"` + style + `>`
}

// cssLengthPt converts a CSS length (pt, px, in, cm, mm) to points
func cssLengthPt(s string) float64 {
	s = strings.TrimSpace(strings.ToLower(s))
	units := []struct {
		suf string
		k   float64
	}{{"pt", 1}, {"px", 0.75}, {"in", 72}, {"cm", 72 / 2.54}, {"mm", 72 / 25.4}}
	for _, u := range units {
		if strings.HasSuffix(s, u.suf) {
			if v, err := strconv.ParseFloat(strings.TrimSuffix(s, u.suf), 64); err == nil {
				return v * u.k
			}
		}
	}
	if v, err := strconv.ParseFloat(s, 64); err == nil {
		return v * 0.75
	}
	return 0
}

/* ---------------- tables ---------------- */

type docxCell struct {
	node    *xnode
	tcPr    *xnode
	gridCol int
	span    int
	vMerge  string // restart | continue | ""
	rowspan int
}

func (cv *docxConv) table(tbl *xnode, part *docxPartCtx, spanAll bool) string {
	direct := parseTblPr(tbl.first("tblPr"))
	tp := *cv.ss.tableStyle(direct.style)
	tp.merge(direct)

	// grid
	var grid []float64
	if g := tbl.first("tblGrid"); g != nil {
		for _, gc := range g.all("gridCol") {
			grid = append(grid, twipsAttr(gc, "w", 0)/20)
		}
	}

	// rows and cells with their grid positions
	type rowInfo struct {
		node  *xnode
		cells []*docxCell
	}
	var rows []*rowInfo
	for i := range tbl.Nodes {
		tr := &tbl.Nodes[i]
		if tr.XMLName.Local != "tr" {
			continue
		}
		ri := &rowInfo{node: tr}
		col := 0
		if trPr := tr.first("trPr"); trPr != nil {
			if gb := trPr.first("gridBefore"); gb != nil {
				if v, err := strconv.Atoi(gb.attr("val")); err == nil {
					col += v
				}
			}
		}
		var addCells func(parent *xnode)
		addCells = func(parent *xnode) {
			for j := range parent.Nodes {
				tc := &parent.Nodes[j]
				switch tc.XMLName.Local {
				case "tc":
					c := &docxCell{node: tc, tcPr: tc.first("tcPr"), gridCol: col, span: 1, rowspan: 1}
					if c.tcPr != nil {
						if gs := c.tcPr.first("gridSpan"); gs != nil {
							if v, err := strconv.Atoi(gs.attr("val")); err == nil && v > 1 {
								c.span = v
							}
						}
						if vm := c.tcPr.first("vMerge"); vm != nil {
							c.vMerge = vm.attr("val")
							if c.vMerge == "" {
								c.vMerge = "continue"
							}
						}
					}
					ri.cells = append(ri.cells, c)
					col += c.span
				case "sdt":
					if sc := tc.first("sdtContent"); sc != nil {
						addCells(sc)
					}
				case "customXml":
					addCells(tc)
				}
			}
		}
		addCells(tr)
		rows = append(rows, ri)
	}
	// vertical merges -> rowspan on the restarting cell
	for r, ri := range rows {
		for _, c := range ri.cells {
			if c.vMerge != "restart" {
				continue
			}
			for r2 := r + 1; r2 < len(rows); r2++ {
				found := false
				for _, c2 := range rows[r2].cells {
					if c2.gridCol == c.gridCol && c2.vMerge == "continue" {
						found = true
						c.rowspan++
						break
					}
				}
				if !found {
					break
				}
			}
		}
	}
	nCols := len(grid)
	for _, ri := range rows {
		n := 0
		for _, c := range ri.cells {
			n = maxInt(n, c.gridCol+c.span)
		}
		nCols = maxInt(nCols, n)
	}
	for len(grid) < nCols {
		grid = append(grid, cv.textW/float64(maxInt(nCols, 1)))
	}
	totalW := 0.0
	for _, w := range grid {
		totalW += w
	}
	if tp.width.set && tp.widthType == "dxa" && tp.width.v > 0 && totalW == 0 {
		totalW = tp.width.v / 20
	}

	var css []string
	if totalW > 0 {
		// the grid decides the columns, not the content (Word's fixed
		// layout, and what Google Docs always does)
		css = append(css, "width:"+ptStr(totalW), "table-layout:fixed")
	}
	switch tp.jc {
	case "center":
		css = append(css, "margin-left:auto", "margin-right:auto")
	case "right", "end":
		css = append(css, "margin-left:auto", "margin-right:0")
	default:
		if tp.ind.set && tp.ind.v != 0 {
			css = append(css, "margin-left:"+ptStr(tp.ind.v/20))
		}
	}
	cls := "of-table"
	if spanAll {
		cls += " col-span-all"
	}
	// data-docx: the table lays out as Word's (no spacing around it) -
	// except one the editor made, which keeps the editor's own
	docxAttr := ` data-docx="1"`
	if pr := tbl.first("tblPr"); pr != nil {
		if st := pr.first("tblStyle"); st != nil && st.attr("val") == editorTableStyle {
			docxAttr = ""
		}
	}
	var sb strings.Builder
	sb.WriteString(`<table class="` + cls + `"` + docxAttr + ` style="` + strings.Join(css, ";") + `;">`)
	if len(grid) > 0 {
		sb.WriteString("<colgroup>")
		for _, w := range grid {
			sb.WriteString(`<col style="width:` + ptStr(w) + `">`)
		}
		sb.WriteString("</colgroup>")
	}
	sb.WriteString("<tbody>")
	for r, ri := range rows {
		trStyle := ""
		trData := ""
		if trPr := ri.node.first("trPr"); trPr != nil {
			if th := trPr.first("trHeight"); th != nil {
				if v := numAttr(th, "val"); v.set && v.v > 0 {
					trStyle = ` style="height:` + ptStr(v.v/20) + `;"`
					if th.attr("hRule") == "exact" {
						trData += ` data-exact="1"`
					}
				}
			}
			if onOff(trPr.first("cantSplit")).v {
				trData += ` data-cant-split="1"`
			}
			if onOff(trPr.first("tblHeader")).v {
				trData += ` data-header-row="1"`
			}
		}
		sb.WriteString("<tr" + trStyle + trData + ">")
		for _, c := range ri.cells {
			if c.vMerge == "continue" {
				continue
			}
			sb.WriteString(cv.cell(c, tp, r, len(rows), nCols, c.rowspan, part))
		}
		sb.WriteString("</tr>")
	}
	sb.WriteString("</tbody></table>")
	return sb.String()
}

func (cv *docxConv) cell(c *docxCell, tp docxTblPr, row, nRows, nCols, rowspan int, part *docxPartCtx) string {
	var tcBorders map[string]docxBorder
	var tcMar map[string]optNum
	shd, vAlign := "", ""
	if c.tcPr != nil {
		tcBorders = parseBorderSet(c.tcPr.first("tcBorders"))
		tcMar = parseMarginSet(c.tcPr.first("tcMar"))
		if s := c.tcPr.first("shd"); s != nil {
			if f := strings.ToLower(s.attr("fill")); len(f) == 6 {
				shd = f
			}
		}
		if va := c.tcPr.first("vAlign"); va != nil {
			vAlign = va.attr("val")
		}
	}
	lastRow := row+rowspan >= nRows
	firstCol := c.gridCol == 0
	lastCol := c.gridCol+c.span >= nCols
	side := func(name, outer, inner string, isOuter bool) string {
		if b, ok := tcBorders[name]; ok {
			if !b.visible() {
				return "none"
			}
			return borderCSS(b)
		}
		key := inner
		if isOuter {
			key = outer
		}
		if b, ok := tp.borders[key]; ok && b.visible() {
			return borderCSS(b)
		}
		return "none"
	}
	var css []string
	css = append(css,
		"border-top:"+side("top", "top", "insideH", row == 0),
		"border-right:"+side("right", "right", "insideV", lastCol),
		"border-bottom:"+side("bottom", "bottom", "insideH", lastRow),
		"border-left:"+side("left", "left", "insideV", firstCol))
	mar := func(name string, def float64) float64 {
		if v, ok := tcMar[name]; ok {
			return v.v / 20
		}
		if v, ok := tp.cellMar[name]; ok {
			return v.v / 20
		}
		return def
	}
	// Word's defaults when nothing states a margin: 0.08" left and right
	css = append(css, "padding:"+ptStr(mar("top", 0))+" "+ptStr(mar("right", 5.4))+" "+
		ptStr(mar("bottom", 0))+" "+ptStr(mar("left", 5.4)))
	switch vAlign {
	case "center":
		css = append(css, "vertical-align:middle")
	case "bottom":
		css = append(css, "vertical-align:bottom")
	default:
		css = append(css, "vertical-align:top")
	}
	if shd != "" && shd != "auto" {
		css = append(css, "background-color:#"+shd)
	}
	attrs := ""
	if c.span > 1 {
		attrs += ` colspan="` + strconv.Itoa(c.span) + `"`
	}
	if rowspan > 1 {
		attrs += ` rowspan="` + strconv.Itoa(rowspan) + `"`
	}
	inner := cv.blocks(c.node, part, blockCtx{cell: true})
	if inner == "" {
		inner = "<p><br></p>"
	}
	return "<td" + attrs + ` style="` + strings.Join(css, ";") + `;">` + inner + "</td>"
}
