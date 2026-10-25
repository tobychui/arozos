package pdfrender

import (
	"strings"
	"sync"

	"golang.org/x/image/font/gofont/gobold"
	"golang.org/x/image/font/gofont/gobolditalic"
	"golang.org/x/image/font/gofont/goitalic"
	"golang.org/x/image/font/gofont/gomono"
	"golang.org/x/image/font/gofont/gomonobold"
	"golang.org/x/image/font/gofont/gomonobolditalic"
	"golang.org/x/image/font/gofont/gomonoitalic"
	"golang.org/x/image/font/gofont/goregular"
)

/*
	font.go

	PDF font dictionaries: simple fonts (Type1, MMType1, TrueType), Type 3
	and composite (Type0 with a CIDFontType0 / CIDFontType2 descendant).
	Each one decodes a string into character codes, gives their advance
	widths and finds their outlines in the embedded program. Fonts that are
	not embedded are drawn with the Go fonts, stretched to the widths the
	PDF asks for so line layout stays right.
*/

type fontKind int

const (
	fontSimple fontKind = iota
	fontType0
	fontType3
)

type charCode struct {
	code uint32
	n    int
	cid  int
}

type glyphOutline struct {
	p *path
	m matrix //Glyph units to text space
}

type pdfFont struct {
	kind fontKind
	name string

	//Simple fonts
	names        [256]string
	hasEncoding  bool
	symbolic     bool
	widths       map[int]float64 //Glyph space units / 1000 (Type 3: glyph space)
	hasWidths    bool
	missingWidth float64

	//Composite fonts
	cmap       *cmap
	dw         float64
	vertical   bool
	dw2        [2]float64
	w2         map[int][3]float64
	cidToGID   []uint16
	cidMapIden bool

	//Programs
	tt       *ttFont
	cff      *cffFont
	t1       *type1Font
	fallback *ttFont
	toUni    *cmap

	//Type 3
	t3procs  Dict
	t3res    Dict
	t3matrix matrix

	cache map[int]*glyphOutline
	macRe map[string]int
}

// loadFont builds the font for a font dictionary
func (d *Document) loadFont(o Object) *pdfFont {
	fd := d.dict(o)
	if fd == nil {
		return nil
	}
	f := &pdfFont{cache: map[int]*glyphOutline{}, widths: map[int]float64{}}
	f.name = string(d.name(fd["BaseFont"]))
	if i := strings.IndexByte(f.name, '+'); i == 6 {
		//Subset prefix
		f.name = f.name[7:]
	}
	if tu := d.stream(fd["ToUnicode"]); tu != nil {
		if data, err := d.decodeStream(tu, 4<<20); err == nil {
			f.toUni = parseCMap(data)
		}
	}
	switch d.name(fd["Subtype"]) {
	case "Type0":
		f.kind = fontType0
		d.loadType0(f, fd)
	case "Type3":
		f.kind = fontType3
		d.loadType3(f, fd)
	default:
		f.kind = fontSimple
		d.loadSimple(f, fd)
	}
	return f
}

func (d *Document) loadDescriptorProgram(f *pdfFont, desc Dict) {
	if desc == nil {
		return
	}
	if s := d.stream(desc["FontFile2"]); s != nil {
		if data, err := d.decodeStream(s, 64<<20); err == nil {
			if t, err := parseSFNT(data); err == nil {
				f.tt = t
				if t.cff != nil && t.glyf == nil {
					f.cff = t.cff
				}
			}
		}
	}
	if f.tt == nil {
		if s := d.stream(desc["FontFile3"]); s != nil {
			if data, err := d.decodeStream(s, 64<<20); err == nil {
				if d.name(s.Dict["Subtype"]) == "OpenType" || (len(data) > 4 && (string(data[:4]) == "OTTO" || string(data[:4]) == "\x00\x01\x00\x00" || string(data[:4]) == "true")) {
					if t, err := parseSFNT(data); err == nil {
						f.tt = t
						if t.cff != nil && t.glyf == nil {
							f.cff = t.cff
						}
					}
				} else if c, err := parseCFF(data); err == nil {
					f.cff = c
				}
			}
		}
	}
	if f.tt == nil && f.cff == nil {
		if s := d.stream(desc["FontFile"]); s != nil {
			if data, err := d.decodeStream(s, 64<<20); err == nil {
				if t, err := parseType1(data, d.integer(s.Dict["Length1"], 0)); err == nil {
					f.t1 = t
				} else if c, err := parseCFF(data); err == nil {
					//Mislabelled CFF data
					f.cff = c
				}
			}
		}
	}
}

