package doc

/*
	emit.go - paragraphs and runs as WordprocessingML.

	Special characters become elements: 0x09 a tab, 0x0B a line break,
	0x0C a page break, 0x0E a column break, 0x1E / 0x1F hyphens, 0x01 a
	picture, 0x08 a floating object, 0x02 a note reference, 0x05 a comment
	reference, 0x28 with sprmCSymbol a symbol. Fields are delimited by
	0x13 (begin), 0x14 (separator) and 0x15 (end): the instruction between
	the first two, the last result between the other two (LibreOffice:
	ww8par5.cxx). A HYPERLINK field inside one paragraph is written as a
	w:hyperlink, which is what readers follow; every other field keeps
	its instruction and shows its stored result.
*/

import (
	"strings"
	"unicode/utf16"

	"imuslab.com/arozos/mod/office/internal/xmltree"
)

type storyKind int

const (
	storyMain storyKind = iota
	storyFootnote
	storyEndnote
	storyHeader
	storyComment
	storyTextbox
)

// field is a field of a story, found by a pre-scan
type field struct {
	begin, sep, end int // sep = -1 without a result
	instr           string
	link            string // a HYPERLINK's target ("#bookmark" for \l)
}

// scanFields finds every field of [cp1, cp2), nested ones included
func (d *docFile) scanFields(cp1, cp2 int) map[int]*field {
	out := map[int]*field{}
	var stack []*field
	for cp := cp1; cp < cp2; cp++ {
		switch d.text[cp] {
		case 0x13:
			f := &field{begin: cp, sep: -1, end: -1}
			stack = append(stack, f)
		case 0x14:
			if n := len(stack); n > 0 && stack[n-1].sep < 0 {
				stack[n-1].sep = cp
			}
		case 0x15:
			if n := len(stack); n > 0 {
				f := stack[n-1]
				stack = stack[:n-1]
				f.end = cp
				out[f.begin] = f
			}
		}
	}
	for _, f := range out {
		iEnd := f.end
		if f.sep >= 0 {
			iEnd = f.sep
		}
		// the instruction, without nested fields' text
		var u []uint16
		depth := 0
		for cp := f.begin + 1; cp < iEnd; cp++ {
			switch c := d.text[cp]; c {
			case 0x13:
				depth++
			case 0x15:
				depth--
			default:
				if depth == 0 && c >= 0x20 {
					u = append(u, c)
				}
			}
		}
		f.instr = strings.TrimSpace(string(utf16.Decode(u)))
		f.link = hyperlinkTarget(f.instr)
	}
	return out
}

