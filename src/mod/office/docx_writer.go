package office

/*
	docx_writer.go - Build a Word (.docx) file from a Document.

	The input is the Docs rich HTML model (see docx_reader.go for the
	vocabulary) and every formatting decision in it is written out as
	explicit WordprocessingML, so that the file lays out in Word - and back
	in the editor - the way it looked in the editor:

	  blocks     spacing before/after (margin/padding), indents, alignment,
	             line spacing (data-ls / data-lsexact / data-lsmin), shading,
	             borders, keep-with-next / keep-lines / widow control,
	             page-break-before and tab stops (data-tabs); headings and
	             the title/subtitle keep their named styles
	  runs       font family (the first of the stack), size, weight, italic,
	             underline, strike-through, colour, highlight/shading,
	             small caps, caps, superscript/subscript, hyperlinks
	             (external and internal #bookmark), tabs, line breaks,
	             PAGE / NUMPAGES fields and footnote references
	  lists      one numbering definition per list, with the list's own
	             number format, marker text, start and indents per level;
	             a list interrupted by a paragraph keeps counting (data-num)
	  tables     the grid in twips, the table's indent, fixed layout, per
	             cell borders, margins, shading, vertical alignment, column
	             and row spans, row heights, cant-split and header rows
	  pictures   inline or anchored (top-and-bottom / square wrap), with the
	             crop (srcRect) and the picture outline
	  parts      rich header/footer parts with their own pictures, footnotes,
	             page size, margins and the header/footer distances

	What the editor draws with its own CSS defaults (a heading without
	inline style, a table cell without borders) is written with those
	defaults, mirrored in editorBlockDefaults - change docs.css and change
	them too.
*/

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"errors"
	"fmt"
	"image"
	_ "image/gif"  // natural-size probing
	_ "image/jpeg" // natural-size probing
	_ "image/png"  // natural-size probing
	"math"
	"regexp"
	"strconv"
	"strings"

	"golang.org/x/net/html"
)

const docxNs = `xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"`

const (
	relImage     = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
	relHyperlink = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
)

/* ---------------- CSS reading ---------------- */

// cssDecls parses an inline style attribute (later declarations win)
func cssDecls(style string) map[string]string {
	out := map[string]string{}
	var cur strings.Builder
	quote := byte(0)
	flush := func() {
		decl := cur.String()
		cur.Reset()
		kv := strings.SplitN(decl, ":", 2)
		if len(kv) != 2 {
			return
		}
		k := strings.ToLower(strings.TrimSpace(kv[0]))
		v := strings.TrimSpace(kv[1])
		v = strings.TrimSuffix(strings.TrimSpace(strings.TrimSuffix(v, "!important")), ";")
		if k != "" {
			out[k] = v
		}
	}
	for i := 0; i < len(style); i++ {
		c := style[i]
		switch {
		case quote != 0:
			if c == quote {
				quote = 0
			}
			cur.WriteByte(c)
		case c == '"' || c == '\'':
			quote = c
			cur.WriteByte(c)
		case c == ';':
			flush()
		default:
			cur.WriteByte(c)
		}
	}
	flush()
	return out
}

// cssPt converts a CSS length to points; em is relative to emPt; ok=false
// when the value is not a length
func cssPt(v string, emPt float64) (float64, bool) {
	v = strings.TrimSpace(strings.ToLower(v))
	if v == "" || v == "auto" || v == "normal" {
		return 0, false
	}
	if v == "0" {
		return 0, true
	}
	units := []struct {
		suf string
		k   float64
	}{{"pt", 1}, {"px", 0.75}, {"mm", 72 / 25.4}, {"cm", 72 / 2.54}, {"in", 72}, {"em", 0}, {"rem", 11}}
	for _, u := range units {
		if strings.HasSuffix(v, u.suf) {
			n, err := strconv.ParseFloat(strings.TrimSpace(strings.TrimSuffix(v, u.suf)), 64)
			if err != nil {
				return 0, false
			}
			if u.suf == "em" {
				return n * emPt, true
			}
			return n * u.k, true
		}
	}
	if n, err := strconv.ParseFloat(v, 64); err == nil {
		return n * 0.75, true
	}
	return 0, false
}

// cssFontSizePt resolves font-size (absolute, %, em, keywords)
func cssFontSizePt(v string, parentPt float64) (float64, bool) {
	v = strings.TrimSpace(strings.ToLower(v))
	if strings.HasSuffix(v, "%") {
		if n, err := strconv.ParseFloat(strings.TrimSuffix(v, "%"), 64); err == nil {
			return parentPt * n / 100, true
		}
		return 0, false
	}
	switch v {
	case "smaller":
		return parentPt * 0.83, true
	case "larger":
		return parentPt * 1.2, true
	case "xx-small":
		return 7, true
	case "x-small":
		return 7.5, true
	case "small":
		return 10, true
	case "medium":
		return 12, true
	case "large":
		return 13.5, true
	case "x-large":
		return 18, true
	case "xx-large":
		return 24, true
	case "xxx-large":
		return 36, true
	}
	return cssPt(v, parentPt)
}

// cssBorder parses "1pt solid #000" into a Word border (sz in eighths)
type wBorder struct {
	val   string
	sz    int
	color string
	space float64 // pt between a paragraph border and its text
}

func cssBorder(v string) (wBorder, bool) {
	v = strings.TrimSpace(strings.ToLower(v))
	if v == "" {
		return wBorder{}, false
	}
	if v == "none" || v == "0" || strings.HasPrefix(v, "none ") || strings.Contains(v, " none") || v == "hidden" {
		return wBorder{val: "nil"}, true
	}
	b := wBorder{val: "single", sz: 4, color: "000000"}
	for _, tok := range splitCSSValue(v) {
		switch tok {
		case "solid":
			b.val = "single"
		case "dotted":
			b.val = "dotted"
		case "dashed":
			b.val = "dashed"
		case "double":
			b.val = "double"
		case "thin":
			b.sz = 4
		case "medium":
			b.sz = 12
		case "thick":
			b.sz = 18
		default:
			if pt, ok := cssPt(tok, 11); ok {
				b.sz = int(math.Round(pt * 8))
				if b.sz < 2 {
					b.sz = 2
				}
				if pt == 0 {
					return wBorder{val: "nil"}, true
				}
				continue
			}
			if c := cssColorHex(tok); c != "" {
				b.color = c
			}
		}
	}
	return b, true
}

// borderSpace is a border's w:space: whole points, 0 to 31
func borderSpace(pt float64) int {
	return int(math.Max(0, math.Min(31, math.Round(pt))))
}

// splitCSSValue splits a shorthand on spaces, keeping rgb(...) whole
func splitCSSValue(v string) []string {
	var out []string
	depth := 0
	var cur strings.Builder
	for _, r := range v {
		switch {
		case r == '(':
			depth++
			cur.WriteRune(r)
		case r == ')':
			depth--
			cur.WriteRune(r)
		case r == ' ' && depth == 0:
			if cur.Len() > 0 {
				out = append(out, cur.String())
				cur.Reset()
			}
		default:
			cur.WriteRune(r)
		}
	}
	if cur.Len() > 0 {
		out = append(out, cur.String())
	}
	return out
}

// boxSides expands a 1-4 value shorthand (padding, margin) into t r b l
func boxSides(v string, emPt float64) ([4]float64, bool) {
	var out [4]float64
	toks := splitCSSValue(strings.TrimSpace(v))
	var vals []float64
	for _, t := range toks {
		pt, ok := cssPt(t, emPt)
		if !ok {
			return out, false
		}
		vals = append(vals, pt)
	}
	switch len(vals) {
	case 1:
		out = [4]float64{vals[0], vals[0], vals[0], vals[0]}
	case 2:
		out = [4]float64{vals[0], vals[1], vals[0], vals[1]}
	case 3:
		out = [4]float64{vals[0], vals[1], vals[2], vals[1]}
	case 4:
		out = [4]float64{vals[0], vals[1], vals[2], vals[3]}
	default:
		return out, false
	}
	return out, true
}

func twip(pt float64) int { return int(math.Round(pt * 20)) }

func hasClass(n *html.Node, cls string) bool {
	return strings.Contains(" "+htmlAttr(n, "class")+" ", " "+cls+" ")
}

/* ---------------- inherited formatting ---------------- */

type wRunStyle struct {
	font              string
	sizePt            float64
	bold, italic      bool
	underline, strike bool
	smallCaps, caps   bool
	color             string // RRGGBB
	shade             string // RRGGBB background
	vert              string // superscript | subscript
	preWrap           bool
	link              string
}

// applyBlockCSS folds a container's inline style into the run style; its
// background belongs to the paragraph or cell, not to every run inside
func (rs wRunStyle) applyBlockCSS(css map[string]string) wRunStyle {
	if _, ok := css["background-color"]; !ok {
		return rs.applyCSS(css)
	}
	own := make(map[string]string, len(css))
	for k, v := range css {
		if k != "background-color" {
			own[k] = v
		}
	}
	return rs.applyCSS(own)
}

// applyCSS folds an element's inline style into the inherited run style
func (rs wRunStyle) applyCSS(css map[string]string) wRunStyle {
	if v, ok := css["font-family"]; ok {
		if f := firstFontFamily(v); f != "" {
			rs.font = f
		}
	}
	if v, ok := css["font-size"]; ok {
		if pt, ok := cssFontSizePt(v, rs.sizePt); ok && pt > 0 {
			rs.sizePt = pt
		}
	}
	if v, ok := css["font-weight"]; ok {
		switch v {
		case "bold", "bolder", "600", "700", "800", "900":
			rs.bold = true
		case "normal", "lighter", "100", "200", "300", "400", "500":
			rs.bold = false
		}
	}
	if v, ok := css["font-style"]; ok {
		rs.italic = v == "italic" || v == "oblique"
	}
	for _, k := range []string{"text-decoration", "text-decoration-line"} {
		if v, ok := css[k]; ok {
			if v == "none" {
				rs.underline, rs.strike = false, false
			} else {
				if strings.Contains(v, "underline") {
					rs.underline = true
				}
				if strings.Contains(v, "line-through") {
					rs.strike = true
				}
			}
		}
	}
	if v, ok := css["color"]; ok && v != "inherit" {
		if c := cssColorHex(v); c != "" {
			rs.color = c
		}
	}
	if v, ok := css["background-color"]; ok {
		rs.shade = cssColorHex(v)
	}
	if v, ok := css["font-variant"]; ok {
		rs.smallCaps = strings.Contains(v, "small-caps")
	}
	if v, ok := css["text-transform"]; ok {
		rs.caps = v == "uppercase"
	}
	if v, ok := css["white-space"]; ok {
		rs.preWrap = strings.HasPrefix(v, "pre") || v == "break-spaces"
	}
	return rs
}

