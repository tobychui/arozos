package pdfrender

import (
	"encoding/binary"
	"errors"
)

/*
	truetype.go

	A TrueType / OpenType reader written for fonts embedded in PDFs: those
	are usually subsets that miss tables a general font library insists on
	(cmap, name, OS/2 ...), so only head, maxp, loca and glyf are required.
	An OpenType font with a 'CFF ' table hands its outlines to the CFF
	reader instead.
*/

var errFont = errors.New("pdfrender: bad font")

type cmapSub struct {
	platform, encoding int
	format             int
	data               []byte //The subtable from its format field on
}

type ttFont struct {
	data       []byte
	unitsPerEm int
	numGlyphs  int
	loca       []uint32
	glyf       []byte
	cmaps      []cmapSub
	advances   []uint16
	postNames  []string
	cff        *cffFont
	nameToGID  map[string]int
}

func be16(b []byte, off int) int {
	if off < 0 || off > len(b)-2 {
		return 0
	}
	return int(binary.BigEndian.Uint16(b[off:]))
}

func be16s(b []byte, off int) int {
	return int(int16(be16(b, off)))
}

func be32(b []byte, off int) uint32 {
	if off < 0 || off > len(b)-4 {
		return 0
	}
	return binary.BigEndian.Uint32(b[off:])
}

// tableSlice returns a bounds checked sub slice
func tableSlice(b []byte, off, n int64) []byte {
	if off < 0 || n < 0 || off > int64(len(b)) || n > int64(len(b))-off {
		return nil
	}
	return b[off : off+n]
}

func parseSFNT(data []byte) (*ttFont, error) {
	if len(data) < 12 {
		return nil, errFont
	}
	base := 0
	if string(data[:4]) == "ttcf" {
		//A collection: use the first font
		base = int(be32(data, 12))
	}
	numTables := be16(data, base+4)
	tables := map[string][]byte{}
	for i := 0; i < numTables; i++ {
		rec := base + 12 + i*16
		if rec > len(data)-16 {
			break
		}
		tag := string(data[rec : rec+4])
		off := int64(be32(data, rec+8))
		n := int64(be32(data, rec+12))
		t := tableSlice(data, off, n)
		if t == nil {
			//Some subsetters write a length past the end of the file
			t = tableSlice(data, off, int64(len(data))-off)
		}
		if t != nil {
			tables[tag] = t
		}
	}
	f := &ttFont{data: data, unitsPerEm: 1000}
	if head := tables["head"]; len(head) >= 54 {
		if u := be16(head, 18); u >= 16 && u <= 16384 {
			f.unitsPerEm = u
		}
	}
	if maxp := tables["maxp"]; len(maxp) >= 6 {
		f.numGlyphs = be16(maxp, 4)
	}
	if cffData := tables["CFF "]; cffData != nil {
		c, err := parseCFF(cffData)
		if err == nil {
			f.cff = c
			if f.numGlyphs == 0 {
				f.numGlyphs = len(c.charStrings)
			}
		}
	}
	if glyf, loca, head := tables["glyf"], tables["loca"], tables["head"]; glyf != nil && loca != nil {
		long := len(head) >= 54 && be16(head, 50) == 1
		n := f.numGlyphs + 1
		if long {
			if n > len(loca)/4 || f.numGlyphs == 0 {
				n = len(loca) / 4
			}
			f.loca = make([]uint32, n)
			for i := range f.loca {
				f.loca[i] = be32(loca, i*4)
			}
		} else {
			if n > len(loca)/2 || f.numGlyphs == 0 {
				n = len(loca) / 2
			}
			f.loca = make([]uint32, n)
			for i := range f.loca {
				f.loca[i] = uint32(be16(loca, i*2)) * 2
			}
		}
		f.glyf = glyf
		if f.numGlyphs == 0 || f.numGlyphs > len(f.loca)-1 {
			f.numGlyphs = len(f.loca) - 1
		}
	}
	if f.glyf == nil && f.cff == nil {
		return nil, errFont
	}
	if cmap := tables["cmap"]; len(cmap) >= 4 {
		n := be16(cmap, 2)
		for i := 0; i < n; i++ {
			rec := 4 + i*8
			if rec > len(cmap)-8 {
				break
			}
			off := int(be32(cmap, rec+4))
			if off < 0 || off >= len(cmap)-2 {
				continue
			}
			f.cmaps = append(f.cmaps, cmapSub{
				platform: be16(cmap, rec),
				encoding: be16(cmap, rec+2),
				format:   be16(cmap, off),
				data:     cmap[off:],
			})
		}
	}
	if hhea, hmtx := tables["hhea"], tables["hmtx"]; len(hhea) >= 36 && hmtx != nil {
		n := be16(hhea, 34)
		if n > len(hmtx)/4 {
			n = len(hmtx) / 4
		}
		f.advances = make([]uint16, n)
		for i := 0; i < n; i++ {
			f.advances[i] = uint16(be16(hmtx, i*4))
		}
	}
	if post := tables["post"]; len(post) >= 32 && be32(post, 0) == 0x00020000 {
		n := be16(post, 32)
		names := []string{}
		pos := 34 + 2*n
		for pos < len(post) {
			l := int(post[pos])
			pos++
			if l > len(post)-pos {
				break
			}
			names = append(names, string(post[pos:pos+l]))
			pos += l
		}
		f.postNames = make([]string, n)
		for i := 0; i < n; i++ {
			idx := be16(post, 34+2*i)
			if idx < 258 {
				f.postNames[i] = macGlyphNames[idx]
			} else if idx-258 < len(names) {
				f.postNames[i] = names[idx-258]
			}
		}
	} else if len(post) >= 4 && be32(post, 0) == 0x00010000 {
		f.postNames = macGlyphNames
	}
	return f, nil
}

