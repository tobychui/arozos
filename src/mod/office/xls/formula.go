package xls

/*
	formula.go - decompile BIFF parsed formulas back into formula text.

	Excel stores a formula as its compiled form: a byte string of "Ptg"
	tokens in reverse Polish order (rgce) followed by the extra data some
	of them need (rgcb: array constants, memory area lists). Decompiling is
	a stack machine: operands push their text, operators and functions pop
	their arguments and push the combined expression. Parentheses the user
	typed are tokens of their own (ptgParen), so no precedence rules are
	needed to print the formula the way it was entered.

	Every token keeps the class bits of BIFF (reference / value / array) in
	bits 5-6; they matter to Excel's evaluator, not to the text, so they are
	masked off. References come in three flavours: plain (absolute
	coordinates with "relative" flags for display), N (shared formulas and
	names: row and column offsets from the cell the formula is used in) and
	3D (through an EXTERNSHEET index naming the sheet or sheet range).

	The same code reads BIFF5 (Excel 5/95), whose references are narrower
	and whose 3D tokens are laid out differently.
*/

import (
	"encoding/binary"
	"errors"
	"math"
	"strconv"
	"strings"
	"unicode/utf16"
)

var errFormula = errors.New("unsupported formula")

// errCodes maps BIFF error values to their text
var errCodes = map[byte]string{
	0x00: "#NULL!", 0x07: "#DIV/0!", 0x0F: "#VALUE!", 0x17: "#REF!",
	0x1D: "#NAME?", 0x24: "#NUM!", 0x2A: "#N/A",
}

func errText(code byte) string {
	if s, ok := errCodes[code]; ok {
		return s
	}
	return "#N/A"
}

var binOps = map[byte]string{
	0x03: "+", 0x04: "-", 0x05: "*", 0x06: "/", 0x07: "^", 0x08: "&",
	0x09: "<", 0x0A: "<=", 0x0B: "=", 0x0C: ">=", 0x0D: ">", 0x0E: "<>",
	0x0F: " ", 0x10: ",", 0x11: ":",
}

// colName is the letter name of a 0-based column
func colName(c int) string {
	s := ""
	c++
	for c > 0 {
		m := (c - 1) % 26
		s = string(rune('A'+m)) + s
		c = (c - 1) / 26
	}
	return s
}

// cellText prints one reference with its $ markers
func cellText(row, col int, rowRel, colRel bool) string {
	var b strings.Builder
	if !colRel {
		b.WriteByte('$')
	}
	b.WriteString(colName(col))
	if !rowRel {
		b.WriteByte('$')
	}
	b.WriteString(strconv.Itoa(row + 1))
	return b.String()
}

// quoteSheet quotes a sheet name when a formula needs it to
func quoteSheet(name string) string {
	plain := name != ""
	for i, r := range name {
		if !(r == '_' || r == '.' || r >= 'A' && r <= 'Z' || r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r > 0x7F) {
			plain = false
			break
		}
		if i == 0 && r >= '0' && r <= '9' {
			plain = false
			break
		}
	}
	// a name that reads as a cell reference ("A1", "R1C1") must be quoted
	if plain && looksLikeRef(name) {
		plain = false
	}
	if plain {
		return name
	}
	return "'" + strings.ReplaceAll(name, "'", "''") + "'"
}

func looksLikeRef(s string) bool {
	i := 0
	for i < len(s) && (s[i] >= 'A' && s[i] <= 'Z' || s[i] >= 'a' && s[i] <= 'z') {
		i++
	}
	if i == 0 || i > 3 || i == len(s) {
		return false
	}
	for j := i; j < len(s); j++ {
		if s[j] < '0' || s[j] > '9' {
			return false
		}
	}
	return true
}

// formatNumber prints a constant the way Excel shows it in the formula bar
func formatNumber(v float64) string {
	if math.IsInf(v, 0) || math.IsNaN(v) {
		return "#NUM!"
	}
	if v == math.Trunc(v) && math.Abs(v) < 1e15 {
		return strconv.FormatInt(int64(v), 10)
	}
	s := strconv.FormatFloat(v, 'G', 15, 64)
	if strings.ContainsAny(s, "E") {
		// "1E-07" rather than "1E-7"
		mant, exp, _ := strings.Cut(s, "E")
		sign := exp[:1]
		digits := strings.TrimLeft(exp[1:], "0")
		if len(digits) < 2 {
			digits = strings.Repeat("0", 2-len(digits)) + digits
		}
		return mant + "E" + sign + digits
	}
	return s
}

func quoteString(s string) string {
	return `"` + strings.ReplaceAll(s, `"`, `""`) + `"`
}