func (rs wRunStyle) rPr() string {
	var sb strings.Builder
	sb.WriteString("<w:rPr>")
	if rs.font != "" {
		f := xmlEscape(rs.font)
		sb.WriteString(`<w:rFonts w:ascii="` + f + `" w:hAnsi="` + f + `" w:cs="` + f + `" w:eastAsia="` + f + `"/>`)
	}
	if rs.bold {
		sb.WriteString(`<w:b/><w:bCs/>`)
	} else {
		sb.WriteString(`<w:b w:val="0"/><w:bCs w:val="0"/>`)
	}
	if rs.italic {
		sb.WriteString(`<w:i/><w:iCs/>`)
	} else {
		sb.WriteString(`<w:i w:val="0"/><w:iCs w:val="0"/>`)
	}
	if rs.caps {
		sb.WriteString(`<w:caps/>`)
	}
	if rs.smallCaps {
		sb.WriteString(`<w:smallCaps/>`)
	}
	if rs.strike {
		sb.WriteString(`<w:strike/>`)
	}
	col := rs.color
	if col == "" {
		col = "000000"
	}
	sb.WriteString(`<w:color w:val="` + col + `"/>`)
	if rs.sizePt > 0 {
		hp := int(math.Round(rs.sizePt * 2))
		sb.WriteString(fmt.Sprintf(`<w:sz w:val="%d"/><w:szCs w:val="%d"/>`, hp, hp))
	}
	if rs.underline {
		sb.WriteString(`<w:u w:val="single"/>`)
	} else {
		sb.WriteString(`<w:u w:val="none"/>`)
	}
	if rs.shade != "" {
		sb.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="` + rs.shade + `"/>`)
	}
	if rs.vert != "" {
		sb.WriteString(`<w:vertAlign w:val="` + rs.vert + `"/>`)
	}
	sb.WriteString("</w:rPr>")
	return sb.String()
}

/*
The editor's own look for elements that state nothing (docs.css). The

	writer starts every element from these, then applies its inline style.
*/
type blockDefault struct {
	sizePt, beforePt, afterPt float64
	bold, italic              bool
	color                     string
	style                     string
}

var editorBlockDefaults = map[string]blockDefault{
	"p":            {sizePt: 11, color: "000000"},
	"h1":           {sizePt: 20, beforePt: 14, afterPt: 6, bold: true, color: "1F2328", style: "Heading1"},
	"h2":           {sizePt: 16, beforePt: 14, afterPt: 6, bold: true, color: "1F2328", style: "Heading2"},
	"h3":           {sizePt: 13, beforePt: 14, afterPt: 6, bold: true, color: "1F2328", style: "Heading3"},
	"h4":           {sizePt: 11, beforePt: 14, afterPt: 6, bold: true, italic: true, color: "1F2328", style: "Heading4"},
	"h5":           {sizePt: 11, beforePt: 14, afterPt: 6, bold: true, color: "1F2328", style: "Heading5"},
	"h6":           {sizePt: 11, beforePt: 14, afterPt: 6, bold: true, italic: true, color: "1F2328", style: "Heading6"},
	"doc-title":    {sizePt: 26, afterPt: 12, color: "1F2328", style: "Title"},
	"doc-subtitle": {sizePt: 15, afterPt: 16, color: "666666", style: "Subtitle"},
}

// editorBlockCSS is docs.css for the blocks it boxes (longhands only, so an
// inline shorthand can replace them): the export starts from what the
// editor draws before the element's own style is applied
var editorBlockCSS = map[string]map[string]string{
	"blockquote": {
		"margin-top": "8pt", "margin-bottom": "8pt",
		"border-left": "3px solid #c3c7cc",
		"padding-top": "2pt", "padding-bottom": "2pt", "padding-left": "12px",
		"color": "#5f6368",
	},
	"pre": {
		"margin-top": "8pt", "margin-bottom": "8pt",
		"background-color": "#f1f3f4",
		"border-top":       "1px solid #e2e5e9", "border-right": "1px solid #e2e5e9",
		"border-bottom": "1px solid #e2e5e9", "border-left": "1px solid #e2e5e9",
		"padding-top": "10px", "padding-right": "12px", "padding-bottom": "10px", "padding-left": "12px",
		"font-family": "Consolas, 'Courier New', monospace", "font-size": "10pt",
		"white-space": "pre-wrap",
	},
}

// withDefaultCSS lays an element's inline declarations over defaults; a
// shorthand ("margin", "border") replaces the defaults it covers
func withDefaultCSS(defaults, inline map[string]string) map[string]string {
	out := make(map[string]string, len(defaults)+len(inline))
	for k, v := range defaults {
		out[k] = v
	}
	for k := range inline {
		for d := range defaults {
			if strings.HasPrefix(d, k+"-") {
				delete(out, d)
			}
		}
	}
	for k, v := range inline {
		out[k] = v
	}
	return out
}

/* ---------------- relationships and media ---------------- */

type docxPart struct {
	rels []string
	next int
}

func (p *docxPart) add(typ, target string, external bool) string {
	p.next++
	id := fmt.Sprintf("rId%d", 100+p.next)
	mode := ""
	if external {
		mode = ` TargetMode="External"`
	}
	p.rels = append(p.rels, `<Relationship Id="`+id+`" Type="`+typ+`" Target="`+xmlEscape(target)+`"`+mode+`/>`)
	return id
}

func (p *docxPart) relsXML(fixed string) string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		fixed + strings.Join(p.rels, "") + `</Relationships>`
}

/* ---------------- numbering ---------------- */

type numLevelDef struct {
	fmt, text      string
	start          int
	leftPt, hangPt float64
	set            bool
}

type numInstance struct {
	id     int
	levels [9]numLevelDef
}

type docxNumbering struct {
	list  []*numInstance
	byKey map[string]*numInstance
}

func (nb *docxNumbering) instance(key string) *numInstance {
	if nb.byKey == nil {
		nb.byKey = map[string]*numInstance{}
	}
	if key != "" {
		if in, ok := nb.byKey[key]; ok {
			return in
		}
	}
	in := &numInstance{id: len(nb.list) + 1}
	nb.list = append(nb.list, in)
	if key != "" {
		nb.byKey[key] = in
	}
	return in
}

func (nb *docxNumbering) xml() string {
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	sb.WriteString(`<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`)
	for _, in := range nb.list {
		sb.WriteString(fmt.Sprintf(`<w:abstractNum w:abstractNumId="%d"><w:multiLevelType w:val="hybridMultilevel"/>`, in.id))
		for l := 0; l < 9; l++ {
			d := in.levels[l]
			if !d.set {
				d = defaultNumLevel(in.levels[0].fmt == "bullet", l)
			}
			start := d.start
			if start < 0 {
				start = 1
			}
			sb.WriteString(fmt.Sprintf(`<w:lvl w:ilvl="%d"><w:start w:val="%d"/><w:numFmt w:val="%s"/><w:lvlText w:val="%s"/><w:lvlJc w:val="left"/>`+
				`<w:pPr><w:ind w:left="%d" w:hanging="%d"/></w:pPr>`,
				l, start, d.fmt, xmlEscape(d.text), twip(d.leftPt), twip(d.hangPt)))
			if d.fmt == "bullet" {
				sb.WriteString(`<w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial"/><w:u w:val="none"/></w:rPr>`)
			}
			sb.WriteString(`</w:lvl>`)
		}
		sb.WriteString(`</w:abstractNum>`)
	}
	for _, in := range nb.list {
		sb.WriteString(fmt.Sprintf(`<w:num w:numId="%d"><w:abstractNumId w:val="%d"/></w:num>`, in.id, in.id))
	}
	sb.WriteString(`</w:numbering>`)
	return sb.String()
}

var defaultBullets = []string{"\u25cf", "\u25cb", "\u25a0"}
var defaultOrdered = []string{"decimal", "lowerLetter", "lowerRoman"}

func defaultNumLevel(bullet bool, level int) numLevelDef {
	d := numLevelDef{start: 1, leftPt: float64(level+1) * 36, hangPt: 18, set: true}
	if bullet {
		d.fmt = "bullet"
		d.text = defaultBullets[level%3]
	} else {
		d.fmt = defaultOrdered[level%3]
		d.text = "%" + strconv.Itoa(level+1) + "."
	}
	return d
}

/* ---------------- the builder ---------------- */

type docxBuilder struct {
	doc     *Document
	textWPt float64 // the width a block at hand may take (a column or the page)
	// the indent of the containers the block at hand sits in
	containerLeft, containerRight float64
	fullWPt                       float64 // the page's text width
	colWPt                        float64 // one column of a multi-column page
	media                         []mediaEntry
	imgCount                      int
	mediaByHash                   map[[32]byte]int
	// resolves the media?file= links pictures carry (nil = data URLs only)
	readVpath func(string) ([]byte, error)
	// review markup (docx_review.go): pieces per comment anchor, pieces
	// written so far, Word ids, and the revision counter
	cmtTotal  map[string]int
	cmtSeen   map[string]int
	cmtWordID map[string]int
	cmtOrder  []*DocComment
	revID     int
	inRev     bool
	docPrID   int
	num       docxNumbering
	fnIDs     map[string]int
	fnOrder   []string
	bookmarkN int
	// multi-column documents: blocks with class "col-span-all" (IEEE-style
	// title/author rows) are emitted into their own single-column section,
	// separated from the columned body by a continuous section break
	multiCol    bool
	sectDivider string
	lastSpan    bool
	anyBlock    bool
	usedDivider bool
}

// BuildDocx serializes a Document into a complete .docx file; pictures
// must be inline data URLs
func BuildDocx(doc *Document) ([]byte, error) {
	return BuildDocxMedia(doc, nil)
}

