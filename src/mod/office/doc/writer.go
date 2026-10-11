package doc

/*
	writer.go - assemble the .docx package: document.xml with its sections,
	headers and footers, footnotes, endnotes, comments, styles, numbering,
	settings and the pictures.
*/

import (
	"crypto/sha256"
	"encoding/binary"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/office/internal/opc"
	"imuslab.com/arozos/mod/office/internal/xmltree"
)

const (
	nsW   = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
	nsR   = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
	nsWP  = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"
	nsA   = "http://schemas.openxmlformats.org/drawingml/2006/main"
	nsPic = "http://schemas.openxmlformats.org/drawingml/2006/picture"

	ctDocument  = "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"
	ctStyles    = "application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"
	ctNumbering = "application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"
	ctFootnotes = "application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"
	ctEndnotes  = "application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"
	ctComments  = "application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"
	ctHeader    = "application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"
	ctFooter    = "application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"
	ctSettings  = "application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"

	relHyperlink = opc.RelHyperlink
	relImage     = opc.RelImage
	relNumbering = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering"
	relFootnotes = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes"
	relEndnotes  = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes"
	relComments  = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"
	relHeader    = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/header"
	relFooter    = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer"
	relSettings  = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings"
)

const partNS = `xmlns:w="` + nsW + `" xmlns:r="` + nsR + `" xmlns:wp="` + nsWP + `" xmlns:a="` + nsA + `" xmlns:pic="` + nsPic + `"`

// relSet is a part's relationships, with images shared per target
type relSet struct {
	r      opc.Rels
	byKey  map[string]string
	prefix string // path from the part's folder to word/
}

func newRelSet() *relSet { return &relSet{byKey: map[string]string{}} }

func (rs *relSet) add(typ, target string, external bool) string {
	key := typ + "|" + target
	if id, ok := rs.byKey[key]; ok {
		return id
	}
	id := rs.r.Add(typ, target, external)
	rs.byKey[key] = id
	return id
}

type writer struct {
	d     *docFile
	pkg   *opc.Package
	media map[[32]byte]string // content -> media file name
	docPr int
	revID int

	docRels, fnRels, enRels, cmRels *relSet

	fnByCP                        map[int]int // reference CP -> footnote id
	enByCP                        map[int]int
	cmByCP                        map[int]int
	footnotes, endnotes, comments []string
	bookmarks                     []bookmark

	inTextbox bool // writing a text box story (see textboxXML)
}

func newWriter(d *docFile) *writer {
	return &writer{d: d, pkg: opc.New(), media: map[[32]byte]string{},
		fnByCP: map[int]int{}, enByCP: map[int]int{}, cmByCP: map[int]int{}}
}

// mediaRel stores a picture once in the package and relates it to a part
func (w *writer) mediaRel(data []byte, ext string, part *partCtx) string {
	h := sha256.Sum256(data)
	name, ok := w.media[h]
	if !ok {
		name = "image" + strconv.Itoa(len(w.media)+1) + "." + ext
		w.media[h] = name
		w.pkg.Add("word/media/"+name, "", data)
	}
	return part.rels.add(relImage, "media/"+name, false)
}

func emu(twips int) int { return twips * 635 }

func (w *writer) graphicXML(pic *picture, rid string, cx, cy int) string {
	w.docPr++
	id := itoa(w.docPr)
	src := ""
	if c := pic.crop; c != [4]float64{} {
		pct := func(v float64) string { return itoa(int(v * 100000)) }
		src = `<a:srcRect l="` + pct(c[0]) + `" t="` + pct(c[1]) + `" r="` + pct(c[2]) + `" b="` + pct(c[3]) + `"/>`
	}
	return `<a:graphic><a:graphicData uri="` + nsPic + `"><pic:pic><pic:nvPicPr><pic:cNvPr id="` + id +
		`" name="Picture ` + id + `"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="` + rid + `"/>` + src +
		`<a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="` + itoa(cx) +
		`" cy="` + itoa(cy) + `"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>` + frameXML(pic.frame) +
		`</pic:spPr></pic:pic></a:graphicData></a:graphic>`
}