// hyperlinkTarget reads HYPERLINK "url" [\l "bookmark"]
func hyperlinkTarget(instr string) string {
	fs := splitInstr(instr)
	if len(fs) == 0 || !strings.EqualFold(fs[0], "HYPERLINK") {
		return ""
	}
	url, anchor := "", ""
	for i := 1; i < len(fs); i++ {
		switch strings.ToLower(fs[i]) {
		case `\l`:
			if i+1 < len(fs) {
				anchor = fs[i+1]
				i++
			}
		case `\o`, `\t`:
			i++
		case `\m`, `\n`, `\h`:
		default:
			if url == "" && !strings.HasPrefix(fs[i], `\`) {
				url = fs[i]
			}
		}
	}
	if url == "" && anchor != "" {
		return "#" + anchor
	}
	if anchor != "" {
		return url + "#" + anchor
	}
	return url
}

// splitInstr splits a field instruction into words, quoted ones whole
func splitInstr(s string) []string {
	var out []string
	var cur strings.Builder
	quoted := false
	flush := func() {
		if cur.Len() > 0 {
			out = append(out, cur.String())
			cur.Reset()
		}
	}
	for _, r := range s {
		switch {
		case r == '"':
			if quoted {
				out = append(out, cur.String())
				cur.Reset()
			} else {
				flush()
			}
			quoted = !quoted
		case (r == ' ' || r == '\t') && !quoted:
			flush()
		default:
			cur.WriteRune(r)
		}
	}
	flush()
	return out
}

// partCtx is the part being written: its relationships
type partCtx struct {
	rels *relSet
}

// storyState carries what a story's paragraphs share
type storyState struct {
	kind   storyKind
	part   *partCtx
	fields map[int]*field
	stack  []*fieldRun
	marks  *markers
}

// markers are the range starts and ends a story's text carries:
// bookmarks and comment ranges, each written once
type markers struct {
	starts map[int][]string // CP -> XML to write before the character
	ends   map[int][]string // CP -> XML to write after the character before it
}

func (m *markers) take(set map[int][]string, cp int) string {
	if m == nil {
		return ""
	}
	v := set[cp]
	if len(v) == 0 {
		return ""
	}
	delete(set, cp)
	return strings.Join(v, "")
}

type fieldRun struct {
	f       *field
	inInstr bool
	link    bool // written as w:hyperlink
}

// paraXML writes one paragraph (extraPPr goes into its pPr - a section)
func (w *writer) paraXML(pg *para, st *storyState, extraPPr string) string {
	var body strings.Builder
	var after []string // text boxes anchored in the paragraph
	toggles := w.d.styles.toggles(pg.istd, -1)

	inLink := func() bool {
		for _, fr := range st.stack {
			if fr.link {
				return true
			}
		}
		return false
	}
	for _, r := range pg.runs {
		c := r.c
		styleTog := toggles
		if c.istd >= 0 {
			styleTog = w.d.styles.toggles(pg.istd, c.istd)
		}
		rpr := w.rPrXML(c, styleTog, "")
		var text []uint16
		flush := func() {
			if len(text) == 0 {
				return
			}
			s := xmlText(text)
			text = text[:0]
			instr := false
			if n := len(st.stack); n > 0 && st.stack[n-1].inInstr {
				instr = true
			}
			var el string
			switch {
			case instr:
				el = `<w:instrText xml:space="preserve">` + s + `</w:instrText>`
			case c.rmDel:
				el = `<w:delText xml:space="preserve">` + s + `</w:delText>`
			default:
				el = `<w:t xml:space="preserve">` + s + `</w:t>`
			}
			body.WriteString(w.wrapRev(c, "<w:r>"+rpr+el+"</w:r>"))
		}
		elem := func(inner string) {
			flush()
			body.WriteString(w.wrapRev(c, "<w:r>"+rpr+inner+"</w:r>"))
		}
		hiddenInstr := func() bool {
			// inside a hyperlink's instruction nothing is written
			n := len(st.stack)
			return n > 0 && st.stack[n-1].inInstr && st.stack[n-1].link
		}
		for cp := r.cpStart; cp < r.cpEnd; cp++ {
			if s := st.marks.take(st.marks.starts, cp); s != "" {
				flush()
				body.WriteString(s)
			}
			u := w.d.text[cp]
			switch u {
			case 0x13:
				flush()
				f := st.fields[cp]
				if f == nil {
					continue
				}
				fr := &fieldRun{f: f, inInstr: true}
				if f.link != "" && f.sep >= 0 && f.end < pg.cpEnd && f.begin >= pg.cpStart && !inLink() {
					fr.link = true
				} else {
					body.WriteString(`<w:r>` + rpr + `<w:fldChar w:fldCharType="begin"/></w:r>`)
				}
				st.stack = append(st.stack, fr)
			case 0x14:
				flush()
				if n := len(st.stack); n > 0 {
					fr := st.stack[n-1]
					fr.inInstr = false
					if fr.link {
						body.WriteString(w.hyperlinkOpen(fr.f.link, st.part))
					} else {
						body.WriteString(`<w:r>` + rpr + `<w:fldChar w:fldCharType="separate"/></w:r>`)
					}
				}
			case 0x15:
				flush()
				if n := len(st.stack); n > 0 {
					fr := st.stack[n-1]
					st.stack = st.stack[:n-1]
					if fr.link {
						body.WriteString(`</w:hyperlink>`)
					} else {
						body.WriteString(`<w:r>` + rpr + `<w:fldChar w:fldCharType="end"/></w:r>`)
					}
				}
			default:
				if hiddenInstr() {
					continue
				}
				if n := len(st.stack); n > 0 && st.stack[n-1].inInstr {
					if u >= 0x20 {
						text = append(text, u)
					}
					continue
				}
				switch {
				case u == 0x09:
					elem("<w:tab/>")
				case u == 0x0B:
					elem("<w:br/>")
				case u == 0x0C:
					elem(`<w:br w:type="page"/>`)
				case u == 0x0E:
					elem(`<w:br w:type="column"/>`)
				case u == 0x1E:
					elem("<w:noBreakHyphen/>")
				case u == 0x1F:
					elem("<w:softHyphen/>")
				case u == 0x01 && c.spec:
					if c.picLoc >= 0 {
						if pic := w.d.inlinePicture(c.picLoc); pic != nil {
							elem(w.inlineDrawing(pic, st.part))
						}
					}
				case u == 0x08 && c.spec:
					if fo := w.d.floating(cp); fo != nil {
						if fo.pic != nil {
							elem(w.anchorDrawing(fo, st.part))
						}
						for _, t := range fo.txbx {
							after = append(after, w.textboxXML(t, fo.inHeader, st.part))
						}
					}
				case u == 0x02 && c.spec:
					switch st.kind {
					case storyFootnote:
						elem("<w:footnoteRef/>")
					case storyEndnote:
						elem("<w:endnoteRef/>")
					default:
						if id, ok := w.fnByCP[cp]; ok {
							elem(`<w:footnoteReference w:id="` + itoa(id) + `"/>`)
						} else if id, ok := w.enByCP[cp]; ok {
							elem(`<w:endnoteReference w:id="` + itoa(id) + `"/>`)
						}
					}
				case u == 0x05 && c.spec:
					if st.kind == storyComment {
						elem("<w:annotationRef/>")
					} else if id, ok := w.cmByCP[cp]; ok {
						elem(`<w:commentReference w:id="` + itoa(id) + `"/>`)
					}
				case c.symChr != 0 && (c.spec || u == 0x28):
					// sprmCSymbol: the character shown is in the sprm, the
					// text holds a placeholder (Word does not always set fSpec)
					fontName := ""
					if c.symFtc >= 0 && c.symFtc < len(w.d.fonts) {
						fontName = w.d.fonts[c.symFtc].name
					}
					elem(`<w:sym w:font="` + xmltree.Escape(fontName) + `" w:char="` + hex4(c.symChr) + `"/>`)
				case u < 0x20:
					// other control characters carry no text
				default:
					text = append(text, u)
				}
			}
			if s := st.marks.take(st.marks.ends, cp+1); s != "" {
				flush()
				body.WriteString(s)
			}
		}
		flush()
	}
	// ranges that start or end at the paragraph mark
	for cp := pg.cpStart; cp <= pg.cpEnd; cp++ {
		if cp >= pg.cpEnd-1 || len(pg.runs) == 0 {
			body.WriteString(st.marks.take(st.marks.starts, cp))
		}
		if cp >= pg.cpEnd-1 {
			body.WriteString(st.marks.take(st.marks.ends, cp))
		}
	}
	// a hyperlink cannot outlive its paragraph
	for _, fr := range st.stack {
		if fr.link {
			body.WriteString(`</w:hyperlink>`)
			fr.link = false
		}
	}
	markRPr := ""
	if pg.mark != nil {
		markRPr = w.rPrXML(pg.mark, toggles, "")
	}
	ppr := w.pPrXML(pg.istd, pg.p, true, markRPr+extraPPr)
	return "<w:p>" + ppr + body.String() + "</w:p>" + strings.Join(after, "")
}

// wrapRev puts a run inside the tracked change it belongs to
func (w *writer) wrapRev(c *chp, r string) string {
	switch {
	case c.rmDel:
		w.revID++
		return `<w:del w:id="` + itoa(w.revID) + `" w:author="` + xmltree.Escape(w.author(c.rmDelAuth)) + `"` + dttm(c.rmDelDate) + `>` + r + `</w:del>`
	case c.rmIns:
		w.revID++
		return `<w:ins w:id="` + itoa(w.revID) + `" w:author="` + xmltree.Escape(w.author(c.rmInsAuthor)) + `"` + dttm(c.rmInsDate) + `>` + r + `</w:ins>`
	}
	return r
}

func (w *writer) author(i int) string {
	if i >= 0 && i < len(w.d.revAuthors) {
		return w.d.revAuthors[i]
	}
	return "Unknown"
}

// dttm renders a DTTM as a w:date attribute
func dttm(v uint32) string {
	if v == 0 {
		return ""
	}
	mint := int(v & 0x3F)
	hr := int(v>>6) & 0x1F
	dom := int(v>>11) & 0x1F
	mon := int(v>>16) & 0x0F
	yr := int(v>>20)&0x1FF + 1900
	if mon < 1 || mon > 12 || dom < 1 || dom > 31 {
		return ""
	}
	p2 := func(n int) string {
		if n < 10 {
			return "0" + itoa(n)
		}
		return itoa(n)
	}
	return ` w:date="` + itoa(yr) + "-" + p2(mon) + "-" + p2(dom) + "T" + p2(hr) + ":" + p2(mint) + `:00Z"`
}

func hex4(v int) string {
	s := strings.ToUpper(strings.TrimLeft(hexRGB(uint32(v)), "0"))
	for len(s) < 4 {
		s = "0" + s
	}
	return s
}

// xmlText escapes characters for a w:t, dropping what XML cannot hold
func xmlText(u []uint16) string {
	s := string(utf16.Decode(u))
	var sb strings.Builder
	for _, r := range s {
		switch {
		case r == '&':
			sb.WriteString("&amp;")
		case r == '<':
			sb.WriteString("&lt;")
		case r == '>':
			sb.WriteString("&gt;")
		case r < 0x20 && r != '\t', r == 0xFFFE, r == 0xFFFF, r >= 0xD800 && r <= 0xDFFF:
		default:
			sb.WriteRune(r)
		}
	}
	return sb.String()
}

// hyperlinkOpen starts a w:hyperlink: external targets by relationship,
// "#bookmark" by anchor
func (w *writer) hyperlinkOpen(target string, part *partCtx) string {
	if strings.HasPrefix(target, "#") {
		return `<w:hyperlink w:anchor="` + xmltree.Escape(target[1:]) + `" w:history="1">`
	}
	id := part.rels.add(relHyperlink, target, true)
	return `<w:hyperlink r:id="` + id + `" w:history="1">`
}
