package pdfrender

import (
	"math"
)

/*
	function.go

	PDF functions (ISO 32000 7.10): sampled (type 0), exponential (type 2),
	stitching (type 3) and PostScript calculator (type 4). They drive tint
	transforms of Separation / DeviceN colours and the colour of shadings.
*/

type pdfFunction interface {
	eval(in []float64) []float64
}

type funcBase struct {
	domain []float64
	rng    []float64
}

func clamp(v, lo, hi float64) float64 {
	if v < lo {
		return lo
	}
	if v > hi {
		return hi
	}
	if math.IsNaN(v) {
		return lo
	}
	return v
}

func (f *funcBase) clipIn(in []float64) []float64 {
	out := make([]float64, len(in))
	for i, v := range in {
		if 2*i+1 < len(f.domain) {
			v = clamp(v, f.domain[2*i], f.domain[2*i+1])
		}
		out[i] = v
	}
	return out
}

func (f *funcBase) clipOut(out []float64) []float64 {
	for i := range out {
		if 2*i+1 < len(f.rng) {
			out[i] = clamp(out[i], f.rng[2*i], f.rng[2*i+1])
		}
	}
	return out
}

// loadFunction parses a function object, or an array of 1 output functions
// combined into one
func (d *Document) loadFunction(o Object, depth int) pdfFunction {
	if depth > 8 {
		return nil
	}
	o = d.resolve(o)
	if arr, ok := o.(Array); ok {
		var fs []pdfFunction
		for _, e := range arr {
			f := d.loadFunction(e, depth+1)
			if f == nil {
				return nil
			}
			fs = append(fs, f)
		}
		if len(fs) == 0 {
			return nil
		}
		return &funcArray{fs: fs}
	}
	dict := d.dict(o)
	if dict == nil {
		return nil
	}
	base := funcBase{domain: d.numbers(dict["Domain"]), rng: d.numbers(dict["Range"])}
	switch d.integer(dict["FunctionType"], -1) {
	case 0:
		s := d.stream(o)
		if s == nil {
			return nil
		}
		return d.loadSampled(s, base)
	case 2:
		f := &funcExp{funcBase: base, c0: d.numbers(dict["C0"]), c1: d.numbers(dict["C1"]), n: d.num(dict["N"], 1)}
		if len(f.c0) == 0 {
			f.c0 = []float64{0}
		}
		if len(f.c1) == 0 {
			f.c1 = []float64{1}
		}
		return f
	case 3:
		f := &funcStitch{funcBase: base, bounds: d.numbers(dict["Bounds"]), encode: d.numbers(dict["Encode"])}
		for _, e := range d.array(dict["Functions"]) {
			sub := d.loadFunction(e, depth+1)
			if sub == nil {
				return nil
			}
			f.fs = append(f.fs, sub)
		}
		if len(f.fs) == 0 || len(f.bounds) != len(f.fs)-1 {
			return nil
		}
		return f
	case 4:
		s := d.stream(o)
		if s == nil {
			return nil
		}
		data, err := d.decodeStream(s, 1<<20)
		if err != nil {
			return nil
		}
		prog := parsePostScript(data)
		if prog == nil {
			return nil
		}
		return &funcPS{funcBase: base, prog: prog}
	}
	return nil
}

type funcArray struct {
	fs []pdfFunction
}

func (f *funcArray) eval(in []float64) []float64 {
	out := make([]float64, 0, len(f.fs))
	for _, sub := range f.fs {
		r := sub.eval(in)
		if len(r) > 0 {
			out = append(out, r[0])
		} else {
			out = append(out, 0)
		}
	}
	return out
}

type funcExp struct {
	funcBase
	c0, c1 []float64
	n      float64
}

func (f *funcExp) eval(in []float64) []float64 {
	x := 0.0
	if len(in) > 0 {
		x = f.clipIn(in[:1])[0]
	}
	n := len(f.c0)
	if len(f.c1) < n {
		n = len(f.c1)
	}
	out := make([]float64, n)
	xn := math.Pow(x, f.n)
	if math.IsNaN(xn) || math.IsInf(xn, 0) {
		xn = 0
	}
	for i := 0; i < n; i++ {
		out[i] = f.c0[i] + xn*(f.c1[i]-f.c0[i])
	}
	return f.clipOut(out)
}

