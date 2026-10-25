package pdfrender

import (
	"bytes"
)

/*
	type1.go

	Type 1 fonts (FontFile streams, PFA or PFB): the clear text part gives
	the FontMatrix and built-in encoding, the eexec encrypted part the
	Subrs and CharStrings, which run through a Type 1 charstring
	interpreter with flex and seac support.
*/

type type1Font struct {
	fontMatrix  matrix
	encoding    map[int]string
	subrs       [][]byte
	charStrings map[string][]byte
}

func decryptType1(data []byte, r uint16, skip int) []byte {
	const c1, c2 = 52845, 22719
	out := make([]byte, len(data))
	for i, c := range data {
		out[i] = c ^ byte(r>>8)
		r = (uint16(c)+r)*c1 + c2
	}
	if skip > len(out) {
		return nil
	}
	return out[skip:]
}

func isHexByte(c byte) bool { return unhex(c) >= 0 }

func parseType1(data []byte, len1 int) (*type1Font, error) {
	//PFB segments: 0x80 type length
	if len(data) > 6 && data[0] == 0x80 {
		var clear, enc []byte
		for pos := 0; pos+6 <= len(data) && data[pos] == 0x80; {
			typ := data[pos+1]
			n := int(uint32(data[pos+2]) | uint32(data[pos+3])<<8 | uint32(data[pos+4])<<16 | uint32(data[pos+5])<<24)
			pos += 6
			if typ == 3 || n < 0 || n > len(data)-pos {
				break
			}
			if typ == 1 && enc == nil {
				clear = append(clear, data[pos:pos+n]...)
			} else if typ == 2 {
				enc = append(enc, data[pos:pos+n]...)
			}
			pos += n
		}
		data = append(clear, enc...)
		len1 = len(clear)
	}
	if len1 <= 0 || len1 > len(data) {
		//Find the eexec keyword
		i := bytes.Index(data, []byte("eexec"))
		if i < 0 {
			return nil, errFont
		}
		len1 = i + 5
	}
	clear := data[:len1]
	encrypted := data[len1:]
	//Skip the whitespace after eexec
	for len(encrypted) > 0 && isWhite(encrypted[0]) {
		encrypted = encrypted[1:]
	}
	if len(encrypted) >= 4 && isHexByte(encrypted[0]) && isHexByte(encrypted[1]) && isHexByte(encrypted[2]) && isHexByte(encrypted[3]) {
		encrypted = asciiHexDecode(encrypted)
	}
	f := &type1Font{fontMatrix: matrix{0.001, 0, 0, 0.001, 0, 0}, encoding: map[int]string{}, charStrings: map[string][]byte{}}
	f.parseClear(clear)
	priv := decryptType1(encrypted, 55665, 4)
	f.parsePrivate(priv)
	if len(f.charStrings) == 0 {
		return nil, errFont
	}
	return f, nil
}

func (f *type1Font) parseClear(b []byte) {
	if i := bytes.Index(b, []byte("/FontMatrix")); i >= 0 {
		p := newParser(b[i+11:])
		if obj, err := p.parseObject(0); err == nil {
			if arr, ok := obj.(Array); ok && len(arr) == 6 {
				var m matrix
				for k := 0; k < 6; k++ {
					m[k], _ = toFloat(arr[k])
				}
				if m[0] != 0 || m[1] != 0 {
					f.fontMatrix = m
				}
			}
		}
	}
	i := bytes.Index(b, []byte("/Encoding"))
	if i < 0 {
		return
	}
	rest := b[i+9:]
	if bytes.HasPrefix(bytes.TrimLeft(rest, " \t\r\n"), []byte("StandardEncoding")) {
		for c, n := range standardEncoding {
			if n != "" {
				f.encoding[c] = n
			}
		}
		return
	}
	//"dup <code> /<name> put" entries until "readonly def"
	end := bytes.Index(rest, []byte("readonly def"))
	if end < 0 {
		end = bytes.Index(rest, []byte(" def"))
	}
	if end < 0 || end > 1<<20 {
		end = len(rest)
	}
	l := &lexer{buf: rest[:end]}
	var prev []token
	for {
		t := l.next()
		if t.kind == tokEOF {
			break
		}
		if t.kind == tokKeyword && t.s == "put" && len(prev) >= 3 {
			a, bt := prev[len(prev)-2], prev[len(prev)-1]
			if a.kind == tokInt && bt.kind == tokName && a.i >= 0 && a.i < 256 {
				f.encoding[a.i] = bt.s
			}
		}
		prev = append(prev, t)
		if len(prev) > 4 {
			prev = prev[1:]
		}
	}
}