func (d *Document) loadSimple(f *pdfFont, fd Dict) {
	desc := d.dict(fd["FontDescriptor"])
	flags := d.integer(desc["Flags"], 0)
	f.symbolic = flags&4 != 0
	f.missingWidth = d.num(desc["MissingWidth"], 0)
	d.loadDescriptorProgram(f, desc)
	if f.tt == nil && f.cff == nil && f.t1 == nil {
		f.fallback = fallbackFont(f.name, flags, d.num(desc["FontWeight"], 0), d.num(desc["ItalicAngle"], 0))
	}

	//Widths
	if ws := d.array(fd["Widths"]); ws != nil {
		f.hasWidths = true
		first := d.integer(fd["FirstChar"], 0)
		for i, w := range ws {
			if c := first + i; c >= 0 && c < 256 {
				f.widths[c] = d.num(w, 0)
			}
		}
	}

	//Encoding: base, then differences
	var base *[256]string
	builtin := func() *[256]string {
		var b [256]string
		switch {
		case f.t1 != nil:
			for c, n := range f.t1.encoding {
				if c >= 0 && c < 256 {
					b[c] = n
				}
			}
		case f.cff != nil && !f.cff.isCID:
			for c, g := range f.cff.encoding {
				if c >= 0 && c < 256 {
					b[c] = f.cff.glyphName(g)
				}
			}
		default:
			return nil
		}
		return &b
	}
	isSymbolName := strings.HasPrefix(f.name, "Symbol")
	enc := d.resolve(fd["Encoding"])
	switch e := enc.(type) {
	case Name:
		base = encodingByName(e)
		f.hasEncoding = base != nil
	case Dict:
		f.hasEncoding = true
		base = encodingByName(d.name(e["BaseEncoding"]))
	}
	if base == nil {
		if b := builtin(); b != nil && (enc == nil || f.symbolic || f.t1 != nil || f.cff != nil) {
			base = b
		} else if isSymbolName {
			base = &symbolEncoding
		} else if f.tt != nil && enc == nil {
			base = nil
		} else {
			base = &standardEncoding
		}
	}
	if base != nil {
		f.names = *base
	}
	if e, ok := enc.(Dict); ok {
		code := 0
		for _, item := range d.array(e["Differences"]) {
			switch v := d.resolve(item).(type) {
			case int:
				code = v
			case float64:
				code = int(v)
			case Name:
				if code >= 0 && code < 256 {
					f.names[code] = string(v)
				}
				code++
			}
		}
	}
}

func (d *Document) loadType3(f *pdfFont, fd Dict) {
	f.t3procs = d.dict(fd["CharProcs"])
	f.t3res = d.dict(fd["Resources"])
	f.t3matrix = matrix{0.001, 0, 0, 0.001, 0, 0}
	if m := d.numbers(fd["FontMatrix"]); len(m) == 6 {
		f.t3matrix = matrix{m[0], m[1], m[2], m[3], m[4], m[5]}
	}
	if ws := d.array(fd["Widths"]); ws != nil {
		f.hasWidths = true
		first := d.integer(fd["FirstChar"], 0)
		for i, w := range ws {
			if c := first + i; c >= 0 && c < 256 {
				f.widths[c] = d.num(w, 0)
			}
		}
	}
	if e := d.dict(fd["Encoding"]); e != nil {
		code := 0
		for _, item := range d.array(e["Differences"]) {
			switch v := d.resolve(item).(type) {
			case int:
				code = v
			case float64:
				code = int(v)
			case Name:
				if code >= 0 && code < 256 {
					f.names[code] = string(v)
				}
				code++
			}
		}
	}
}