type funcStitch struct {
	funcBase
	fs     []pdfFunction
	bounds []float64
	encode []float64
}

func (f *funcStitch) eval(in []float64) []float64 {
	x := 0.0
	if len(in) > 0 {
		x = f.clipIn(in[:1])[0]
	}
	lo, hi := 0.0, 1.0
	if len(f.domain) >= 2 {
		lo, hi = f.domain[0], f.domain[1]
	}
	k := 0
	for k < len(f.bounds) && x >= f.bounds[k] {
		k++
	}
	b0, b1 := lo, hi
	if k > 0 {
		b0 = f.bounds[k-1]
	}
	if k < len(f.bounds) {
		b1 = f.bounds[k]
	}
	e0, e1 := 0.0, 1.0
	if 2*k+1 < len(f.encode) {
		e0, e1 = f.encode[2*k], f.encode[2*k+1]
	}
	t := e0
	if b1 != b0 {
		t = e0 + (x-b0)*(e1-e0)/(b1-b0)
	}
	return f.clipOut(f.fs[k].eval([]float64{t}))
}

type funcSampled struct {
	funcBase
	size    []int
	bps     int
	encode  []float64
	decode  []float64
	samples []float64 //Normalised to 0..1
	nOut    int
}

func (d *Document) loadSampled(s *Stream, base funcBase) pdfFunction {
	dict := s.Dict
	sizes := d.numbers(dict["Size"])
	m := len(base.domain) / 2
	n := len(base.rng) / 2
	if m < 1 || m > 4 || n < 1 || n > 32 || len(sizes) < m {
		return nil
	}
	f := &funcSampled{funcBase: base, bps: d.integer(dict["BitsPerSample"], 8), nOut: n}
	total := int64(n)
	for i := 0; i < m; i++ {
		sz := int(sizes[i])
		if sz < 1 || sz > 1<<16 {
			return nil
		}
		f.size = append(f.size, sz)
		total *= int64(sz)
		if total > 1<<22 {
			return nil
		}
	}
	switch f.bps {
	case 1, 2, 4, 8, 12, 16, 24, 32:
	default:
		return nil
	}
	f.encode = d.numbers(dict["Encode"])
	if len(f.encode) < 2*m {
		f.encode = nil
		for i := 0; i < m; i++ {
			f.encode = append(f.encode, 0, float64(f.size[i]-1))
		}
	}
	f.decode = d.numbers(dict["Decode"])
	if len(f.decode) < 2*n {
		f.decode = base.rng
	}
	data, err := d.decodeStream(s, 64<<20)
	if err != nil {
		return nil
	}
	maxV := math.Pow(2, float64(f.bps)) - 1
	f.samples = make([]float64, total)
	br := bitReader{data: data}
	for i := range f.samples {
		v, ok := br.read(f.bps)
		if !ok {
			break
		}
		f.samples[i] = float64(v) / maxV
	}
	return f
}

func (f *funcSampled) eval(in []float64) []float64 {
	m := len(f.size)
	x := make([]float64, m)
	for i := 0; i < m; i++ {
		v := 0.0
		if i < len(in) {
			v = in[i]
		}
		d0, d1 := f.domain[2*i], f.domain[2*i+1]
		v = clamp(v, math.Min(d0, d1), math.Max(d0, d1))
		e := f.encode[2*i]
		if d1 != d0 {
			e = f.encode[2*i] + (v-d0)*(f.encode[2*i+1]-f.encode[2*i])/(d1-d0)
		}
		x[i] = clamp(e, 0, float64(f.size[i]-1))
	}
	out := make([]float64, f.nOut)
	//Multilinear interpolation over the 2^m corners
	corners := 1 << m
	for c := 0; c < corners; c++ {
		w := 1.0
		idx := 0
		stride := 1
		for i := 0; i < m; i++ {
			lo := math.Floor(x[i])
			frac := x[i] - lo
			pos := int(lo)
			if c&(1<<i) != 0 {
				if pos+1 < f.size[i] {
					pos++
				}
				w *= frac
			} else {
				w *= 1 - frac
			}
			idx += pos * stride
			stride *= f.size[i]
		}
		if w == 0 {
			continue
		}
		for j := 0; j < f.nOut; j++ {
			k := idx*f.nOut + j
			if k < len(f.samples) {
				out[j] += w * f.samples[k]
			}
		}
	}
	for j := range out {
		if 2*j+1 < len(f.decode) {
			out[j] = f.decode[2*j] + out[j]*(f.decode[2*j+1]-f.decode[2*j])
		}
	}
	return f.clipOut(out)
}

