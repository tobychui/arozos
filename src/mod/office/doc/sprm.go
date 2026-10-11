package doc

/*
	sprm.go - single property modifiers (LibreOffice: wwSprmParser in
	ww8scan.cxx, the attribute handlers of ww8par6.cxx / ww8par2.cxx).

	Every property in a Word 97 file is a sprm: a 16-bit code followed by
	an operand. The code itself says which property group it belongs to
	(character, paragraph, picture, section, table) and how long the
	operand is (bits 13-15), except for the variable length ones, whose
	operand starts with its own size - and two oddities with a different
	size field (sprmTDefTable, sprmPChgTabs).

	The property sets below hold only what a sprm list sets: a style's
	own modifiers, a paragraph's or run's direct formatting. That matches
	WordprocessingML, where a run carries only the formatting that differs
	from its style, so each set is written out as it is.
*/

import "encoding/binary"

// eachSprm walks a grpprl
func eachSprm(grpprl []byte, fn func(op uint16, arg []byte)) {
	le := binary.LittleEndian
	p := 0
	for p+2 <= len(grpprl) {
		op := le.Uint16(grpprl[p:])
		p += 2
		var n int
		switch op >> 13 {
		case 0, 1:
			n = 1
		case 2, 4, 5:
			n = 2
		case 3:
			n = 4
		case 7:
			n = 3
		case 6:
			switch op {
			case 0xD608, 0xD606: // sprmTDefTable: a 16-bit size, plus one
				if p+2 > len(grpprl) {
					return
				}
				cb := int(le.Uint16(grpprl[p:])) - 1
				p += 2
				n = cb
			case 0xC615: // sprmPChgTabs: size 255 means "count it"
				if p >= len(grpprl) {
					return
				}
				cb := int(grpprl[p])
				p++
				if cb != 255 {
					n = cb
				} else {
					if p >= len(grpprl) {
						return
					}
					del := int(grpprl[p])
					ins := 0
					if q := p + 1 + 4*del; q < len(grpprl) {
						ins = int(grpprl[q])
					}
					n = 2 + 4*del + 3*ins
				}
			default:
				if p >= len(grpprl) {
					return
				}
				n = int(grpprl[p])
				p++
			}
		}
		if n < 0 || p+n > len(grpprl) {
			return
		}
		fn(op, grpprl[p:p+n])
		p += n
	}
}

func u16(b []byte) int {
	if len(b) < 2 {
		if len(b) == 1 {
			return int(b[0])
		}
		return 0
	}
	return int(binary.LittleEndian.Uint16(b))
}

func s16(b []byte) int { return int(int16(u16(b))) }

func u32(b []byte) uint32 {
	if len(b) < 4 {
		return 0
	}
	return binary.LittleEndian.Uint32(b)
}

func b0(b []byte) int {
	if len(b) == 0 {
		return 0
	}
	return int(b[0])
}

/* ---------------- colours, borders, shading ---------------- */

// icoColors are the 16 colours of the old ico index
var icoColors = [17]uint32{0, 0x000000, 0x0000FF, 0x00FFFF, 0x00FF00, 0xFF00FF, 0xFF0000, 0xFFFF00,
	0xFFFFFF, 0x000080, 0x008080, 0x008000, 0x800080, 0x800000, 0x808000, 0x808080, 0xC0C0C0}

var highlightNames = [17]string{"", "black", "blue", "cyan", "green", "magenta", "red", "yellow",
	"white", "darkBlue", "darkCyan", "darkGreen", "darkMagenta", "darkRed", "darkYellow", "darkGray", "lightGray"}

type color struct {
	auto bool
	rgb  uint32
}

func icoColor(ico int) color {
	if ico <= 0 || ico >= len(icoColors) {
		return color{auto: true}
	}
	return color{rgb: icoColors[ico]}
}

// colorRef decodes a COLORREF (red, green, blue, auto flag)
func colorRef(b []byte) color {
	if len(b) < 4 {
		return color{auto: true}
	}
	if b[3] == 0xFF {
		return color{auto: true}
	}
	return color{rgb: uint32(b[0])<<16 | uint32(b[1])<<8 | uint32(b[2])}
}

type brc struct {
	typ    uint8 // 0 none, 0xFF "nil"
	width  int   // eighths of a point
	color  color
	space  int // points
	shadow bool
}

