package office

/*
	metafile_emf.go - plays Enhanced Metafile (EMF) records onto an mfCanvas

	An EMF is a list of records (32-bit type and size, then parameters).
	Coordinates go logical -> world transform -> page -> device (through the
	map mode, window and viewport); the header's frame (0.01 mm) and its
	reference device size place the picture in device units.

	EMF+ records ride inside GDI comments; files written in "dual" mode
	keep the plain EMF drawing next to them, which is what is played.
*/

import (
	"encoding/binary"
	"errors"
	"image"
	"math"
)

type emfPlayer struct {
	data []byte
	// the picture frame in device units and its CSS pixel size
	devOrg       mfPt
	devW, devH   float64
	cssW, cssH   float64
	devPerMMX    float64
	devPerMMY    float64
	recordsStart int
}

func newEmfPlayer(data []byte) (*emfPlayer, error) {
	if len(data) < 88 {
		return nil, errors.New("EMF header truncated")
	}
	i32 := func(o int) float64 { return float64(int32(binary.LittleEndian.Uint32(data[o:]))) }
	p := &emfPlayer{data: data}
	bl, bt, br, bb := i32(8), i32(12), i32(16), i32(20)
	fl, ft, fr, fb := i32(24), i32(28), i32(32), i32(36)
	devCX, devCY := i32(72), i32(76)
	mmCX, mmCY := i32(80), i32(84)
	p.devPerMMX, p.devPerMMY = 96/25.4, 96/25.4
	if devCX > 0 && devCY > 0 && mmCX > 0 && mmCY > 0 {
		p.devPerMMX, p.devPerMMY = devCX/mmCX, devCY/mmCY
	}
	if fr > fl && fb > ft {
		// frame: 0.01 mm, inclusive
		p.devOrg = mfPt{fl / 100 * p.devPerMMX, ft / 100 * p.devPerMMY}
		p.devW = (fr - fl) / 100 * p.devPerMMX
		p.devH = (fb - ft) / 100 * p.devPerMMY
		p.cssW = (fr - fl) / 100 / 25.4 * 96
		p.cssH = (fb - ft) / 100 / 25.4 * 96
	} else if br > bl && bb > bt {
		p.devOrg = mfPt{bl, bt}
		p.devW, p.devH = br-bl+1, bb-bt+1
		p.cssW = p.devW / p.devPerMMX / 25.4 * 96
		p.cssH = p.devH / p.devPerMMY / 25.4 * 96
	} else {
		return nil, errors.New("EMF has an empty frame")
	}
	p.recordsStart = int(binary.LittleEndian.Uint32(data[4:]))
	if p.recordsStart < 88 || p.recordsStart > len(data) {
		return nil, errors.New("EMF header size is invalid")
	}
	return p, nil
}

func (p *emfPlayer) baseSize() (float64, float64) {
	return p.cssW, p.cssH
}

// toDevice maps a logical point through the world transform and the map
// mode to device units
func (p *emfPlayer) toDevice(dc *mfDC, q mfPt) mfPt {
	x := dc.xf[0]*q.X + dc.xf[2]*q.Y + dc.xf[4]
	y := dc.xf[1]*q.X + dc.xf[3]*q.Y + dc.xf[5]
	x -= dc.winOrg.X
	y -= dc.winOrg.Y
	switch dc.mapMode {
	case mmIsotropic, mmAnisotropic:
		sx, sy := 1.0, 1.0
		if dc.winExt.X != 0 && dc.winExt.Y != 0 {
			sx, sy = dc.vpExt.X/dc.winExt.X, dc.vpExt.Y/dc.winExt.Y
		}
		if dc.mapMode == mmIsotropic {
			m := math.Min(math.Abs(sx), math.Abs(sy))
			sx, sy = math.Copysign(m, sx), math.Copysign(m, sy)
		}
		x, y = x*sx, y*sy
	case mmLoMetric, mmHiMetric, mmLoEnglish, mmHiEnglish, mmTwips:
		mm := map[int]float64{mmLoMetric: 0.1, mmHiMetric: 0.01, mmLoEnglish: 0.254,
			mmHiEnglish: 0.0254, mmTwips: 25.4 / 1440}[dc.mapMode]
		x, y = x*mm*p.devPerMMX, -y*mm*p.devPerMMY
	}
	return mfPt{x + dc.vpOrg.X, y + dc.vpOrg.Y}
}

