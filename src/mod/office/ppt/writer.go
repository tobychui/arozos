package ppt

/*
	writer.go - assemble the .pptx package: the presentation, one slide
	master (with a blank layout and a theme) per PowerPoint master, the
	slides, their notes and the pictures.
*/

import (
	"crypto/sha256"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/office/internal/officeart"
	"imuslab.com/arozos/mod/office/internal/opc"
	"imuslab.com/arozos/mod/office/internal/xmltree"
	"imuslab.com/arozos/mod/office/metafile"
)

const (
	nsA = "http://schemas.openxmlformats.org/drawingml/2006/main"
	nsR = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
	nsP = "http://schemas.openxmlformats.org/presentationml/2006/main"

	partNS = `xmlns:a="` + nsA + `" xmlns:r="` + nsR + `" xmlns:p="` + nsP + `"`

	ctPresentation = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"
	ctSlide        = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml"
	ctMaster       = "application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"
	ctLayout       = "application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"
	ctTheme        = "application/vnd.openxmlformats-officedocument.theme+xml"
	ctNotes        = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml"
	ctNotesMaster  = "application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"

	relBase        = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/"
	relSlide       = relBase + "slide"
	relMaster      = relBase + "slideMaster"
	relLayout      = relBase + "slideLayout"
	relTheme       = relBase + "theme"
	relNotes       = relBase + "notesSlide"
	relNotesMaster = relBase + "notesMaster"
	relHyperlink   = opc.RelHyperlink
	relImage       = opc.RelImage
)

// partRels is a part's relationships, deduplicated by target
type partRels struct {
	r     opc.Rels
	byKey map[string]string
}

func newPartRels() *partRels { return &partRels{byKey: map[string]string{}} }

func (pr *partRels) add(typ, target string, external bool) string {
	k := typ + "|" + target
	if id, ok := pr.byKey[k]; ok {
		return id
	}
	id := pr.r.Add(typ, target, external)
	pr.byKey[k] = id
	return id
}

type writer struct {
	p     *pres
	pkg   *opc.Package
	media map[[32]byte]string
}

func newWriter(p *pres) *writer {
	return &writer{p: p, pkg: opc.New(), media: map[[32]byte]string{}}
}

// usable turns a picture into one a .pptx reader shows
func usable(b *officeart.Blip) ([]byte, string, bool) {
	if b == nil || len(b.Data) == 0 {
		return nil, "", false
	}
	switch b.Ext {
	case "tiff":
		png, err := metafile.TIFFToPNG(b.Data)
		if err != nil {
			return nil, "", false
		}
		return png, "png", true
	case "pict":
		return nil, "", false
	}
	return b.Data, b.Ext, true
}

func (w *writer) mediaRel(data []byte, ext string, part *partRels) string {
	h := sha256.Sum256(data)
	name, ok := w.media[h]
	if !ok {
		name = "image" + strconv.Itoa(len(w.media)+1) + "." + ext
		w.media[h] = name
		w.pkg.Add("ppt/media/"+name, "", data)
	}
	return part.add(relImage, "../media/"+name, false)
}

// background finds a drawing's background shape
func background(drawing *officeart.Record) *officeart.Shape {
	if drawing == nil {
		return nil
	}
	dg := drawing.Child(officeart.DgContainer)
	if dg == nil {
		return nil
	}
	for _, sp := range dg.All(officeart.SpContainer) {
		if sh := officeart.ReadShape(sp); sh.Flags&officeart.SpBackground != 0 {
			return sh
		}
	}
	return nil
}

func patriarch(drawing *officeart.Record) *officeart.Shape {
	if drawing == nil {
		return nil
	}
	dg := drawing.Child(officeart.DgContainer)
	if dg == nil {
		return nil
	}
	return officeart.ReadGroup(dg.Child(officeart.SpgrContainer))
}

