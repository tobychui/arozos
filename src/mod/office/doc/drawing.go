package doc

/*
	drawing.go - pictures, shapes and text boxes (LibreOffice: ww8graf.cxx,
	ww8graf2.cxx).

	An inline picture is a 0x01 character whose sprmCPicLocation points
	into the Data stream: a PICF header (the size it is shown at, its
	scaling and cropping) followed by an OfficeArt shape and the picture
	store entries holding the picture itself.

	A floating object is a 0x08 character anchored by an FSPA entry
	(PlcSpaMom for the main text, PlcSpaHdr for headers): its rectangle
	and wrapping, and the id of a shape in the document's drawing (the
	OfficeArt content at fcDggInfo). Pictures in the drawing come from
	its picture store, whose entries point back into the WordDocument
	stream. A text box's text is a story of its own (PlcftxbxTxt).
*/

import (
	"encoding/binary"

	"imuslab.com/arozos/mod/office/internal/officeart"
	"imuslab.com/arozos/mod/office/metafile"
)

type picture struct {
	data  []byte
	ext   string
	w, h  int        // shown size, twips
	crop  [4]float64 // left, top, right, bottom: fractions of the picture
	descr string
	frame *brc // an outline around the picture
}

// usable turns a picture into one a .docx reader shows (TIFF and DIB
// become PNG; PICT has no reader at all)
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

func cropOf(props officeart.Props) [4]float64 {
	return [4]float64{
		props.Fixed(officeart.PropCropFromLeft, 0), props.Fixed(officeart.PropCropFromTop, 0),
		props.Fixed(officeart.PropCropFromRight, 0), props.Fixed(officeart.PropCropFromBottom, 0),
	}
}

// inlinePicture reads the picture of a 0x01 character
func (d *docFile) inlinePicture(loc int) *picture {
	le := binary.LittleEndian
	b := d.data
	// against the bytes left: loc+n can overflow a 32-bit int
	if loc < 0 || loc > len(b)-68 {
		return nil
	}
	lcb := int(int32(le.Uint32(b[loc:])))
	cbHeader := int(le.Uint16(b[loc+4:]))
	if lcb < cbHeader || cbHeader < 68 || lcb > len(b)-loc {
		return nil
	}
	h := b[loc : loc+cbHeader]
	mm := int(int16(le.Uint16(h[6:])))
	dxaGoal := int(int16(le.Uint16(h[28:])))
	dyaGoal := int(int16(le.Uint16(h[30:])))
	mx := int(le.Uint16(h[32:]))
	my := int(le.Uint16(h[34:]))
	cl := int(int16(le.Uint16(h[36:])))
	ct := int(int16(le.Uint16(h[38:])))
	cr := int(int16(le.Uint16(h[40:])))
	cb := int(int16(le.Uint16(h[42:])))
	if mx == 0 {
		mx = 1000
	}
	if my == 0 {
		my = 1000
	}
	pic := &picture{
		w: (dxaGoal - cl - cr) * mx / 1000,
		h: (dyaGoal - ct - cb) * my / 1000,
	}
	// the PICF's own borders: Word draws one outline from the top one
	if b := brc80(h[46:50]); b.typ != 0 && b.typ != 0xFF {
		pic.frame = &b
	}
	if dxaGoal > 0 && dyaGoal > 0 {
		pic.crop = [4]float64{float64(cl) / float64(dxaGoal), float64(ct) / float64(dyaGoal),
			float64(cr) / float64(dxaGoal), float64(cb) / float64(dyaGoal)}
	}
	body := b[loc+cbHeader : loc+lcb]
	if mm != 0x64 && mm != 0x66 {
		// an old style picture: a bare Windows metafile
		pic.data, pic.ext = body, "wmf"
		return pic
	}
	if mm == 0x66 && len(body) > 0 {
		n := int(body[0])
		if 1+n > len(body) {
			return nil
		}
		body = body[1+n:]
	}
	recs := officeart.Parse(body)
	var shape *officeart.Shape
	var blips []*officeart.Blip
	for _, r := range recs {
		switch {
		case r.Type == officeart.SpContainer && shape == nil:
			shape = officeart.ReadShape(r)
		case r.Type == officeart.FBSE:
			blips = append(blips, officeart.ReadBSE(r, nil))
		case r.Type >= officeart.BlipFirst && r.Type <= officeart.BlipLast:
			bl, _ := officeart.DecodeBlip(r)
			blips = append(blips, bl)
		}
	}
	idx := 0
	if shape != nil {
		if v, ok := shape.Props.Get(officeart.PropPib); ok && int(v) >= 1 && int(v) <= len(blips) {
			idx = int(v) - 1
		}
		if c := cropOf(shape.Props); c != [4]float64{} {
			pic.crop = c
		}
		pic.descr = shape.Props.String(officeart.PropWzDescription)
	}
	if idx >= len(blips) {
		return nil
	}
	data, ext, ok := usable(blips[idx])
	if !ok {
		return nil
	}
	pic.data, pic.ext = data, ext
	return pic
}

/* ---------------- floating objects ---------------- */