// brc80 decodes a BRC80 (4 bytes, ico colour)
func brc80(b []byte) brc {
	if len(b) < 4 {
		return brc{}
	}
	if b[0] == 0xFF && b[1] == 0xFF && b[2] == 0xFF && b[3] == 0xFF {
		return brc{typ: 0xFF}
	}
	return brc{width: int(b[0]), typ: b[1], color: icoColor(int(b[2])), space: int(b[3] & 0x1F), shadow: b[3]&0x20 != 0}
}

// brc97 decodes a BRC (8 bytes, RGB colour)
func brc97(b []byte) brc {
	if len(b) < 8 {
		return brc{}
	}
	if b[4] == 0xFF && b[5] == 0xFF {
		return brc{typ: 0xFF}
	}
	return brc{color: colorRef(b), width: int(b[4]), typ: b[5], space: int(b[6] & 0x1F), shadow: b[6]&0x20 != 0}
}

type shd struct {
	fore, back color
	pat        int
}

// shd80 decodes a 16-bit SHD80 (ico colours)
func shd80(v int) shd {
	return shd{fore: icoColor(v & 0x1F), back: icoColor((v >> 5) & 0x1F), pat: (v >> 10) & 0x3F}
}

// shd97 decodes a 10-byte SHD
func shd97(b []byte) shd {
	if len(b) < 10 {
		return shd{}
	}
	return shd{fore: colorRef(b), back: colorRef(b[4:]), pat: u16(b[8:])}
}

/* ---------------- character properties ---------------- */

// toggle properties
const (
	tBold = iota
	tItalic
	tStrike
	tOutline
	tShadow
	tSmallCaps
	tCaps
	tVanish
	tDStrike
	tEmboss
	tImprint
	tBoldCs
	tItalicCs
	tRTL
	nToggles
)

var toggleSprms = map[uint16]int{
	0x0835: tBold, 0x0836: tItalic, 0x0837: tStrike, 0x0838: tOutline, 0x0839: tShadow,
	0x083A: tSmallCaps, 0x083B: tCaps, 0x083C: tVanish, 0x2A53: tDStrike, 0x0858: tEmboss,
	0x0854: tImprint, 0x085C: tBoldCs, 0x085D: tItalicCs, 0x085A: tRTL,
}

type chp struct {
	togSet, togVal, togFlip uint32 // set / value / "the opposite of the style"

	ul        int // -1 unset
	hps       int // half points, 0 unset
	hpsCs     int
	col       *color
	highlight int    // -1 unset
	iss       int    // -1 unset, 1 super, 2 sub
	ftc       [4]int // ascii, eastAsia, hAnsi, cs; -1 unset
	istd      int    // character style, -1 unset
	dxaSpace  *int
	charScale int
	hpsPos    *int
	kern      int
	shading   *shd
	border    *brc
	lang      [3]int // -1 unset
	emphasis  int    // -1 unset

	spec   bool // a special character (picture, note reference, field)
	data   bool
	ole2   bool
	obj    bool
	picLoc int // -1 unset: offset of the picture in the Data stream
	symFtc int
	symChr int // 0 unset

	rmIns, rmDel           bool
	rmInsAuthor, rmDelAuth int
	rmInsDate, rmDelDate   uint32
	fldVanish              bool
}

func newChp() *chp {
	return &chp{ul: -1, highlight: -1, iss: -1, ftc: [4]int{-1, -1, -1, -1}, istd: -1,
		lang: [3]int{-1, -1, -1}, emphasis: -1, picLoc: -1, charScale: 0}
}

func (c *chp) toggle(i int) (on, set bool) {
	if c.togSet&(1<<i) == 0 {
		return false, false
	}
	return c.togVal&(1<<i) != 0, true
}