type bitReader struct {
	data []byte
	pos  int //bit position
}

func (b *bitReader) read(n int) (uint32, bool) {
	var v uint32
	for i := 0; i < n; i++ {
		byteIdx := b.pos >> 3
		if byteIdx >= len(b.data) {
			return v, false
		}
		bit := (b.data[byteIdx] >> (7 - uint(b.pos&7))) & 1
		v = v<<1 | uint32(bit)
		b.pos++
	}
	return v, true
}

func (b *bitReader) alignByte() {
	b.pos = (b.pos + 7) &^ 7
}

/*
	PostScript calculator functions
*/

type psOp struct {
	op    string
	num   float64
	ifT   []psOp
	ifF   []psOp
	isNum bool
}

type funcPS struct {
	funcBase
	prog []psOp
}

func parsePostScript(data []byte) []psOp {
	l := &lexer{buf: data}
	t := l.next()
	if t.kind != tokBraceOpen {
		return nil
	}
	prog, ok := parsePSBlock(l, 0)
	if !ok {
		return nil
	}
	return prog
}

func parsePSBlock(l *lexer, depth int) ([]psOp, bool) {
	if depth > 32 {
		return nil, false
	}
	var ops []psOp
	var pending [][]psOp
	for {
		t := l.next()
		switch t.kind {
		case tokEOF:
			return nil, false
		case tokBraceClose:
			return ops, true
		case tokBraceOpen:
			blk, ok := parsePSBlock(l, depth+1)
			if !ok {
				return nil, false
			}
			pending = append(pending, blk)
		case tokInt:
			ops = append(ops, psOp{isNum: true, num: float64(t.i)})
		case tokReal:
			ops = append(ops, psOp{isNum: true, num: t.f})
		case tokKeyword:
			switch t.s {
			case "if":
				if len(pending) < 1 {
					return nil, false
				}
				ops = append(ops, psOp{op: "if", ifT: pending[len(pending)-1]})
				pending = pending[:len(pending)-1]
			case "ifelse":
				if len(pending) < 2 {
					return nil, false
				}
				ops = append(ops, psOp{op: "ifelse", ifT: pending[len(pending)-2], ifF: pending[len(pending)-1]})
				pending = pending[:len(pending)-2]
			default:
				ops = append(ops, psOp{op: t.s})
			}
		}
	}
}

func (f *funcPS) eval(in []float64) []float64 {
	st := &psStack{}
	for _, v := range f.clipIn(in) {
		st.push(v)
	}
	steps := 0
	st.run(f.prog, &steps)
	n := len(f.rng) / 2
	out := make([]float64, n)
	for i := n - 1; i >= 0; i-- {
		out[i] = st.pop()
	}
	return f.clipOut(out)
}

type psStack struct {
	v []float64
}

func (s *psStack) push(x float64) {
	if len(s.v) < 100 {
		s.v = append(s.v, x)
	}
}

func (s *psStack) pop() float64 {
	if len(s.v) == 0 {
		return 0
	}
	x := s.v[len(s.v)-1]
	s.v = s.v[:len(s.v)-1]
	return x
}

func boolNum(b bool) float64 {
	if b {
		return 1
	}
	return 0
}