// fmla is one decompilation
type fmla struct {
	b      *book
	rgce   []byte
	rgcb   []byte
	cbPos  int
	row    int // the cell the formula is evaluated in (N references)
	col    int
	stack  []string
	isName bool // a defined name's formula: N references are relative to A1
}

func (f *fmla) push(s string) { f.stack = append(f.stack, s) }

func (f *fmla) pop() (string, bool) {
	if len(f.stack) == 0 {
		return "", false
	}
	s := f.stack[len(f.stack)-1]
	f.stack = f.stack[:len(f.stack)-1]
	return s, true
}

func (f *fmla) popN(n int) ([]string, bool) {
	if n > len(f.stack) {
		return nil, false
	}
	args := append([]string(nil), f.stack[len(f.stack)-n:]...)
	f.stack = f.stack[:len(f.stack)-n]
	return args, true
}

// decompile turns rgce (+ rgcb) into formula text without the leading "="
func (b *book) decompile(rgce, rgcb []byte, row, col int) (string, error) {
	f := &fmla{b: b, rgce: rgce, rgcb: rgcb, row: row, col: col}
	return f.run()
}

// decompileName decompiles a defined name's formula
func (b *book) decompileName(rgce, rgcb []byte) (string, error) {
	f := &fmla{b: b, rgce: rgce, rgcb: rgcb, isName: true}
	return f.run()
}

