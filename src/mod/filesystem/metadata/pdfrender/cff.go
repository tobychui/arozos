package pdfrender

/*
	cff.go

	Compact Font Format (Type1C / CIDFontType0C / OpenType CFF) and its
	Type 2 charstrings. Hints are parsed and dropped: a thumbnail is drawn
	far below the sizes where hinting matters.
*/

type cffPrivate struct {
	subrs        [][]byte
	defaultWidth float64
	nominalWidth float64
}

type cffFont struct {
	charStrings [][]byte
	gsubrs      [][]byte
	privates    []cffPrivate
	fdSelect    []uint8 //gid -> private index, nil for a single private
	charset     []int   //gid -> SID, or CID for CID keyed fonts
	isCID       bool
	strings     [][]byte
	fontMatrix  matrix
	encoding    map[int]int //code -> gid from the font's own encoding
	nameToGID   map[string]int
	cidToGID    map[int]int
}

func cffIndex(b []byte, pos int) ([][]byte, int, bool) {
	if pos < 0 || pos > len(b)-2 {
		return nil, pos, false
	}
	count := be16(b, pos)
	if count == 0 {
		return nil, pos + 2, true
	}
	if pos > len(b)-3 {
		return nil, pos, false
	}
	offSize := int(b[pos+2])
	if offSize < 1 || offSize > 4 {
		return nil, pos, false
	}
	offStart := pos + 3
	if (count + 1) > (len(b)-offStart)/offSize {
		return nil, pos, false
	}
	readOff := func(i int) int {
		v := 0
		for k := 0; k < offSize; k++ {
			v = v<<8 | int(b[offStart+i*offSize+k])
		}
		return v
	}
	dataStart := offStart + (count+1)*offSize - 1
	items := make([][]byte, count)
	prev := readOff(0)
	for i := 0; i < count; i++ {
		next := readOff(i + 1)
		if prev < 1 || next < prev || next > len(b)-dataStart {
			return items[:i], dataStart + prev, i > 0
		}
		items[i] = b[dataStart+prev : dataStart+next]
		prev = next
	}
	return items, dataStart + prev, true
}

// cffDict parses a DICT into operator -> operands (escaped operators are
// stored as 1200 + op)
func cffDict(b []byte) map[int][]float64 {
	out := map[int][]float64{}
	var ops []float64
	for i := 0; i < len(b); {
		c := int(b[i])
		switch {
		case c <= 21:
			op := c
			i++
			if c == 12 {
				if i >= len(b) {
					return out
				}
				op = 1200 + int(b[i])
				i++
			}
			out[op] = ops
			ops = nil
		case c == 28:
			if i+2 >= len(b) {
				return out
			}
			ops = append(ops, float64(int16(uint16(b[i+1])<<8|uint16(b[i+2]))))
			i += 3
		case c == 29:
			if i+4 >= len(b) {
				return out
			}
			ops = append(ops, float64(int32(uint32(b[i+1])<<24|uint32(b[i+2])<<16|uint32(b[i+3])<<8|uint32(b[i+4]))))
			i += 5
		case c == 30:
			//Real number in packed nibbles
			i++
			s := make([]byte, 0, 16)
			done := false
			for i < len(b) && !done {
				for _, nib := range []byte{b[i] >> 4, b[i] & 15} {
					switch {
					case nib <= 9:
						s = append(s, '0'+nib)
					case nib == 0xa:
						s = append(s, '.')
					case nib == 0xb:
						s = append(s, 'E')
					case nib == 0xc:
						s = append(s, 'E', '-')
					case nib == 0xe:
						s = append(s, '-')
					case nib == 0xf:
						done = true
					}
					if done {
						break
					}
				}
				i++
			}
			t := parseNumberToken(s)
			if t.kind == tokInt {
				ops = append(ops, float64(t.i))
			} else {
				f := t.f
				//parseNumberToken drops exponents; handle them here
				if e := indexByte(s, 'E'); e >= 0 {
					mant := parseNumberToken(s[:e])
					exp := parseNumberToken(s[e+1:])
					mv := mant.f
					if mant.kind == tokInt {
						mv = float64(mant.i)
					}
					ev := exp.i
					if exp.kind == tokReal {
						ev = int(exp.f)
					}
					f = mv
					for k := 0; k < ev && k < 40; k++ {
						f *= 10
					}
					for k := 0; k > ev && k > -40; k-- {
						f /= 10
					}
				}
				ops = append(ops, f)
			}
		case c >= 32 && c <= 246:
			ops = append(ops, float64(c-139))
			i++
		case c >= 247 && c <= 250:
			if i+1 >= len(b) {
				return out
			}
			ops = append(ops, float64((c-247)*256+int(b[i+1])+108))
			i += 2
		case c >= 251 && c <= 254:
			if i+1 >= len(b) {
				return out
			}
			ops = append(ops, float64(-(c-251)*256-int(b[i+1])-108))
			i += 2
		default:
			i++
		}
		if len(ops) > 48 {
			ops = ops[:48]
		}
	}
	return out
}