// emfRec is one record's parameter reader (offsets from the record start)
type emfRec []byte

func (r emfRec) u32(o int) uint32 {
	if o+4 > len(r) {
		return 0
	}
	return binary.LittleEndian.Uint32(r[o:])
}

func (r emfRec) i32(o int) float64 { return float64(int32(r.u32(o))) }

func (r emfRec) i16(o int) float64 {
	if o+2 > len(r) {
		return 0
	}
	return float64(int16(binary.LittleEndian.Uint16(r[o:])))
}

func (r emfRec) f32(o int) float64 { return float64(math.Float32frombits(r.u32(o))) }

// points reads n points (32-bit or 16-bit pairs) at offset o
func (r emfRec) points(o, n int, small bool) []mfPt {
	sz := 8
	if small {
		sz = 4
	}
	if n <= 0 || o+n*sz > len(r) {
		return nil
	}
	pts := make([]mfPt, n)
	for i := range pts {
		if small {
			pts[i] = mfPt{r.i16(o + 4*i), r.i16(o + 4*i + 2)}
		} else {
			pts[i] = mfPt{r.i32(o + 8*i), r.i32(o + 8*i + 4)}
		}
	}
	return pts
}

// slice returns the [off, off+size) part of the record, or nil
func (r emfRec) slice(off, size uint32) []byte {
	if size == 0 || uint64(off)+uint64(size) > uint64(len(r)) {
		return nil
	}
	return r[off : off+size]
}

func (p *emfPlayer) play(c *mfCanvas) error {
	sx, sy := p.cssW/p.devW, p.cssH/p.devH
	c.toCSS = func(q mfPt) mfPt {
		d := p.toDevice(&c.dc, q)
		return mfPt{(d.X - p.devOrg.X) * sx, (d.Y - p.devOrg.Y) * sy}
	}
	d := p.data
	for i := p.recordsStart; i+8 <= len(d); {
		typ := binary.LittleEndian.Uint32(d[i:])
		size := int(binary.LittleEndian.Uint32(d[i+4:]))
		if size < 8 || i+size > len(d) {
			break
		}
		if typ == 14 { // EOF
			break
		}
		p.record(c, typ, emfRec(d[i:i+size]))
		i += size
	}
	return nil
}