// frameXML is a picture outline as DrawingML (widths in eighths of a
// point become EMU)
func frameXML(b *brc) string {
	if b == nil {
		return ""
	}
	col := "000000"
	if !b.color.auto {
		col = hexRGB(b.color.rgb)
	}
	return `<a:ln w="` + itoa(b.width*12700/8) + `"><a:solidFill><a:srgbClr val="` + col + `"/></a:solidFill></a:ln>`
}

func (w *writer) docPrXML(pic *picture) string {
	s := `<wp:docPr id="` + itoa(w.docPr+1) + `" name="Picture ` + itoa(w.docPr+1) + `"`
	if pic.descr != "" {
		s += ` descr="` + xmltree.Escape(pic.descr) + `"`
	}
	return s + `/>`
}

func picSize(pic *picture) (int, int) {
	cx, cy := emu(pic.w), emu(pic.h)
	if cx <= 0 || cy <= 0 {
		cx, cy = emu(1440), emu(1440)
	}
	return cx, cy
}

// inlineDrawing is a w:drawing for an inline picture
func (w *writer) inlineDrawing(pic *picture, part *partCtx) string {
	rid := w.mediaRel(pic.data, pic.ext, part)
	cx, cy := picSize(pic)
	dp := w.docPrXML(pic)
	return `<w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="` + itoa(cx) + `" cy="` + itoa(cy) +
		`"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` + dp + `<wp:cNvGraphicFramePr/>` +
		w.graphicXML(pic, rid, cx, cy) + `</wp:inline></w:drawing>`
}

// anchorDrawing is a w:drawing for a floating picture
func (w *writer) anchorDrawing(fo *floatObj, part *partCtx) string {
	pic := fo.pic
	rid := w.mediaRel(pic.data, pic.ext, part)
	cx, cy := picSize(pic)
	behind := "0"
	if fo.behind || fo.wrap == 3 && fo.behind {
		behind = "1"
	}
	wrap := `<wp:wrapSquare wrapText="bothSides"/>`
	switch fo.wrap {
	case 1:
		wrap = `<wp:wrapTopAndBottom/>`
	case 3:
		wrap = `<wp:wrapNone/>`
	}
	dp := w.docPrXML(pic)
	return `<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" simplePos="0" relativeHeight="` +
		itoa(251658240+w.docPr) + `" behindDoc="` + behind + `" locked="0" layoutInCell="1" allowOverlap="1"><wp:simplePos x="0" y="0"/>` +
		`<wp:positionH relativeFrom="` + fo.relH + `"><wp:posOffset>` + itoa(emu(fo.x)) + `</wp:posOffset></wp:positionH>` +
		`<wp:positionV relativeFrom="` + fo.relV + `"><wp:posOffset>` + itoa(emu(fo.y)) + `</wp:posOffset></wp:positionV>` +
		`<wp:extent cx="` + itoa(cx) + `" cy="` + itoa(cy) + `"/><wp:effectExtent l="0" t="0" r="0" b="0"/>` + wrap + dp +
		`<wp:cNvGraphicFramePr/>` + w.graphicXML(pic, rid, cx, cy) + `</wp:anchor></w:drawing>`
}

// textboxXML writes a text box's story as paragraphs
func (w *writer) textboxXML(idx int, header bool, part *partCtx) string {
	span := w.d.fib.span(w.d.tbl, lcbPlcftxbxTxt)
	base := w.d.fib.txbxStart()
	if header {
		span = w.d.fib.span(w.d.tbl, lcbPlcfHdrtxbxTxt)
		base = w.d.fib.hdrTxbxStart()
	}
	pl := parsePLC(span, 22)
	// a text box never holds another one; a damaged file whose text box
	// story anchors a text box would otherwise recurse without end
	if idx < 0 || idx >= pl.n() || w.inTextbox {
		return ""
	}
	w.inTextbox = true
	defer func() { w.inTextbox = false }()
	// like a header story, a text box story ends with a guard mark
	cp1, cp2 := w.d.clamp(base+pl.pos[idx], base+pl.pos[idx+1]-1)
	if cp2 <= cp1 {
		return ""
	}
	return w.storyXML(cp1, cp2, storyTextbox, part, nil)
}