func indexByte(b []byte, c byte) int {
	for i, v := range b {
		if v == c {
			return i
		}
	}
	return -1
}

func dictInt(d map[int][]float64, op int, def int) int {
	if v, ok := d[op]; ok && len(v) > 0 {
		return int(v[len(v)-1])
	}
	return def
}

func parseCFF(b []byte) (*cffFont, error) {
	if len(b) < 4 {
		return nil, errFont
	}
	hdrSize := int(b[2])
	_, pos, ok := cffIndex(b, hdrSize) //Name INDEX
	if !ok {
		return nil, errFont
	}
	topDicts, pos, ok := cffIndex(b, pos)
	if !ok || len(topDicts) == 0 {
		return nil, errFont
	}
	strs, pos, ok := cffIndex(b, pos)
	if !ok {
		return nil, errFont
	}
	gsubrs, _, _ := cffIndex(b, pos)
	top := cffDict(topDicts[0])
	f := &cffFont{gsubrs: gsubrs, strings: strs, fontMatrix: matrix{0.001, 0, 0, 0.001, 0, 0}}
	if fm, ok := top[1207]; ok && len(fm) == 6 {
		f.fontMatrix = matrix{fm[0], fm[1], fm[2], fm[3], fm[4], fm[5]}
	}
	csOff := dictInt(top, 17, -1)
	if csOff <= 0 {
		return nil, errFont
	}
	f.charStrings, _, ok = cffIndex(b, csOff)
	if !ok || len(f.charStrings) == 0 {
		return nil, errFont
	}
	nGlyphs := len(f.charStrings)
	_, f.isCID = top[1230]

	loadPrivate := func(d map[int][]float64) cffPrivate {
		var p cffPrivate
		pr, ok := d[18]
		if !ok || len(pr) < 2 {
			return p
		}
		size, off := int(pr[0]), int(pr[1])
		if off < 0 || size < 0 || off > len(b) || size > len(b)-off {
			return p
		}
		pd := cffDict(b[off : off+size])
		if v, ok := pd[20]; ok && len(v) > 0 {
			p.defaultWidth = v[0]
		}
		if v, ok := pd[21]; ok && len(v) > 0 {
			p.nominalWidth = v[0]
		}
		if so := dictInt(pd, 19, 0); so > 0 {
			p.subrs, _, _ = cffIndex(b, off+so)
		}
		return p
	}
	if f.isCID {
		fdOff := dictInt(top, 1236, -1)
		fds, _, ok := cffIndex(b, fdOff)
		if ok {
			for _, fd := range fds {
				f.privates = append(f.privates, loadPrivate(cffDict(fd)))
			}
		}
		if len(f.privates) == 0 {
			f.privates = []cffPrivate{{}}
		}
		if sel := dictInt(top, 1237, -1); sel > 0 && sel < len(b) {
			f.fdSelect = make([]uint8, nGlyphs)
			switch b[sel] {
			case 0:
				for i := 0; i < nGlyphs && sel+1+i < len(b); i++ {
					f.fdSelect[i] = b[sel+1+i]
				}
			case 3:
				nr := be16(b, sel+1)
				for r := 0; r < nr; r++ {
					rp := sel + 3 + r*3
					first := be16(b, rp)
					if rp+2 >= len(b) {
						break
					}
					fd := b[rp+2]
					last := be16(b, rp+3)
					if r == nr-1 {
						last = be16(b, sel+3+nr*3)
					}
					for g := first; g < last && g < nGlyphs; g++ {
						f.fdSelect[g] = fd
					}
				}
			}
		}
	} else {
		f.privates = []cffPrivate{loadPrivate(top)}
	}

	//Charset
	f.charset = make([]int, nGlyphs)
	csetOff := dictInt(top, 15, 0)
	switch {
	case csetOff <= 2:
		//Predefined (ISOAdobe; Expert sets are rare enough to treat alike)
		for i := range f.charset {
			f.charset[i] = i
		}
	case csetOff < len(b):
		format := b[csetOff]
		p := csetOff + 1
		g := 1
		switch format {
		case 0:
			for ; g < nGlyphs; g++ {
				f.charset[g] = be16(b, p)
				p += 2
			}
		case 1, 2:
			for g < nGlyphs && p < len(b)-2 {
				first := be16(b, p)
				var nLeft int
				if format == 1 {
					nLeft = int(b[p+2])
					p += 3
				} else {
					nLeft = be16(b, p+2)
					p += 4
				}
				for k := 0; k <= nLeft && g < nGlyphs; k++ {
					f.charset[g] = first + k
					g++
				}
			}
		}
	}

	//Built in encoding of simple fonts
	if !f.isCID {
		encOff := dictInt(top, 16, 0)
		f.encoding = map[int]int{}
		if encOff > 1 && encOff < len(b) {
			format := b[encOff]
			p := encOff + 1
			switch format & 0x7f {
			case 0:
				if p < len(b) {
					n := int(b[p])
					p++
					for i := 0; i < n && p < len(b); i++ {
						f.encoding[int(b[p])] = i + 1
						p++
					}
				}
			case 1:
				if p < len(b) {
					n := int(b[p])
					p++
					g := 1
					for i := 0; i < n && p+1 < len(b); i++ {
						first, left := int(b[p]), int(b[p+1])
						p += 2
						for k := 0; k <= left; k++ {
							f.encoding[first+k] = g
							g++
						}
					}
				}
			}
			if format&0x80 != 0 && p < len(b) {
				n := int(b[p])
				p++
				for i := 0; i < n && p+2 < len(b); i++ {
					code := int(b[p])
					sid := be16(b, p+1)
					p += 3
					if g := f.gidForName(f.sidName(sid)); g > 0 {
						f.encoding[code] = g
					}
				}
			}
		} else {
			//Standard encoding through the glyph names
			for code := 0; code < 256; code++ {
				if n := standardEncoding[code]; n != "" {
					if g := f.gidForName(n); g > 0 {
						f.encoding[code] = g
					}
				}
			}
		}
	}
	return f, nil
}

