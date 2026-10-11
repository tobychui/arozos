/*
Package ppt imports PowerPoint 97-2003 presentations (.ppt) by converting
them into PowerPoint 2007+ presentations (.pptx), which package pptx then
reads into the Slides model.

The design follows LibreOffice's PowerPoint import (sd/source/filter/ppt
with filter/source/msfilter/svdfppt.cxx and msdffimp.cxx): the "Current
User" stream points at the last edit, whose persist directory maps object
ids onto records of the "PowerPoint Document" stream (ppt.go); the
document container lists the slides, masters and notes; text and its
formatting come from text atoms and the masters' text styles (text.go);
shapes are OfficeArt records with PowerPoint's client data (shape.go);
pictures come from the "Pictures" stream. The result is written as
PresentationML (writer.go) with every look resolved onto the slide - one
slide master per PowerPoint master carries its background and decoration.

Imported: slides, notes, masters (background, decoration, colour
scheme, text styles), text boxes and placeholders with their paragraph
and character formatting and bullets, autoshapes (preset geometry, fills
including gradients and pictures, outlines, arrowheads, rotation and
flips), freeforms, lines and connectors, groups, pictures (with
cropping), hyperlinks, slide number fields, slide backgrounds and
transitions. Not imported: animations, sounds and movies, OLE objects
beyond their preview picture, and PowerPoint 95 files. Encrypted
presentations are refused with an explanation.
*/
package ppt

import (
	"encoding/binary"
	"errors"

	"imuslab.com/arozos/mod/office/internal/cfb"
	"imuslab.com/arozos/mod/office/internal/officeart"
	"imuslab.com/arozos/mod/office/model"
	"imuslab.com/arozos/mod/office/pptx"
)

// record types of the PowerPoint Document stream
const (
	rtDocument          = 1000
	rtDocumentAtom      = 1001
	rtSlide             = 1006
	rtSlideAtom         = 1007
	rtNotes             = 1008
	rtNotesAtom         = 1009
	rtEnvironment       = 1010
	rtSlidePersistAtom  = 1011
	rtMainMaster        = 1016
	rtSSSlideInfoAtom   = 1017
	rtExObjList         = 1033
	rtPPDrawingGroup    = 1035
	rtPPDrawing         = 1036
	rtFontCollection    = 2005
	rtColorSchemeAtom   = 2032
	rtOEPlaceholderAtom = 3011
	rtOutlineTextRef    = 3998
	rtTextHeaderAtom    = 3999
	rtTextCharsAtom     = 4000
	rtStyleTextPropAtom = 4001
	rtTxMasterStyleAtom = 4003
	rtTextRulerAtom     = 4006
	rtTextBytesAtom     = 4008
	rtFontEntityAtom    = 4023
	rtCString           = 4026
	rtExHyperlinkAtom   = 4051
	rtExHyperlink       = 4055
	rtSlideNumberMC     = 4056
	rtTxInteractiveInfo = 4063
	rtSlideListWithText = 4080
	rtInteractiveInfo   = 4082
	rtInteractiveAtom   = 4083
	rtUserEditAtom      = 4085
	rtPersistDirectory  = 6002
)

// master units: 576 to the inch
const emuPerMaster = 914400.0 / 576.0

var errEncrypted = errors.New("this presentation is password protected; remove the password in PowerPoint and save it again to open it here")

// slideRec is a slide, master or notes page
type slideRec struct {
	id         uint32
	rec        *officeart.Record
	texts      []*textBlock // from SlideListWithText (OutlineTextRefAtom targets)
	master     *slideRec
	notes      *slideRec
	masterObjs bool
	masterBg   bool
	scheme     [8]uint32
	styles     [9]*masterStyle // a master's text styles by text type
	isMaster   bool
	transition string
	number     int
}

type link struct {
	url      string
	location string
}

type pres struct {
	doc, pics  []byte
	persist    map[uint32]int
	docRec     *officeart.Record
	slideW     int // master units
	slideH     int
	fonts      []string
	store      []*officeart.Blip
	masters    []*slideRec
	masterByID map[uint32]*slideRec
	slides     []*slideRec
	notesByID  map[uint32]*slideRec
	links      map[uint32]link
	envStyle   *masterStyle // the document's default text style
}

// ToPptx converts a PowerPoint 97-2003 presentation into a .pptx file
func ToPptx(data []byte) ([]byte, error) {
	p, err := open(data)
	if err != nil {
		return nil, err
	}
	return newWriter(p).write()
}

// Parse converts a PowerPoint 97-2003 presentation into the Slides model
func Parse(data []byte) (*model.Presentation, error) {
	x, err := ToPptx(data)
	if err != nil {
		return nil, err
	}
	return pptx.Parse(x)
}