// BuildDocxMedia serializes a Document, reading pictures that are
// media?file= links through readVpath
func BuildDocxMedia(doc *Document, readVpath func(string) ([]byte, error)) ([]byte, error) {
	if doc == nil {
		return nil, errors.New("nil document")
	}
	b := &docxBuilder{doc: doc, fnIDs: map[string]int{}, mediaByHash: map[[32]byte]int{}, readVpath: readVpath,
		cmtTotal: map[string]int{}, cmtSeen: map[string]int{}, cmtWordID: map[string]int{}}
	b.fullWPt = textWidthPt(doc.Page)
	b.colWPt = b.fullWPt
	b.textWPt = b.fullWPt
	if doc.Page != nil && doc.Page.Columns > 1 {
		// a block inside the column flow is as wide as one column
		gap := doc.Page.ColGap * 72 / 25.4
		b.colWPt = (b.fullWPt - gap*float64(doc.Page.Columns-1)) / float64(doc.Page.Columns)
		b.multiCol = true
		b.sectDivider = `<w:p><w:pPr><w:sectPr><w:type w:val="continuous"/>` +
			pgGeometry(doc.Page) + `<w:cols w:num="1"/></w:sectPr></w:pPr></w:p>`
	}

	docPart := &docxPart{}
	body, err := b.convertBlocks(doc.HTML, docPart, true)
	if err != nil {
		return nil, err
	}

	// header / footer parts, each with its own relationships
	hfOn := doc.HFMode != HFModeNone
	type hfOut struct {
		xml  string
		part *docxPart
	}
	var header, footer *hfOut
	if hfOn {
		if h := b.hfBody(doc.HeaderHTML, doc.Header, false); h != nil {
			header = &hfOut{xml: h.xml, part: h.part}
		}
	}
	if f := b.hfBody(doc.FooterHTML, doc.Footer, doc.PageNumbers); f != nil {
		if !hfOn {
			// "none" drops the text but a page counter is its own setting
			f = b.hfBody("", "", doc.PageNumbers)
		}
		if f != nil {
			footer = &hfOut{xml: f.xml, part: f.part}
		}
	}

	// footnotes referenced by the text (and the notes inside them)
	var fnXML string
	fnPart := &docxPart{}
	if len(b.fnOrder) > 0 {
		fnXML, err = b.footnotesXML(fnPart)
		if err != nil {
			return nil, err
		}
	}

	cmtXML, cmtExtXML := b.commentsXML()

	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)
	add := func(name string, data []byte) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	}
	addS := func(name, content string) error { return add(name, []byte(content)) }

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
	ct.WriteString(`<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>`)
	ct.WriteString(`<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>`)
	if header != nil {
		ct.WriteString(`<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>`)
	}
	if footer != nil {
		ct.WriteString(`<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>`)
	}
	if fnXML != "" {
		ct.WriteString(`<Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>`)
	}
	if cmtXML != "" {
		ct.WriteString(`<Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>`)
	}
	if cmtExtXML != "" {
		ct.WriteString(`<Override PartName="/word/commentsExtended.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.commentsExtended+xml"/>`)
	}
	ct.WriteString(`</Types>`)
	if err := addS("[Content_Types].xml", ct.String()); err != nil {
		return nil, err
	}
	if err := addS("_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+"\n"+
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+
		`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>`+
		`</Relationships>`); err != nil {
		return nil, err
	}

	fixed := `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
		`<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>` +
		`<Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>`
	headerRef, footerRef := "", ""
	if header != nil {
		fixed += `<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>`
		headerRef = `<w:headerReference w:type="default" r:id="rId3"/>`
	}
	if footer != nil {
		fixed += `<Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>`
		footerRef = `<w:footerReference w:type="default" r:id="rId4"/>`
	}
	if fnXML != "" {
		fixed += `<Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>`
	}
	if cmtXML != "" {
		fixed += `<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>`
	}
	if cmtExtXML != "" {
		fixed += `<Relationship Id="rId8" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/>`
	}
	if err := addS("word/_rels/document.xml.rels", docPart.relsXML(fixed)); err != nil {
		return nil, err
	}

	sect := buildSectPr(doc.Page, headerRef, footerRef, b.usedDivider, doc.HFMode == HFModeExceptFirst)
	if err := addS("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+"\n"+
		`<w:document `+docxNs+`><w:body>`+body+sect+`</w:body></w:document>`); err != nil {
		return nil, err
	}
	if err := addS("word/styles.xml", docxStylesXML(doc)); err != nil {
		return nil, err
	}
	settings := docxSettings
	if doc.TrackChanges {
		// "Suggest edits" on: Word goes on tracking where the editor left off
		settings = strings.Replace(settings, `<w:defaultTabStop`, `<w:trackRevisions/><w:defaultTabStop`, 1)
	}
	if err := addS("word/settings.xml", settings); err != nil {
		return nil, err
	}
	if cmtXML != "" {
		if err := addS("word/comments.xml", cmtXML); err != nil {
			return nil, err
		}
	}
	if cmtExtXML != "" {
		if err := addS("word/commentsExtended.xml", cmtExtXML); err != nil {
			return nil, err
		}
	}
	if err := addS("word/numbering.xml", b.num.xml()); err != nil {
		return nil, err
	}
	if header != nil {
		if err := addS("word/header1.xml", hfPartXML("hdr", header.xml)); err != nil {
			return nil, err
		}
		if err := addS("word/_rels/header1.xml.rels", header.part.relsXML("")); err != nil {
			return nil, err
		}
	}
	if footer != nil {
		if err := addS("word/footer1.xml", hfPartXML("ftr", footer.xml)); err != nil {
			return nil, err
		}
		if err := addS("word/_rels/footer1.xml.rels", footer.part.relsXML("")); err != nil {
			return nil, err
		}
	}
	if fnXML != "" {
		if err := addS("word/footnotes.xml", fnXML); err != nil {
			return nil, err
		}
		if err := addS("word/_rels/footnotes.xml.rels", fnPart.relsXML("")); err != nil {
			return nil, err
		}
	}
	for _, m := range b.media {
		if err := add(fmt.Sprintf("word/media/image%d.%s", m.index, m.ext), m.data); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// textWidthPt is the width of the text column for a page setup
func textWidthPt(pc *PageConf) float64 {
	size, orient := "A4", "portrait"
	mL, mR := 25.4, 25.4
	if pc != nil {
		if _, ok := pageSizesTwips[pc.Size]; ok {
			size = pc.Size
		}
		orient = pc.Orientation
		if pc.Margins != nil {
			mL, mR = pc.Margins.Left, pc.Margins.Right
		}
	}
	dim := pageSizesTwips[size]
	w := float64(dim[0])
	if orient == "landscape" {
		w = float64(dim[1])
	}
	return w/20 - (mL+mR)*72/25.4
}

// convertBlocks parses a fragment of editor HTML into body XML
func (b *docxBuilder) convertBlocks(src string, part *docxPart, top bool) (string, error) {
	root, err := html.Parse(strings.NewReader("<body>" + src + "</body>"))
	if err != nil {
		return "", errors.New("cannot parse document HTML: " + err.Error())
	}
	body := findHTMLNode(root, "body")
	if body == nil {
		return "", nil
	}
	liftReviewWrappers(body)
	if top {
		b.countComments(body)
		b.numberComments()
	}
	var sb strings.Builder
	base := wRunStyle{font: "Arial", sizePt: 11, color: "000000"}
	b.blocks(body, part, base, &sb, top)
	return sb.String(), nil
}

type hfResult struct {
	xml  string
	part *docxPart
}

// hfBody renders a header/footer: rich HTML, else plain text, plus an
// automatic centred page number
func (b *docxBuilder) hfBody(richHTML, text string, pageNumbers bool) *hfResult {
	part := &docxPart{}
	var sb strings.Builder
	if strings.TrimSpace(richHTML) != "" {
		x, err := b.convertBlocks(richHTML, part, false)
		if err == nil {
			sb.WriteString(x)
		}
	} else if strings.TrimSpace(text) != "" {
		rs := wRunStyle{font: "Arial", sizePt: 9, color: "6B7078"}
		sb.WriteString(`<w:p><w:r>` + rs.rPr() + `<w:t xml:space="preserve">` + xmlEscape(text) + `</w:t></w:r></w:p>`)
	}
	hasField := strings.Contains(richHTML, `data-field="PAGE"`)
	if pageNumbers && !hasField {
		rs := wRunStyle{font: "Arial", sizePt: 10, color: "444444"}
		// the page number the editor draws by itself: its own style marks it
		// so an import turns it back into the page-number switch
		sb.WriteString(`<w:p><w:pPr><w:pStyle w:val="` + autoPageNumberStyle + `"/><w:jc w:val="center"/></w:pPr><w:fldSimple w:instr=" PAGE "><w:r>` +
			rs.rPr() + `<w:t>1</w:t></w:r></w:fldSimple></w:p>`)
	}
	if sb.Len() == 0 {
		return nil
	}
	return &hfResult{xml: sb.String(), part: part}
}

func hfPartXML(root, inner string) string {
	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<w:` + root + ` ` + docxNs + `>` + inner + `</w:` + root + `>`
}

// footnotesXML writes the separators and every referenced footnote
func (b *docxBuilder) footnotesXML(part *docxPart) (string, error) {
	byID := map[string]string{}
	for _, fn := range b.doc.Footnotes {
		byID[fn.ID] = fn.HTML
	}
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	sb.WriteString(`<w:footnotes ` + docxNs + `>`)
	sb.WriteString(`<w:footnote w:type="separator" w:id="-1"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:separator/></w:r></w:p></w:footnote>`)
	sb.WriteString(`<w:footnote w:type="continuationSeparator" w:id="0"><w:p><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>`)
	// notes can reference notes; walk until no new ones appear
	for i := 0; i < len(b.fnOrder); i++ {
		id := b.fnOrder[i]
		src := byID[id]
		if strings.TrimSpace(src) == "" {
			src = "<p><br></p>"
		}
		x, err := b.convertBlocks(src, part, false)
		if err != nil {
			return "", err
		}
		mark := `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteRef/></w:r>`
		if at := strings.Index(x, "</w:pPr>"); at >= 0 && at < strings.Index(x+"<w:r>", "<w:r>")+len("</w:pPr>") {
			x = x[:at+len("</w:pPr>")] + mark + x[at+len("</w:pPr>"):]
		} else if at := strings.Index(x, "<w:p>"); at >= 0 {
			x = x[:at+len("<w:p>")] + mark + x[at+len("<w:p>"):]
		} else {
			x = `<w:p>` + mark + `</w:p>` + x
		}
		sb.WriteString(fmt.Sprintf(`<w:footnote w:id="%d">`, b.fnIDs[id]))
		sb.WriteString(x)
		sb.WriteString(`</w:footnote>`)
	}
	sb.WriteString(`</w:footnotes>`)
	return sb.String(), nil
}