// readBinaryAfter takes the n data bytes of "<n> RD <bytes>" after the RD
func readBinaryAfter(b []byte, pos int, n int) ([]byte, int) {
	//pos points just after the RD token; one space separates the data
	pos++
	if n < 0 || pos > len(b) || n > len(b)-pos {
		return nil, len(b)
	}
	return b[pos : pos+n], pos + n
}

func (f *type1Font) parsePrivate(b []byte) {
	lenIV := 4
	if i := bytes.Index(b, []byte("/lenIV")); i >= 0 {
		l := &lexer{buf: b[i+6:]}
		if t := l.next(); t.kind == tokInt {
			lenIV = t.i
		}
	}
	decrypt := func(cs []byte) []byte {
		if lenIV < 0 {
			return cs
		}
		return decryptType1(cs, 4330, lenIV)
	}
	//Subrs
	if i := bytes.Index(b, []byte("/Subrs")); i >= 0 {
		pos := i + 6
		l := &lexer{buf: b, pos: pos}
		if t := l.next(); t.kind == tokInt && t.i > 0 && t.i < 65536 {
			f.subrs = make([][]byte, t.i)
		}
		for {
			//dup <index> <n> RD <bytes> NP
			save := l.pos
			t := l.next()
			if t.kind == tokKeyword && t.s == "dup" {
				ti := l.next()
				tn := l.next()
				rd := l.next()
				if ti.kind != tokInt || tn.kind != tokInt || rd.kind != tokKeyword {
					break
				}
				data, np := readBinaryAfter(b, l.pos, tn.i)
				l.pos = np
				if ti.i >= 0 && ti.i < len(f.subrs) && data != nil {
					f.subrs[ti.i] = decrypt(data)
				}
				continue
			}
			if t.kind == tokEOF {
				break
			}
			if t.kind == tokName && t.s == "CharStrings" {
				l.pos = save
				break
			}
			if l.pos-pos > 1<<24 {
				break
			}
		}
	}
	//CharStrings
	i := bytes.Index(b, []byte("/CharStrings"))
	if i < 0 {
		return
	}
	l := &lexer{buf: b, pos: i + 12}
	for {
		t := l.next()
		if t.kind == tokEOF {
			break
		}
		if t.kind == tokKeyword && t.s == "end" && len(f.charStrings) > 0 {
			break
		}
		if t.kind != tokName {
			continue
		}
		tn := l.next()
		if tn.kind != tokInt {
			continue
		}
		rd := l.next()
		if rd.kind != tokKeyword {
			continue
		}
		data, np := readBinaryAfter(b, l.pos, tn.i)
		l.pos = np
		if data != nil {
			f.charStrings[t.s] = decrypt(data)
		}
	}
}

func (f *type1Font) glyphPath(name string) *path {
	p := &path{}
	cs, ok := f.charStrings[name]
	if !ok {
		return p
	}
	t := &type1Interp{f: f, p: p}
	t.run(cs, 0)
	if t.open {
		p.close()
	}
	return p
}

type type1Interp struct {
	f       *type1Font
	p       *path
	stack   []float64
	ps      []float64
	x, y    float64
	sbx     float64
	open    bool
	done    bool
	flex    bool
	flexPts []point
	steps   int
	dx, dy  float64 //Offset for seac accents
	inSeac  bool
}