type floatObj struct {
	pic      *picture
	x, y     int // twips, relative to relH / relV
	w, h     int
	relH     string // margin, page, column
	relV     string // margin, page, paragraph
	wrap     int    // FSPA wr: 1 top and bottom, 2 square, 3 none, 4 tight, 5 through
	behind   bool
	txbx     []int // indexes of the text box stories it shows
	inHeader bool
}

type fspa struct {
	spid                     int32
	left, top, right, bottom int
	bx, by, wr               int
	below                    bool
}

// drawings holds the OfficeArt content of the document
type drawings struct {
	shapes map[int32]*officeart.Shape
	store  []*officeart.Blip
	mom    map[int]fspa // anchor CP -> FSPA (main text)
	hdr    map[int]fspa // anchor CP -> FSPA (headers, absolute CP)
}

func (d *docFile) readDrawings() {
	dr := &drawings{shapes: map[int32]*officeart.Shape{}, mom: map[int]fspa{}, hdr: map[int]fspa{}}
	d.draw = dr
	readFspa := func(b []byte, base int, into map[int]fspa) {
		pl := parsePLC(b, 26)
		for i := 0; i < pl.n(); i++ {
			it := pl.item(i)
			if it == nil {
				continue
			}
			le := binary.LittleEndian
			fl := le.Uint16(it[20:])
			into[base+pl.pos[i]] = fspa{
				spid: int32(le.Uint32(it)),
				left: int(int32(le.Uint32(it[4:]))), top: int(int32(le.Uint32(it[8:]))),
				right: int(int32(le.Uint32(it[12:]))), bottom: int(int32(le.Uint32(it[16:]))),
				bx: int(fl>>1) & 3, by: int(fl>>3) & 3, wr: int(fl>>5) & 0xF,
				below: fl&0x4000 != 0,
			}
		}
	}
	readFspa(d.fib.span(d.tbl, lcbPlcSpaMom), 0, dr.mom)
	readFspa(d.fib.span(d.tbl, lcbPlcSpaHdr), d.fib.hddStart(), dr.hdr)

	content := d.fib.span(d.tbl, lcbDggInfo)
	if len(content) == 0 {
		return
	}
	dgg, next, err := officeart.ParseOne(content, 0)
	if err != nil {
		return
	}
	dr.store = officeart.BStore(dgg, d.wd)
	for next < len(content) {
		next++ // dgglbl: 0 main document, 1 headers
		dg, n2, err := officeart.ParseOne(content, next)
		if err != nil || n2 <= next {
			break
		}
		next = n2
		for _, spgr := range dg.All(officeart.SpgrContainer) {
			officeart.Walk(officeart.ReadGroup(spgr), func(sh *officeart.Shape, _ []*officeart.Shape) {
				dr.shapes[int32(sh.ID)] = sh
			})
		}
		for _, sp := range dg.All(officeart.SpContainer) {
			sh := officeart.ReadShape(sp)
			dr.shapes[int32(sh.ID)] = sh
		}
	}
}

// shapePicture is the picture a shape shows, if any
func (d *docFile) shapePicture(sh *officeart.Shape) *picture {
	pib, ok := sh.Props.Get(officeart.PropPib)
	if !ok {
		if v, ok2 := sh.Props.Get(officeart.PropFillBlip); ok2 && sh.Type != 202 {
			pib, ok = v, true
		}
	}
	if !ok || int(pib) < 1 || int(pib) > len(d.draw.store) {
		return nil
	}
	data, ext, ok := usable(d.draw.store[pib-1])
	if !ok {
		return nil
	}
	return &picture{data: data, ext: ext, crop: cropOf(sh.Props), descr: sh.Props.String(officeart.PropWzDescription)}
}

// floating returns the object anchored at cp (nil when none)
func (d *docFile) floating(cp int) *floatObj {
	if d.draw == nil {
		return nil
	}
	fs, ok := d.draw.mom[cp]
	header := false
	if !ok {
		if fs, ok = d.draw.hdr[cp]; !ok {
			return nil
		}
		header = true
	}
	sh := d.draw.shapes[fs.spid]
	if sh == nil {
		return nil
	}
	fo := &floatObj{
		x: fs.left, y: fs.top, w: fs.right - fs.left, h: fs.bottom - fs.top,
		relH: []string{"margin", "page", "column", "column"}[fs.bx],
		relV: []string{"margin", "page", "paragraph", "paragraph"}[fs.by],
		wrap: fs.wr, behind: fs.below, inHeader: header,
	}
	// a group: its pictures and text boxes, the first picture standing
	// for the whole frame
	officeart.Walk(sh, func(s *officeart.Shape, _ []*officeart.Shape) {
		if s.Deleted() {
			return
		}
		if fo.pic == nil {
			if p := d.shapePicture(s); p != nil {
				fo.pic = p
			}
		}
		if v, ok := s.Props.Get(officeart.PropLTxid); ok {
			fo.txbx = append(fo.txbx, int(v>>16)-1)
		}
	})
	if fo.pic != nil {
		fo.pic.w, fo.pic.h = fo.w, fo.h
	}
	return fo
}