// applyChp applies one character sprm
func (c *chp) apply(op uint16, a []byte) {
	if t, ok := toggleSprms[op]; ok {
		v := b0(a)
		bit := uint32(1) << t
		switch v {
		case 0:
			c.togSet |= bit
			c.togVal &^= bit
			c.togFlip &^= bit
		case 1:
			c.togSet |= bit
			c.togVal |= bit
			c.togFlip &^= bit
		case 0x80: // same as the style: nothing of its own
			c.togSet &^= bit
			c.togFlip &^= bit
		case 0x81: // the opposite of the style, resolved when written
			c.togSet &^= bit
			c.togFlip |= bit
		}
		return
	}
	switch op {
	case 0x2A3E:
		c.ul = b0(a)
	case 0x4A43:
		c.hps = u16(a)
	case 0x4A61:
		c.hpsCs = u16(a)
	case 0x2A42:
		col := icoColor(b0(a))
		c.col = &col
	case 0x6870:
		col := colorRef(a)
		c.col = &col
	case 0x2A0C:
		c.highlight = b0(a)
	case 0x2A48:
		c.iss = b0(a)
	case 0x4A4F:
		c.ftc[0] = u16(a)
	case 0x4A50:
		c.ftc[1] = u16(a)
	case 0x4A51:
		c.ftc[2] = u16(a)
	case 0x4A5E:
		c.ftc[3] = u16(a)
	case 0x4A30:
		c.istd = u16(a)
	case 0x8840:
		v := s16(a)
		c.dxaSpace = &v
	case 0x4852:
		c.charScale = u16(a)
	case 0x4845:
		v := s16(a)
		c.hpsPos = &v
	case 0x484B:
		c.kern = u16(a)
	case 0x4866:
		s := shd80(u16(a))
		c.shading = &s
	case 0xCA71:
		s := shd97(a)
		c.shading = &s
	case 0x6865:
		b := brc80(a)
		c.border = &b
	case 0xCA72:
		b := brc97(a)
		c.border = &b
	case 0x486D, 0x4873:
		c.lang[0] = u16(a)
	case 0x486E, 0x4874:
		c.lang[1] = u16(a)
	case 0x485F:
		c.lang[2] = u16(a)
	case 0x2A34:
		c.emphasis = b0(a)
	case 0x0855:
		c.spec = b0(a) != 0
	case 0x0806:
		c.data = b0(a) != 0
	case 0x080A:
		c.ole2 = b0(a) != 0
	case 0x0856:
		c.obj = b0(a) != 0
	case 0x6A03:
		c.picLoc = int(u32(a))
	case 0x6A09:
		c.symFtc = u16(a)
		c.symChr = u16(a[min(2, len(a)):])
	case 0x0801:
		c.rmIns = b0(a) != 0
	case 0x0800:
		c.rmDel = b0(a) != 0
	case 0x4804:
		c.rmInsAuthor = u16(a)
	case 0x6805:
		c.rmInsDate = u32(a)
	case 0x4863:
		c.rmDelAuth = u16(a)
	case 0x6864:
		c.rmDelDate = u32(a)
	case 0x0802:
		c.fldVanish = b0(a) != 0
	case 0x2A33: // sprmCPlain: back to the style's formatting
		keep := *c
		*c = *newChp()
		c.istd = keep.istd
		c.spec, c.picLoc, c.data, c.ole2, c.obj = keep.spec, keep.picLoc, keep.data, keep.ole2, keep.obj
	}
}

/* ---------------- paragraph properties ---------------- */

type tabStop struct {
	pos    int // twips
	jc     int // 0 left, 1 centre, 2 right, 3 decimal, 4 bar
	leader int // 0 none, 1 dot, 2 hyphen, 3 underscore, 4 heavy, 5 middle dot
	clear  bool
}

type pap struct {
	istd       int
	jc         int // -1 unset
	indLeft    *int
	indRight   *int
	indFirst   *int
	spBefore   *int
	spAfter    *int
	beforeAuto int // -1 unset
	afterAuto  int
	line       *int
	lineMult   bool
	keep       int // -1 unset, 0, 1
	keepNext   int
	pageBefore int
	widow      int
	outline    int // -1 unset
	ilvl       int // -1 unset
	ilfo       int // -1 unset
	inTable    bool
	ttp        bool
	innerCell  bool
	innerTtp   bool
	itap       int
	borders    [5]*brc // top, left, bottom, right, between
	shading    *shd
	tabs       []tabStop
	bidi       int // -1 unset
	contextual int // -1 unset
	hugePapx   int // -1 unset: offset in the Data stream of the real grpprl
	tap        *tap
}

func newPap() *pap {
	return &pap{jc: -1, beforeAuto: -1, afterAuto: -1, keep: -1, keepNext: -1, pageBefore: -1,
		widow: -1, outline: -1, ilvl: -1, ilfo: -1, bidi: -1, contextual: -1, hugePapx: -1}
}