func (t *type1Interp) moveTo(x, y float64) {
	if t.flex {
		t.flexPts = append(t.flexPts, point{x, y})
		t.x, t.y = x, y
		return
	}
	if t.open {
		t.p.close()
	}
	t.x, t.y = x, y
	t.p.moveTo(x+t.dx, y+t.dy)
	t.open = true
}

func (t *type1Interp) lineTo(x, y float64) {
	if !t.open {
		t.p.moveTo(t.x+t.dx, t.y+t.dy)
		t.open = true
	}
	t.x, t.y = x, y
	t.p.lineTo(x+t.dx, y+t.dy)
}

func (t *type1Interp) curveTo(x1, y1, x2, y2, x3, y3 float64) {
	if !t.open {
		t.p.moveTo(t.x+t.dx, t.y+t.dy)
		t.open = true
	}
	t.x, t.y = x3, y3
	t.p.cubicTo(x1+t.dx, y1+t.dy, x2+t.dx, y2+t.dy, x3+t.dx, y3+t.dy)
}

func (t *type1Interp) run(cs []byte, depth int) {
	if depth > 10 {
		return
	}
	for i := 0; i < len(cs) && !t.done; {
		t.steps++
		if t.steps > 100000 {
			t.done = true
			return
		}
		v := int(cs[i])
		if v >= 32 {
			var n float64
			switch {
			case v <= 246:
				n = float64(v - 139)
				i++
			case v <= 250:
				if i+1 >= len(cs) {
					return
				}
				n = float64((v-247)*256 + int(cs[i+1]) + 108)
				i += 2
			case v <= 254:
				if i+1 >= len(cs) {
					return
				}
				n = float64(-(v-251)*256 - int(cs[i+1]) - 108)
				i += 2
			default:
				if i+4 >= len(cs) {
					return
				}
				n = float64(int32(uint32(cs[i+1])<<24 | uint32(cs[i+2])<<16 | uint32(cs[i+3])<<8 | uint32(cs[i+4])))
				i += 5
			}
			if len(t.stack) < 64 {
				t.stack = append(t.stack, n)
			}
			continue
		}
		i++
		s := t.stack
		arg := func(k int) float64 {
			if k < len(s) {
				return s[k]
			}
			return 0
		}
		switch v {
		case 13: //hsbw
			t.sbx = arg(0)
			t.x, t.y = arg(0), 0
			t.stack = t.stack[:0]
		case 9: //closepath
			if t.open {
				t.p.close()
				t.open = false
			}
			t.stack = t.stack[:0]
		case 21: //rmoveto
			t.moveTo(t.x+arg(0), t.y+arg(1))
			t.stack = t.stack[:0]
		case 22: //hmoveto
			t.moveTo(t.x+arg(0), t.y)
			t.stack = t.stack[:0]
		case 4: //vmoveto
			t.moveTo(t.x, t.y+arg(0))
			t.stack = t.stack[:0]
		case 5: //rlineto
			t.lineTo(t.x+arg(0), t.y+arg(1))
			t.stack = t.stack[:0]
		case 6: //hlineto
			t.lineTo(t.x+arg(0), t.y)
			t.stack = t.stack[:0]
		case 7: //vlineto
			t.lineTo(t.x, t.y+arg(0))
			t.stack = t.stack[:0]
		case 8: //rrcurveto
			x1, y1 := t.x+arg(0), t.y+arg(1)
			x2, y2 := x1+arg(2), y1+arg(3)
			t.curveTo(x1, y1, x2, y2, x2+arg(4), y2+arg(5))
			t.stack = t.stack[:0]
		case 30: //vhcurveto
			x1, y1 := t.x, t.y+arg(0)
			x2, y2 := x1+arg(1), y1+arg(2)
			t.curveTo(x1, y1, x2, y2, x2+arg(3), y2)
			t.stack = t.stack[:0]
		case 31: //hvcurveto
			x1, y1 := t.x+arg(0), t.y
			x2, y2 := x1+arg(1), y1+arg(2)
			t.curveTo(x1, y1, x2, y2, x2, y2+arg(3))
			t.stack = t.stack[:0]
		case 1, 3: //hstem vstem
			t.stack = t.stack[:0]
		case 10: //callsubr
			if len(s) == 0 {
				return
			}
			idx := int(s[len(s)-1])
			t.stack = s[:len(s)-1]
			if idx >= 0 && idx < len(t.f.subrs) {
				t.run(t.f.subrs[idx], depth+1)
			}
		case 11: //return
			return
		case 14: //endchar
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
			t.escape(op, s)
		default:
			t.stack = t.stack[:0]
		}
	}
}