func open(data []byte) (*pres, error) {
	if !cfb.IsCompound(data) {
		return nil, errors.New("not a PowerPoint 97-2003 presentation")
	}
	cf, err := cfb.Open(data)
	if err != nil {
		return nil, err
	}
	if cf.Has("EncryptedSummary") {
		return nil, errEncrypted
	}
	if !cf.Has("PowerPoint Document") {
		if cf.Has("PP40") || cf.Has("Header") {
			return nil, errors.New("PowerPoint 95 and older presentations are not supported")
		}
		return nil, errors.New("not a PowerPoint presentation (no PowerPoint Document stream)")
	}
	p := &pres{masterByID: map[uint32]*slideRec{}, notesByID: map[uint32]*slideRec{}, links: map[uint32]link{}}
	if p.doc, err = cf.Stream("PowerPoint Document"); err != nil {
		return nil, err
	}
	if cf.Has("Pictures") {
		p.pics, _ = cf.Stream("Pictures")
	}
	var cu []byte
	if cf.Has("Current User") {
		cu, _ = cf.Stream("Current User")
	}
	if err := p.readPersist(cu); err != nil {
		return nil, err
	}
	if err := p.readDocument(); err != nil {
		return nil, err
	}
	return p, nil
}

// readPersist follows the edit chain from the current edit back to the
// first save; a newer edit's entries win
func (p *pres) readPersist(cu []byte) error {
	le := binary.LittleEndian
	p.persist = map[uint32]int{}
	off := -1
	if len(cu) >= 20 {
		if le.Uint32(cu[12:]) == 0xF3D1C4DF {
			return errEncrypted
		}
		off = int(le.Uint32(cu[16:]))
	}
	if off < 0 || off+8 > len(p.doc) {
		// no Current User stream: the last UserEditAtom of the stream
		off = -1
		for _, r := range officeart.Parse(p.doc) {
			if r.Type == rtUserEditAtom {
				off = r.Offset
			}
		}
		if off < 0 {
			return errors.New("the presentation has no edit record")
		}
	}
	docRef := uint32(0)
	seen := map[int]bool{}
	for off >= 0 && off+8 <= len(p.doc) && !seen[off] && len(seen) < 4096 {
		seen[off] = true
		ue, _, err := officeart.ParseOne(p.doc, off)
		if err != nil || ue.Type != rtUserEditAtom || len(ue.Data) < 20 {
			break
		}
		last := int(le.Uint32(ue.Data[8:]))
		dirOff := int(le.Uint32(ue.Data[12:]))
		if docRef == 0 {
			docRef = le.Uint32(ue.Data[16:])
			if len(ue.Data) >= 32 && le.Uint32(ue.Data[28:]) != 0 {
				return errEncrypted
			}
		}
		if dir, _, err := officeart.ParseOne(p.doc, dirOff); err == nil && dir.Type == rtPersistDirectory {
			d := dir.Data
			for q := 0; q+4 <= len(d); {
				hdr := le.Uint32(d[q:])
				q += 4
				id := hdr & 0xFFFFF
				n := int(hdr >> 20)
				for k := 0; k < n && q+4 <= len(d); k++ {
					if _, ok := p.persist[id+uint32(k)]; !ok {
						p.persist[id+uint32(k)] = int(le.Uint32(d[q:]))
					}
					q += 4
				}
			}
		}
		if last == 0 || last == off {
			break
		}
		off = last
	}
	doff, ok := p.persist[docRef]
	if !ok {
		return errors.New("the presentation's document record is missing")
	}
	rec, _, err := officeart.ParseOne(p.doc, doff)
	if err != nil || rec.Type != rtDocument {
		return errors.New("the presentation's document record is damaged")
	}
	p.docRec = rec
	return nil
}

// record returns the record a persist id points at
func (p *pres) record(id uint32) *officeart.Record {
	off, ok := p.persist[id]
	if !ok {
		return nil
	}
	r, _, err := officeart.ParseOne(p.doc, off)
	if err != nil {
		return nil
	}
	return r
}