// storyXML writes the paragraphs and tables of a CP range
func (w *writer) storyXML(cp1, cp2 int, kind storyKind, part *partCtx, sections []section) string {
	cp1, cp2 = w.d.clamp(cp1, cp2)
	if cp2 <= cp1 {
		return ""
	}
	st := &storyState{kind: kind, part: part, fields: w.d.scanFields(cp1, cp2), marks: w.markersFor(cp1, cp2, kind)}
	ends := map[int]bool{}
	for _, s := range sections {
		ends[s.cpEnd] = true
	}
	paras := w.d.paragraphs(cp1, cp2, ends)
	var sectPr map[*para]string
	if kind == storyMain && len(sections) > 0 {
		sectPr = map[*para]string{}
		si := 0
		for _, pg := range paras {
			for si < len(sections)-1 && pg.cpEnd > sections[si].cpEnd {
				si++
			}
			if si < len(sections)-1 && pg.cpEnd == sections[si].cpEnd {
				sectPr[pg] = sections[si].xml
				si++
			}
		}
	}
	return w.blocksXML(paras, 0, st, sectPr)
}

/* ---------------- sections and headers ---------------- */

type section struct {
	cpEnd int
	s     sep
	xml   string
}

// sections reads PlcfSed and the SEPX of each section; the headers and
// footers they reference are written here too
func (w *writer) sections(docRels *relSet) []section {
	d := w.d
	pl := parsePLC(d.fib.span(d.tbl, lcbPlcfSed), 12)
	hdd := parsePLC(d.fib.span(d.tbl, lcbPlcfHdd), 0)
	var out []section
	headerN := 0
	for i := 0; i < pl.n(); i++ {
		s := defaultSep()
		it := pl.item(i)
		if it != nil {
			// in int64: a 32-bit int(fc) of a large offset is negative
			fc := int64(binary.LittleEndian.Uint32(it[2:]))
			if fc != 0xFFFFFFFF && fc+2 <= int64(len(d.wd)) {
				cb := int64(binary.LittleEndian.Uint16(d.wd[fc:]))
				if fc+2+cb <= int64(len(d.wd)) {
					eachSprm(d.wd[fc+2:fc+2+cb], s.apply)
				}
			}
		}
		// headers: 6 stories per section after 6 note separators
		var refs strings.Builder
		for k, ref := range []struct{ tag, typ string }{
			{"headerReference", "even"}, {"headerReference", "default"},
			{"footerReference", "even"}, {"footerReference", "default"},
			{"headerReference", "first"}, {"footerReference", "first"},
		} {
			idx := 6 + 6*i + k
			if idx+1 >= len(hdd.pos) {
				break
			}
			// every story ends with a guard paragraph mark of its own; one
			// with nothing else is empty, and the previous section's story
			// carries on (LibreOffice: Read_HdFtText reads nLen - 1)
			a, b := hdd.pos[idx], hdd.pos[idx+1]-1
			if b <= a {
				continue
			}
			if ref.typ == "first" && !s.titlePg {
				continue
			}
			headerN++
			part := &partCtx{rels: newRelSet()}
			isHeader := ref.tag == "headerReference"
			body := w.storyXML(d.fib.hddStart()+a, d.fib.hddStart()+b, storyHeader, part, nil)
			if body == "" {
				body = "<w:p/>"
			}
			name := "header" + itoa(headerN) + ".xml"
			root, ct, rel := "w:hdr", ctHeader, relHeader
			if !isHeader {
				name = "footer" + itoa(headerN) + ".xml"
				root, ct, rel = "w:ftr", ctFooter, relFooter
			}
			w.pkg.AddXML("word/"+name, ct, "<"+root+" "+partNS+">"+body+"</"+root+">")
			if part.rels.r.Len() > 0 {
				w.pkg.AddXML(opc.RelsPath("word/"+name), "", part.rels.r.XML())
			}
			rid := docRels.add(rel, name, false)
			refs.WriteString(`<w:` + ref.tag + ` w:type="` + ref.typ + `" r:id="` + rid + `"/>`)
		}
		out = append(out, section{cpEnd: pl.pos[i+1], s: s, xml: sectPrXML(s, refs.String())})
	}
	if len(out) == 0 {
		out = append(out, section{cpEnd: d.fib.ccpText, s: defaultSep(), xml: sectPrXML(defaultSep(), "")})
	}
	return out
}

