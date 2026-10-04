package office

/*
	metafile_wmf.go - plays Windows Metafile (WMF) records onto an mfCanvas

	A WMF is an optional "placeable" header (the picture's bounding box and
	units per inch), the metafile header, then 16-bit records: a size in
	words, a function number and parameters, mostly 16-bit signed values
	listed in reverse (y before x, bottom before top).

	The window (SETWINDOWORG / SETWINDOWEXT) is mapped onto the placeable
	bounding box, as Office does; a metafile without a placeable header is
	drawn at one pixel per logical unit of its window.
*/

import (
	"encoding/binary"
	"errors"
	"image"
	"math"
	"unicode/utf16"
)

type wmfPlayer struct {
	data    []byte
	records int // offset of the first record
	// placeable bounding box (logical units) and units per inch
	hasBox   bool
	box      [4]float64 // left, top, right, bottom
	inch     float64
	firstWin [4]float64 // the window set before the first drawing record
	hasWin   bool
}

func newWmfPlayer(data []byte) (*wmfPlayer, error) {
	p := &wmfPlayer{data: data}
	off := 0
	if len(data) >= 22 && binary.LittleEndian.Uint32(data) == 0x9AC6CDD7 {
		s := func(i int) float64 { return float64(int16(binary.LittleEndian.Uint16(data[i:]))) }
		p.box = [4]float64{s(6), s(8), s(10), s(12)}
		p.inch = float64(binary.LittleEndian.Uint16(data[14:]))
		if p.inch == 0 {
			p.inch = 1440
		}
		p.hasBox = p.box[2] != p.box[0] && p.box[3] != p.box[1]
		off = 22
	}
	if len(data) < off+18 {
		return nil, errors.New("WMF header truncated")
	}
	hs := int(binary.LittleEndian.Uint16(data[off+2:])) * 2
	if hs < 18 {
		hs = 18
	}
	p.records = off + hs

	// the window in force when drawing starts frames a metafile that has
	// no placeable header
	org, ext := [2]float64{}, [2]float64{}
	extSet := false
	p.walk(func(fn uint16, prm []byte) bool {
		switch fn {
		case 0x020B:
			org = [2]float64{wmfS(prm, 1), wmfS(prm, 0)}
		case 0x020C:
			ext = [2]float64{wmfS(prm, 1), wmfS(prm, 0)}
			extSet = true
		case 0x0103, 0x0102, 0x0201, 0x0209, 0x012E, 0x0106, 0x001E, 0x0127,
			0x012D, 0x01F0, 0x02FA, 0x02FC, 0x02FB, 0x00F7, 0x0626, 0x020D, 0x020E:
		default:
			return false
		}
		return true
	})
	if extSet && ext[0] != 0 && ext[1] != 0 {
		p.firstWin = [4]float64{org[0], org[1], ext[0], ext[1]}
		p.hasWin = true
	}
	if !p.hasBox && !p.hasWin {
		return nil, errors.New("WMF has neither a placeable header nor a window")
	}
	return p, nil
}

// walk visits every record until EOF, a malformed record, or visit
// returning false
func (p *wmfPlayer) walk(visit func(fn uint16, prm []byte) bool) {
	d := p.data
	for i := p.records; i+6 <= len(d); {
		size := int(binary.LittleEndian.Uint32(d[i:])) * 2
		fn := binary.LittleEndian.Uint16(d[i+4:])
		if fn == 0 || size < 6 || i+size > len(d) {
			return
		}
		if !visit(fn, d[i+6:i+size]) {
			return
		}
		i += size
	}
}

// wmfS reads the n-th 16-bit signed parameter
func wmfS(prm []byte, n int) float64 {
	if 2*n+2 > len(prm) {
		return 0
	}
	return float64(int16(binary.LittleEndian.Uint16(prm[2*n:])))
}

func wmfU(prm []byte, n int) uint32 {
	if 2*n+2 > len(prm) {
		return 0
	}
	return uint32(binary.LittleEndian.Uint16(prm[2*n:]))
}

func wmfU32(prm []byte, n int) uint32 {
	return wmfU(prm, n) | wmfU(prm, n+1)<<16
}

func (p *wmfPlayer) baseSize() (float64, float64) {
	if p.hasBox {
		return math.Abs(p.box[2]-p.box[0]) / p.inch * 96, math.Abs(p.box[3]-p.box[1]) / p.inch * 96
	}
	return math.Abs(p.firstWin[2]), math.Abs(p.firstWin[3])
}