func (f *cffFont) sidName(sid int) string {
	if sid < len(cffStandardStrings) {
		return cffStandardStrings[sid]
	}
	i := sid - len(cffStandardStrings)
	if i < len(f.strings) {
		return string(f.strings[i])
	}
	return ""
}

func (f *cffFont) glyphName(gid int) string {
	if f.isCID || gid < 0 || gid >= len(f.charset) {
		return ""
	}
	return f.sidName(f.charset[gid])
}

func (f *cffFont) gidForName(name string) int {
	if f.isCID {
		return 0
	}
	if f.nameToGID == nil {
		f.nameToGID = map[string]int{}
		for g := range f.charset {
			n := f.glyphName(g)
			if _, ok := f.nameToGID[n]; !ok {
				f.nameToGID[n] = g
			}
		}
	}
	return f.nameToGID[name]
}

func (f *cffFont) gidForCID(cid int) int {
	if !f.isCID {
		return cid
	}
	if f.cidToGID == nil {
		f.cidToGID = make(map[int]int, len(f.charset))
		for g, c := range f.charset {
			if _, ok := f.cidToGID[c]; !ok {
				f.cidToGID[c] = g
			}
		}
	}
	return f.cidToGID[cid]
}

func subrBias(n int) int {
	if n < 1240 {
		return 107
	}
	if n < 33900 {
		return 1131
	}
	return 32768
}