/* ---------------- notes and comments ---------------- */

// notes writes the footnotes or endnotes and maps their reference CPs
func (w *writer) notes(refIdx, txtIdx int, start int, byCP map[int]int, kind storyKind, rels *relSet) []string {
	d := w.d
	ref := parsePLC(d.fib.span(d.tbl, refIdx), 2)
	txt := parsePLC(d.fib.span(d.tbl, txtIdx), 0)
	var out []string
	for i := 0; i < ref.n(); i++ {
		id := i + 2 // 0 and 1 are the separators
		byCP[ref.pos[i]] = id
		if i+1 >= len(txt.pos) {
			continue
		}
		part := &partCtx{rels: rels}
		body := w.storyXML(start+txt.pos[i], start+txt.pos[i+1], kind, part, nil)
		if body == "" {
			body = "<w:p/>"
		}
		tag := "w:footnote"
		if kind == storyEndnote {
			tag = "w:endnote"
		}
		out = append(out, `<`+tag+` w:id="`+itoa(id)+`">`+body+`</`+tag+`>`)
	}
	return out
}

func notesPart(root, tag string, notes []string) string {
	return `<` + root + ` ` + partNS + `>` +
		`<` + tag + ` w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></` + tag + `>` +
		`<` + tag + ` w:type="continuationSeparator" w:id="1"><w:p><w:r><w:continuationSeparator/></w:r></w:p></` + tag + `>` +
		strings.Join(notes, "") + `</` + root + `>`
}

// commentAuthors reads GrpXstAtnOwners
func (w *writer) commentAuthors() []string {
	b := w.d.fib.span(w.d.tbl, lcbGrpXstAtnOwner)
	var out []string
	for p := 0; p < len(b); {
		s, next := xst(b, p)
		if next <= p {
			break
		}
		out = append(out, s)
		p = next
	}
	return out
}

// cmRanges finds where each comment's commented text starts and ends:
// the annotation bookmarks, joined to the comments by their tag
func (w *writer) cmRanges() (map[int][]int, map[int][]int) {
	d := w.d
	starts, ends := map[int][]int{}, map[int][]int{}
	ref := parsePLC(d.fib.span(d.tbl, lcbPlcfandRef), 30)
	bkf := parsePLC(d.fib.span(d.tbl, lcbPlcfAtnBkf), 4)
	bkl := parsePLC(d.fib.span(d.tbl, lcbPlcfAtnBkl), 0)
	tags := atnTags(d.fib.span(d.tbl, lcbSttbfAtnBkmk))
	for i := 0; i < ref.n(); i++ {
		it := ref.item(i)
		if it == nil {
			continue
		}
		id := i
		tag := int32(binary.LittleEndian.Uint32(it[26:]))
		start, end := ref.pos[i], ref.pos[i]
		if tag != -1 {
			for k, t := range tags {
				if t == tag && k < bkf.n() {
					start = bkf.pos[k]
					if f := bkf.item(k); f != nil {
						if j := int(binary.LittleEndian.Uint16(f)); j < len(bkl.pos) {
							end = bkl.pos[j]
						}
					}
					break
				}
			}
		}
		if end < start {
			end = start
		}
		starts[start] = append(starts[start], id)
		ends[end] = append(ends[end], id)
	}
	return starts, ends
}

// markersFor collects the bookmarks and comment ranges inside [cp1, cp2]
func (w *writer) markersFor(cp1, cp2 int, kind storyKind) *markers {
	m := &markers{starts: map[int][]string{}, ends: map[int][]string{}}
	in := func(cp int) bool { return cp >= cp1 && cp <= cp2 }
	for _, b := range w.bookmarks {
		if !in(b.start) || !in(b.end) {
			continue
		}
		m.starts[b.start] = append(m.starts[b.start], `<w:bookmarkStart w:id="`+itoa(b.id)+`" w:name="`+xmltree.Escape(b.name)+`"/>`)
		m.ends[b.end] = append(m.ends[b.end], `<w:bookmarkEnd w:id="`+itoa(b.id)+`"/>`)
	}
	if kind == storyMain {
		starts, ends := w.cmRanges()
		for cp, ids := range starts {
			for _, id := range ids {
				m.starts[cp] = append(m.starts[cp], `<w:commentRangeStart w:id="`+itoa(id)+`"/>`)
			}
		}
		for cp, ids := range ends {
			for _, id := range ids {
				m.ends[cp] = append(m.ends[cp], `<w:commentRangeEnd w:id="`+itoa(id)+`"/>`)
			}
		}
	}
	return m
}