func (p *pap) apply(op uint16, a []byte) {
	ip := func(v int) *int { return &v }
	switch op {
	case 0x4600:
		p.istd = u16(a)
	case 0x2403, 0x2461:
		p.jc = b0(a)
	case 0x2405:
		p.keep = b0(a)
	case 0x2406:
		p.keepNext = b0(a)
	case 0x2407:
		p.pageBefore = b0(a)
	case 0x2431:
		p.widow = b0(a)
	case 0x2640:
		p.outline = b0(a)
	case 0x260A:
		p.ilvl = b0(a)
	case 0x460B:
		p.ilfo = s16(a)
	case 0x840E, 0x845D:
		p.indRight = ip(s16(a))
	case 0x840F, 0x845E:
		p.indLeft = ip(s16(a))
	case 0x8411, 0x8460:
		p.indFirst = ip(s16(a))
	case 0x4610, 0x465F: // nest: add to the left indent
		base := 0
		if p.indLeft != nil {
			base = *p.indLeft
		}
		p.indLeft = ip(base + s16(a))
	case 0x6412:
		p.line = ip(s16(a))
		p.lineMult = s16(a[min(2, len(a)):]) != 0
	case 0xA413:
		p.spBefore = ip(u16(a))
	case 0xA414:
		p.spAfter = ip(u16(a))
	case 0x245B:
		p.beforeAuto = b0(a)
	case 0x245C:
		p.afterAuto = b0(a)
	case 0x2416:
		p.inTable = b0(a) != 0
	case 0x2417:
		p.ttp = b0(a) != 0
	case 0x6649:
		p.itap = int(u32(a))
	case 0x664A: // sprmPDtap: change of nesting depth
		p.itap += int(int32(u32(a)))
	case 0x244B:
		p.innerCell = b0(a) != 0
	case 0x244C:
		p.innerTtp = b0(a) != 0
	case 0x6424:
		b := brc80(a)
		p.borders[0] = &b
	case 0x6425:
		b := brc80(a)
		p.borders[1] = &b
	case 0x6426:
		b := brc80(a)
		p.borders[2] = &b
	case 0x6427:
		b := brc80(a)
		p.borders[3] = &b
	case 0x6428:
		b := brc80(a)
		p.borders[4] = &b
	case 0xC64E:
		b := brc97(a)
		p.borders[0] = &b
	case 0xC64F:
		b := brc97(a)
		p.borders[1] = &b
	case 0xC650:
		b := brc97(a)
		p.borders[2] = &b
	case 0xC651:
		b := brc97(a)
		p.borders[3] = &b
	case 0xC652:
		b := brc97(a)
		p.borders[4] = &b
	case 0x442D:
		s := shd80(u16(a))
		p.shading = &s
	case 0xC64D:
		s := shd97(a)
		p.shading = &s
	case 0xC60D, 0xC615:
		p.changeTabs(a, op == 0xC615)
	case 0x2441:
		p.bidi = b0(a)
	case 0x246D:
		p.contextual = b0(a)
	case 0x6646:
		p.hugePapx = int(u32(a))
	default:
		if op>>10&7 == 5 { // a table sprm in the row end paragraph
			if p.tap == nil {
				p.tap = newTap()
			}
			p.tap.apply(op, a)
		}
	}
}

// changeTabs applies sprmPChgTabsPapx / sprmPChgTabs: deletions, then
// additions
func (p *pap) changeTabs(a []byte, close bool) {
	if len(a) < 1 {
		return
	}
	q := 0
	del := int(a[q])
	q++
	dels := make([]int, 0, del)
	for i := 0; i < del && q+2 <= len(a); i++ {
		dels = append(dels, s16(a[q:]))
		q += 2
	}
	if close {
		q += 2 * del // the tolerances of the deletions
	}
	if q >= len(a) {
		return
	}
	add := int(a[q])
	q++
	pos := make([]int, 0, add)
	for i := 0; i < add && q+2 <= len(a); i++ {
		pos = append(pos, s16(a[q:]))
		q += 2
	}
	for _, d := range dels {
		p.tabs = append(p.tabs, tabStop{pos: d, clear: true})
	}
	for i, ps := range pos {
		t := tabStop{pos: ps}
		if q+i < len(a) {
			t.jc = int(a[q+i] & 7)
			t.leader = int(a[q+i]>>3) & 7
		}
		// an addition replaces a deletion at the same place
		for k := range p.tabs {
			if p.tabs[k].clear && p.tabs[k].pos == ps {
				p.tabs[k] = t
				t.pos = -1 << 30
				break
			}
		}
		if t.pos != -1<<30 {
			p.tabs = append(p.tabs, t)
		}
	}
}