// wmfPoints reads count (x, y) pairs starting at parameter n
func wmfPoints(prm []byte, n, count int) []mfPt {
	if count <= 0 || 2*(n+2*count) > len(prm) {
		return nil
	}
	pts := make([]mfPt, count)
	for i := range pts {
		pts[i] = mfPt{wmfS(prm, n+2*i), wmfS(prm, n+2*i+1)}
	}
	return pts
}

func (p *wmfPlayer) play(c *mfCanvas) error {
	bw, bh := p.baseSize()
	frame := p.firstWin
	if p.hasBox {
		frame = [4]float64{p.box[0], p.box[1], p.box[2] - p.box[0], p.box[3] - p.box[1]}
	}
	c.dc.winOrg = mfPt{frame[0], frame[1]}
	c.dc.winExt = mfPt{frame[2], frame[3]}
	c.toCSS = func(q mfPt) mfPt {
		ex, ey := c.dc.winExt.X, c.dc.winExt.Y
		if ex == 0 {
			ex = 1
		}
		if ey == 0 {
			ey = 1
		}
		return mfPt{(q.X - c.dc.winOrg.X) / ex * bw, (q.Y - c.dc.winOrg.Y) / ey * bh}
	}

	// the object table: a created object takes the lowest free slot
	slots := []*mfObject{}
	create := func(o *mfObject) {
		if o == nil {
			o = &mfObject{}
		}
		for i, s := range slots {
			if s == nil {
				slots[i] = o
				return
			}
		}
		slots = append(slots, o)
	}

	p.walk(func(fn uint16, prm []byte) bool {
		switch fn {
		case 0x001E: // SAVEDC
			c.save()
		case 0x0127: // RESTOREDC
			c.restore(int(wmfS(prm, 0)))
		case 0x0103: // SETMAPMODE
			c.dc.mapMode = int(wmfU(prm, 0))
		case 0x020B: // SETWINDOWORG
			c.dc.winOrg = mfPt{wmfS(prm, 1), wmfS(prm, 0)}
		case 0x020C: // SETWINDOWEXT
			c.dc.winExt = mfPt{wmfS(prm, 1), wmfS(prm, 0)}
		case 0x020F: // OFFSETWINDOWORG
			c.dc.winOrg.X += wmfS(prm, 1)
			c.dc.winOrg.Y += wmfS(prm, 0)
		case 0x0410: // SCALEWINDOWEXT yDenom yNum xDenom xNum
			if yd, xd := wmfS(prm, 0), wmfS(prm, 2); yd != 0 && xd != 0 {
				c.dc.winExt.X = c.dc.winExt.X * wmfS(prm, 3) / xd
				c.dc.winExt.Y = c.dc.winExt.Y * wmfS(prm, 1) / yd
			}
		case 0x0102: // SETBKMODE
			c.dc.bkOpaque = wmfU(prm, 0) == 2
		case 0x0201: // SETBKCOLOR
			c.dc.bkColor = colorRef(wmfU32(prm, 0))
		case 0x0209: // SETTEXTCOLOR
			c.dc.textColor = colorRef(wmfU32(prm, 0))
		case 0x012E: // SETTEXTALIGN
			c.dc.textAlign = wmfU(prm, 0)
		case 0x0106: // SETPOLYFILLMODE
			c.dc.winding = wmfU(prm, 0) == 2

		case 0x02FA: // CREATEPENINDIRECT style, width(x, y), colour
			create(&mfObject{pen: penFromStyle(wmfU(prm, 0), wmfS(prm, 1), wmfU32(prm, 3))})
		case 0x02FC: // CREATEBRUSHINDIRECT style, colour, hatch
			create(&mfObject{brush: brushFromStyle(wmfU(prm, 0), wmfU32(prm, 1))})
		case 0x02FB: // CREATEFONTINDIRECT
			create(&mfObject{font: wmfFont(prm)})
		case 0x0142, 0x01F9: // DIBCREATEPATTERNBRUSH, CREATEPATTERNBRUSH
			create(&mfObject{brush: brushFromStyle(3, 0)})
		case 0x00F7, 0x06FF: // CREATEPALETTE, CREATEREGION
			create(nil)
		case 0x012D: // SELECTOBJECT
			if i := int(wmfU(prm, 0)); i < len(slots) {
				c.selectObject(slots[i])
			}
		case 0x01F0: // DELETEOBJECT
			if i := int(wmfU(prm, 0)); i < len(slots) {
				slots[i] = nil
			}

		case 0x0214: // MOVETO
			c.dc.cur = mfPt{wmfS(prm, 1), wmfS(prm, 0)}
		case 0x0213: // LINETO
			to := mfPt{wmfS(prm, 1), wmfS(prm, 0)}
			c.shape([][]mfPt{{c.dc.cur, to}}, false)
			c.dc.cur = to
		case 0x041B: // RECTANGLE bottom right top left
			c.shape([][]mfPt{rectPoly(wmfS(prm, 3), wmfS(prm, 2), wmfS(prm, 1), wmfS(prm, 0))}, true)
		case 0x0418: // ELLIPSE
			c.shape([][]mfPt{ellipsePoly(wmfS(prm, 3), wmfS(prm, 2), wmfS(prm, 1), wmfS(prm, 0))}, true)
		case 0x061C: // ROUNDRECT height width bottom right top left
			c.shape([][]mfPt{roundRectPoly(wmfS(prm, 5), wmfS(prm, 4), wmfS(prm, 3), wmfS(prm, 2), wmfS(prm, 1), wmfS(prm, 0))}, true)
		case 0x0817, 0x081A, 0x0830: // ARC, PIE, CHORD
			l, t, r, b := wmfS(prm, 7), wmfS(prm, 6), wmfS(prm, 5), wmfS(prm, 4)
			pts := arcPoly(l, t, r, b, mfPt{wmfS(prm, 3), wmfS(prm, 2)}, mfPt{wmfS(prm, 1), wmfS(prm, 0)})
			switch fn {
			case 0x0817:
				c.shape([][]mfPt{pts}, false)
			case 0x081A:
				c.shape([][]mfPt{append(pts, mfPt{(l + r) / 2, (t + b) / 2})}, true)
			default:
				c.shape([][]mfPt{pts}, true)
			}
		case 0x0324, 0x0325: // POLYGON, POLYLINE
			pts := wmfPoints(prm, 1, int(wmfS(prm, 0)))
			c.shape([][]mfPt{pts}, fn == 0x0324)
		case 0x0538: // POLYPOLYGON
			n := int(wmfU(prm, 0))
			at := 1 + n
			var polys [][]mfPt
			for k := 0; k < n; k++ {
				cnt := int(wmfU(prm, 1+k))
				polys = append(polys, wmfPoints(prm, at, cnt))
				at += 2 * cnt
			}
			c.shape(polys, true)

		case 0x061D: // PATBLT rop(32) height width y x
			c.patBlt(wmfS(prm, 5), wmfS(prm, 4), wmfS(prm, 3), wmfS(prm, 2), wmfU32(prm, 0))
		case 0x0B41: // DIBSTRETCHBLT
			p.stretchBlt(c, prm, 2, true)
		case 0x0940: // DIBBITBLT
			p.stretchBlt(c, prm, 2, false)
		case 0x0F43: // STRETCHDIB rop(32) usage srcH srcW ySrc xSrc dstH dstW yDst xDst DIB
			if len(prm) > 22 {
				rop, usage := wmfU32(prm, 0), wmfU(prm, 2)
				if img, info, err := decodePackedDIB(prm[22:], usage); err == nil {
					sr := image.Rect(int(wmfS(prm, 6)), int(wmfS(prm, 5)), int(wmfS(prm, 6)+wmfS(prm, 4)), int(wmfS(prm, 5)+wmfS(prm, 3)))
					c.blit(img, dibSrcRect(sr, info, true), wmfS(prm, 10), wmfS(prm, 9), wmfS(prm, 8), wmfS(prm, 7), rop, info.isPhoto())
				}
			}
		case 0x0D33: // SETDIBTODEV usage scanCount startScan yDib xDib h w yDest xDest DIB
			if len(prm) > 18 {
				if img, info, err := decodePackedDIB(prm[18:], wmfU(prm, 0)); err == nil {
					w, h := wmfS(prm, 6), wmfS(prm, 5)
					sr := image.Rect(int(wmfS(prm, 4)), int(wmfS(prm, 3)), int(wmfS(prm, 4)+w), int(wmfS(prm, 3)+h))
					c.blit(img, dibSrcRect(sr, info, true), wmfS(prm, 8), wmfS(prm, 7), w, h, ropSrcCopy, info.isPhoto())
				}
			}

		case 0x0521: // TEXTOUT len string(padded) y x
			n := int(wmfU(prm, 0))
			sb := (n + 1) / 2 * 2
			if 2+sb+4 <= len(prm) {
				s := prm[2 : 2+n]
				y := wmfS(prm[2+sb:], 0)
				x := wmfS(prm[2+sb:], 1)
				c.text(mfPt{x, y}, ansiRunes(s), nil)
			}
		case 0x0A32: // EXTTEXTOUT y x len opts [rect] string [dx]
			y, x := wmfS(prm, 0), wmfS(prm, 1)
			n := int(wmfU(prm, 2))
			opts := wmfU(prm, 3)
			at := 8
			if opts&0x6 != 0 && len(prm) >= 16 {
				if opts&0x2 != 0 { // ETO_OPAQUE
					c.opaqueBox(wmfS(prm, 4), wmfS(prm, 5), wmfS(prm, 6), wmfS(prm, 7))
				}
				at = 16
			}
			if at+n <= len(prm) {
				s := ansiRunes(prm[at : at+n])
				var dx []float64
				dAt := at + (n+1)/2*2
				if dAt+2*n <= len(prm) {
					dx = make([]float64, n)
					for i := range dx {
						dx[i] = wmfS(prm[dAt:], i)
					}
				}
				c.text(mfPt{x, y}, s, dx)
			}
		}
		return true
	})
	return nil
}