func (f *fmla) run() (string, error) {
	p := 0
	le := binary.LittleEndian
	b := f.rgce
	need := func(n int) bool { return p+n <= len(b) }
	biff8 := f.b.biff8
	for p < len(b) {
		tok := b[p]
		p++
		base := tok
		if tok >= 0x20 && tok < 0x80 {
			base = (tok & 0x1F) | 0x20
		}
		switch {
		case base >= 0x03 && base <= 0x11:
			args, ok := f.popN(2)
			if !ok {
				return "", errFormula
			}
			f.push(args[0] + binOps[base] + args[1])
		case base == 0x12: // unary plus
			a, ok := f.pop()
			if !ok {
				return "", errFormula
			}
			f.push("+" + a)
		case base == 0x13: // unary minus
			a, ok := f.pop()
			if !ok {
				return "", errFormula
			}
			f.push("-" + a)
		case base == 0x14: // percent
			a, ok := f.pop()
			if !ok {
				return "", errFormula
			}
			f.push(a + "%")
		case base == 0x15: // parentheses
			a, ok := f.pop()
			if !ok {
				return "", errFormula
			}
			f.push("(" + a + ")")
		case base == 0x16: // missing argument
			f.push("")
		case base == 0x17: // string
			if biff8 {
				if !need(2) {
					return "", errFormula
				}
				cch := int(b[p])
				high := b[p+1]&1 != 0
				p += 2
				n := cch
				if high {
					n *= 2
				}
				if !need(n) {
					return "", errFormula
				}
				f.push(quoteString(decodeChars(b[p:p+n], high)))
				p += n
			} else {
				if !need(1) {
					return "", errFormula
				}
				cch := int(b[p])
				p++
				if !need(cch) {
					return "", errFormula
				}
				f.push(quoteString(f.b.cp.Decode(b[p : p+cch])))
				p += cch
			}
		case base == 0x18: // ptgExtend / BIFF8 extended tokens
			return "", errFormula
		case base == 0x19: // attributes
			if !need(3) {
				return "", errFormula
			}
			grbit := b[p]
			data := int(le.Uint16(b[p+1:]))
			p += 3
			switch {
			case grbit&0x04 != 0: // tAttrChoose: jump table follows
				p += 2 * (data + 1)
			case grbit&0x10 != 0: // tAttrSum: SUM of one argument
				a, ok := f.pop()
				if !ok {
					return "", errFormula
				}
				f.push("SUM(" + a + ")")
			}
		case base == 0x1C:
			if !need(1) {
				return "", errFormula
			}
			f.push(errText(b[p]))
			p++
		case base == 0x1D:
			if !need(1) {
				return "", errFormula
			}
			if b[p] != 0 {
				f.push("TRUE")
			} else {
				f.push("FALSE")
			}
			p++
		case base == 0x1E:
			if !need(2) {
				return "", errFormula
			}
			f.push(strconv.Itoa(int(le.Uint16(b[p:]))))
			p += 2
		case base == 0x1F:
			if !need(8) {
				return "", errFormula
			}
			f.push(formatNumber(math.Float64frombits(le.Uint64(b[p:]))))
			p += 8
		case base == 0x20: // array constant: the values are in rgcb
			p += 7
			s, err := f.arrayConst()
			if err != nil {
				return "", err
			}
			f.push(s)
		case base == 0x21: // function, fixed argument count
			if !need(2) {
				return "", errFormula
			}
			id := le.Uint16(b[p:])
			p += 2
			fi, ok := biffFuncs[id]
			if !ok {
				return "", errFormula
			}
			n := int(fi.max)
			if fi.max == 255 {
				n = int(fi.min)
			}
			args, ok := f.popN(n)
			if !ok {
				return "", errFormula
			}
			f.push(fi.name + "(" + strings.Join(args, ",") + ")")
		case base == 0x22: // function, variable argument count
			if !need(3) {
				return "", errFormula
			}
			n := int(b[p] & 0x7F)
			id := le.Uint16(b[p+1:]) & 0x7FFF
			p += 3
			args, ok := f.popN(n)
			if !ok {
				return "", errFormula
			}
			name := ""
			if id == 255 {
				// a user / add-in / newer function: the first argument is
				// its name
				if len(args) == 0 {
					return "", errFormula
				}
				name = args[0]
				args = args[1:]
			} else if fi, ok := biffFuncs[id]; ok {
				name = fi.name
			} else {
				return "", errFormula
			}
			f.push(name + "(" + strings.Join(args, ",") + ")")
		case base == 0x23: // defined name
			var idx int
			if biff8 {
				if !need(4) {
					return "", errFormula
				}
				idx = int(le.Uint16(b[p:]))
				p += 4
			} else {
				if !need(14) {
					return "", errFormula
				}
				idx = int(le.Uint16(b[p:]))
				p += 14
			}
			f.push(f.b.nameText(idx))
		case base == 0x24, base == 0x2A, base == 0x2C: // ref, ref error, ref N
			row, col, rr, cr, ok := f.readRef(b, &p, base == 0x2C)
			if !ok {
				return "", errFormula
			}
			if base == 0x2A {
				f.push("#REF!")
			} else {
				f.push(cellText(row, col, rr, cr))
			}
		case base == 0x25, base == 0x2B, base == 0x2D: // area, area error, area N
			s, ok := f.readArea(b, &p, base == 0x2D)
			if !ok {
				return "", errFormula
			}
			if base == 0x2B {
				s = "#REF!"
			}
			f.push(s)
		case base == 0x26, base == 0x27, base == 0x28: // mem area / err / nomem
			// a cache header: 4 reserved bytes and the size of the
			// subexpression that follows and is decompiled as usual
			p += 6
			if base == 0x26 {
				f.skipMemArea()
			}
		case base == 0x29, base == 0x2E, base == 0x2F: // mem func / mem area N / mem nomem N
			p += 2
		case base == 0x39: // external / add-in name
			if biff8 {
				if !need(6) {
					return "", errFormula
				}
				ixti := int(le.Uint16(b[p:]))
				idx := int(le.Uint16(b[p+2:]))
				p += 6
				f.push(f.b.externNameText(ixti, idx))
			} else {
				if !need(24) {
					return "", errFormula
				}
				ixals := int(int16(le.Uint16(b[p:])))
				idx := int(le.Uint16(b[p+10:]))
				p += 24
				f.push(f.b.externNameText5(ixals, idx))
			}
		case base == 0x3A, base == 0x3C: // 3D ref, 3D ref error
			prefix, ok := f.read3DPrefix(b, &p)
			if !ok {
				return "", errFormula
			}
			row, col, rr, cr, ok := f.readRef(b, &p, false)
			if !ok {
				return "", errFormula
			}
			if base == 0x3C || prefix == "#REF!" {
				f.push("#REF!")
			} else {
				f.push(prefix + cellText(row, col, rr, cr))
			}
		case base == 0x3B, base == 0x3D: // 3D area, 3D area error
			prefix, ok := f.read3DPrefix(b, &p)
			if !ok {
				return "", errFormula
			}
			s, ok := f.readArea(b, &p, false)
			if !ok {
				return "", errFormula
			}
			if base == 0x3D || prefix == "#REF!" {
				f.push("#REF!")
			} else {
				f.push(prefix + s)
			}
		case base == 0x01, base == 0x02: // shared / table formula pointer
			return "", errFormula
		default:
			return "", errFormula
		}
		if p > len(b) {
			return "", errFormula
		}
	}
	if len(f.stack) != 1 {
		return "", errFormula
	}
	return f.stack[0], nil
}