type bookmark struct {
	id         int
	name       string
	start, end int
}

// readBookmarks reads SttbfBkmk, PlcfBkf and PlcfBkl
func (w *writer) readBookmarks() {
	d := w.d
	names := sttb(d.fib.span(d.tbl, lcbSttbfBkmk))
	bkf := parsePLC(d.fib.span(d.tbl, lcbPlcfBkf), 4)
	bkl := parsePLC(d.fib.span(d.tbl, lcbPlcfBkl), 0)
	for i := 0; i < bkf.n() && i < len(names); i++ {
		f := bkf.item(i)
		if f == nil {
			continue
		}
		j := int(binary.LittleEndian.Uint16(f))
		if j >= len(bkl.pos) || names[i] == "" {
			continue
		}
		start, end := bkf.pos[i], bkl.pos[j]
		if end < start {
			end = start
		}
		w.bookmarks = append(w.bookmarks, bookmark{id: i, name: names[i], start: start, end: end})
	}
}

// atnTags reads the tags of SttbfAtnBkmk's entries
func atnTags(b []byte) []int32 {
	le := binary.LittleEndian
	if len(b) < 6 || le.Uint16(b) != 0xFFFF {
		return nil
	}
	n := int(le.Uint16(b[2:]))
	extra := int(le.Uint16(b[4:]))
	p := 6
	var out []int32
	for i := 0; i < n && p+2 <= len(b); i++ {
		cch := int(le.Uint16(b[p:]))
		p += 2 + 2*cch
		if p+extra > len(b) || extra < 6 {
			break
		}
		out = append(out, int32(le.Uint32(b[p+2:])))
		p += extra
	}
	return out
}

func (w *writer) commentsXML() []string {
	d := w.d
	ref := parsePLC(d.fib.span(d.tbl, lcbPlcfandRef), 30)
	txt := parsePLC(d.fib.span(d.tbl, lcbPlcfandTxt), 0)
	authors := w.commentAuthors()
	var out []string
	for i := 0; i < ref.n(); i++ {
		it := ref.item(i)
		if it == nil || i+1 >= len(txt.pos) {
			continue
		}
		w.cmByCP[ref.pos[i]] = i
		initials, _ := xst(it, 0)
		author := ""
		if ib := int(int16(binary.LittleEndian.Uint16(it[20:]))); ib >= 0 && ib < len(authors) {
			author = authors[ib]
		}
		part := &partCtx{rels: w.cmRels}
		body := w.storyXML(d.fib.atnStart()+txt.pos[i], d.fib.atnStart()+txt.pos[i+1], storyComment, part, nil)
		if body == "" {
			body = "<w:p/>"
		}
		out = append(out, `<w:comment w:id="`+itoa(i)+`" w:author="`+xmltree.Escape(author)+`" w:initials="`+
			xmltree.Escape(initials)+`">`+body+`</w:comment>`)
	}
	return out
}

/* ---------------- styles, numbering, settings ---------------- */