// stretchBlt plays DIBSTRETCHBLT (stretch) and DIBBITBLT. at is the
// parameter index after the 32-bit raster op.
func (p *wmfPlayer) stretchBlt(c *mfCanvas, prm []byte, at int, stretch bool) {
	rop := wmfU32(prm, 0)
	// a record without a bitmap carries one reserved word more than the
	// parameters and no DIB: it is a pattern fill
	nParams := 8
	if !stretch {
		nParams = 6
	}
	var srcW, srcH, ySrc, xSrc, dstW, dstH, yDst, xDst float64
	read := func(base int) {
		if stretch {
			srcH, srcW, ySrc, xSrc = wmfS(prm, base), wmfS(prm, base+1), wmfS(prm, base+2), wmfS(prm, base+3)
			dstH, dstW, yDst, xDst = wmfS(prm, base+4), wmfS(prm, base+5), wmfS(prm, base+6), wmfS(prm, base+7)
		} else {
			ySrc, xSrc = wmfS(prm, base), wmfS(prm, base+1)
			dstH, dstW, yDst, xDst = wmfS(prm, base+2), wmfS(prm, base+3), wmfS(prm, base+4), wmfS(prm, base+5)
			srcW, srcH = dstW, dstH
		}
	}
	if len(prm) == 2*(at+nParams+1) {
		read(at + 1)
		c.patBlt(xDst, yDst, dstW, dstH, rop)
		return
	}
	read(at)
	dibAt := 2 * (at + nParams)
	if dibAt >= len(prm) {
		return
	}
	img, info, err := decodePackedDIB(prm[dibAt:], 0)
	if err != nil {
		return
	}
	sr := image.Rect(int(xSrc), int(ySrc), int(xSrc+srcW), int(ySrc+srcH))
	c.blit(img, dibSrcRect(sr, info, false), xDst, yDst, dstW, dstH, rop, info.isPhoto())
}