/* ---------------- blocks ---------------- */

type pProps struct {
	style                    string
	beforePt, afterPt        float64
	hasBefore, hasAfter      bool
	lineRule                 string // auto | exact | atLeast
	line                     int    // twips (exact/atLeast) or 240ths (auto)
	leftPt, rightPt, firstPt float64
	hasInd                   bool
	jc                       string
	shade                    string
	borders                  map[string]wBorder
	keepNext, keepLines      bool
	widowOff                 bool
	pageBreakBefore          bool
	tabs                     string
	numID, ilvl              int
	bookmark                 string
	mark                     string // paragraph mark run properties
}

func (pp pProps) xml() string {
	var sb strings.Builder
	sb.WriteString("<w:pPr>")
	if pp.style != "" {
		sb.WriteString(`<w:pStyle w:val="` + pp.style + `"/>`)
	}
	if pp.keepNext {
		sb.WriteString(`<w:keepNext/>`)
	}
	if pp.keepLines {
		sb.WriteString(`<w:keepLines/>`)
	}
	if pp.pageBreakBefore {
		sb.WriteString(`<w:pageBreakBefore/>`)
	}
	if pp.widowOff {
		sb.WriteString(`<w:widowControl w:val="0"/>`)
	}
	if pp.numID > 0 {
		sb.WriteString(fmt.Sprintf(`<w:numPr><w:ilvl w:val="%d"/><w:numId w:val="%d"/></w:numPr>`, pp.ilvl, pp.numID))
	}
	if len(pp.borders) > 0 {
		sb.WriteString("<w:pBdr>")
		for _, side := range []string{"top", "left", "bottom", "right"} {
			if bd, ok := pp.borders[side]; ok && bd.val != "nil" {
				sb.WriteString(fmt.Sprintf(`<w:%s w:val="%s" w:sz="%d" w:space="%d" w:color="%s"/>`, side, bd.val, bd.sz, borderSpace(bd.space), bd.color))
			}
		}
		sb.WriteString("</w:pBdr>")
	}
	if pp.shade != "" {
		sb.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="` + pp.shade + `"/>`)
	}
	if pp.tabs != "" {
		sb.WriteString(pp.tabs)
	}
	sp := ""
	if pp.hasBefore {
		sp += fmt.Sprintf(` w:before="%d"`, twip(pp.beforePt))
	}
	if pp.hasAfter {
		sp += fmt.Sprintf(` w:after="%d"`, twip(pp.afterPt))
	}
	if pp.lineRule != "" {
		sp += fmt.Sprintf(` w:line="%d" w:lineRule="%s"`, pp.line, pp.lineRule)
	}
	if sp != "" {
		sb.WriteString(`<w:spacing` + sp + `/>`)
	}
	if pp.hasInd {
		ind := fmt.Sprintf(` w:left="%d" w:right="%d"`, twip(pp.leftPt), twip(pp.rightPt))
		if pp.firstPt < 0 {
			ind += fmt.Sprintf(` w:hanging="%d"`, twip(-pp.firstPt))
		} else {
			ind += fmt.Sprintf(` w:firstLine="%d"`, twip(pp.firstPt))
		}
		sb.WriteString(`<w:ind` + ind + `/>`)
	}
	if pp.jc != "" {
		sb.WriteString(`<w:jc w:val="` + pp.jc + `"/>`)
	}
	sb.WriteString(pp.mark)
	sb.WriteString("</w:pPr>")
	return sb.String()
}

// blockStyleOf reads one block element's paragraph and run formatting
func (b *docxBuilder) blockStyleOf(n *html.Node, parent wRunStyle) (pProps, wRunStyle) {
	css := withDefaultCSS(editorBlockCSS[n.Data], cssDecls(htmlAttr(n, "style")))
	pp := pProps{}
	rs := parent
	key := n.Data
	if hasClass(n, "doc-title") {
		key = "doc-title"
	} else if hasClass(n, "doc-subtitle") {
		key = "doc-subtitle"
	}
	if def, ok := editorBlockDefaults[key]; ok && key != "p" {
		pp.style = def.style
		rs.sizePt = def.sizePt
		rs.bold = def.bold
		rs.italic = def.italic
		rs.color = def.color
		pp.beforePt, pp.afterPt = def.beforePt, def.afterPt
		pp.hasBefore, pp.hasAfter = true, true
		pp.keepNext = strings.HasPrefix(key, "h")
	}
	rs = rs.applyBlockCSS(css)
	em := rs.sizePt
	if v, ok := css["margin"]; ok {
		if s, ok := boxSides(v, em); ok {
			pp.beforePt, pp.afterPt = s[0], s[2]
			pp.leftPt, pp.rightPt = s[3], s[1]
			pp.hasBefore, pp.hasAfter, pp.hasInd = true, true, true
		}
	}
	if v, ok := css["margin-top"]; ok {
		if pt, ok := cssPt(v, em); ok {
			pp.beforePt = pt
			pp.hasBefore = true
		}
	}
	if v, ok := css["margin-bottom"]; ok {
		if pt, ok := cssPt(v, em); ok {
			pp.afterPt = pt
			pp.hasAfter = true
		}
	}
	if v, ok := css["margin-left"]; ok {
		if pt, ok := cssPt(v, em); ok {
			pp.leftPt = pt
			pp.hasInd = true
		}
	}
	if v, ok := css["margin-right"]; ok {
		if pt, ok := cssPt(v, em); ok {
			pp.rightPt = pt
			pp.hasInd = true
		}
	}
	if v, ok := css["text-indent"]; ok {
		if pt, ok := cssPt(v, em); ok {
			pp.firstPt = pt
			pp.hasInd = true
		}
	}
	switch css["text-align"] {
	case "center":
		pp.jc = "center"
	case "right", "end":
		pp.jc = "right"
	case "justify":
		pp.jc = "both"
	case "left", "start":
		pp.jc = "left"
	}
	if c := cssColorHex(css["background-color"]); c != "" {
		pp.shade = c
		rs.shade = ""
	}
	for _, side := range []string{"top", "right", "bottom", "left"} {
		if v, ok := css["border-"+side]; ok {
			if bd, ok := cssBorder(v); ok && bd.val != "nil" {
				if pp.borders == nil {
					pp.borders = map[string]wBorder{}
				}
				pp.borders[side] = bd
			}
		}
	}
	if v, ok := css["border"]; ok {
		if bd, ok := cssBorder(v); ok && bd.val != "nil" {
			pp.borders = map[string]wBorder{"top": bd, "right": bd, "bottom": bd, "left": bd}
		}
	}
	// padding: inside a border it is the border's space, and the text keeps
	// clear of the rule by width + space; with no border it is plain extra
	// spacing or indent
	var pad [4]float64 // top right bottom left
	padSet := false
	if v, ok := css["padding"]; ok {
		if s, ok := boxSides(v, em); ok {
			pad, padSet = s, true
		}
	}
	for i, side := range []string{"top", "right", "bottom", "left"} {
		if pt, ok := cssPt(css["padding-"+side], em); ok {
			pad[i], padSet = pt, true
		}
	}
	for i, side := range []string{"top", "right", "bottom", "left"} {
		bd, bordered := pp.borders[side]
		if !bordered && (!padSet || pad[i] == 0) {
			continue
		}
		extra := pad[i]
		if bordered {
			// w:space is whole points: what rounding takes from it goes
			// to the spacing outside the rule (the indent already counts
			// the full padding)
			bd.space = pad[i]
			pp.borders[side] = bd
			extra = float64(bd.sz)/8 + pad[i]
		}
		frac := pad[i] - float64(borderSpace(pad[i]))
		switch side {
		case "top":
			if !bordered {
				pp.beforePt += extra
			} else {
				pp.beforePt += frac
			}
			pp.hasBefore = true
		case "bottom":
			if !bordered {
				pp.afterPt += extra
			} else {
				pp.afterPt += frac
			}
			pp.hasAfter = true
		case "left":
			pp.leftPt += extra
			pp.hasInd = true
		case "right":
			pp.rightPt += extra
			pp.hasInd = true
		}
	}
	pp.beforePt, pp.afterPt = math.Max(0, pp.beforePt), math.Max(0, pp.afterPt)
	// line spacing: data-ls (multiple), data-lsexact, data-lsmin; a legacy
	// unitless line-height means a multiple too
	if v := htmlAttr(n, "data-lsexact"); v != "" {
		if pt, ok := cssPt(v, em); ok {
			pp.lineRule, pp.line = "exact", twip(pt)
		}
	} else if v := htmlAttr(n, "data-lsmin"); v != "" {
		if pt, ok := cssPt(v, em); ok {
			pp.lineRule, pp.line = "atLeast", twip(pt)
		}
	} else if v := htmlAttr(n, "data-ls"); v != "" {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
			pp.lineRule, pp.line = "auto", int(math.Round(f*240))
		}
	} else if v, ok := css["line-height"]; ok {
		if f, err := strconv.ParseFloat(v, 64); err == nil && f > 0 {
			pp.lineRule, pp.line = "auto", int(math.Round(f*240))
		}
	}
	pp.keepNext = pp.keepNext || htmlAttr(n, "data-keep-next") == "1"
	pp.keepLines = htmlAttr(n, "data-keep-lines") == "1"
	pp.widowOff = htmlAttr(n, "data-widow") == "0"
	pp.pageBreakBefore = htmlAttr(n, "data-page-break-before") == "1"
	if v := htmlAttr(n, "data-tabs"); v != "" {
		pp.tabs = tabsXML(v)
	}
	if id := htmlAttr(n, "id"); id != "" {
		pp.bookmark = id
	}
	return pp, rs
}

// tabsXML turns data-tabs ("right:451.28:dot;left:36:none") into w:tabs
func tabsXML(v string) string {
	var sb strings.Builder
	for _, t := range strings.Split(v, ";") {
		f := strings.Split(t, ":")
		if len(f) < 2 {
			continue
		}
		pos, err := strconv.ParseFloat(f[1], 64)
		if err != nil {
			continue
		}
		align := f[0]
		switch align {
		case "left", "right", "center", "decimal":
		default:
			align = "left"
		}
		leader := "none"
		if len(f) > 2 && f[2] != "" {
			leader = f[2]
		}
		sb.WriteString(fmt.Sprintf(`<w:tab w:val="%s" w:leader="%s" w:pos="%d"/>`, align, xmlEscape(leader), twip(pos)))
	}
	if sb.Len() == 0 {
		return ""
	}
	return "<w:tabs>" + sb.String() + "</w:tabs>"
}

// blocks emits the block-level children of an element
func (b *docxBuilder) blocks(n *html.Node, part *docxPart, rs wRunStyle, sb *strings.Builder, top bool) {
	var pending *html.Node // first of a run of stray inline nodes
	flushInline := func(stop *html.Node) {
		if pending == nil {
			return
		}
		pp := pProps{}
		b.paragraph(pending, stop, pp, rs, part, sb)
		pending = nil
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.TextNode {
			if strings.TrimSpace(c.Data) != "" && pending == nil {
				pending = c
			}
			continue
		}
		if c.Type != html.ElementNode {
			continue
		}
		if !isBlockElement(c) {
			if pending == nil {
				pending = c
			}
			continue
		}
		flushInline(c)
		if top && b.multiCol {
			span := hasClass(c, "col-span-all")
			if b.anyBlock && b.lastSpan && !span {
				sb.WriteString(b.sectDivider)
				b.usedDivider = true
			}
			b.lastSpan = span
			b.textWPt = b.colWPt
			if span {
				b.textWPt = b.fullWPt
			}
		}
		b.anyBlock = true
		b.block(c, part, rs, sb)
	}
	flushInline(nil)
}

func isBlockElement(n *html.Node) bool {
	if n.Type != html.ElementNode {
		return false
	}
	if n.Data == "img" && hasClass(n, "doc-anchor") {
		return false // lives inside a paragraph
	}
	switch n.Data {
	case "p", "div", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "table",
		"blockquote", "pre", "hr", "section", "article", "header", "footer", "figure":
		return true
	}
	return false
}

// block emits one block element
func (b *docxBuilder) block(c *html.Node, part *docxPart, rs wRunStyle, sb *strings.Builder) {
	if hasClass(c, "doc-pagebreak") {
		sb.WriteString(`<w:p><w:r><w:br w:type="page"/></w:r></w:p>`)
		return
	}
	switch c.Data {
	case "ul", "ol":
		b.list(c, part, rs, sb, 0, b.containerLeft, "")
	case "table":
		b.table(c, part, rs, sb)
	case "hr":
		// docs.css: a 1px rule with 14pt either side; a 1pt exact line
		// holds it, and the style brings it back as an <hr> on import
		sb.WriteString(`<w:p><w:pPr><w:pStyle w:val="` + autoRuleStyle + `"/><w:pBdr><w:top w:val="single" w:sz="6" w:space="0" w:color="C9CDD3"/></w:pBdr>` +
			`<w:spacing w:before="280" w:after="265" w:line="20" w:lineRule="exact"/><w:rPr><w:sz w:val="2"/><w:szCs w:val="2"/></w:rPr></w:pPr></w:p>`)
	case "pre":
		pp, prs := b.blockStyleOf(c, rs)
		b.paragraph(c.FirstChild, nil, pp, prs, part, sb)
	case "blockquote":
		pp, prs := b.blockStyleOf(c, rs)
		if hasBlockChild(c) {
			b.inContainer(pp, func() { b.blocks(c, part, prs, sb, false) })
		} else {
			b.paragraph(c.FirstChild, nil, pp, prs, part, sb)
		}
	default:
		pp, prs := b.blockStyleOf(c, rs)
		if hasBlockChild(c) {
			// a container: its own inline runs become paragraphs between
			// the nested blocks
			inner := pp
			inner.leftPt, inner.rightPt = 0, 0
			b.inContainer(pp, func() { b.containerWithStyle(c, part, inner, prs, sb) })
			return
		}
		b.paragraph(c.FirstChild, nil, pp, prs, part, sb)
	}
}

// inContainer runs fn with the blocks it writes inside a container's
// indent (a blockquote the browser's indent command made, a div)
func (b *docxBuilder) inContainer(pp pProps, fn func()) {
	l, r := b.containerLeft, b.containerRight
	b.containerLeft += pp.leftPt
	b.containerRight += pp.rightPt
	fn()
	b.containerLeft, b.containerRight = l, r
}

// containerWithStyle handles a div/p that holds nested blocks
func (b *docxBuilder) containerWithStyle(c *html.Node, part *docxPart, pp pProps, rs wRunStyle, sb *strings.Builder) {
	var pending *html.Node
	flush := func(stop *html.Node) {
		if pending != nil {
			b.paragraph(pending, stop, pp, rs, part, sb)
			pending = nil
		}
	}
	for ch := c.FirstChild; ch != nil; ch = ch.NextSibling {
		if isBlockElement(ch) {
			flush(ch)
			b.block(ch, part, rs, sb)
			continue
		}
		if pending == nil && !(ch.Type == html.TextNode && strings.TrimSpace(ch.Data) == "") {
			pending = ch
		}
	}
	flush(nil)
}

/* ---------------- paragraphs and runs ---------------- */

type runBuf struct {
	sb  strings.Builder
	any bool
}

// paragraph writes the inline nodes from first up to (not including) stop
func (b *docxBuilder) paragraph(first, stop *html.Node, pp pProps, rs wRunStyle, part *docxPart, sb *strings.Builder) {
	rb := &runBuf{}
	for n := first; n != nil && n != stop; n = n.NextSibling {
		b.inline(n, rs, part, rb)
	}
	runs := rb.sb.String()
	// a line break that ends a block opens no line in HTML
	if strings.HasSuffix(runs, "<w:br/></w:r>") {
		if at := strings.LastIndex(runs, "<w:r>"); at >= 0 {
			runs = runs[:at]
			rb.any = strings.Contains(runs, "<w:t") || strings.Contains(runs, "<w:tab/>") ||
				strings.Contains(runs, "<w:drawing>") || strings.Contains(runs, "<w:br/>") ||
				strings.Contains(runs, "footnoteReference") || strings.Contains(runs, "fldSimple")
		}
	}
	if pp.numID == 0 && (b.containerLeft != 0 || b.containerRight != 0) {
		pp.leftPt += b.containerLeft
		pp.rightPt += b.containerRight
		pp.hasInd = true
	}
	pp.mark = rs.rPr()
	sb.WriteString("<w:p>")
	sb.WriteString(pp.xml())
	if pp.bookmark != "" {
		b.bookmarkN++
		sb.WriteString(fmt.Sprintf(`<w:bookmarkStart w:id="%d" w:name="%s"/><w:bookmarkEnd w:id="%d"/>`,
			b.bookmarkN, xmlEscape(pp.bookmark), b.bookmarkN))
	}
	sb.WriteString(runs)
	if !rb.any {
		// the paragraph mark carries the size an empty line is laid out in
		sb.WriteString(`<w:r>` + rs.rPr() + `</w:r>`)
	}
	sb.WriteString("</w:p>")
}

var wsRun = regexp.MustCompile(`[ \t\r\n\f]+`)

func (b *docxBuilder) textRuns(text string, rs wRunStyle, rb *runBuf) {
	text = strings.ReplaceAll(text, "\u00a0", " ")
	if !rs.preWrap {
		text = wsRun.ReplaceAllString(text, " ")
	}
	if text == "" {
		return
	}
	rpr := rs.rPr()
	var cur strings.Builder
	flush := func() {
		if cur.Len() == 0 {
			return
		}
		rb.sb.WriteString(`<w:r>` + rpr + `<w:t xml:space="preserve">` + xmlEscape(cur.String()) + `</w:t></w:r>`)
		cur.Reset()
		rb.any = true
	}
	for _, r := range text {
		switch {
		case r == '\t':
			flush()
			rb.sb.WriteString(`<w:r>` + rpr + `<w:tab/></w:r>`)
			rb.any = true
		case r == '\n' && rs.preWrap:
			flush()
			rb.sb.WriteString(`<w:r>` + rpr + `<w:br/></w:r>`)
			rb.any = true
		case r == '\u200b':
		default:
			cur.WriteRune(r)
		}
	}
	flush()
}

// inline writes one inline node (and its subtree) as runs
func (b *docxBuilder) inline(n *html.Node, rs wRunStyle, part *docxPart, rb *runBuf) {
	if n.Type == html.TextNode {
		b.textRuns(n.Data, rs, rb)
		return
	}
	if n.Type != html.ElementNode {
		return
	}
	switch n.Data {
	case "br":
		rb.sb.WriteString(`<w:r>` + rs.rPr() + `<w:br/></w:r>`)
		rb.any = true
		return
	case "img":
		if x := b.image(n, part); x != "" {
			rb.sb.WriteString(x)
			rb.any = true
		}
		return
	case "script", "style":
		return
	}
	if hasClass(n, "doc-autobreak") {
		return
	}
	if hasClass(n, "doc-tab") {
		rb.sb.WriteString(`<w:r>` + rs.rPr() + `<w:tab/></w:r>`)
		rb.any = true
		return
	}
	if n.Data == "sup" && hasClass(n, "doc-fnref") {
		id := htmlAttr(n, "data-fn")
		num, ok := b.fnIDs[id]
		if !ok {
			num = len(b.fnOrder) + 1
			b.fnIDs[id] = num
			b.fnOrder = append(b.fnOrder, id)
		}
		rb.sb.WriteString(fmt.Sprintf(`<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/><w:vertAlign w:val="superscript"/></w:rPr><w:footnoteReference w:id="%d"/></w:r>`, num))
		rb.any = true
		return
	}
	if hasClass(n, "doc-field") {
		field := strings.ToUpper(htmlAttr(n, "data-field"))
		if field == "PAGE" || field == "NUMPAGES" {
			inner := &runBuf{}
			for c := n.FirstChild; c != nil; c = c.NextSibling {
				b.inline(c, rs, part, inner)
			}
			if !inner.any {
				inner.sb.WriteString(`<w:r>` + rs.rPr() + `<w:t>1</w:t></w:r>`)
			}
			rb.sb.WriteString(`<w:fldSimple w:instr=" ` + field + ` ">` + inner.sb.String() + `</w:fldSimple>`)
			rb.any = true
			return
		}
	}

	if b.reviewInline(n, rs, part, rb) {
		return
	}

	crs := rs
	switch n.Data {
	case "b", "strong":
		crs.bold = true
	case "i", "em":
		crs.italic = true
	case "u", "ins":
		crs.underline = true
	case "s", "strike", "del":
		crs.strike = true
	case "code", "tt", "kbd", "samp":
		crs.font = "Consolas"
	case "sup":
		crs.vert = "superscript"
	case "sub":
		crs.vert = "subscript"
	case "font":
		if c := cssColorHex(htmlAttr(n, "color")); c != "" {
			crs.color = c
		}
		if f := htmlAttr(n, "face"); f != "" {
			crs.font = firstFontFamily(f)
		}
	case "a":
		// the editor underlines and colours links unless the link says
		// "inherit" (an imported link whose runs carry their own look)
		css := cssDecls(htmlAttr(n, "style"))
		if css["color"] != "inherit" {
			crs.color = "1A58C2"
		}
		if !strings.Contains(css["text-decoration"], "inherit") && css["text-decoration"] != "none" {
			crs.underline = true
		}
	}
	crs = crs.applyCSS(cssDecls(htmlAttr(n, "style")))

	if n.Data == "a" {
		href := htmlAttr(n, "href")
		inner := &runBuf{}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			b.inline(c, crs, part, inner)
		}
		if !inner.any {
			return
		}
		switch {
		case strings.HasPrefix(href, "#") && len(href) > 1:
			rb.sb.WriteString(`<w:hyperlink w:anchor="` + xmlEscape(href[1:]) + `">` + inner.sb.String() + `</w:hyperlink>`)
		case href != "" && !strings.HasPrefix(strings.ToLower(strings.TrimSpace(href)), "javascript:"):
			rid := part.add(relHyperlink, href, true)
			rb.sb.WriteString(`<w:hyperlink r:id="` + rid + `">` + inner.sb.String() + `</w:hyperlink>`)
		default:
			rb.sb.WriteString(inner.sb.String())
		}
		rb.any = true
		return
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if isBlockElement(c) {
			continue // blocks inside inline content are not representable in a run
		}
		b.inline(c, crs, part, rb)
	}
}

/* ---------------- pictures ---------------- */

var insetRe = regexp.MustCompile(`inset\(\s*([-\d.]+)%?\s*([-\d.]+)?%?\s*([-\d.]+)?%?\s*([-\d.]+)?%?\s*\)`)

func (b *docxBuilder) image(n *html.Node, part *docxPart) string {
	// data-export-src: the PNG the editor rendered for a picture Word cannot
	// take as it is (an SVG chart, a WebP); src stays the original
	src := htmlAttr(n, "data-export-src")
	if src == "" {
		src = htmlAttr(n, "src")
	}
	data, ext, ok := imageSrcBytes(src, b.readVpath)
	if !ok {
		return "" // a picture that cannot be read or embedded is skipped
	}
	// the same picture twice is one media part
	sum := sha256.Sum256(data)
	idx, seen := b.mediaByHash[sum]
	if !seen {
		b.imgCount++
		idx = b.imgCount
		b.mediaByHash[sum] = idx
		b.media = append(b.media, mediaEntry{index: idx, ext: ext, data: data})
	}
	rid := part.add(relImage, fmt.Sprintf("media/image%d.%s", idx, ext), false)

	css := cssDecls(htmlAttr(n, "style"))
	natW, natH := 0.0, 0.0
	if cfg, _, err := image.DecodeConfig(bytes.NewReader(data)); err == nil {
		natW, natH = float64(cfg.Width), float64(cfg.Height)
	}
	dim := func(name string) float64 {
		if v, ok := css[name]; ok {
			if pt, ok := cssPt(v, 11); ok && pt > 0 {
				return pt
			}
		}
		if a := htmlAttr(n, name); a != "" {
			if pt, ok := cssPt(a, 11); ok && pt > 0 {
				return pt
			}
		}
		return 0
	}
	wPt, hPt := dim("width"), dim("height")
	fixedH := hPt > 0
	switch {
	case wPt > 0 && hPt <= 0:
		if natW > 0 && natH > 0 {
			hPt = wPt * natH / natW
		} else {
			hPt = wPt * 3 / 4
		}
	case hPt > 0 && wPt <= 0:
		if natW > 0 && natH > 0 {
			wPt = hPt * natW / natH
		} else {
			wPt = hPt * 4 / 3
		}
	case wPt <= 0 && hPt <= 0:
		if natW > 0 && natH > 0 {
			wPt, hPt = natW*0.75, natH*0.75
		} else {
			wPt, hPt = 300, 225
		}
	}
	anchor := hasClass(n, "doc-anchor")
	// an inline picture cannot be wider than the text column (the editor's
	// max-width: 100%) - a stated height stays as the editor shows it, an
	// automatic one scales along; an anchored picture may bleed past
	if !anchor && b.textWPt > 0 && wPt > b.textWPt+0.5 {
		if !fixedH {
			hPt = hPt * b.textWPt / wPt
		}
		wPt = b.textWPt
	}
	cx, cy := int64(math.Round(wPt*12700)), int64(math.Round(hPt*12700))

	crop := ""
	if m := insetRe.FindStringSubmatch(css["object-view-box"]); m != nil {
		vals := []string{m[1], m[2], m[3], m[4]}
		fl := make([]float64, 4)
		for i, v := range vals {
			if v == "" {
				v = vals[0]
				if i == 3 && m[2] != "" {
					v = m[2]
				}
			}
			fl[i], _ = strconv.ParseFloat(v, 64)
		}
		crop = fmt.Sprintf(`<a:srcRect t="%d" r="%d" b="%d" l="%d"/>`,
			int(math.Round(fl[0]*1000)), int(math.Round(fl[1]*1000)), int(math.Round(fl[2]*1000)), int(math.Round(fl[3]*1000)))
	}
	line := `<a:ln><a:noFill/></a:ln>`
	borderPt := 0.0
	if v, ok := css["border"]; ok {
		if bd, ok := cssBorder(v); ok && bd.val != "nil" {
			borderPt = float64(bd.sz) / 8
			line = fmt.Sprintf(`<a:ln w="%d"><a:solidFill><a:srgbClr val="%s"/></a:solidFill><a:prstDash val="solid"/></a:ln>`,
				int64(borderPt*12700), bd.color)
		}
	}
	// the outline and the sideways margin (Google Docs sets pictures 1.5pt
	// apart) ride on the effect extent, which Word lays out around the frame
	mlPt, _ := cssPt(css["margin-left"], 11)
	mrPt, _ := cssPt(css["margin-right"], 11)
	if anchor {
		mlPt, mrPt = 0, 0
	}
	eff := fmt.Sprintf(`<wp:effectExtent l="%d" t="%d" r="%d" b="%d"/>`,
		int64((borderPt+mlPt)*12700), int64(borderPt*12700), int64((borderPt+mrPt)*12700), int64(borderPt*12700))
	b.docPrID++
	alt := xmlEscape(htmlAttr(n, "alt"))
	graphic := fmt.Sprintf(`<wp:docPr id="%d" name="Picture %d" descr="%s"/>`+
		`<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>`+
		`<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture">`+
		`<pic:pic><pic:nvPicPr><pic:cNvPr id="%d" name="Picture %d"/><pic:cNvPicPr/></pic:nvPicPr>`+
		`<pic:blipFill><a:blip r:embed="%s"/>%s<a:stretch><a:fillRect/></a:stretch></pic:blipFill>`+
		`<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="%d" cy="%d"/></a:xfrm>`+
		`<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>%s</pic:spPr></pic:pic>`+
		`</a:graphicData></a:graphic>`,
		b.docPrID, b.docPrID, alt, b.docPrID, b.docPrID, rid, crop, cx, cy, line)

	if anchor {
		xPt, _ := cssPt(css["margin-left"], 11)
		yPt, _ := cssPt(css["margin-top"], 11)
		wrap := `<wp:wrapTopAndBottom/>`
		posH := fmt.Sprintf(`<wp:positionH relativeFrom="column"><wp:posOffset>%d</wp:posOffset></wp:positionH>`, int64(math.Round(xPt*12700)))
		if fl := css["float"]; fl == "left" || fl == "right" {
			wrap = `<wp:wrapSquare wrapText="bothSides"/>`
			if fl == "right" {
				posH = `<wp:positionH relativeFrom="column"><wp:align>right</wp:align></wp:positionH>`
			}
		}
		return fmt.Sprintf(`<w:r><w:drawing><wp:anchor distT="0" distB="0" distL="0" distR="0" simplePos="0" relativeHeight="%d" behindDoc="0" locked="0" layoutInCell="1" allowOverlap="1">`+
			`<wp:simplePos x="0" y="0"/>%s<wp:positionV relativeFrom="paragraph"><wp:posOffset>%d</wp:posOffset></wp:positionV>`+
			`<wp:extent cx="%d" cy="%d"/>%s%s%s</wp:anchor></w:drawing></w:r>`,
			b.docPrID, posH, int64(math.Round(yPt*12700)), cx, cy, eff, wrap, graphic)
	}
	return fmt.Sprintf(`<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="%d" cy="%d"/>%s%s</wp:inline></w:drawing></w:r>`,
		cx, cy, eff, graphic)
}