// glyphPath runs a Type 2 charstring into a path in glyph units
func (f *cffFont) glyphPath(gid int) *path {
	p := &path{}
	if gid < 0 || gid >= len(f.charStrings) {
		return p
	}
	priv := f.privates[0]
	if f.fdSelect != nil && gid < len(f.fdSelect) && int(f.fdSelect[gid]) < len(f.privates) {
		priv = f.privates[f.fdSelect[gid]]
	}
	t2 := &type2Interp{f: f, priv: priv, p: p}
	t2.run(f.charStrings[gid], 0)
	if t2.open {
		p.close()
	}
	return p
}

type type2Interp struct {
	f        *cffFont
	priv     cffPrivate
	p        *path
	stack    []float64
	x, y     float64
	nStems   int
	open     bool
	seenW    bool
	done     bool
	steps    int
	trans    [32]float64
	seacBase bool
}

func (t *type2Interp) moveTo(dx, dy float64) {
	if t.open {
		t.p.close()
	}
	t.x += dx
	t.y += dy
	t.p.moveTo(t.x, t.y)
	t.open = true
}

func (t *type2Interp) lineTo(dx, dy float64) {
	if !t.open {
		t.p.moveTo(t.x, t.y)
		t.open = true
	}
	t.x += dx
	t.y += dy
	t.p.lineTo(t.x, t.y)
}

func (t *type2Interp) curveTo(dx1, dy1, dx2, dy2, dx3, dy3 float64) {
	if !t.open {
		t.p.moveTo(t.x, t.y)
		t.open = true
	}
	x1, y1 := t.x+dx1, t.y+dy1
	x2, y2 := x1+dx2, y1+dy2
	t.x, t.y = x2+dx3, y2+dy3
	t.p.cubicTo(x1, y1, x2, y2, t.x, t.y)
}

// takeWidth drops the optional width operand of the first stack clearing op
func (t *type2Interp) takeWidth(even bool) {
	if t.seenW {
		return
	}
	t.seenW = true
	if (len(t.stack)%2 == 1) == even && len(t.stack) > 0 {
		t.stack = t.stack[1:]
	}
}