// dibSrcRect turns a source rectangle into decoded-image coordinates.
// StretchDIBits and SetDIBitsToDevice measure y from the bottom row of a
// bottom-up DIB (fromBottom); the blt records read the DIB as a bitmap
// whose origin is the top-left corner, like the decoded image.
func dibSrcRect(r image.Rectangle, info *dibInfo, fromBottom bool) image.Rectangle {
	r = r.Canon()
	if fromBottom && !info.topDown {
		r = image.Rect(r.Min.X, info.h-r.Max.Y, r.Max.X, info.h-r.Min.Y)
	}
	return r
}

// wmfFont reads a WMF LOGFONT (16-bit fields)
func wmfFont(prm []byte) *mfFont {
	f := &mfFont{
		height:     wmfS(prm, 0),
		escapement: wmfS(prm, 2),
		weight:     int(wmfS(prm, 4)),
	}
	if len(prm) >= 18 {
		f.italic = prm[10] != 0
		f.underline = prm[11] != 0
		f.strike = prm[12] != 0
		name := prm[18:]
		for i, b := range name {
			if b == 0 {
				name = name[:i]
				break
			}
		}
		f.face = string(ansiRunes(name))
	}
	return f
}

// ansiRunes reads 8-bit text as Windows-1252 (close enough for the
// Western code pages metafiles from Office use)
func ansiRunes(b []byte) []rune {
	out := make([]rune, 0, len(b))
	for _, c := range b {
		if c >= 0x80 && c < 0xA0 {
			out = append(out, cp1252High[c-0x80])
			continue
		}
		out = append(out, rune(c))
	}
	return out
}

var cp1252High = [32]rune{
	0x20AC, 0x81, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, 0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x8D, 0x017D, 0x8F,
	0x90, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, 0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x9D, 0x017E, 0x0178,
}

// utf16Runes reads n UTF-16LE code units
func utf16Runes(b []byte, n int) []rune {
	if 2*n > len(b) {
		n = len(b) / 2
	}
	u := make([]uint16, n)
	for i := range u {
		u[i] = binary.LittleEndian.Uint16(b[2*i:])
	}
	return utf16.Decode(u)
}