func (s *psStack) run(prog []psOp, steps *int) {
	for _, op := range prog {
		*steps++
		if *steps > 10000 {
			return
		}
		if op.isNum {
			s.push(op.num)
			continue
		}
		switch op.op {
		case "add":
			b, a := s.pop(), s.pop()
			s.push(a + b)
		case "sub":
			b, a := s.pop(), s.pop()
			s.push(a - b)
		case "mul":
			b, a := s.pop(), s.pop()
			s.push(a * b)
		case "div":
			b, a := s.pop(), s.pop()
			if b == 0 {
				s.push(0)
			} else {
				s.push(a / b)
			}
		case "idiv":
			b, a := int64(s.pop()), int64(s.pop())
			if b == 0 {
				s.push(0)
			} else {
				s.push(float64(a / b))
			}
		case "mod":
			b, a := int64(s.pop()), int64(s.pop())
			if b == 0 {
				s.push(0)
			} else {
				s.push(float64(a % b))
			}
		case "neg":
			s.push(-s.pop())
		case "abs":
			s.push(math.Abs(s.pop()))
		case "ceiling":
			s.push(math.Ceil(s.pop()))
		case "floor":
			s.push(math.Floor(s.pop()))
		case "round":
			s.push(math.Floor(s.pop() + 0.5))
		case "truncate", "cvi":
			s.push(math.Trunc(s.pop()))
		case "cvr":
		case "sqrt":
			s.push(math.Sqrt(math.Max(0, s.pop())))
		case "sin":
			s.push(math.Sin(s.pop() * math.Pi / 180))
		case "cos":
			s.push(math.Cos(s.pop() * math.Pi / 180))
		case "atan":
			den, num := s.pop(), s.pop()
			a := math.Atan2(num, den) * 180 / math.Pi
			if a < 0 {
				a += 360
			}
			s.push(a)
		case "exp":
			e, b := s.pop(), s.pop()
			s.push(math.Pow(b, e))
		case "ln":
			s.push(math.Log(math.Max(1e-30, s.pop())))
		case "log":
			s.push(math.Log10(math.Max(1e-30, s.pop())))
		case "eq":
			b, a := s.pop(), s.pop()
			s.push(boolNum(a == b))
		case "ne":
			b, a := s.pop(), s.pop()
			s.push(boolNum(a != b))
		case "gt":
			b, a := s.pop(), s.pop()
			s.push(boolNum(a > b))
		case "ge":
			b, a := s.pop(), s.pop()
			s.push(boolNum(a >= b))
		case "lt":
			b, a := s.pop(), s.pop()
			s.push(boolNum(a < b))
		case "le":
			b, a := s.pop(), s.pop()
			s.push(boolNum(a <= b))
		case "and":
			b, a := int64(s.pop()), int64(s.pop())
			s.push(float64(a & b))
		case "or":
			b, a := int64(s.pop()), int64(s.pop())
			s.push(float64(a | b))
		case "xor":
			b, a := int64(s.pop()), int64(s.pop())
			s.push(float64(a ^ b))
		case "not":
			a := s.pop()
			if a == 0 || a == 1 {
				s.push(1 - a)
			} else {
				s.push(float64(^int64(a)))
			}
		case "bitshift":
			sh, a := int64(s.pop()), int64(s.pop())
			if sh > 0 && sh < 63 {
				s.push(float64(a << uint(sh)))
			} else if sh < 0 && sh > -63 {
				s.push(float64(a >> uint(-sh)))
			} else {
				s.push(float64(a))
			}
		case "true":
			s.push(1)
		case "false":
			s.push(0)
		case "pop":
			s.pop()
		case "dup":
			a := s.pop()
			s.push(a)
			s.push(a)
		case "exch":
			b, a := s.pop(), s.pop()
			s.push(b)
			s.push(a)
		case "copy":
			n := int(s.pop())
			if n > 0 && n <= len(s.v) {
				s.v = append(s.v, s.v[len(s.v)-n:]...)
				if len(s.v) > 100 {
					s.v = s.v[:100]
				}
			}
		case "index":
			n := int(s.pop())
			if n >= 0 && n < len(s.v) {
				s.push(s.v[len(s.v)-1-n])
			} else {
				s.push(0)
			}
		case "roll":
			j, n := int(s.pop()), int(s.pop())
			if n > 0 && n <= len(s.v) {
				part := s.v[len(s.v)-n:]
				j = ((j % n) + n) % n
				tmp := append(append([]float64{}, part[n-j:]...), part[:n-j]...)
				copy(part, tmp)
			}
		case "if":
			if s.pop() != 0 {
				s.run(op.ifT, steps)
			}
		case "ifelse":
			if s.pop() != 0 {
				s.run(op.ifT, steps)
			} else {
				s.run(op.ifF, steps)
			}
		}
	}
}