/* ---------------- lists ---------------- */

// list writes an ol/ul (depth = nesting level, leftPt = the indent its
// parent list's text starts at)
func (b *docxBuilder) list(l *html.Node, part *docxPart, rs wRunStyle, sb *strings.Builder, depth int, leftPt float64, key string) {
	if depth > 8 {
		depth = 8
	}
	css := cssDecls(htmlAttr(l, "style"))
	pad := 36.0
	if v, ok := css["padding-left"]; ok {
		if pt, ok := cssPt(v, rs.sizePt); ok {
			pad = pt
		}
	}
	hang := 18.0
	if v, ok := css["--doc-hang"]; ok {
		if pt, ok := cssPt(v, rs.sizePt); ok {
			hang = pt
		}
	}
	left := leftPt + pad
	lrs := rs.applyBlockCSS(css)
	if depth == 0 {
		key = htmlAttr(l, "data-num")
		if key != "" {
			key = "num:" + key
		}
	}
	inst := b.num.instance(key)
	if depth == 0 && key == "" {
		// a list without an id is its own list: key it by its instance
		key = fmt.Sprintf("inst:%d", inst.id)
		b.num.byKey[key] = inst
	}
	if !inst.levels[depth].set {
		d := defaultNumLevel(l.Data == "ul", depth)
		if f := htmlAttr(l, "data-fmt"); f != "" {
			d.fmt = f
			if f == "bullet" && l.Data == "ol" {
				d.text = defaultBullets[depth%3]
			}
			if f != "bullet" && l.Data == "ul" {
				d.text = "%" + strconv.Itoa(depth+1) + "."
			}
		}
		if t, ok := attrPresent(l, "data-lvltext"); ok {
			d.text = t
		}
		if s, err := strconv.Atoi(htmlAttr(l, "start")); err == nil {
			d.start = s
		}
		if hasClass(l, "of-checklist") {
			d.fmt, d.text = "bullet", "\u2610"
		}
		d.leftPt, d.hangPt = left, hang
		inst.levels[depth] = d
	}
	for c := l.FirstChild; c != nil; c = c.NextSibling {
		if c.Type != html.ElementNode {
			continue
		}
		switch c.Data {
		case "li":
			b.listItem(c, part, lrs, sb, inst, depth, left, hang, key)
		case "ul", "ol":
			b.list(c, part, lrs, sb, depth+1, left, key)
		default:
			if isBlockElement(c) {
				b.block(c, part, lrs, sb)
			}
		}
	}
}