func (t *type1Interp) escape(op int, s []float64) {
	arg := func(k int) float64 {
		if k < len(s) {
			return s[k]
		}
		return 0
	}
	switch op {
	case 7: //sbw
		t.sbx = arg(0)
		t.x, t.y = arg(0), arg(1)
		t.stack = t.stack[:0]
	case 6: //seac
		asb, adx, ady := arg(0), arg(1), arg(2)
		bchar, achar := int(arg(3)), int(arg(4))
		t.stack = t.stack[:0]
		if bchar < 0 || bchar > 255 || achar < 0 || achar > 255 || t.inSeac {
			t.done = true
			return
		}
		base := t.f.charStrings[standardEncoding[bchar]]
		accent := t.f.charStrings[standardEncoding[achar]]
		if base != nil {
			sub := &type1Interp{f: t.f, p: t.p, inSeac: true}
			sub.run(base, 1)
			if sub.open {
				t.p.close()
			}
		}
		if accent != nil {
			//The accent's origin sits at adx - asb from the base's
			sub := &type1Interp{f: t.f, p: t.p, inSeac: true, dx: adx - asb, dy: ady}
			sub.run(accent, 1)
			if sub.open {
				t.p.close()
			}
		}
		t.done = true
	case 12: //div
		if len(s) >= 2 {
			b, a := s[len(s)-1], s[len(s)-2]
			r := 0.0
			if b != 0 {
				r = a / b
			}
			t.stack = append(s[:len(s)-2], r)
		}
	case 16: //callothersubr
		if len(s) < 2 {
			t.stack = t.stack[:0]
			return
		}
		other := int(s[len(s)-1])
		n := int(s[len(s)-2])
		rest := s[:len(s)-2]
		if n < 0 || n > len(rest) {
			n = len(rest)
		}
		args := append([]float64{}, rest[len(rest)-n:]...)
		t.stack = rest[:len(rest)-n]
		switch other {
		case 1: //Start flex
			t.flex = true
			t.flexPts = t.flexPts[:0]
		case 2: //Add a flex point (done by rmoveto)
		case 0: //End flex
			t.flex = false
			if len(t.flexPts) >= 7 {
				pts := t.flexPts
				t.curveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y)
				t.curveTo(pts[4].x, pts[4].y, pts[5].x, pts[5].y, pts[6].x, pts[6].y)
			}
			//The final point goes back through pop pop setcurrentpoint
			t.ps = append(t.ps[:0], t.y, t.x)
		default:
			//Hint replacement and unknown: return the arguments to pop
			t.ps = t.ps[:0]
			for k := len(args) - 1; k >= 0; k-- {
				t.ps = append(t.ps, args[k])
			}
		}
	case 17: //pop
		if len(t.ps) > 0 {
			v := t.ps[len(t.ps)-1]
			t.ps = t.ps[:len(t.ps)-1]
			t.stack = append(t.stack, v)
		}
	case 33: //setcurrentpoint
		if len(s) >= 2 {
			t.x, t.y = s[len(s)-2], s[len(s)-1]
		}
		t.stack = t.stack[:0]
	default:
		t.stack = t.stack[:0]
	}
}