func (w *writer) ctx(s, master *slideRec, part *partRels) *slideCtx {
	c := &slideCtx{w: w, p: w.p, s: s, master: master, part: part, nextID: 1, number: s.number}
	c.scheme = s.scheme
	if c.scheme == [8]uint32{} && master != nil {
		c.scheme = master.scheme
	}
	if c.scheme == [8]uint32{} {
		c.scheme = [8]uint32{0xFFFFFF, 0x000000, 0x808080, 0x000000, 0xBBE0E3, 0x333399, 0x009999, 0x99CC00}
	}
	return c
}

// bgXML writes a p:bg from a background shape
func (c *slideCtx) bgXML(sh *officeart.Shape) string {
	if sh == nil {
		return ""
	}
	fill := c.fillXML(sh, true)
	if fill == "<a:noFill/>" {
		return ""
	}
	return `<p:bg><p:bgPr>` + fill + `<a:effectLst/></p:bgPr></p:bg>`
}

func spTree(inner string) string {
	return `<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm>` +
		`<a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>` + inner + `</p:spTree>`
}

const clrMap = `<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>`

// themeXML writes a theme carrying a PowerPoint colour scheme
func themeXML(name string, scheme [8]uint32, font string) string {
	if font == "" {
		font = "Arial"
	}
	c := func(tag string, v uint32) string {
		return `<a:` + tag + `><a:srgbClr val="` + hex6(v) + `"/></a:` + tag + `>`
	}
	f := xmltree.Escape(font)
	return `<a:theme ` + partNS + ` name="` + xmltree.Escape(name) + `"><a:themeElements><a:clrScheme name="` + xmltree.Escape(name) + `">` +
		c("dk1", scheme[1]) + c("lt1", scheme[0]) + c("dk2", scheme[3]) + c("lt2", scheme[2]) +
		c("accent1", scheme[4]) + c("accent2", scheme[5]) + c("accent3", scheme[6]) + c("accent4", scheme[7]) +
		c("accent5", 0x4BACC6) + c("accent6", 0xF79646) + c("hlink", scheme[6]) + c("folHlink", scheme[7]) +
		`</a:clrScheme><a:fontScheme name="` + xmltree.Escape(name) + `"><a:majorFont><a:latin typeface="` + f + `"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>` +
		`<a:minorFont><a:latin typeface="` + f + `"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme>` +
		`<a:fmtScheme name="` + xmltree.Escape(name) + `"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>` +
		`<a:lnStyleLst><a:ln w="9525"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="25400"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln w="38100"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>` +
		`<a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>` +
		`<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`
}

// notesText gathers a notes page's body text
func (w *writer) notesText(n *slideRec) []*textBlock {
	if n == nil || n.rec == nil {
		return nil
	}
	g := patriarch(n.rec.Child(rtPPDrawing))
	if g == nil {
		return nil
	}
	var out []*textBlock
	c := &slideCtx{w: w, p: w.p, s: n}
	officeart.Walk(g, func(sh *officeart.Shape, _ []*officeart.Shape) {
		if ph := placeholder(sh); ph != 6 && ph != 12 {
			return
		}
		if t := c.textOf(sh); t != nil && len(t.text) > 0 {
			out = append(out, t)
		}
	})
	return out
}