// advance returns the advance width of a glyph in font units
func (f *ttFont) advance(gid int) int {
	if len(f.advances) == 0 {
		return 0
	}
	if gid >= len(f.advances) {
		gid = len(f.advances) - 1
	}
	if gid < 0 {
		return 0
	}
	return int(f.advances[gid])
}

// lookupCmap finds the glyph of code in one subtable, 0 when missing
func lookupCmap(s cmapSub, code uint32) int {
	d := s.data
	switch s.format {
	case 0:
		if code < 256 && int(6+code) < len(d) {
			return int(d[6+code])
		}
	case 4:
		if code > 0xFFFF {
			return 0
		}
		segX2 := be16(d, 6)
		segs := segX2 / 2
		endOff := 14
		startOff := endOff + segX2 + 2
		deltaOff := startOff + segX2
		rangeOff := deltaOff + segX2
		lo, hi := 0, segs-1
		for lo <= hi {
			mid := (lo + hi) / 2
			end := be16(d, endOff+mid*2)
			if int(code) > end {
				lo = mid + 1
				continue
			}
			start := be16(d, startOff+mid*2)
			if int(code) < start {
				hi = mid - 1
				continue
			}
			delta := be16(d, deltaOff+mid*2)
			ro := be16(d, rangeOff+mid*2)
			if ro == 0 {
				return (int(code) + delta) & 0xFFFF
			}
			gOff := rangeOff + mid*2 + ro + 2*(int(code)-start)
			g := be16(d, gOff)
			if g == 0 {
				return 0
			}
			return (g + delta) & 0xFFFF
		}
	case 6:
		first := be16(d, 6)
		count := be16(d, 8)
		if int(code) >= first && int(code) < first+count {
			return be16(d, 10+2*(int(code)-first))
		}
	case 12:
		n := int(be32(d, 12))
		if n < 0 || n > (len(d)-16)/12 {
			n = (len(d) - 16) / 12
		}
		lo, hi := 0, n-1
		for lo <= hi {
			mid := (lo + hi) / 2
			g := 16 + mid*12
			start, end := be32(d, g), be32(d, g+4)
			if code < start {
				hi = mid - 1
			} else if code > end {
				lo = mid + 1
			} else {
				return int(be32(d, g+8) + (code - start))
			}
		}
	}
	return 0
}