func (w *writer) stylesXML() string {
	d := w.d
	var sb strings.Builder
	sb.WriteString(`<w:styles ` + partNS + `><w:docDefaults><w:rPrDefault><w:rPr>`)
	sb.WriteString(w.rFonts([4]int{d.styles.defFtc[0], d.styles.defFtc[1], d.styles.defFtc[2], -1}))
	sb.WriteString(`<w:sz w:val="20"/><w:szCs w:val="20"/></w:rPr></w:rPrDefault>`)
	sb.WriteString(`<w:pPrDefault><w:pPr><w:spacing w:after="0" w:line="240" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`)
	for _, st := range d.styles.styles {
		if st == nil {
			continue
		}
		typ := map[int]string{stkPara: "paragraph", stkChar: "character", stkTable: "table", stkList: "numbering"}[st.stk]
		if typ == "" {
			continue
		}
		sb.WriteString(`<w:style w:type="` + typ + `" w:styleId="` + xmltree.Escape(st.id) + `"`)
		if st.istd == 0 || st.sti == 65 || st.sti == 105 || st.sti == 107 {
			sb.WriteString(` w:default="1"`)
		}
		sb.WriteString(`><w:name w:val="` + xmltree.Escape(st.name) + `"/>`)
		if b := d.styles.get(st.base); b != nil && st.base != st.istd {
			sb.WriteString(`<w:basedOn w:val="` + xmltree.Escape(b.id) + `"/>`)
		}
		if n := d.styles.get(st.next); n != nil {
			sb.WriteString(`<w:next w:val="` + xmltree.Escape(n.id) + `"/>`)
		}
		if st.hidden {
			sb.WriteString(`<w:semiHidden/>`)
		}
		if len(st.papx) > 0 && st.stk != stkChar {
			p := newPap()
			eachSprm(st.papx, p.apply)
			sb.WriteString(w.pPrXML(st.istd, p, false, ""))
		}
		if len(st.chpx) > 0 {
			c := newChp()
			eachSprm(st.chpx, c.apply)
			// a flip in a style flips its base style's value
			base := uint32(0)
			if st.base != 0xFFF {
				base = d.styles.toggles(st.base, -1)
				if st.stk == stkChar {
					base = d.styles.toggles(0, st.base)
				}
			}
			c.istd = -1
			sb.WriteString(w.rPrXML(c, base, ""))
		}
		sb.WriteString(`</w:style>`)
	}
	sb.WriteString(`</w:styles>`)
	return sb.String()
}

func (w *writer) numberingXML() string {
	ls := w.d.lists
	if len(ls.defs) == 0 {
		return ""
	}
	var sb strings.Builder
	sb.WriteString(`<w:numbering ` + partNS + `>`)
	lvlXML := func(i int, l *lvl) string {
		var b strings.Builder
		b.WriteString(`<w:lvl w:ilvl="` + itoa(i) + `"><w:start w:val="` + itoa(l.start) + `"/>`)
		nf, ok := nfcNames[l.nfc]
		if !ok {
			nf = "decimal"
		}
		b.WriteString(`<w:numFmt w:val="` + nf + `"/>`)
		if l.restart > 0 && l.restart <= 9 {
			b.WriteString(`<w:lvlRestart w:val="` + itoa(l.restart) + `"/>`)
		}
		if l.legal {
			b.WriteString(`<w:isLgl/>`)
		}
		b.WriteString(`<w:suff w:val="` + []string{"tab", "space", "nothing", "tab"}[l.follow&3] + `"/>`)
		b.WriteString(`<w:lvlText w:val="` + xmltree.Escape(lvlText(l.text)) + `"/>`)
		b.WriteString(`<w:lvlJc w:val="` + []string{"left", "center", "right", "left"}[l.jc&3] + `"/>`)
		if len(l.papx) > 0 {
			p := newPap()
			eachSprm(l.papx, p.apply)
			b.WriteString(w.pPrXML(-1, p, false, ""))
		}
		if len(l.chpx) > 0 {
			c := newChp()
			eachSprm(l.chpx, c.apply)
			b.WriteString(w.rPrXML(c, 0, ""))
		}
		b.WriteString(`</w:lvl>`)
		return b.String()
	}
	for i, def := range ls.defs {
		sb.WriteString(`<w:abstractNum w:abstractNumId="` + itoa(i) + `">`)
		if def.simple {
			sb.WriteString(`<w:multiLevelType w:val="singleLevel"/>`)
		} else {
			sb.WriteString(`<w:multiLevelType w:val="hybridMultilevel"/>`)
		}
		for k, l := range def.levels {
			sb.WriteString(lvlXML(k, l))
		}
		sb.WriteString(`</w:abstractNum>`)
	}
	for i, o := range ls.lfos {
		a := ls.defIndex(o.lsid)
		if a < 0 {
			a = 0
		}
		sb.WriteString(`<w:num w:numId="` + itoa(i+1) + `"><w:abstractNumId w:val="` + itoa(a) + `"/>`)
		for _, lv := range o.levels {
			if !lv.hasStart && lv.formatted == nil {
				continue
			}
			sb.WriteString(`<w:lvlOverride w:ilvl="` + itoa(lv.ilvl) + `">`)
			if lv.hasStart {
				sb.WriteString(`<w:startOverride w:val="` + itoa(lv.start) + `"/>`)
			}
			if lv.formatted != nil {
				sb.WriteString(lvlXML(lv.ilvl, lv.formatted))
			}
			sb.WriteString(`</w:lvlOverride>`)
		}
		sb.WriteString(`</w:num>`)
	}
	sb.WriteString(`</w:numbering>`)
	return sb.String()
}