// readRef reads one cell reference; rel marks an N reference whose
// relative parts are offsets from the formula's cell
func (f *fmla) readRef(b []byte, p *int, rel bool) (row, col int, rowRel, colRel bool, ok bool) {
	le := binary.LittleEndian
	if f.b.biff8 {
		if *p+4 > len(b) {
			return 0, 0, false, false, false
		}
		rw := le.Uint16(b[*p:])
		cl := le.Uint16(b[*p+2:])
		*p += 4
		rowRel, colRel = cl&0x8000 != 0, cl&0x4000 != 0
		row, col = int(rw), int(cl&0x3FFF)
		if rel {
			if rowRel {
				row = f.row + int(int16(rw))
			}
			if colRel {
				col = f.col + int(int8(cl&0xFF))
			}
		}
	} else {
		if *p+3 > len(b) {
			return 0, 0, false, false, false
		}
		rw := le.Uint16(b[*p:])
		cl := b[*p+2]
		*p += 3
		rowRel, colRel = rw&0x8000 != 0, rw&0x4000 != 0
		row, col = int(rw&0x3FFF), int(cl)
		if rel {
			if rowRel {
				off := int(rw & 0x3FFF)
				if off&0x2000 != 0 {
					off -= 0x4000
				}
				row = f.row + off
			}
			if colRel {
				col = f.col + int(int8(cl))
			}
		}
	}
	row = wrap(row, f.b.maxRows())
	col = wrap(col, 256)
	return row, col, rowRel, colRel, true
}

func wrap(v, n int) int {
	v %= n
	if v < 0 {
		v += n
	}
	return v
}

// readArea reads a rectangle reference; whole rows and columns print the
// way Excel shows them (A:B, 3:5)
func (f *fmla) readArea(b []byte, p *int, rel bool) (string, bool) {
	le := binary.LittleEndian
	var r1, r2, c1, c2 int
	var rr1, rr2, cr1, cr2 bool
	if f.b.biff8 {
		if *p+8 > len(b) {
			return "", false
		}
		rw1, rw2 := le.Uint16(b[*p:]), le.Uint16(b[*p+2:])
		cl1, cl2 := le.Uint16(b[*p+4:]), le.Uint16(b[*p+6:])
		*p += 8
		r1, r2, c1, c2 = int(rw1), int(rw2), int(cl1&0x3FFF), int(cl2&0x3FFF)
		rr1, cr1 = cl1&0x8000 != 0, cl1&0x4000 != 0
		rr2, cr2 = cl2&0x8000 != 0, cl2&0x4000 != 0
		if rel {
			if rr1 {
				r1 = f.row + int(int16(rw1))
			}
			if rr2 {
				r2 = f.row + int(int16(rw2))
			}
			if cr1 {
				c1 = f.col + int(int8(cl1&0xFF))
			}
			if cr2 {
				c2 = f.col + int(int8(cl2&0xFF))
			}
		}
	} else {
		if *p+6 > len(b) {
			return "", false
		}
		rw1, rw2 := le.Uint16(b[*p:]), le.Uint16(b[*p+2:])
		cl1, cl2 := b[*p+4], b[*p+5]
		*p += 6
		r1, r2, c1, c2 = int(rw1&0x3FFF), int(rw2&0x3FFF), int(cl1), int(cl2)
		rr1, cr1 = rw1&0x8000 != 0, rw1&0x4000 != 0
		rr2, cr2 = rw2&0x8000 != 0, rw2&0x4000 != 0
		if rel {
			sx := func(v uint16) int {
				o := int(v & 0x3FFF)
				if o&0x2000 != 0 {
					o -= 0x4000
				}
				return o
			}
			if rr1 {
				r1 = f.row + sx(rw1)
			}
			if rr2 {
				r2 = f.row + sx(rw2)
			}
			if cr1 {
				c1 = f.col + int(int8(cl1))
			}
			if cr2 {
				c2 = f.col + int(int8(cl2))
			}
		}
	}
	maxR := f.b.maxRows()
	r1, r2, c1, c2 = wrap(r1, maxR), wrap(r2, maxR), wrap(c1, 256), wrap(c2, 256)
	switch {
	case r1 == 0 && r2 == maxR-1 && !rel:
		// whole columns
		a, z := colName(c1), colName(c2)
		if !cr1 {
			a = "$" + a
		}
		if !cr2 {
			z = "$" + z
		}
		return a + ":" + z, true
	case c1 == 0 && c2 == 255 && !rel:
		a, z := strconv.Itoa(r1+1), strconv.Itoa(r2+1)
		if !rr1 {
			a = "$" + a
		}
		if !rr2 {
			z = "$" + z
		}
		return a + ":" + z, true
	}
	return cellText(r1, c1, rr1, cr1) + ":" + cellText(r2, c2, rr2, cr2), true
}