// cmapLookup looks a code up in the first subtable of the given platform
// and encoding. It returns -1 when there is no such subtable.
func (f *ttFont) cmapLookup(platform, encoding int, code uint32) int {
	for _, s := range f.cmaps {
		if s.platform == platform && s.encoding == encoding {
			return lookupCmap(s, code)
		}
	}
	return -1
}

func (f *ttFont) hasCmap(platform, encoding int) bool {
	for _, s := range f.cmaps {
		if s.platform == platform && s.encoding == encoding {
			return true
		}
	}
	return false
}

// unicodeGID maps a Unicode value through the best Unicode subtable
func (f *ttFont) unicodeGID(r rune) int {
	for _, pe := range [][2]int{{3, 10}, {3, 1}, {0, 4}, {0, 3}, {0, 6}, {0, 0}, {0, 1}, {0, 2}} {
		if g := f.cmapLookup(pe[0], pe[1], uint32(r)); g > 0 {
			return g
		}
	}
	return 0
}

func (f *ttFont) gidForName(name string) int {
	if f.nameToGID == nil {
		f.nameToGID = map[string]int{}
		for i, n := range f.postNames {
			if _, ok := f.nameToGID[n]; !ok && n != "" {
				f.nameToGID[n] = i
			}
		}
	}
	if g, ok := f.nameToGID[name]; ok {
		return g
	}
	return 0
}

// glyphPath returns the outline of a glyph in font units
func (f *ttFont) glyphPath(gid int) *path {
	if f.cff != nil && f.glyf == nil {
		return f.cff.glyphPath(gid)
	}
	p := &path{}
	f.appendGlyph(p, gid, identity, 0)
	return p
}

func (f *ttFont) appendGlyph(p *path, gid int, m matrix, depth int) {
	if depth > 8 || gid < 0 || gid+1 >= len(f.loca) {
		return
	}
	start, end := int64(f.loca[gid]), int64(f.loca[gid+1])
	if end <= start || end > int64(len(f.glyf)) {
		return
	}
	g := f.glyf[start:end]
	if len(g) < 10 {
		return
	}
	nc := be16s(g, 0)
	if nc >= 0 {
		f.simpleGlyph(p, g, nc, m)
		return
	}
	//Composite glyph
	pos := 10
	for {
		if pos > len(g)-4 {
			return
		}
		flags := be16(g, pos)
		sub := be16(g, pos+2)
		pos += 4
		var dx, dy float64
		if flags&1 != 0 {
			dx, dy = float64(be16s(g, pos)), float64(be16s(g, pos+2))
			pos += 4
		} else {
			if pos > len(g)-2 {
				return
			}
			dx, dy = float64(int8(g[pos])), float64(int8(g[pos+1]))
			pos += 2
		}
		if flags&2 == 0 {
			//Point matching offsets are not supported
			dx, dy = 0, 0
		}
		a, b, c, d := 1.0, 0.0, 0.0, 1.0
		f2dot14 := func(off int) float64 { return float64(be16s(g, off)) / 16384 }
		switch {
		case flags&0x8 != 0:
			a = f2dot14(pos)
			d = a
			pos += 2
		case flags&0x40 != 0:
			a, d = f2dot14(pos), f2dot14(pos+2)
			pos += 4
		case flags&0x80 != 0:
			a, b, c, d = f2dot14(pos), f2dot14(pos+2), f2dot14(pos+4), f2dot14(pos+6)
			pos += 8
		}
		cm := matrix{a, b, c, d, dx, dy}.mul(m)
		f.appendGlyph(p, sub, cm, depth+1)
		if flags&0x20 == 0 {
			return
		}
	}
}