func (d *Document) loadType0(f *pdfFont, fd Dict) {
	switch e := d.resolve(fd["Encoding"]).(type) {
	case Name:
		f.cmap = predefinedCMap(string(e))
	case *Stream:
		if data, err := d.decodeStream(e, 8<<20); err == nil {
			f.cmap = parseCMap(data)
			if base := d.name(e.Dict["UseCMap"]); base != "" {
				b := predefinedCMap(string(base))
				f.cmap.codespace = append(f.cmap.codespace, b.codespace...)
				f.cmap.identity = f.cmap.identity || b.identity
			}
			if d.integer(e.Dict["WMode"], 0) == 1 {
				f.cmap.vertical = true
			}
		}
	}
	if f.cmap == nil {
		f.cmap = predefinedCMap("Identity-H")
	}
	f.vertical = f.cmap.vertical
	desc := d.array(fd["DescendantFonts"])
	if len(desc) == 0 {
		return
	}
	cf := d.dict(desc[0])
	if cf == nil {
		return
	}
	fdesc := d.dict(cf["FontDescriptor"])
	flags := d.integer(fdesc["Flags"], 0)
	d.loadDescriptorProgram(f, fdesc)
	if f.tt == nil && f.cff == nil {
		name := string(d.name(cf["BaseFont"]))
		f.fallback = fallbackFont(name, flags, d.num(fdesc["FontWeight"], 0), d.num(fdesc["ItalicAngle"], 0))
	}
	f.dw = d.num(cf["DW"], 1000)
	//W: c [w1 w2 ...] or c_first c_last w
	ws := d.array(cf["W"])
	for i := 0; i < len(ws); {
		first := d.integer(ws[i], -1)
		if i+1 >= len(ws) {
			break
		}
		if arr, ok := d.resolve(ws[i+1]).(Array); ok {
			for k, w := range arr {
				if first+k >= 0 {
					f.widths[first+k] = d.num(w, f.dw)
				}
			}
			i += 2
			continue
		}
		if i+2 >= len(ws) {
			break
		}
		last := d.integer(ws[i+1], -1)
		w := d.num(ws[i+2], f.dw)
		if first >= 0 && last >= first && last-first < 1<<16 {
			for c := first; c <= last; c++ {
				f.widths[c] = w
			}
		}
		i += 3
		if len(f.widths) > 1<<20 {
			break
		}
	}
	f.dw2 = [2]float64{880, -1000}
	if v := d.numbers(cf["DW2"]); len(v) == 2 {
		f.dw2 = [2]float64{v[0], v[1]}
	}
	if f.vertical {
		f.w2 = map[int][3]float64{}
		w2 := d.array(cf["W2"])
		for i := 0; i < len(w2); {
			first := d.integer(w2[i], -1)
			if i+1 >= len(w2) {
				break
			}
			if arr, ok := d.resolve(w2[i+1]).(Array); ok {
				for k := 0; k+2 < len(arr); k += 3 {
					f.w2[first+k/3] = [3]float64{d.num(arr[k], 0), d.num(arr[k+1], 0), d.num(arr[k+2], 0)}
				}
				i += 2
				continue
			}
			if i+4 >= len(w2) {
				break
			}
			last := d.integer(w2[i+1], -1)
			v := [3]float64{d.num(w2[i+2], 0), d.num(w2[i+3], 0), d.num(w2[i+4], 0)}
			if first >= 0 && last >= first && last-first < 1<<16 {
				for c := first; c <= last; c++ {
					f.w2[c] = v
				}
			}
			i += 5
		}
	}
	//CID to GID
	switch m := d.resolve(cf["CIDToGIDMap"]).(type) {
	case *Stream:
		if data, err := d.decodeStream(m, 1<<20); err == nil {
			f.cidToGID = make([]uint16, len(data)/2)
			for i := range f.cidToGID {
				f.cidToGID[i] = uint16(data[2*i])<<8 | uint16(data[2*i+1])
			}
		}
	default:
		f.cidMapIden = true
	}
}

// decode splits a string into character codes
func (f *pdfFont) decode(s []byte) []charCode {
	out := make([]charCode, 0, len(s))
	if f.kind != fontType0 {
		for _, b := range s {
			out = append(out, charCode{code: uint32(b), n: 1, cid: int(b)})
		}
		return out
	}
	for len(s) > 0 {
		code, n := f.cmap.nextCode(s)
		s = s[n:]
		out = append(out, charCode{code: code, n: n, cid: f.cmap.cid(code, n)})
	}
	return out
}