// read3DPrefix reads the sheet part of a 3D reference ("Data!",
// "'Q1':'Q4'!") or "#REF!" for a sheet that is gone or external
func (f *fmla) read3DPrefix(b []byte, p *int) (string, bool) {
	le := binary.LittleEndian
	if f.b.biff8 {
		if *p+2 > len(b) {
			return "", false
		}
		ixti := int(le.Uint16(b[*p:]))
		*p += 2
		return f.b.sheetPrefix(ixti), true
	}
	if *p+14 > len(b) {
		return "", false
	}
	ixals := int(int16(le.Uint16(b[*p:])))
	first := int(int16(le.Uint16(b[*p+10:])))
	last := int(int16(le.Uint16(b[*p+12:])))
	*p += 14
	if ixals >= 0 {
		return "#REF!", true // another workbook
	}
	return f.b.sheetRangePrefix(first, last), true
}

// arrayConst reads the next array constant out of rgcb
func (f *fmla) arrayConst() (string, error) {
	le := binary.LittleEndian
	c := f.rgcb
	if f.cbPos+3 > len(c) {
		return "", errFormula
	}
	cols := int(c[f.cbPos]) + 1
	rows := int(le.Uint16(c[f.cbPos+1:])) + 1
	if !f.b.biff8 && cols == 1 && c[f.cbPos] == 0 {
		cols = 256
	}
	f.cbPos += 3
	if rows*cols > 1<<16 {
		return "", errFormula
	}
	var sb strings.Builder
	sb.WriteByte('{')
	for r := 0; r < rows; r++ {
		if r > 0 {
			sb.WriteByte(';')
		}
		for col := 0; col < cols; col++ {
			if col > 0 {
				sb.WriteByte(',')
			}
			if f.cbPos >= len(c) {
				return "", errFormula
			}
			t := c[f.cbPos]
			f.cbPos++
			switch t {
			case 0x00: // empty
				f.cbPos += 8
			case 0x01:
				if f.cbPos+8 > len(c) {
					return "", errFormula
				}
				sb.WriteString(formatNumber(math.Float64frombits(le.Uint64(c[f.cbPos:]))))
				f.cbPos += 8
			case 0x02:
				if f.b.biff8 {
					if f.cbPos+3 > len(c) {
						return "", errFormula
					}
					cch := int(le.Uint16(c[f.cbPos:]))
					high := c[f.cbPos+2]&1 != 0
					f.cbPos += 3
					n := cch
					if high {
						n *= 2
					}
					if f.cbPos+n > len(c) {
						return "", errFormula
					}
					sb.WriteString(quoteString(decodeChars(c[f.cbPos:f.cbPos+n], high)))
					f.cbPos += n
				} else {
					if f.cbPos+1 > len(c) {
						return "", errFormula
					}
					cch := int(c[f.cbPos])
					f.cbPos++
					if f.cbPos+cch > len(c) {
						return "", errFormula
					}
					sb.WriteString(quoteString(f.b.cp.Decode(c[f.cbPos : f.cbPos+cch])))
					f.cbPos += cch
				}
			case 0x04:
				if f.cbPos+8 > len(c) {
					return "", errFormula
				}
				if c[f.cbPos] != 0 {
					sb.WriteString("TRUE")
				} else {
					sb.WriteString("FALSE")
				}
				f.cbPos += 8
			case 0x10:
				if f.cbPos+8 > len(c) {
					return "", errFormula
				}
				sb.WriteString(errText(c[f.cbPos]))
				f.cbPos += 8
			default:
				return "", errFormula
			}
		}
	}
	sb.WriteByte('}')
	return sb.String(), nil
}

// skipMemArea steps over the PtgExtraMem list of a ptgMemArea
func (f *fmla) skipMemArea() {
	c := f.rgcb
	if f.cbPos+2 > len(c) {
		f.cbPos = len(c)
		return
	}
	n := int(binary.LittleEndian.Uint16(c[f.cbPos:]))
	size := 8
	if !f.b.biff8 {
		size = 6
	}
	f.cbPos += 2 + n*size
}

// decodeChars decodes 8-bit (Latin-1) or UTF-16LE characters
func decodeChars(b []byte, high bool) string {
	if !high {
		u := make([]uint16, len(b))
		for i, c := range b {
			u[i] = uint16(c)
		}
		return string(utf16.Decode(u))
	}
	u := make([]uint16, len(b)/2)
	for i := range u {
		u[i] = binary.LittleEndian.Uint16(b[2*i:])
	}
	return string(utf16.Decode(u))
}