func (f *ttFont) simpleGlyph(p *path, g []byte, nc int, m matrix) {
	if nc == 0 {
		return
	}
	pos := 10
	if nc > (len(g)-pos)/2 {
		return
	}
	ends := make([]int, nc)
	for i := 0; i < nc; i++ {
		ends[i] = be16(g, pos+2*i)
	}
	pos += 2 * nc
	nPts := ends[nc-1] + 1
	if nPts <= 0 || nPts > 65536 {
		return
	}
	insLen := be16(g, pos)
	pos += 2 + insLen
	if pos > len(g) {
		return
	}
	flags := make([]byte, nPts)
	for i := 0; i < nPts; {
		if pos >= len(g) {
			return
		}
		fl := g[pos]
		pos++
		flags[i] = fl
		i++
		if fl&8 != 0 {
			if pos >= len(g) {
				return
			}
			rep := int(g[pos])
			pos++
			for k := 0; k < rep && i < nPts; k++ {
				flags[i] = fl
				i++
			}
		}
	}
	xs := make([]int, nPts)
	ys := make([]int, nPts)
	v := 0
	for i := 0; i < nPts; i++ {
		fl := flags[i]
		if fl&2 != 0 {
			if pos >= len(g) {
				return
			}
			dv := int(g[pos])
			pos++
			if fl&16 == 0 {
				dv = -dv
			}
			v += dv
		} else if fl&16 == 0 {
			v += be16s(g, pos)
			pos += 2
		}
		xs[i] = v
	}
	v = 0
	for i := 0; i < nPts; i++ {
		fl := flags[i]
		if fl&4 != 0 {
			if pos >= len(g) {
				return
			}
			dv := int(g[pos])
			pos++
			if fl&32 == 0 {
				dv = -dv
			}
			v += dv
		} else if fl&32 == 0 {
			v += be16s(g, pos)
			pos += 2
		}
		ys[i] = v
	}
	tp := func(i int) (point, bool) {
		x, y := m.apply(float64(xs[i]), float64(ys[i]))
		return point{x, y}, flags[i]&1 != 0
	}
	start := 0
	for c := 0; c < nc; c++ {
		end := ends[c]
		if end < start || end >= nPts {
			break
		}
		n := end - start + 1
		pts := make([]point, n)
		on := make([]bool, n)
		for i := 0; i < n; i++ {
			pts[i], on[i] = tp(start + i)
		}
		emitQuadContour(p, pts, on)
		start = end + 1
	}
}

// emitQuadContour adds one TrueType contour (on / off curve points)
func emitQuadContour(p *path, pts []point, on []bool) {
	n := len(pts)
	if n == 0 {
		return
	}
	//Start from an on curve point, or the midpoint of two off curve ones
	first := -1
	for i := 0; i < n; i++ {
		if on[i] {
			first = i
			break
		}
	}
	var startPt point
	if first < 0 {
		startPt = point{(pts[0].x + pts[n-1].x) / 2, (pts[0].y + pts[n-1].y) / 2}
		first = 0
		p.moveTo(startPt.x, startPt.y)
		for i := 0; i < n; i++ {
			cur := pts[i]
			next := pts[(i+1)%n]
			mid := point{(cur.x + next.x) / 2, (cur.y + next.y) / 2}
			p.quadTo(cur.x, cur.y, mid.x, mid.y)
		}
		p.close()
		return
	}
	startPt = pts[first]
	p.moveTo(startPt.x, startPt.y)
	var ctrl *point
	for k := 1; k <= n; k++ {
		i := (first + k) % n
		cur := pts[i]
		if on[i] {
			if ctrl != nil {
				p.quadTo(ctrl.x, ctrl.y, cur.x, cur.y)
				ctrl = nil
			} else {
				p.lineTo(cur.x, cur.y)
			}
		} else {
			if ctrl != nil {
				mid := point{(ctrl.x + cur.x) / 2, (ctrl.y + cur.y) / 2}
				p.quadTo(ctrl.x, ctrl.y, mid.x, mid.y)
			}
			c := cur
			ctrl = &c
		}
	}
	p.close()
}