// advance is the horizontal advance of a code in text space (1 = font size)
func (f *pdfFont) advance(c charCode) float64 {
	switch f.kind {
	case fontType3:
		w := f.widths[int(c.code)]
		return w * f.t3matrix[0]
	case fontType0:
		if w, ok := f.widths[c.cid]; ok {
			return w / 1000
		}
		return f.dw / 1000
	}
	if w, ok := f.widths[int(c.code)]; ok {
		return w / 1000
	}
	if f.hasWidths && f.missingWidth > 0 {
		return f.missingWidth / 1000
	}
	//No widths in the PDF: take them from the font program
	if adv := f.programAdvance(c); adv > 0 {
		return adv
	}
	if f.missingWidth > 0 {
		return f.missingWidth / 1000
	}
	return 0.5
}

// verticalMetrics returns the vertical advance and the origin offset of a
// CID in text space
func (f *pdfFont) verticalMetrics(c charCode) (float64, float64, float64) {
	if v, ok := f.w2[c.cid]; ok {
		return v[0] / 1000, v[1] / 1000, v[2] / 1000
	}
	w := f.advance(c)
	return f.dw2[1] / 1000, w / 2, f.dw2[0] / 1000
}

// programAdvance reads the advance from the program (TrueType hmtx or the
// fallback font), as a fraction of the em
func (f *pdfFont) programAdvance(c charCode) float64 {
	t := f.tt
	if t == nil {
		t = f.fallback
	}
	if t == nil {
		return 0
	}
	gid := f.gid(c)
	if gid <= 0 {
		return 0
	}
	return float64(t.advance(gid)) / float64(t.unitsPerEm)
}

func (f *pdfFont) macCode(name string) uint32 {
	if f.macRe == nil {
		f.macRe = map[string]int{}
		for c, n := range macRomanEncoding {
			if n != "" {
				if _, ok := f.macRe[n]; !ok {
					f.macRe[n] = c
				}
			}
		}
	}
	if c, ok := f.macRe[name]; ok {
		return uint32(c)
	}
	return 0
}

// unicodeFor finds the text of a code for the fallback font
func (f *pdfFont) unicodeFor(c charCode) rune {
	if rs := f.toUni.unicodeOf(c.code, c.n); len(rs) > 0 {
		return rs[0]
	}
	if f.kind == fontType0 {
		if f.cmap.unicode {
			return rune(c.code)
		}
		return 0
	}
	if n := f.names[c.code&0xff]; n != "" {
		if r, ok := glyphNameToRune(n); ok {
			return r
		}
	}
	if c.code >= 32 && c.code < 127 {
		return rune(c.code)
	}
	return rune(winAnsiRune(byte(c.code)))
}

func winAnsiRune(b byte) rune {
	if r, ok := glyphNameToRune(winAnsiEncoding[b]); ok {
		return r
	}
	return rune(b)
}

// gid maps a code to a glyph index of the TrueType / CFF / fallback font
func (f *pdfFont) gid(c charCode) int {
	if f.fallback != nil {
		r := f.unicodeFor(c)
		if r == 0 {
			return 0
		}
		return f.fallback.unicodeGID(r)
	}
	if f.kind == fontType0 {
		if f.cmap.unicode && f.tt != nil && f.cidToGID == nil && f.tt.glyf != nil {
			return f.tt.unicodeGID(rune(c.code))
		}
		cid := c.cid
		if f.cff != nil {
			return f.cff.gidForCID(cid)
		}
		if f.cidToGID != nil {
			if cid >= 0 && cid < len(f.cidToGID) {
				return int(f.cidToGID[cid])
			}
			return 0
		}
		return cid
	}
	code := c.code & 0xff
	name := f.names[code]
	if f.cff != nil {
		if name != "" {
			if g := f.cff.gidForName(name); g > 0 {
				return g
			}
		}
		if g, ok := f.cff.encoding[int(code)]; ok {
			return g
		}
		if f.cff.isCID {
			return int(code)
		}
		return 0
	}
	t := f.tt
	if t == nil {
		return 0
	}
	if len(t.cmaps) == 0 {
		if name != "" {
			if g := t.gidForName(name); g > 0 {
				return g
			}
		}
		return int(code)
	}
	if !f.symbolic || f.hasEncoding {
		if name != "" {
			if r, ok := glyphNameToRune(name); ok {
				if g := t.cmapLookup(3, 1, uint32(r)); g > 0 {
					return g
				}
			}
			if g := t.gidForName(name); g > 0 {
				return g
			}
			if t.hasCmap(1, 0) {
				if mc := f.macCode(name); mc > 0 {
					if g := t.cmapLookup(1, 0, mc); g > 0 {
						return g
					}
				}
			}
		}
	}
	for _, cc := range []uint32{code, 0xF000 + code, 0xF100 + code, 0xF200 + code} {
		if g := t.cmapLookup(3, 0, cc); g > 0 {
			return g
		}
	}
	if g := t.cmapLookup(1, 0, code); g > 0 {
		return g
	}
	if g := t.cmapLookup(3, 1, code); g > 0 {
		return g
	}
	return 0
}