func (w *writer) write() ([]byte, error) {
	p := w.p
	var root opc.Rels
	root.Add(opc.RelOfficeDocument, "ppt/presentation.xml", false)
	w.pkg.AddXML("_rels/.rels", "", root.XML())
	presRels := newPartRels()

	// masters: each with a layout and a theme
	masters := p.masters
	if len(masters) == 0 {
		masters = []*slideRec{{isMaster: true, masterObjs: true, masterBg: true}}
	}
	layoutOf := map[*slideRec]int{}
	var masterIDs strings.Builder
	for i, m := range masters {
		n := strconv.Itoa(i + 1)
		mRels := newPartRels()
		mRels.add(relLayout, "../slideLayouts/slideLayout"+n+".xml", false)
		mRels.add(relTheme, "../theme/theme"+n+".xml", false)
		c := w.ctx(m, m, mRels)
		var bg, shapes string
		if m.rec != nil {
			drawing := m.rec.Child(rtPPDrawing)
			bg = c.bgXML(background(drawing))
			if g := patriarch(drawing); g != nil {
				shapes = c.shapesXML(g, false, true)
			}
		}
		if bg == "" {
			bg = `<p:bg><p:bgPr><a:solidFill>` + srgb(c.scheme[0], "") + `</a:solidFill><a:effectLst/></p:bgPr></p:bg>`
		}
		font := ""
		if len(p.fonts) > 0 {
			font = p.fonts[0]
		}
		// master and layout ids share one range from 2^31 up (int64: they
		// overflow int on 32-bit targets); each master leaves room for its
		// layout right after it
		masterID := int64(2147483648) + int64(i)*12
		w.pkg.AddXML("ppt/theme/theme"+n+".xml", ctTheme, themeXML("Master "+n, c.scheme, font))
		w.pkg.AddXML("ppt/slideMasters/slideMaster"+n+".xml", ctMaster, `<p:sldMaster `+partNS+`><p:cSld>`+bg+spTree(shapes)+`</p:cSld>`+clrMap+
			`<p:sldLayoutIdLst><p:sldLayoutId id="`+strconv.FormatInt(masterID+1, 10)+`" r:id="rId1"/></p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`)
		w.pkg.AddXML(opc.RelsPath("ppt/slideMasters/slideMaster"+n+".xml"), "", mRels.r.XML())
		var lRels opc.Rels
		lRels.Add(relMaster, "../slideMasters/slideMaster"+n+".xml", false)
		w.pkg.AddXML("ppt/slideLayouts/slideLayout"+n+".xml", ctLayout, `<p:sldLayout `+partNS+` type="blank" preserve="1"><p:cSld name="Blank">`+spTree("")+`</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`)
		w.pkg.AddXML(opc.RelsPath("ppt/slideLayouts/slideLayout"+n+".xml"), "", lRels.XML())
		rid := presRels.add(relMaster, "slideMasters/slideMaster"+n+".xml", false)
		masterIDs.WriteString(`<p:sldMasterId id="` + strconv.FormatInt(masterID, 10) + `" r:id="` + rid + `"/>`)
		layoutOf[m] = i + 1
	}

	// a notes master, for the notes pages to point at
	hasNotes := false
	for _, s := range p.slides {
		if len(w.notesText(s.notes)) > 0 {
			hasNotes = true
		}
	}
	notesMasterRef := ""
	if hasNotes {
		n := strconv.Itoa(len(masters) + 1)
		w.pkg.AddXML("ppt/theme/theme"+n+".xml", ctTheme, themeXML("Notes", masters[0].scheme, ""))
		w.pkg.AddXML("ppt/notesMasters/notesMaster1.xml", ctNotesMaster, `<p:notesMaster `+partNS+`><p:cSld>`+spTree("")+`</p:cSld>`+clrMap+`</p:notesMaster>`)
		var nr opc.Rels
		nr.Add(relTheme, "../theme/theme"+n+".xml", false)
		w.pkg.AddXML(opc.RelsPath("ppt/notesMasters/notesMaster1.xml"), "", nr.XML())
		notesMasterRef = presRels.add(relNotesMaster, "notesMasters/notesMaster1.xml", false)
	}

	var sldIDs strings.Builder
	for i, s := range p.slides {
		n := strconv.Itoa(i + 1)
		part := "ppt/slides/slide" + n + ".xml"
		sRels := newPartRels()
		m := s.master
		if m == nil {
			m = masters[0]
		}
		li := layoutOf[m]
		if li == 0 {
			li = 1
		}
		sRels.add(relLayout, "../slideLayouts/slideLayout"+strconv.Itoa(li)+".xml", false)
		c := w.ctx(s, m, sRels)
		drawing := s.rec.Child(rtPPDrawing)
		bg := ""
		if !s.masterBg {
			bg = c.bgXML(background(drawing))
		}
		shapes := ""
		if g := patriarch(drawing); g != nil {
			shapes = c.shapesXML(g, false, false)
		}
		attrs := ""
		if !s.masterObjs {
			attrs = ` showMasterSp="0"`
		}
		if s.hidden {
			attrs += ` show="0"`
		}
		trans := ""
		if s.transition != "" {
			trans = `<p:transition><p:` + s.transition + `/></p:transition>`
		}
		if notes := w.notesText(s.notes); len(notes) > 0 {
			nn := strconv.Itoa(i + 1)
			nRels := newPartRels()
			nRels.add(relNotesMaster, "../notesMasters/notesMaster1.xml", false)
			nRels.add(relSlide, "../slides/slide"+n+".xml", false)
			var paras strings.Builder
			for _, t := range notes {
				for _, line := range strings.Split(strings.ReplaceAll(string(decodeUTF16(t.text)), "\v", "\n"), "\r") {
					paras.WriteString(`<a:p><a:r><a:rPr lang="en-US"/><a:t>` + xmlText(utf16Encode(line)) + `</a:t></a:r></a:p>`)
				}
			}
			body := `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Notes"/><p:cNvSpPr/><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/>` +
				`<p:txBody><a:bodyPr/><a:lstStyle/>` + paras.String() + `</p:txBody></p:sp>`
			w.pkg.AddXML("ppt/notesSlides/notesSlide"+nn+".xml", ctNotes, `<p:notes `+partNS+`><p:cSld>`+spTree(body)+`</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>`)
			w.pkg.AddXML(opc.RelsPath("ppt/notesSlides/notesSlide"+nn+".xml"), "", nRels.r.XML())
			sRels.add(relNotes, "../notesSlides/notesSlide"+nn+".xml", false)
		}
		w.pkg.AddXML(part, ctSlide, `<p:sld `+partNS+attrs+`><p:cSld>`+bg+spTree(shapes)+`</p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr>`+trans+`</p:sld>`)
		w.pkg.AddXML(opc.RelsPath(part), "", sRels.r.XML())
		rid := presRels.add(relSlide, "slides/slide"+n+".xml", false)
		sldIDs.WriteString(`<p:sldId id="` + strconv.Itoa(256+i) + `" r:id="` + rid + `"/>`)
	}

	cx := strconv.Itoa(int(float64(p.slideW) * emuPerMaster))
	cy := strconv.Itoa(int(float64(p.slideH) * emuPerMaster))
	var pres strings.Builder
	pres.WriteString(`<p:presentation ` + partNS + ` saveSubsetFonts="1"><p:sldMasterIdLst>` + masterIDs.String() + `</p:sldMasterIdLst>`)
	if notesMasterRef != "" {
		pres.WriteString(`<p:notesMasterIdLst><p:notesMasterId r:id="` + notesMasterRef + `"/></p:notesMasterIdLst>`)
	}
	pres.WriteString(`<p:sldIdLst>` + sldIDs.String() + `</p:sldIdLst><p:sldSz cx="` + cx + `" cy="` + cy + `"/><p:notesSz cx="` + cy + `" cy="` + cx + `"/></p:presentation>`)
	w.pkg.AddXML("ppt/presentation.xml", ctPresentation, pres.String())
	w.pkg.AddXML("ppt/_rels/presentation.xml.rels", "", presRels.r.XML())
	return w.pkg.Bytes()
}

func utf16Encode(s string) []uint16 {
	out := make([]uint16, 0, len(s))
	for _, r := range s {
		if r >= 0x10000 {
			r -= 0x10000
			out = append(out, uint16(0xD800+(r>>10)), uint16(0xDC00+(r&0x3FF)))
			continue
		}
		out = append(out, uint16(r))
	}
	return out
}