func attrPresent(n *html.Node, name string) (string, bool) {
	for _, a := range n.Attr {
		if a.Key == name {
			return a.Val, true
		}
	}
	return "", false
}

func (b *docxBuilder) listItem(li *html.Node, part *docxPart, rs wRunStyle, sb *strings.Builder, inst *numInstance, depth int, left, hang float64, key string) {
	pp, prs := b.blockStyleOf(li, rs)
	pp.numID, pp.ilvl = inst.id, depth
	pp.leftPt, pp.firstPt, pp.hasInd = left, -hang, true
	numbered := false
	var pending *html.Node
	flush := func(stop *html.Node) {
		if pending == nil {
			return
		}
		ip := pp
		if numbered {
			// a later paragraph of the same item: aligned, not numbered
			ip.numID = 0
			ip.firstPt = 0
		}
		b.paragraph(pending, stop, ip, prs, part, sb)
		numbered = true
		pending = nil
	}
	for c := li.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.ElementNode && (c.Data == "ul" || c.Data == "ol") {
			flush(c)
			if !numbered {
				b.paragraph(nil, nil, pp, prs, part, sb)
				numbered = true
			}
			b.list(c, part, prs, sb, depth+1, left, key)
			continue
		}
		if isBlockElement(c) {
			flush(c)
			cpp, crs := b.blockStyleOf(c, prs)
			if !numbered {
				cpp.numID, cpp.ilvl = inst.id, depth
				cpp.firstPt = -hang
				numbered = true
			}
			cpp.leftPt, cpp.hasInd = left, true
			b.paragraph(c.FirstChild, nil, cpp, crs, part, sb)
			continue
		}
		if pending == nil && !(c.Type == html.TextNode && strings.TrimSpace(c.Data) == "" && c.NextSibling != nil) {
			pending = c
		}
	}
	flush(nil)
	if !numbered {
		b.paragraph(nil, nil, pp, prs, part, sb)
	}
}