func (p *emfPlayer) record(c *mfCanvas, typ uint32, r emfRec) {
	switch typ {
	case 9: // SETWINDOWEXTEX
		c.dc.winExt = mfPt{r.i32(8), r.i32(12)}
	case 10: // SETWINDOWORGEX
		c.dc.winOrg = mfPt{r.i32(8), r.i32(12)}
	case 11: // SETVIEWPORTEXTEX
		c.dc.vpExt = mfPt{r.i32(8), r.i32(12)}
	case 12: // SETVIEWPORTORGEX
		c.dc.vpOrg = mfPt{r.i32(8), r.i32(12)}
	case 17: // SETMAPMODE
		c.dc.mapMode = int(r.u32(8))
	case 18: // SETBKMODE
		c.dc.bkOpaque = r.u32(8) == 2
	case 19: // SETPOLYFILLMODE
		c.dc.winding = r.u32(8) == 2
	case 22: // SETTEXTALIGN
		c.dc.textAlign = r.u32(8)
	case 24: // SETTEXTCOLOR
		c.dc.textColor = colorRef(r.u32(8))
	case 25: // SETBKCOLOR
		c.dc.bkColor = colorRef(r.u32(8))
	case 33: // SAVEDC
		c.save()
	case 34: // RESTOREDC
		c.restore(int(int32(r.u32(8))))
	case 35: // SETWORLDTRANSFORM
		c.dc.xf = [6]float64{r.f32(8), r.f32(12), r.f32(16), r.f32(20), r.f32(24), r.f32(28)}
	case 36: // MODIFYWORLDTRANSFORM
		m := [6]float64{r.f32(8), r.f32(12), r.f32(16), r.f32(20), r.f32(24), r.f32(28)}
		switch r.u32(32) {
		case 1:
			c.dc.xf = [6]float64{1, 0, 0, 1, 0, 0}
		case 2: // left multiply: m * xf
			c.dc.xf = xfMul(m, c.dc.xf)
		case 3: // right multiply: xf * m
			c.dc.xf = xfMul(c.dc.xf, m)
		case 4:
			c.dc.xf = m
		}

	case 37: // SELECTOBJECT
		h := r.u32(8)
		if h&0x80000000 != 0 {
			c.selectObject(stockObject(h))
		} else {
			c.selectObject(c.objs[h])
		}
	case 40: // DELETEOBJECT
		delete(c.objs, r.u32(8))
	case 38: // CREATEPEN ih style width(x, y) colour
		c.objs[r.u32(8)] = &mfObject{pen: penFromStyle(r.u32(12), r.i32(16), r.u32(24))}
	case 95: // EXTCREATEPEN ih offBmi cbBmi offBits cbBits style width brushStyle colour
		pen := penFromStyle(r.u32(28), r.i32(32), r.u32(40))
		if r.u32(28)&0x000F0000 == 0 { // PS_COSMETIC: always one pixel
			pen.width = 0
		}
		if r.u32(36) == 1 { // BS_NULL brush
			pen.null = true
		}
		c.objs[r.u32(8)] = &mfObject{pen: pen}
	case 39: // CREATEBRUSHINDIRECT ih style colour hatch
		c.objs[r.u32(8)] = &mfObject{brush: brushFromStyle(r.u32(12), r.u32(16))}
	case 93, 94: // CREATEDIBPATTERNBRUSHPT, CREATEMONOBRUSH
		c.objs[r.u32(8)] = &mfObject{brush: brushFromStyle(3, 0)}
	case 82: // EXTCREATEFONTINDIRECTW
		c.objs[r.u32(8)] = &mfObject{font: emfFont(r[12:])}
	case 49: // CREATEPALETTE
		c.objs[r.u32(8)] = &mfObject{}

	case 27: // MOVETOEX
		c.dc.cur = mfPt{r.i32(8), r.i32(12)}
		if c.inPath {
			c.pathMoveTo(c.dc.cur)
		}
	case 54: // LINETO
		to := mfPt{r.i32(8), r.i32(12)}
		if c.inPath {
			c.pathLineTo(to)
		} else {
			c.shape([][]mfPt{{c.dc.cur, to}}, false)
		}
		c.dc.cur = to
	case 43: // RECTANGLE
		c.shape([][]mfPt{rectPoly(r.i32(8), r.i32(12), r.i32(16), r.i32(20))}, true)
	case 42: // ELLIPSE
		c.shape([][]mfPt{ellipsePoly(r.i32(8), r.i32(12), r.i32(16), r.i32(20))}, true)
	case 44: // ROUNDRECT
		c.shape([][]mfPt{roundRectPoly(r.i32(8), r.i32(12), r.i32(16), r.i32(20), r.i32(24), r.i32(28))}, true)
	case 45, 46, 47, 55: // ARC, CHORD, PIE, ARCTO
		l, t, rr, b := r.i32(8), r.i32(12), r.i32(16), r.i32(20)
		pts := arcPoly(l, t, rr, b, mfPt{r.i32(24), r.i32(28)}, mfPt{r.i32(32), r.i32(36)})
		switch typ {
		case 45:
			c.shape([][]mfPt{pts}, false)
		case 47:
			c.shape([][]mfPt{append(pts, mfPt{(l + rr) / 2, (t + b) / 2})}, true)
		case 46:
			c.shape([][]mfPt{pts}, true)
		case 55:
			if len(pts) > 0 {
				if c.inPath {
					c.pathLineTo(pts...)
				} else {
					c.shape([][]mfPt{append([]mfPt{c.dc.cur}, pts...)}, false)
				}
				c.dc.cur = pts[len(pts)-1]
			}
		}

	case 3, 4, 86, 87: // POLYGON, POLYLINE (32 / 16 bit)
		small := typ >= 86
		pts := r.points(28, int(r.u32(24)), small)
		c.shape([][]mfPt{pts}, typ == 3 || typ == 86)
	case 2, 85: // POLYBEZIER
		pts := r.points(28, int(r.u32(24)), typ == 85)
		c.shape([][]mfPt{bezierPoly(pts)}, false)
	case 5, 88, 6, 89: // POLYBEZIERTO, POLYLINETO
		small := typ == 88 || typ == 89
		pts := r.points(28, int(r.u32(24)), small)
		if len(pts) == 0 {
			break
		}
		if typ == 5 || typ == 88 {
			pts = bezierPoly(append([]mfPt{c.dc.cur}, pts...))[1:]
		}
		if c.inPath {
			c.pathLineTo(pts...)
		} else {
			c.shape([][]mfPt{append([]mfPt{c.dc.cur}, pts...)}, false)
		}
		c.dc.cur = pts[len(pts)-1]
	case 7, 8, 90, 91: // POLYPOLYLINE, POLYPOLYGON
		small := typ >= 90
		n := int(r.u32(24))
		if n <= 0 || n > len(r)/4 {
			break
		}
		at := 32 + 4*n
		sz := 8
		if small {
			sz = 4
		}
		var polys [][]mfPt
		for k := 0; k < n; k++ {
			cnt := int(r.u32(32 + 4*k))
			polys = append(polys, r.points(at, cnt, small))
			at += cnt * sz
		}
		c.shape(polys, typ == 8 || typ == 91)

	case 59: // BEGINPATH
		c.beginPath()
	case 60: // ENDPATH
		c.inPath = false
	case 61: // CLOSEFIGURE
		c.closeFigure()
	case 68: // ABORTPATH
		c.inPath = false
		c.path, c.pathOpen = nil, nil
	case 62: // FILLPATH
		c.drawPath(true, false)
	case 63: // STROKEANDFILLPATH
		c.drawPath(true, true)
	case 64: // STROKEPATH
		c.drawPath(false, true)
	case 67: // SELECTCLIPPATH: clipping is not modelled; the path is used up
		c.path, c.pathOpen = nil, nil

	case 76, 77: // BITBLT, STRETCHBLT
		// Bounds xDest yDest cxDest cyDest rop xSrc ySrc xform(24) bk usage
		// offBmi cbBmi offBits cbBits [cxSrc cySrc]
		x, y, w, h := r.i32(24), r.i32(28), r.i32(32), r.i32(36)
		rop := r.u32(40)
		bmi, bits := r.slice(r.u32(84), r.u32(88)), r.slice(r.u32(92), r.u32(96))
		if bmi == nil {
			c.patBlt(x, y, w, h, rop)
			break
		}
		sw, sh := w, h
		if typ == 77 {
			sw, sh = r.i32(100), r.i32(104)
		}
		if img, info, err := decodeDIB(bmi, bits, r.u32(80)); err == nil {
			sr := image.Rect(int(r.i32(44)), int(r.i32(48)), int(r.i32(44)+sw), int(r.i32(48)+sh))
			c.blit(img, dibSrcRect(sr, info, false), x, y, w, h, rop, info.isPhoto())
		}
	case 81: // STRETCHDIBITS
		// Bounds xDest yDest xSrc ySrc cxSrc cySrc offBmi cbBmi offBits
		// cbBits usage rop cxDest cyDest
		bmi, bits := r.slice(r.u32(48), r.u32(52)), r.slice(r.u32(56), r.u32(60))
		x, y, w, h := r.i32(24), r.i32(28), r.i32(72), r.i32(76)
		rop := r.u32(68)
		if bmi == nil {
			c.patBlt(x, y, w, h, rop)
			break
		}
		if img, info, err := decodeDIB(bmi, bits, r.u32(64)); err == nil {
			sr := image.Rect(int(r.i32(32)), int(r.i32(36)), int(r.i32(32)+r.i32(40)), int(r.i32(36)+r.i32(44)))
			c.blit(img, dibSrcRect(sr, info, true), x, y, w, h, rop, info.isPhoto())
		}
	case 80: // SETDIBITSTODEVICE
		// Bounds xDest yDest xSrc ySrc cxSrc cySrc offBmi cbBmi offBits cbBits usage start scans
		bmi, bits := r.slice(r.u32(48), r.u32(52)), r.slice(r.u32(56), r.u32(60))
		if img, info, err := decodeDIB(bmi, bits, r.u32(64)); err == nil {
			w, h := r.i32(40), r.i32(44)
			sr := image.Rect(int(r.i32(32)), int(r.i32(36)), int(r.i32(32)+w), int(r.i32(36)+h))
			c.blit(img, dibSrcRect(sr, info, true), r.i32(24), r.i32(28), w, h, ropSrcCopy, info.isPhoto())
		}
	case 114: // ALPHABLEND
		// Bounds xDest yDest cxDest cyDest blend xSrc ySrc xform bk usage
		// offBmi cbBmi offBits cbBits cxSrc cySrc
		bmi, bits := r.slice(r.u32(84), r.u32(88)), r.slice(r.u32(92), r.u32(96))
		if img, info, err := decodeDIB(bmi, bits, r.u32(80)); err == nil {
			sr := image.Rect(int(r.i32(44)), int(r.i32(48)), int(r.i32(44)+r.i32(100)), int(r.i32(48)+r.i32(104)))
			c.blit(img, dibSrcRect(sr, info, false), r.i32(24), r.i32(28), r.i32(32), r.i32(36), ropSrcCopy, info.isPhoto())
		}

	case 83, 84: // EXTTEXTOUTA, EXTTEXTOUTW
		// Bounds mode exScale eyScale | EMRTEXT: ref(x, y) nChars offString
		// options rect(16) offDx
		ref := mfPt{r.i32(36), r.i32(40)}
		n := int(r.u32(44))
		off := r.u32(48)
		opts := r.u32(52)
		if opts&0x2 != 0 { // ETO_OPAQUE
			c.opaqueBox(r.i32(56), r.i32(60), r.i32(64), r.i32(68))
		}
		if n <= 0 || n > 1<<16 {
			break
		}
		var s []rune
		if typ == 84 {
			if b := r.slice(off, uint32(2*n)); b != nil {
				s = utf16Runes(b, n)
			}
		} else if b := r.slice(off, uint32(n)); b != nil {
			s = ansiRunes(b)
		}
		var dx []float64
		if offDx := r.u32(72); offDx != 0 {
			step := 4
			if opts&0x2000 != 0 { // ETO_PDY: (dx, dy) pairs
				step = 8
			}
			if b := r.slice(offDx, uint32(step*n)); b != nil {
				dx = make([]float64, n)
				for k := range dx {
					dx[k] = float64(int32(binary.LittleEndian.Uint32(b[step*k:])))
				}
			}
		}
		if len(dx) != len(s) {
			dx = nil // surrogate pairs: fall back to the font's advances
		}
		c.text(ref, s, dx)
	}
}

// xfMul composes two world transforms: the result applies a, then b
func xfMul(a, b [6]float64) [6]float64 {
	return [6]float64{
		a[0]*b[0] + a[1]*b[2],
		a[0]*b[1] + a[1]*b[3],
		a[2]*b[0] + a[3]*b[2],
		a[2]*b[1] + a[3]*b[3],
		a[4]*b[0] + a[5]*b[2] + b[4],
		a[4]*b[1] + a[5]*b[3] + b[5],
	}
}

// emfFont reads an EMF LOGFONTW (32-bit fields, UTF-16 face name)
func emfFont(b []byte) *mfFont {
	r := emfRec(b)
	f := &mfFont{
		height:     r.i32(0),
		escapement: r.i32(8),
		weight:     int(r.i32(16)),
	}
	if len(b) >= 28 {
		f.italic = b[20] != 0
		f.underline = b[21] != 0
		f.strike = b[22] != 0
	}
	if len(b) >= 28+64 {
		name := utf16Runes(b[28:28+64], 32)
		for i, ch := range name {
			if ch == 0 {
				name = name[:i]
				break
			}
		}
		f.face = string(name)
	}
	return f
}