func (p *pres) readDocument() error {
	le := binary.LittleEndian
	d := p.docRec
	p.slideW, p.slideH = 5760, 4320 // 10 x 7.5 inches
	if a := d.Child(rtDocumentAtom); a != nil && len(a.Data) >= 8 {
		if w, h := int(int32(le.Uint32(a.Data))), int(int32(le.Uint32(a.Data[4:]))); w > 0 && h > 0 {
			p.slideW, p.slideH = w, h
		}
	}
	if env := d.Child(rtEnvironment); env != nil {
		if fc := env.Child(rtFontCollection); fc != nil {
			for _, fe := range fc.All(rtFontEntityAtom) {
				p.fonts = append(p.fonts, utf16z(fe.Data[:min(64, len(fe.Data))]))
			}
		}
		for _, ms := range env.All(rtTxMasterStyleAtom) {
			if ms.Instance == 4 {
				p.envStyle = parseMasterStyle(ms)
			}
		}
	}
	if dg := d.Child(rtPPDrawingGroup); dg != nil {
		if dgg := dg.Child(officeart.DggContainer); dgg != nil {
			p.store = officeart.BStore(dgg, p.pics)
		}
	}
	if ex := d.Child(rtExObjList); ex != nil {
		for _, h := range ex.All(rtExHyperlink) {
			a := h.Child(rtExHyperlinkAtom)
			if a == nil || len(a.Data) < 4 {
				continue
			}
			var l link
			for _, s := range h.All(rtCString) {
				switch s.Instance {
				case 1:
					l.url = utf16z(s.Data)
				case 3:
					l.location = utf16z(s.Data)
				}
			}
			p.links[le.Uint32(a.Data)] = l
		}
	}
	// the three lists: slides (instance 0), masters (1), notes (2)
	for _, lst := range d.All(rtSlideListWithText) {
		var cur *slideRec
		var list []*slideRec
		for _, c := range lst.Children {
			if c.Type == rtSlidePersistAtom && len(c.Data) >= 16 {
				ref := le.Uint32(c.Data)
				cur = &slideRec{id: le.Uint32(c.Data[12:]), rec: p.record(ref)}
				list = append(list, cur)
				continue
			}
			if cur != nil {
				addTextRecord(&cur.texts, c)
			}
		}
		switch lst.Instance {
		case 0:
			p.slides = list
		case 1:
			p.masters = list
		case 2:
			for _, n := range list {
				p.notesByID[n.id] = n
			}
		}
	}
	for _, m := range p.masters {
		m.isMaster = true
		p.masterByID[m.id] = m
		p.readSlide(m)
	}
	var slides []*slideRec
	for i, s := range p.slides {
		if s.rec == nil || s.rec.Type != rtSlide {
			continue
		}
		s.number = i + 1
		p.readSlide(s)
		slides = append(slides, s)
	}
	p.slides = slides
	if len(p.slides) == 0 {
		return errors.New("the presentation has no slides")
	}
	return nil
}

// readSlide reads a slide's or master's atom, scheme and styles
func (p *pres) readSlide(s *slideRec) {
	le := binary.LittleEndian
	if s.rec == nil {
		return
	}
	s.masterObjs, s.masterBg = true, true
	if a := s.rec.Child(rtSlideAtom); a != nil && len(a.Data) >= 22 {
		masterID := le.Uint32(a.Data[12:])
		notesID := le.Uint32(a.Data[16:])
		flags := le.Uint16(a.Data[20:])
		if !s.isMaster {
			s.masterObjs = flags&0x01 != 0
			s.masterBg = flags&0x04 != 0
			s.master = p.masterByID[masterID]
			if n := p.notesByID[notesID]; n != nil && n.rec != nil && n.rec.Type == rtNotes {
				s.notes = n
			}
		}
	}
	for _, cs := range s.rec.All(rtColorSchemeAtom) {
		if cs.Instance == 1 && len(cs.Data) >= 32 {
			for k := 0; k < 8; k++ {
				s.scheme[k] = uint32(cs.Data[4*k])<<16 | uint32(cs.Data[4*k+1])<<8 | uint32(cs.Data[4*k+2])
			}
		}
	}
	if s.isMaster {
		for _, ms := range s.rec.All(rtTxMasterStyleAtom) {
			if ms.Instance < 9 {
				s.styles[ms.Instance] = parseMasterStyle(ms)
			}
		}
	}
	if ti := s.rec.Child(rtSSSlideInfoAtom); ti != nil && len(ti.Data) >= 10 {
		s.transition = transitionName(int(ti.Data[9]), int(ti.Data[8]))
	}
}

// transitionName maps a SlideShowSlideInfoAtom effect onto the
// PresentationML transition element
func transitionName(effect, dir int) string {
	switch effect {
	case 0:
		return ""
	case 6, 23:
		return "fade"
	case 5:
		return "dissolve"
	case 4:
		return "cover"
	case 7:
		return "pull"
	case 10:
		return "wipe"
	case 20:
		return "push"
	case 11:
		return "zoom"
	case 2:
		return "blinds"
	case 3:
		return "checker"
	case 8:
		return "randomBar"
	case 9:
		return "strips"
	case 13:
		return "split"
	case 17:
		return "diamond"
	case 18:
		return "plus"
	case 19:
		return "wedge"
	case 21:
		return "comb"
	case 22:
		return "newsflash"
	case 26:
		return "wheel"
	case 27:
		return "circle"
	}
	return "fade"
}

// utf16z decodes UTF-16 up to the first NUL
func utf16z(b []byte) string {
	u := make([]uint16, 0, len(b)/2)
	for i := 0; i+1 < len(b); i += 2 {
		c := binary.LittleEndian.Uint16(b[i:])
		if c == 0 {
			break
		}
		u = append(u, c)
	}
	return string(decodeUTF16(u))
}