func (t *type2Interp) run(cs []byte, depth int) {
	if depth > 10 {
		return
	}
	for i := 0; i < len(cs) && !t.done; {
		t.steps++
		if t.steps > 200000 {
			t.done = true
			return
		}
		b0 := int(cs[i])
		if b0 >= 32 || b0 == 28 {
			var v float64
			switch {
			case b0 == 28:
				if i+2 >= len(cs) {
					return
				}
				v = float64(int16(uint16(cs[i+1])<<8 | uint16(cs[i+2])))
				i += 3
			case b0 <= 246:
				v = float64(b0 - 139)
				i++
			case b0 <= 250:
				if i+1 >= len(cs) {
					return
				}
				v = float64((b0-247)*256 + int(cs[i+1]) + 108)
				i += 2
			case b0 <= 254:
				if i+1 >= len(cs) {
					return
				}
				v = float64(-(b0-251)*256 - int(cs[i+1]) - 108)
				i += 2
			default:
				if i+4 >= len(cs) {
					return
				}
				v = float64(int32(uint32(cs[i+1])<<24|uint32(cs[i+2])<<16|uint32(cs[i+3])<<8|uint32(cs[i+4]))) / 65536
				i += 5
			}
			if len(t.stack) < 513 {
				t.stack = append(t.stack, v)
			}
			continue
		}
		i++
		s := t.stack
		switch b0 {
		case 1, 3, 18, 23: //hstem vstem hstemhm vstemhm
			t.takeWidth(true)
			t.nStems += len(t.stack) / 2
			t.stack = t.stack[:0]
		case 19, 20: //hintmask cntrmask
			t.takeWidth(true)
			t.nStems += len(t.stack) / 2
			t.stack = t.stack[:0]
			i += (t.nStems + 7) / 8
		case 21: //rmoveto
			t.takeWidth(true)
			s = t.stack
			if len(s) >= 2 {
				t.moveTo(s[len(s)-2], s[len(s)-1])
			}
			t.stack = t.stack[:0]
		case 22: //hmoveto
			t.takeWidth(false)
			s = t.stack
			if len(s) >= 1 {
				t.moveTo(s[len(s)-1], 0)
			}
			t.stack = t.stack[:0]
		case 4: //vmoveto
			t.takeWidth(false)
			s = t.stack
			if len(s) >= 1 {
				t.moveTo(0, s[len(s)-1])
			}
			t.stack = t.stack[:0]
		case 5: //rlineto
			for k := 0; k+1 < len(s); k += 2 {
				t.lineTo(s[k], s[k+1])
			}
			t.stack = t.stack[:0]
		case 6, 7: //hlineto vlineto
			horiz := b0 == 6
			for k := 0; k < len(s); k++ {
				if horiz {
					t.lineTo(s[k], 0)
				} else {
					t.lineTo(0, s[k])
				}
				horiz = !horiz
			}
			t.stack = t.stack[:0]
		case 8: //rrcurveto
			for k := 0; k+5 < len(s); k += 6 {
				t.curveTo(s[k], s[k+1], s[k+2], s[k+3], s[k+4], s[k+5])
			}
			t.stack = t.stack[:0]
		case 24: //rcurveline
			k := 0
			for ; k+5 < len(s)-2; k += 6 {
				t.curveTo(s[k], s[k+1], s[k+2], s[k+3], s[k+4], s[k+5])
			}
			if k+1 < len(s) {
				t.lineTo(s[k], s[k+1])
			}
			t.stack = t.stack[:0]
		case 25: //rlinecurve
			k := 0
			for ; k < len(s)-6; k += 2 {
				t.lineTo(s[k], s[k+1])
			}
			if k+5 < len(s) {
				t.curveTo(s[k], s[k+1], s[k+2], s[k+3], s[k+4], s[k+5])
			}
			t.stack = t.stack[:0]
		case 26: //vvcurveto
			k := 0
			dx1 := 0.0
			if len(s)%2 == 1 {
				dx1 = s[0]
				k = 1
			}
			for ; k+3 < len(s); k += 4 {
				t.curveTo(dx1, s[k], s[k+1], s[k+2], 0, s[k+3])
				dx1 = 0
			}
			t.stack = t.stack[:0]
		case 27: //hhcurveto
			k := 0
			dy1 := 0.0
			if len(s)%2 == 1 {
				dy1 = s[0]
				k = 1
			}
			for ; k+3 < len(s); k += 4 {
				t.curveTo(s[k], dy1, s[k+1], s[k+2], s[k+3], 0)
				dy1 = 0
			}
			t.stack = t.stack[:0]
		case 30, 31: //vhcurveto hvcurveto
			horiz := b0 == 31
			k := 0
			for ; k+3 < len(s); k += 4 {
				last := 0.0
				if len(s)-(k+4) == 1 {
					last = s[k+4]
				}
				if horiz {
					t.curveTo(s[k], 0, s[k+1], s[k+2], last, s[k+3])
				} else {
					t.curveTo(0, s[k], s[k+1], s[k+2], s[k+3], last)
				}
				horiz = !horiz
			}
			t.stack = t.stack[:0]
		case 10, 29: //callsubr callgsubr
			if len(s) == 0 {
				return
			}
			idx := int(s[len(s)-1])
			t.stack = s[:len(s)-1]
			subrs := t.priv.subrs
			if b0 == 29 {
				subrs = t.f.gsubrs
			}
			idx += subrBias(len(subrs))
			if idx >= 0 && idx < len(subrs) {
				t.run(subrs[idx], depth+1)
			}
		case 11: //return
			return
		case 14: //endchar
			t.takeWidth(true)
			s = t.stack
			if len(s) >= 4 && !t.seacBase {
				//seac-like accented character
				t.seac(s[len(s)-4], s[len(s)-3], int(s[len(s)-2]), int(s[len(s)-1]))
			}
			if t.open {
				t.p.close()
				t.open = false
			}
			t.done = true
			return
		case 12:
			if i >= len(cs) {
				return
			}
			op := int(cs[i])
			i++
			t.escape(op)
		default:
			t.stack = t.stack[:0]
		}
	}
}