/* ---------------- table properties ---------------- */

type tc struct {
	firstMerged bool
	merged      bool
	vertMerge   bool
	vertRestart bool
	vAlign      int // 0 top, 1 centre, 2 bottom
	fts         int
	width       int
	noWrap      bool
	borders     [4]*brc // top, left, bottom, right
}

type tap struct {
	jc        int // -1 unset
	dxaLeft   int
	gapHalf   int
	rowHeight int // twips: positive at least, negative exact, 0 auto
	header    bool
	cantSplit bool
	centers   []int // itcMac+1 cell edges
	cells     []tc
	shades    []*shd
	borders   [6]*brc // top, left, bottom, right, insideH, insideV
	widthFts  int
	width     int
	beforeFts int
	before    int
	afterFts  int
	after     int
	padding   [4]int // top, left, bottom, right (twips); -1 unset
}

func newTap() *tap {
	return &tap{jc: -1, padding: [4]int{-1, -1, -1, -1}}
}

func (t *tap) apply(op uint16, a []byte) {
	switch op {
	case 0x5400, 0x548A:
		t.jc = u16(a)
	case 0x9601:
		t.dxaLeft = s16(a)
	case 0x9602:
		t.gapHalf = s16(a)
	case 0x9407:
		t.rowHeight = s16(a)
	case 0x3404:
		t.header = b0(a) != 0
	case 0x3403, 0x3466:
		t.cantSplit = b0(a) != 0
	case 0xD608, 0xD606:
		t.defTable(a)
	case 0xD609:
		t.shades = nil
		for i := 0; i+2 <= len(a); i += 2 {
			s := shd80(u16(a[i:]))
			t.shades = append(t.shades, &s)
		}
	// cell shading in three parts: cells 0-21, 22-43 and 44-62 (the
	// "raw" forms are what Word 2007 and later write)
	case 0xD612, 0xD670:
		t.setShades(0, a)
	case 0xD616, 0xD671:
		t.setShades(22, a)
	case 0xD60C, 0xD672:
		t.setShades(44, a)
	case 0xD605:
		for i := 0; i < 6 && 4*i+4 <= len(a); i++ {
			b := brc80(a[4*i:])
			t.borders[i] = &b
		}
	case 0xD613:
		for i := 0; i < 6 && 8*i+8 <= len(a); i++ {
			b := brc97(a[8*i:])
			t.borders[i] = &b
		}
	case 0xF614:
		t.widthFts, t.width = b0(a), u16(a[min(1, len(a)):])
	case 0xF617:
		t.beforeFts, t.before = b0(a), u16(a[min(1, len(a)):])
	case 0xF618:
		t.afterFts, t.after = b0(a), u16(a[min(1, len(a)):])
	case 0xD620, 0xD62F:
		t.setBrc(a, op == 0xD62F)
	case 0xD61A, 0xD61B, 0xD61C, 0xD61D:
		// the exact colours of each cell's top / left / bottom / right
		// border, where the TC80 could only name one of 16
		side := []int{0, 1, 2, 3}[op-0xD61A]
		for i := 0; 4*i+4 <= len(a) && i < len(t.cells); i++ {
			c := colorRef(a[4*i:])
			if b := t.cells[i].borders[side]; b != nil && !c.auto {
				bb := *b
				bb.color = c
				t.cells[i].borders[side] = &bb
			}
		}
	case 0xD62B: // vertical merge of one cell
		if len(a) >= 2 && int(a[0]) < len(t.cells) {
			c := &t.cells[a[0]]
			c.vertMerge = a[1]&1 != 0
			c.vertRestart = a[1]&2 != 0
		}
	case 0xD62C: // vertical alignment of a cell range
		if len(a) >= 3 {
			for i := int(a[0]); i < int(a[1]) && i < len(t.cells); i++ {
				t.cells[i].vAlign = int(a[2])
			}
		}
	case 0xD634, 0xD632: // cell padding: itcFirst, itcLim, grfbrc, ftsWidth, wWidth
		if len(a) >= 6 {
			sides := a[2]
			w := u16(a[4:])
			if op == 0xD632 && !(a[0] == 0 && int(a[1]) >= len(t.cells)) {
				return // padding of a few cells only
			}
			for i, bit := range []byte{1, 2, 4, 8} {
				if sides&bit != 0 {
					t.padding[i] = w
				}
			}
		}
	case 0x5624: // merge cells horizontally
		if len(a) >= 2 {
			first, lim := int(a[0]), int(a[1])
			for i := first; i < lim && i < len(t.cells); i++ {
				t.cells[i].merged = i > first
				t.cells[i].firstMerged = i == first
			}
		}
	}
}