// outline returns the glyph of a code, cached per glyph
func (f *pdfFont) outline(c charCode) *glyphOutline {
	key := int(c.code)
	if f.kind == fontType0 {
		key = c.cid
	}
	if g, ok := f.cache[key]; ok {
		return g
	}
	g := f.buildOutline(c)
	if len(f.cache) < 1<<16 {
		f.cache[key] = g
	}
	return g
}

func (f *pdfFont) buildOutline(c charCode) *glyphOutline {
	switch {
	case f.kind == fontType3:
		return nil
	case f.t1 != nil:
		name := f.names[c.code&0xff]
		if name == "" {
			return nil
		}
		return &glyphOutline{p: f.t1.glyphPath(name), m: f.t1.fontMatrix}
	case f.cff != nil:
		gid := f.gid(c)
		if gid <= 0 {
			return nil
		}
		return &glyphOutline{p: f.cff.glyphPath(gid), m: f.cff.fontMatrix}
	case f.tt != nil:
		gid := f.gid(c)
		if gid <= 0 {
			return nil
		}
		s := 1 / float64(f.tt.unitsPerEm)
		return &glyphOutline{p: f.tt.glyphPath(gid), m: matrix{s, 0, 0, s, 0, 0}}
	case f.fallback != nil:
		gid := f.gid(c)
		if gid <= 0 {
			return nil
		}
		s := 1 / float64(f.fallback.unitsPerEm)
		sx := s
		//Stretch to the width the PDF asks for
		want := -1.0
		if f.kind == fontType0 {
			if w, ok := f.widths[c.cid]; ok {
				want = w / 1000
			}
		} else if w, ok := f.widths[int(c.code)]; ok {
			want = w / 1000
		}
		if adv := float64(f.fallback.advance(gid)) * s; want > 0 && adv > 0 {
			k := want / adv
			if k < 0.5 {
				k = 0.5
			}
			if k > 1.5 {
				k = 1.5
			}
			sx *= k
		}
		return &glyphOutline{p: f.fallback.glyphPath(gid), m: matrix{sx, 0, 0, s, 0, 0}}
	}
	return nil
}

/*
	Fallback fonts
*/

var (
	fallbackOnce  sync.Once
	fallbackFonts map[string]*ttFont
)

func fallbackFont(name string, flags int, weight float64, italicAngle float64) *ttFont {
	fallbackOnce.Do(func() {
		fallbackFonts = map[string]*ttFont{}
		for key, data := range map[string][]byte{
			"r": goregular.TTF, "b": gobold.TTF, "i": goitalic.TTF, "bi": gobolditalic.TTF,
			"mr": gomono.TTF, "mb": gomonobold.TTF, "mi": gomonoitalic.TTF, "mbi": gomonobolditalic.TTF,
		} {
			if f, err := parseSFNT(data); err == nil {
				fallbackFonts[key] = f
			}
		}
	})
	lower := strings.ToLower(name)
	key := ""
	if flags&1 != 0 || strings.Contains(lower, "courier") || strings.Contains(lower, "mono") || strings.Contains(lower, "consol") {
		key = "m"
	}
	bold := weight >= 600 || flags&(1<<18) != 0 || strings.Contains(lower, "bold") || strings.Contains(lower, "black") || strings.Contains(lower, "heavy") || strings.Contains(lower, "semibold")
	italic := italicAngle != 0 || flags&(1<<6) != 0 || strings.Contains(lower, "italic") || strings.Contains(lower, "oblique")
	switch {
	case bold && italic:
		key += "bi"
	case bold:
		key += "b"
	case italic:
		key += "i"
	default:
		key += "r"
	}
	if f, ok := fallbackFonts[key]; ok {
		return f
	}
	return fallbackFonts["r"]
}