func (t *type2Interp) escape(op int) {
	s := t.stack
	pop := func() float64 {
		if len(t.stack) == 0 {
			return 0
		}
		v := t.stack[len(t.stack)-1]
		t.stack = t.stack[:len(t.stack)-1]
		return v
	}
	switch op {
	case 35: //flex
		if len(s) >= 12 {
			t.curveTo(s[0], s[1], s[2], s[3], s[4], s[5])
			t.curveTo(s[6], s[7], s[8], s[9], s[10], s[11])
		}
		t.stack = t.stack[:0]
	case 34: //hflex
		if len(s) >= 7 {
			y0 := t.y
			t.curveTo(s[0], 0, s[1], s[2], s[3], 0)
			t.curveTo(s[4], 0, s[5], y0-t.y, s[6], 0)
		}
		t.stack = t.stack[:0]
	case 36: //hflex1
		if len(s) >= 9 {
			y0 := t.y
			t.curveTo(s[0], s[1], s[2], s[3], s[4], 0)
			t.curveTo(s[5], 0, s[6], s[7], s[8], y0-t.y-s[7])
		}
		t.stack = t.stack[:0]
	case 37: //flex1
		if len(s) >= 11 {
			x0, y0 := t.x, t.y
			dx := s[0] + s[2] + s[4] + s[6] + s[8]
			dy := s[1] + s[3] + s[5] + s[7] + s[9]
			t.curveTo(s[0], s[1], s[2], s[3], s[4], s[5])
			if abs64(dx) > abs64(dy) {
				t.curveTo(s[6], s[7], s[8], s[9], s[10], y0-t.y-s[7]-s[9])
			} else {
				t.curveTo(s[6], s[7], s[8], s[9], x0-t.x-s[6]-s[8], s[10])
			}
		}
		t.stack = t.stack[:0]
	default:
		//Arithmetic and storage operators
		switch op {
		case 9:
			t.stack = append(t.stack, abs64(pop()))
		case 10:
			b, a := pop(), pop()
			t.stack = append(t.stack, a+b)
		case 11:
			b, a := pop(), pop()
			t.stack = append(t.stack, a-b)
		case 12:
			b, a := pop(), pop()
			if b != 0 {
				t.stack = append(t.stack, a/b)
			} else {
				t.stack = append(t.stack, 0)
			}
		case 14:
			t.stack = append(t.stack, -pop())
		case 18:
			pop()
		case 24:
			b, a := pop(), pop()
			t.stack = append(t.stack, a*b)
		case 27:
			a := pop()
			t.stack = append(t.stack, a, a)
		case 28:
			b, a := pop(), pop()
			t.stack = append(t.stack, b, a)
		case 20:
			v, idx := pop(), int(pop())
			if idx >= 0 && idx < len(t.trans) {
				t.trans[idx] = v
			}
		case 21:
			idx := int(pop())
			v := 0.0
			if idx >= 0 && idx < len(t.trans) {
				v = t.trans[idx]
			}
			t.stack = append(t.stack, v)
		default:
			t.stack = t.stack[:0]
		}
	}
}

// seac draws an accented glyph from two standard encoding codes
func (t *type2Interp) seac(adx, ady float64, bchar, achar int) {
	if bchar < 0 || bchar > 255 || achar < 0 || achar > 255 {
		return
	}
	bg := t.f.gidForName(standardEncoding[bchar])
	ag := t.f.gidForName(standardEncoding[achar])
	for _, part := range []struct {
		gid    int
		dx, dy float64
	}{{bg, 0, 0}, {ag, adx, ady}} {
		if part.gid <= 0 || part.gid >= len(t.f.charStrings) {
			continue
		}
		sub := &type2Interp{f: t.f, priv: t.priv, p: t.p, x: part.dx, y: part.dy, seacBase: true}
		sub.run(t.f.charStrings[part.gid], 1)
		if sub.open {
			t.p.close()
		}
	}
}

func abs64(v float64) float64 {
	if v < 0 {
		return -v
	}
	return v
}