/* ---------------- tables ---------------- */

type tcell struct {
	node            *html.Node
	col, span, rows int
}

func (b *docxBuilder) table(t *html.Node, part *docxPart, rs wRunStyle, sb *strings.Builder) {
	css := cssDecls(htmlAttr(t, "style"))
	rs = rs.applyBlockCSS(css)

	// rows (thead/tbody/tfoot flattened), skipping layout spacers
	var rows []*html.Node
	var collect func(n *html.Node)
	collect = func(n *html.Node) {
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if c.Type != html.ElementNode {
				continue
			}
			switch c.Data {
			case "thead", "tbody", "tfoot":
				collect(c)
			case "tr":
				if !hasClass(c, "doc-autobreak") {
					rows = append(rows, c)
				}
			}
		}
	}
	collect(t)
	if len(rows) == 0 {
		return
	}

	// lay the cells out on the grid (rowspans occupy the rows below)
	occupied := map[[2]int]bool{}
	grid := make([][]tcell, len(rows))
	nCols := 0
	for r, tr := range rows {
		col := 0
		for td := tr.FirstChild; td != nil; td = td.NextSibling {
			if td.Type != html.ElementNode || (td.Data != "td" && td.Data != "th") {
				continue
			}
			for occupied[[2]int{r, col}] {
				col++
			}
			span, _ := strconv.Atoi(htmlAttr(td, "colspan"))
			if span < 1 {
				span = 1
			}
			rspan, _ := strconv.Atoi(htmlAttr(td, "rowspan"))
			if rspan < 1 {
				rspan = 1
			}
			if r+rspan > len(rows) {
				rspan = len(rows) - r
			}
			grid[r] = append(grid[r], tcell{node: td, col: col, span: span, rows: rspan})
			for rr := r; rr < r+rspan; rr++ {
				for cc := col; cc < col+span; cc++ {
					occupied[[2]int{rr, cc}] = true
				}
			}
			col += span
		}
		for occupied[[2]int{r, col}] {
			col++
		}
		if col > nCols {
			nCols = col
		}
	}
	if nCols == 0 {
		nCols = 1
	}

	// widths: the table's own, then the colgroup's columns
	tblW := b.textWPt
	if v, ok := css["width"]; ok {
		if strings.HasSuffix(v, "%") {
			if p, err := strconv.ParseFloat(strings.TrimSuffix(v, "%"), 64); err == nil && p > 0 {
				tblW = b.textWPt * math.Min(p, 100) / 100
			}
		} else if pt, ok := cssPt(v, rs.sizePt); ok && pt > 10 {
			tblW = pt
		}
	}
	colW := make([]float64, nCols)
	got := 0
	sum := 0.0
	pctCols := false
	for cg := t.FirstChild; cg != nil; cg = cg.NextSibling {
		if cg.Type != html.ElementNode || cg.Data != "colgroup" {
			continue
		}
		for col := cg.FirstChild; col != nil && got < nCols; col = col.NextSibling {
			if col.Type != html.ElementNode || col.Data != "col" {
				continue
			}
			w := styleProp(htmlAttr(col, "style"), "width")
			if strings.HasSuffix(w, "%") {
				if p, err := strconv.ParseFloat(strings.TrimSuffix(w, "%"), 64); err == nil {
					colW[got] = p
					pctCols = true
				}
			} else if pt, ok := cssPt(w, 11); ok {
				colW[got] = pt
			}
			sum += colW[got]
			got++
		}
	}
	if got == nCols && sum > 0 {
		if pctCols || math.Abs(sum-tblW) > 1 && css["width"] == "" {
			if !pctCols {
				tblW = sum
			}
			for i := range colW {
				colW[i] = colW[i] * tblW / sum
			}
		} else if math.Abs(sum-tblW) > 1 {
			for i := range colW {
				colW[i] = colW[i] * tblW / sum
			}
		}
	} else {
		for i := range colW {
			colW[i] = tblW / float64(nCols)
		}
	}

	var tp strings.Builder
	// a table made in the editor (not an imported one) is marked: it has
	// docs.css's spacing above and below, which a Word table cannot carry
	tblStyle := "TableGrid"
	if htmlAttr(t, "data-docx") == "" {
		tblStyle = editorTableStyle
	}
	tp.WriteString(`<w:tbl><w:tblPr><w:tblStyle w:val="` + tblStyle + `"/>`)
	tp.WriteString(fmt.Sprintf(`<w:tblW w:w="%d" w:type="dxa"/>`, twip(tblW)))
	switch {
	case css["margin-left"] == "auto" && css["margin-right"] == "auto":
		tp.WriteString(`<w:jc w:val="center"/>`)
	case css["margin-left"] == "auto":
		tp.WriteString(`<w:jc w:val="right"/>`)
	default:
		pt, _ := cssPt(css["margin-left"], 11)
		if pt += b.containerLeft; pt != 0 {
			tp.WriteString(fmt.Sprintf(`<w:tblInd w:w="%d" w:type="dxa"/>`, twip(pt)))
		}
	}
	tp.WriteString(`<w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="0" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="0" w:type="dxa"/></w:tblCellMar>`)
	tp.WriteString(`<w:tblLook w:val="0600"/></w:tblPr><w:tblGrid>`)
	for _, w := range colW {
		tp.WriteString(fmt.Sprintf(`<w:gridCol w:w="%d"/>`, twip(w)))
	}
	tp.WriteString(`</w:tblGrid>`)
	sb.WriteString(tp.String())

	// cells continuing a rowspan from above, per row and grid column
	cont := map[[2]int]tcell{}
	for r := range grid {
		for _, c := range grid[r] {
			for rr := r + 1; rr < r+c.rows; rr++ {
				cont[[2]int{rr, c.col}] = c
			}
		}
	}
	for r, tr := range rows {
		trCSS := cssDecls(htmlAttr(tr, "style"))
		sb.WriteString("<w:tr><w:trPr>")
		if htmlAttr(tr, "data-cant-split") == "1" {
			sb.WriteString(`<w:cantSplit/>`)
		}
		if pt, ok := cssPt(trCSS["height"], 11); ok && pt > 0 {
			rule := "atLeast"
			if htmlAttr(tr, "data-exact") == "1" {
				rule = "exact"
			}
			sb.WriteString(fmt.Sprintf(`<w:trHeight w:val="%d" w:hRule="%s"/>`, twip(pt), rule))
		}
		if htmlAttr(tr, "data-header-row") == "1" {
			sb.WriteString(`<w:tblHeader/>`)
		}
		sb.WriteString("</w:trPr>")
		cells := grid[r]
		ci := 0
		for col := 0; col < nCols; {
			if c, ok := cont[[2]int{r, col}]; ok {
				b.cell(c, part, rs, sb, colW, "continue")
				col += c.span
				continue
			}
			if ci < len(cells) && cells[ci].col == col {
				c := cells[ci]
				ci++
				merge := ""
				if c.rows > 1 {
					merge = "restart"
				}
				b.cell(c, part, rs, sb, colW, merge)
				col += c.span
				continue
			}
			// a ragged row: pad with an empty cell so the grid stays whole
			sb.WriteString(fmt.Sprintf(`<w:tc><w:tcPr><w:tcW w:w="%d" w:type="dxa"/></w:tcPr><w:p/></w:tc>`, twip(colW[col])))
			col++
		}
		sb.WriteString("</w:tr>")
	}
	sb.WriteString("</w:tbl>")
}