// setShades stores the SHDs of the cells from first on
func (t *tap) setShades(first int, a []byte) {
	for i := 0; i+10 <= len(a); i += 10 {
		k := first + i/10
		for len(t.shades) <= k {
			t.shades = append(t.shades, nil)
		}
		s := shd97(a[i:])
		t.shades[k] = &s
	}
}

// defTable reads sprmTDefTable: the cell edges and each cell's TC80
func (t *tap) defTable(a []byte) {
	if len(a) < 1 {
		return
	}
	n := int(a[0])
	if 1+2*(n+1) > len(a) {
		return
	}
	t.centers = make([]int, n+1)
	for i := 0; i <= n; i++ {
		t.centers[i] = s16(a[1+2*i:])
	}
	t.cells = make([]tc, n)
	p := 1 + 2*(n+1)
	for i := 0; i < n && p+20 <= len(a); i++ {
		g := u16(a[p:])
		c := tc{
			firstMerged: g&0x0001 != 0,
			merged:      g&0x0002 != 0,
			vertMerge:   g&0x0020 != 0,
			vertRestart: g&0x0040 != 0,
			vAlign:      (g >> 7) & 3,
			fts:         (g >> 9) & 7,
			noWrap:      g&0x2000 != 0,
			width:       u16(a[p+2:]),
		}
		for k := 0; k < 4; k++ {
			b := brc80(a[p+4+4*k:])
			c.borders[k] = &b
		}
		t.cells[i] = c
		p += 20
	}
}

// setBrc applies sprmTSetBrc(80): borders of a range of cells
func (t *tap) setBrc(a []byte, wide bool) {
	if len(a) < 3 {
		return
	}
	first, lim, sides := int(a[0]), int(a[1]), a[2]
	var b brc
	if wide {
		b = brc97(a[3:])
	} else {
		b = brc80(a[3:])
	}
	for i := first; i < lim && i < len(t.cells); i++ {
		for k, bit := range []byte{1, 2, 4, 8} {
			if sides&bit != 0 {
				bb := b
				t.cells[i].borders[k] = &bb
			}
		}
	}
}

/* ---------------- section properties ---------------- */

type sep struct {
	bkc         int
	titlePg     bool
	cols        int
	colSpace    int
	lineBetween bool
	hdrTop      int
	hdrBottom   int
	landscape   bool
	pageW       int
	pageH       int
	left, right int
	top, bottom int
	gutter      int
	pgnFmt      int
	pgnRestart  bool
	pgnStart    int
}

// defaultSep are the section defaults a SEPX modifies
func defaultSep() sep {
	return sep{bkc: 2, cols: 1, colSpace: 720, hdrTop: 720, hdrBottom: 720,
		pageW: 12240, pageH: 15840, left: 1800, right: 1800, top: 1440, bottom: 1440, pgnStart: 1}
}

func (s *sep) apply(op uint16, a []byte) {
	switch op {
	case 0x3009:
		s.bkc = b0(a)
	case 0x300A:
		s.titlePg = b0(a) != 0
	case 0x500B:
		s.cols = u16(a) + 1
	case 0x900C:
		s.colSpace = s16(a)
	case 0x3019:
		s.lineBetween = b0(a) != 0
	case 0xB017:
		s.hdrTop = u16(a)
	case 0xB018:
		s.hdrBottom = u16(a)
	case 0x301D:
		s.landscape = b0(a) == 2
	case 0xB01F:
		s.pageW = u16(a)
	case 0xB020:
		s.pageH = u16(a)
	case 0xB021:
		s.left = u16(a)
	case 0xB022:
		s.right = u16(a)
	case 0x9023:
		s.top = s16(a)
	case 0x9024:
		s.bottom = s16(a)
	case 0xB025:
		s.gutter = u16(a)
	case 0x300E:
		s.pgnFmt = b0(a)
	case 0x3011:
		s.pgnRestart = b0(a) != 0
	case 0x501C:
		s.pgnStart = u16(a)
	case 0x7044:
		s.pgnStart = int(u32(a))
	}
}