func (w *writer) settingsXML() string {
	tab := 720
	facing := false
	if dop := w.d.fib.span(w.d.tbl, lcbDop); len(dop) >= 12 {
		facing = dop[0]&0x01 != 0
		if v := int(binary.LittleEndian.Uint16(dop[10:])); v > 0 {
			tab = v
		}
	}
	s := `<w:settings ` + partNS + `><w:defaultTabStop w:val="` + itoa(tab) + `"/>`
	if facing {
		s += `<w:evenAndOddHeaders/>`
	}
	return s + `<w:compat/></w:settings>`
}

/* ---------------- the package ---------------- */

func (w *writer) write() ([]byte, error) {
	d := w.d
	w.docRels, w.fnRels, w.enRels, w.cmRels = newRelSet(), newRelSet(), newRelSet(), newRelSet()
	docPart := &partCtx{rels: w.docRels}

	w.readBookmarks()
	// notes and comments first: their reference CPs are needed while the
	// text is written
	w.footnotes = w.notes(lcbPlcffndRef, lcbPlcffndTxt, d.fib.ftnStart(), w.fnByCP, storyFootnote, w.fnRels)
	w.endnotes = w.notes(lcbPlcfendRef, lcbPlcfendTxt, d.fib.ednStart(), w.enByCP, storyEndnote, w.enRels)
	w.comments = w.commentsXML()

	sections := w.sections(w.docRels)
	body := w.storyXML(0, d.fib.ccpText, storyMain, docPart, sections)
	last := sections[len(sections)-1]
	doc := `<w:document ` + partNS + `><w:body>` + body + last.xml + `</w:body></w:document>`

	var root opc.Rels
	root.Add(opc.RelOfficeDocument, "word/document.xml", false)
	w.pkg.AddXML("_rels/.rels", "", root.XML())
	w.pkg.AddXML("word/document.xml", ctDocument, doc)
	w.docRels.add(opc.RelStyles, "styles.xml", false)
	w.pkg.AddXML("word/styles.xml", ctStyles, w.stylesXML())
	w.docRels.add(relSettings, "settings.xml", false)
	w.pkg.AddXML("word/settings.xml", ctSettings, w.settingsXML())
	if num := w.numberingXML(); num != "" {
		w.docRels.add(relNumbering, "numbering.xml", false)
		w.pkg.AddXML("word/numbering.xml", ctNumbering, num)
	}
	if len(w.footnotes) > 0 {
		w.docRels.add(relFootnotes, "footnotes.xml", false)
		w.pkg.AddXML("word/footnotes.xml", ctFootnotes, notesPart("w:footnotes", "w:footnote", w.footnotes))
	}
	if len(w.endnotes) > 0 {
		w.docRels.add(relEndnotes, "endnotes.xml", false)
		w.pkg.AddXML("word/endnotes.xml", ctEndnotes, notesPart("w:endnotes", "w:endnote", w.endnotes))
	}
	if len(w.comments) > 0 {
		w.docRels.add(relComments, "comments.xml", false)
		w.pkg.AddXML("word/comments.xml", ctComments, `<w:comments `+partNS+`>`+strings.Join(w.comments, "")+`</w:comments>`)
	}
	for name, rs := range map[string]*relSet{"footnotes.xml": w.fnRels, "endnotes.xml": w.enRels, "comments.xml": w.cmRels} {
		if rs.r.Len() > 0 {
			w.pkg.AddXML(opc.RelsPath("word/"+name), "", rs.r.XML())
		}
	}
	w.pkg.AddXML("word/_rels/document.xml.rels", "", w.docRels.r.XML())
	return w.pkg.Bytes()
}