func (b *docxBuilder) cell(c tcell, part *docxPart, rs wRunStyle, sb *strings.Builder, colW []float64, merge string) {
	td := c.node
	css := cssDecls(htmlAttr(td, "style"))
	w := 0.0
	for i := c.col; i < c.col+c.span && i < len(colW); i++ {
		w += colW[i]
	}
	var tp strings.Builder
	tp.WriteString(fmt.Sprintf(`<w:tcPr><w:tcW w:w="%d" w:type="dxa"/>`, twip(w)))
	if c.span > 1 {
		tp.WriteString(fmt.Sprintf(`<w:gridSpan w:val="%d"/>`, c.span))
	}
	if merge == "restart" {
		tp.WriteString(`<w:vMerge w:val="restart"/>`)
	} else if merge == "continue" {
		tp.WriteString(`<w:vMerge/>`)
	}
	// borders: the cell's own, else the editor's default grid
	def := wBorder{val: "single", sz: 6, color: "B9BEC7"}
	borders := map[string]wBorder{"top": def, "left": def, "bottom": def, "right": def}
	if v, ok := css["border"]; ok {
		if bd, ok := cssBorder(v); ok {
			borders = map[string]wBorder{"top": bd, "left": bd, "bottom": bd, "right": bd}
		}
	}
	for _, side := range []string{"top", "right", "bottom", "left"} {
		if v, ok := css["border-"+side]; ok {
			if bd, ok := cssBorder(v); ok {
				borders[side] = bd
			}
		}
	}
	tp.WriteString("<w:tcBorders>")
	for _, side := range []string{"top", "left", "bottom", "right"} {
		bd := borders[side]
		if bd.val == "nil" {
			tp.WriteString(`<w:` + side + ` w:val="nil"/>`)
		} else {
			tp.WriteString(fmt.Sprintf(`<w:%s w:val="%s" w:sz="%d" w:space="0" w:color="%s"/>`, side, bd.val, bd.sz, bd.color))
		}
	}
	tp.WriteString("</w:tcBorders>")
	shade := cssColorHex(css["background-color"])
	if shade == "" && td.Data == "th" {
		shade = "F1F3F4"
	}
	if shade != "" {
		tp.WriteString(`<w:shd w:val="clear" w:color="auto" w:fill="` + shade + `"/>`)
	}
	pad := [4]float64{3, 6, 3, 6} // the editor's 4px 8px
	if v, ok := css["padding"]; ok {
		if s, ok := boxSides(v, 11); ok {
			pad = s
		}
	}
	for i, side := range []string{"top", "right", "bottom", "left"} {
		if pt, ok := cssPt(css["padding-"+side], 11); ok {
			pad[i] = pt
		}
	}
	tp.WriteString(fmt.Sprintf(`<w:tcMar><w:top w:w="%d" w:type="dxa"/><w:left w:w="%d" w:type="dxa"/><w:bottom w:w="%d" w:type="dxa"/><w:right w:w="%d" w:type="dxa"/></w:tcMar>`,
		twip(pad[0]), twip(pad[3]), twip(pad[2]), twip(pad[1])))
	switch css["vertical-align"] {
	case "middle":
		tp.WriteString(`<w:vAlign w:val="center"/>`)
	case "bottom":
		tp.WriteString(`<w:vAlign w:val="bottom"/>`)
	default:
		tp.WriteString(`<w:vAlign w:val="top"/>`)
	}
	tp.WriteString("</w:tcPr>")
	sb.WriteString("<w:tc>" + tp.String())
	if merge == "continue" {
		sb.WriteString("<w:p/></w:tc>")
		return
	}
	crs := rs.applyBlockCSS(css)
	if td.Data == "th" {
		crs.bold = true
		if _, ok := css["text-align"]; !ok {
			css["text-align"] = "center" // the browser's th default
		}
	}
	var inner strings.Builder
	if hasBlockChild(td) {
		b.containerWithStyle(td, part, pProps{jc: jcOf(css)}, crs, &inner)
	} else {
		b.paragraph(td.FirstChild, nil, pProps{jc: jcOf(css)}, crs, part, &inner)
	}
	x := inner.String()
	if !strings.Contains(x, "<w:p>") && !strings.Contains(x, "<w:p ") {
		x += "<w:p/>"
	}
	// Word needs a cell to end in a paragraph (a nested table cannot be last)
	if strings.HasSuffix(x, "</w:tbl>") {
		x += "<w:p/>"
	}
	sb.WriteString(x + "</w:tc>")
}

func jcOf(css map[string]string) string {
	switch css["text-align"] {
	case "center":
		return "center"
	case "right":
		return "right"
	case "justify":
		return "both"
	}
	return ""
}

/* ---------------- section / styles / settings ---------------- */

// pgGeometry renders the pgSz + pgMar pair for a page config
func pgGeometry(pc *PageConf) string {
	size := "A4"
	orient := "portrait"
	mT, mR, mB, mL := 25.4, 25.4, 25.4, 25.4
	hd, fd := 12.7, 12.7
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
		if pc.HeaderDist != nil {
			hd = *pc.HeaderDist
		}
		if pc.FooterDist != nil {
			fd = *pc.FooterDist
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
		`<w:pgMar w:top="%d" w:right="%d" w:bottom="%d" w:left="%d" w:header="%d" w:footer="%d" w:gutter="0"/>`,
		w, h, orientAttr,
		mmToTwips(mT), mmToTwips(mR), mmToTwips(mB), mmToTwips(mL), mmToTwips(hd), mmToTwips(fd))
}

func buildSectPr(pc *PageConf, headerRef, footerRef string, continuous, titlePg bool) string {
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
	first := ""
	if titlePg {
		// "different first page" with no first-page reference: Word leaves
		// page 1's header and footer empty
		first = `<w:titlePg/>`
	}
	return `<w:sectPr>` + headerRef + footerRef + typ + pgGeometry(pc) + cols +
		first + `</w:sectPr>`
}

// docxStylesXML pins the editor's typography - Word substitutes its own
// Normal defaults (Calibri, 8pt after) for anything left unstated, and that
// substitution is exactly what makes a document's pages break somewhere
// else than in the editor. Spacing units: half-points for sz, twentieths of
// a point for spacing, 240ths of a line for w:line.
func docxStylesXML(doc *Document) string {
	ls := 1.15
	if doc != nil && doc.LineSpacing > 0 {
		ls = doc.LineSpacing
	}
	line := int(math.Round(ls * 240))
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	sb.WriteString(`<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">`)
	sb.WriteString(`<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Arial" w:hAnsi="Arial" w:cs="Arial" w:eastAsia="Arial"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault>`)
	sb.WriteString(fmt.Sprintf(`<w:pPrDefault><w:pPr><w:widowControl/><w:spacing w:before="0" w:after="0" w:line="%d" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`, line))
	sb.WriteString(`<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`)
	sb.WriteString(`<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:tblPr><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>`)
	sb.WriteString(`<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/></w:style>`)
	sb.WriteString(`<w:style w:type="table" w:customStyle="1" w:styleId="` + editorTableStyle + `"><w:name w:val="Editor Table"/><w:basedOn w:val="TableNormal"/></w:style>`)
	names := []struct{ key, name string }{
		{"h1", "heading 1"}, {"h2", "heading 2"}, {"h3", "heading 3"},
		{"h4", "heading 4"}, {"h5", "heading 5"}, {"h6", "heading 6"},
		{"doc-title", "Title"}, {"doc-subtitle", "Subtitle"},
	}
	for _, n := range names {
		d := editorBlockDefaults[n.key]
		rpr := fmt.Sprintf(`<w:color w:val="%s"/><w:sz w:val="%d"/><w:szCs w:val="%d"/>`, d.color, int(d.sizePt*2), int(d.sizePt*2))
		if d.bold {
			rpr = `<w:b/><w:bCs/>` + rpr
		}
		if d.italic {
			rpr = `<w:i/><w:iCs/>` + rpr
		}
		keep := ""
		if strings.HasPrefix(n.key, "h") {
			keep = `<w:keepNext/><w:keepLines/>`
		}
		sb.WriteString(fmt.Sprintf(`<w:style w:type="paragraph" w:styleId="%s"><w:name w:val="%s"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>`+
			`<w:pPr>%s<w:spacing w:before="%d" w:after="%d"/></w:pPr><w:rPr>%s</w:rPr></w:style>`,
			d.style, n.name, keep, twip(d.beforePt), twip(d.afterPt), rpr))
	}
	sb.WriteString(`<w:style w:type="paragraph" w:customStyle="1" w:styleId="` + autoRuleStyle + `"><w:name w:val="Horizontal Rule"/></w:style>`)
	sb.WriteString(`<w:style w:type="paragraph" w:customStyle="1" w:styleId="` + autoPageNumberStyle + `"><w:name w:val="Page Number Line"/><w:pPr><w:jc w:val="center"/></w:pPr></w:style>`)
	sb.WriteString(`<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style>`)
	sb.WriteString(`<w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="1A58C2"/><w:u w:val="single"/></w:rPr></w:style>`)
	sb.WriteString(`</w:styles>`)
	return sb.String()
}

const docxSettings = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/><w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>`
