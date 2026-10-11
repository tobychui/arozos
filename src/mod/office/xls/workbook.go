package xls

/*
	workbook.go - the workbook globals substream.

	A workbook stream opens with the globals: code page and date system,
	the font, number format and cell format (XF) tables, the colour
	palette, one BOUNDSHEET per sheet (its name and the stream offset of
	its own substream), the shared string table, external references and
	defined names. The sheet substreams that follow (sheet.go) refer to
	all of it by index.
*/

import (
	"encoding/binary"
	"errors"
	"math"
	"strings"

	"imuslab.com/arozos/mod/office/internal/codepage"
)

type font struct {
	name      string
	height    int // twips
	bold      bool
	italic    bool
	strike    bool
	underline uint8
	color     uint16
	script    uint16 // 1 superscript, 2 subscript
	charset   uint8
}

type borderLine struct {
	style uint8
	color uint16
}

// xf is one cell / style format record
type xf struct {
	font, format int
	parent       int
	style        bool
	hAlign       uint8 // 0 general, 1 left, 2 centre, 3 right, 4 fill, 5 justify, 6 centre across, 7 distributed
	vAlign       uint8 // 0 top, 1 centre, 2 bottom, 3 justify, 4 distributed
	wrap         bool
	shrink       bool
	indent       int
	rotation     int
	left, right  borderLine
	top, bottom  borderLine
	pattern      uint8
	fg, bg       uint16
}

// xfExt holds the exact colours Excel 2007+ stores beside an XF (the XF
// itself can only name palette entries); nil means "use the palette"
type xfExt struct {
	fg, bg, text             *uint32
	left, right, top, bottom *uint32
}

type boundSheet struct {
	name  string
	pos   int
	state uint8 // 0 visible, 1 hidden, 2 very hidden
	kind  uint8 // 0 worksheet, 1 macro sheet, 2 chart, 6 VB module
}

type definedName struct {
	name    string
	builtin bool
	hidden  bool
	local   int // 0 workbook wide, else the 1-based sheet
	rgce    []byte
	rgcb    []byte
	formula string
}

type supBook struct {
	self   bool
	addin  bool
	names  []string
	sheets []string
}

type xti struct {
	book, first, last int
}

// book is the decoded globals plus the raw records of the stream
type book struct {
	biff8    bool
	cp       codepage.Decoder
	date1904 bool
	fonts    []*font // BIFF font index (index 4 does not exist)
	formats  map[int]string
	xfs      []*xf
	xfExts   map[int]*xfExt
	defXF    int // the default cell XF, -1 until looked up
	palette  [64]uint32
	sheets   []*boundSheet
	sst      []string
	names    []*definedName
	supbooks []*supBook
	xtis     []xti
	ext5     [][]string // BIFF5: external names per EXTERNSHEET record
	active   int
	records  []*record
}

var errEncrypted = errors.New("this workbook is password protected; remove the password in Excel and save it again to open it here")

// defaultPalette is the BIFF8 palette, indices 8 to 63
var defaultPalette = [56]uint32{
	0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00, 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF,
	0x800000, 0x008000, 0x000080, 0x808000, 0x800080, 0x008080, 0xC0C0C0, 0x808080,
	0x9999FF, 0x993366, 0xFFFFCC, 0xCCFFFF, 0x660066, 0xFF8080, 0x0066CC, 0xCCCCFF,
	0x000080, 0xFF00FF, 0xFFFF00, 0x00FFFF, 0x800080, 0x800000, 0x008080, 0x0000FF,
	0x00CCFF, 0xCCFFFF, 0xCCFFCC, 0xFFFF99, 0x99CCFF, 0xFF99CC, 0xCC99FF, 0xFFCC99,
	0x3366FF, 0x33CCCC, 0x99CC00, 0xFFCC00, 0xFF9900, 0xFF6600, 0x666699, 0x969696,
	0x003366, 0x339966, 0x003300, 0x333300, 0x993300, 0x993366, 0x333399, 0x333333,
}

func newBook(biff8 bool) *book {
	b := &book{biff8: biff8, formats: map[int]string{}, cp: codepage.For(1252), xfExts: map[int]*xfExt{}, defXF: -1}
	b.palette[0], b.palette[1], b.palette[2], b.palette[3] = 0x000000, 0xFFFFFF, 0xFF0000, 0x00FF00
	b.palette[4], b.palette[5], b.palette[6], b.palette[7] = 0x0000FF, 0xFFFF00, 0xFF00FF, 0x00FFFF
	copy(b.palette[8:], defaultPalette[:])
	return b
}

// color resolves a palette index; auto reports the "automatic" colours
// (system window text / background), for which def is returned
func (b *book) color(idx uint16, def uint32) (uint32, bool) {
	if int(idx) < len(b.palette) {
		return b.palette[idx], false
	}
	return def, true
}

func (b *book) maxRows() int {
	if b.biff8 {
		return 65536
	}
	return 16384
}

// parseGlobals reads the globals substream, which starts at records[0]
func (b *book) parseGlobals() error {
	le := binary.LittleEndian
	for i, r := range b.records {
		if i > 0 && r.typ == rtEOF {
			return nil
		}
		rd := newReader(r)
		switch r.typ {
		case rtFilePass:
			return errEncrypted
		case rtCodePage:
			cp := int(rd.u16())
			if cp != 1200 {
				b.cp = codepage.For(cp)
			}
		case rtDateMode:
			b.date1904 = rd.u16() == 1
		case rtWindow1:
			if len(r.data) >= 12 {
				b.active = int(le.Uint16(r.data[10:]))
			}
		case rtFont:
			b.parseFont(rd)
		case rtFormat:
			idx := int(rd.u16())
			var code string
			if b.biff8 {
				code = rd.xlString()
			} else {
				code = rd.byteString(int(rd.u8()), b.cp)
			}
			b.formats[idx] = code
		case rtXF:
			if b.biff8 {
				b.xfs = append(b.xfs, parseXF8(r.data))
			} else {
				b.xfs = append(b.xfs, parseXF5(r.data))
			}
		case rtPalette:
			n := int(rd.u16())
			for k := 0; k < n && 8+k < len(b.palette) && rd.left() >= 4; k++ {
				c := rd.bytes(4)
				b.palette[8+k] = uint32(c[0])<<16 | uint32(c[1])<<8 | uint32(c[2])
			}
		case rtBoundSheet:
			bs := &boundSheet{pos: int(rd.u32())}
			if b.biff8 {
				bs.state = rd.u8() & 3
				bs.kind = rd.u8()
				bs.name = rd.shortString()
			} else {
				g := rd.u16()
				bs.state = uint8(g) & 3
				bs.kind = uint8(g >> 8)
				bs.name = rd.byteString(int(rd.u8()), b.cp)
			}
			b.sheets = append(b.sheets, bs)
		case rtSST:
			rd.skip(4)
			// capped as uint32: int() of a large count is negative on a
			// 32-bit target
			n := int(min(rd.u32(), 1<<24))
			// the count is the file's claim: reserve modestly and let the
			// strings that are really there grow the table
			b.sst = make([]string, 0, min(n, 1<<12))
			for k := 0; k < n && rd.left() > 0 && rd.err == nil; k++ {
				b.sst = append(b.sst, rd.richString())
			}
		case rtSupBook:
			ctab := int(rd.u16())
			cch := rd.u16()
			sb := &supBook{}
			switch cch {
			case 0x0401:
				sb.self = true
			case 0x3A01:
				sb.addin = true
			default:
				rd.noCchString(int(cch)) // the external workbook's path
				for k := 0; k < ctab && rd.err == nil; k++ {
					sb.sheets = append(sb.sheets, rd.xlString())
				}
			}
			b.supbooks = append(b.supbooks, sb)
		case rtExternName:
			b.parseExternName(rd)
		case rtExternSheet:
			if b.biff8 {
				n := int(rd.u16())
				for k := 0; k < n && rd.left() >= 6; k++ {
					b.xtis = append(b.xtis, xti{book: int(rd.u16()), first: int(int16(rd.u16())), last: int(int16(rd.u16()))})
				}
			} else {
				b.ext5 = append(b.ext5, nil)
			}
		case rtName:
			b.parseName(rd)
		case rtXFExt:
			b.parseXFExt(r.data)
		}
	}
	return nil
}

func (b *book) parseFont(rd *reader) {
	f := &font{}
	f.height = int(rd.u16())
	g := rd.u16()
	f.italic = g&0x02 != 0
	f.strike = g&0x08 != 0
	f.color = rd.u16()
	f.bold = rd.u16() >= 600
	f.script = rd.u16()
	f.underline = rd.u8()
	rd.u8() // family
	f.charset = rd.u8()
	rd.u8()
	if b.biff8 {
		f.name = rd.shortString()
	} else {
		f.name = rd.byteString(int(rd.u8()), b.cp)
	}
	// font index 4 is never written: the fifth record is font 5
	if len(b.fonts) == 4 {
		b.fonts = append(b.fonts, nil)
	}
	b.fonts = append(b.fonts, f)
}

// parseXF8 decodes a BIFF8 XF record
func parseXF8(d []byte) *xf {
	if len(d) < 20 {
		d = append(append([]byte(nil), d...), make([]byte, 20-len(d))...)
	}
	le := binary.LittleEndian
	x := &xf{font: int(le.Uint16(d)), format: int(le.Uint16(d[2:]))}
	fl := le.Uint16(d[4:])
	x.style = fl&0x04 != 0
	x.parent = int(fl >> 4)
	al := d[6]
	x.hAlign = al & 7
	x.wrap = al&0x08 != 0
	x.vAlign = (al >> 4) & 7
	x.rotation = int(d[7])
	x.indent = int(d[8] & 0x0F)
	x.shrink = d[8]&0x10 != 0
	b1 := le.Uint32(d[10:])
	b2 := le.Uint32(d[14:])
	x.left = borderLine{uint8(b1 & 0xF), uint16(b1>>16) & 0x7F}
	x.right = borderLine{uint8(b1>>4) & 0xF, uint16(b1>>23) & 0x7F}
	x.top = borderLine{uint8(b1>>8) & 0xF, uint16(b2) & 0x7F}
	x.bottom = borderLine{uint8(b1>>12) & 0xF, uint16(b2>>7) & 0x7F}
	x.pattern = uint8(b2>>26) & 0x3F
	c := le.Uint16(d[18:])
	x.fg = c & 0x7F
	x.bg = (c >> 7) & 0x7F
	return x
}

// parseXF5 decodes a BIFF5 XF record
func parseXF5(d []byte) *xf {
	if len(d) < 16 {
		d = append(append([]byte(nil), d...), make([]byte, 16-len(d))...)
	}
	le := binary.LittleEndian
	x := &xf{font: int(le.Uint16(d)), format: int(le.Uint16(d[2:]))}
	fl := le.Uint16(d[4:])
	x.style = fl&0x04 != 0
	x.parent = int(fl >> 4)
	al := d[6]
	x.hAlign = al & 7
	x.wrap = al&0x08 != 0
	x.vAlign = (al >> 4) & 7
	c1 := le.Uint32(d[8:])
	c2 := le.Uint32(d[12:])
	x.fg = uint16(c1) & 0x7F
	x.bg = uint16(c1>>7) & 0x7F
	x.pattern = uint8(c1>>16) & 0x3F
	x.bottom = borderLine{uint8(c1>>22) & 7, uint16(c1>>25) & 0x7F}
	x.top = borderLine{uint8(c2) & 7, uint16(c2>>9) & 0x7F}
	x.left = borderLine{uint8(c2>>3) & 7, uint16(c2>>16) & 0x7F}
	x.right = borderLine{uint8(c2>>6) & 7, uint16(c2>>23) & 0x7F}
	return x
}

// officeTheme is the colour scheme of the default Office 2007 theme, in
// SpreadsheetML theme index order (lt1, dk1, lt2, dk2, accents, links)
var officeTheme = [12]uint32{
	0xFFFFFF, 0x000000, 0xEEECE1, 0x1F497D, 0x4F81BD, 0xC0504D,
	0x9BBB59, 0x8064A2, 0x4BACC6, 0xF79646, 0x0000FF, 0x800080,
}

// parseXFExt reads an XFEXT record: per-XF colours as RGB or theme
// colours with a tint
func (b *book) parseXFExt(d []byte) {
	le := binary.LittleEndian
	if len(d) < 20 {
		return
	}
	ixfe := int(le.Uint16(d[14:]))
	n := int(le.Uint16(d[18:]))
	ext := &xfExt{}
	p := 20
	for k := 0; k < n && p+4 <= len(d); k++ {
		typ := le.Uint16(d[p:])
		cb := int(le.Uint16(d[p+2:]))
		if cb < 4 || p+cb > len(d) {
			break
		}
		body := d[p+4 : p+cb]
		p += cb
		if len(body) < 8 {
			continue
		}
		var c uint32
		switch le.Uint16(body) {
		case 2: // RGB
			c = uint32(body[4])<<16 | uint32(body[5])<<8 | uint32(body[6])
		case 3: // theme colour
			idx := int(le.Uint32(body[4:]))
			if idx < 0 || idx >= len(officeTheme) {
				continue
			}
			c = officeTheme[idx]
		default:
			continue
		}
		if tint := float64(int16(le.Uint16(body[2:]))) / 32767; tint != 0 {
			c = applyTint(c, tint)
		}
		cc := c
		switch typ {
		case 0x04:
			ext.fg = &cc
		case 0x05:
			ext.bg = &cc
		case 0x07:
			ext.top = &cc
		case 0x08:
			ext.bottom = &cc
		case 0x09:
			ext.left = &cc
		case 0x0A:
			ext.right = &cc
		case 0x0D:
			ext.text = &cc
		}
	}
	b.xfExts[ixfe] = ext
}

// applyTint lightens (tint > 0) or darkens a colour the way Excel applies
// a theme colour's tint: on the HSL luminance
func applyTint(c uint32, tint float64) uint32 {
	r, g, bl := float64(c>>16&0xFF)/255, float64(c>>8&0xFF)/255, float64(c&0xFF)/255
	mx, mn := math.Max(r, math.Max(g, bl)), math.Min(r, math.Min(g, bl))
	l := (mx + mn) / 2
	h, s := 0.0, 0.0
	if mx != mn {
		d := mx - mn
		if l > 0.5 {
			s = d / (2 - mx - mn)
		} else {
			s = d / (mx + mn)
		}
		switch mx {
		case r:
			h = (g - bl) / d
			if g < bl {
				h += 6
			}
		case g:
			h = (bl-r)/d + 2
		default:
			h = (r-g)/d + 4
		}
		h /= 6
	}
	if tint < 0 {
		l *= 1 + tint
	} else {
		l = l*(1-tint) + tint
	}
	hue := func(p, q, t float64) float64 {
		if t < 0 {
			t++
		}
		if t > 1 {
			t--
		}
		switch {
		case t < 1.0/6:
			return p + (q-p)*6*t
		case t < 0.5:
			return q
		case t < 2.0/3:
			return p + (q-p)*(2.0/3-t)*6
		}
		return p
	}
	if s == 0 {
		r, g, bl = l, l, l
	} else {
		q := l * (1 + s)
		if l >= 0.5 {
			q = l + s - l*s
		}
		p := 2*l - q
		r, g, bl = hue(p, q, h+1.0/3), hue(p, q, h), hue(p, q, h-1.0/3)
	}
	to := func(v float64) uint32 { return uint32(math.Round(math.Max(0, math.Min(1, v)) * 255)) }
	return to(r)<<16 | to(g)<<8 | to(bl)
}

func (b *book) parseExternName(rd *reader) {
	if !b.biff8 {
		rd.u16()
		rd.u32()
		name := rd.byteString(int(rd.u8()), b.cp)
		if len(b.ext5) == 0 {
			b.ext5 = append(b.ext5, nil)
		}
		b.ext5[len(b.ext5)-1] = append(b.ext5[len(b.ext5)-1], name)
		return
	}
	rd.u16() // flags
	rd.u32() // reserved / sheet index
	cch := int(rd.u8())
	name := rd.noCchString(cch)
	if len(b.supbooks) == 0 {
		b.supbooks = append(b.supbooks, &supBook{})
	}
	sb := b.supbooks[len(b.supbooks)-1]
	sb.names = append(sb.names, name)
}

// builtinNames are the names Excel keeps under a one-character code
var builtinNames = []string{
	"Consolidate_Area", "Auto_Open", "Auto_Close", "Extract", "Database",
	"Criteria", "Print_Area", "Print_Titles", "Recorder", "Data_Form",
	"Auto_Activate", "Auto_Deactivate", "Sheet_Title", "_FilterDatabase",
}

func (b *book) parseName(rd *reader) {
	n := &definedName{}
	g := rd.u16()
	n.hidden = g&0x01 != 0
	n.builtin = g&0x20 != 0
	rd.u8() // keyboard shortcut
	cch := int(rd.u8())
	cce := int(rd.u16())
	if b.biff8 {
		rd.u16()
		n.local = int(rd.u16())
		rd.skip(4)
		n.name = rd.noCchString(cch)
	} else {
		rd.u16()
		n.local = int(rd.u16())
		rd.skip(4)
		n.name = rd.byteString(cch, b.cp)
	}
	if n.builtin && len(n.name) == 1 && int(n.name[0]) < len(builtinNames) {
		n.name = builtinNames[n.name[0]]
	}
	if cce > 0 && rd.left() >= cce {
		n.rgce = rd.bytes(cce)
		n.rgcb = rd.bytes(rd.left())
	}
	b.names = append(b.names, n)
}

// nameText is the text of a defined name a formula refers to (1-based)
func (b *book) nameText(idx int) string {
	if idx < 1 || idx > len(b.names) {
		return "#NAME?"
	}
	return b.names[idx-1].name
}

// externNameText is an external or add-in name (a function from an
// add-in, or one of the functions newer Excel versions store as
// "_xlfn.NAME")
func (b *book) externNameText(ixti, idx int) string {
	if ixti < 0 || ixti >= len(b.xtis) {
		return "#NAME?"
	}
	bk := b.xtis[ixti].book
	if bk < 0 || bk >= len(b.supbooks) {
		return "#NAME?"
	}
	names := b.supbooks[bk].names
	if idx < 1 || idx > len(names) {
		return "#NAME?"
	}
	return names[idx-1]
}

func (b *book) externNameText5(ixals, idx int) string {
	if ixals < 0 {
		ixals = -ixals
	}
	g := ixals - 1
	if g < 0 || g >= len(b.ext5) {
		// add-in names are often grouped under the last entry
		g = len(b.ext5) - 1
	}
	if g < 0 || idx < 1 || idx > len(b.ext5[g]) {
		return "#NAME?"
	}
	return b.ext5[g][idx-1]
}

// sheetPrefix renders the sheet part of a 3D reference
func (b *book) sheetPrefix(ixti int) string {
	if ixti < 0 || ixti >= len(b.xtis) {
		return "#REF!"
	}
	x := b.xtis[ixti]
	if x.book < 0 || x.book >= len(b.supbooks) || !b.supbooks[x.book].self {
		return "#REF!"
	}
	return b.sheetRangePrefix(x.first, x.last)
}

func (b *book) sheetRangePrefix(first, last int) string {
	if first < 0 || first >= len(b.sheets) || last < first || last >= len(b.sheets) {
		return "#REF!"
	}
	if first == last {
		return quoteSheet(b.sheets[first].name) + "!"
	}
	a, z := b.sheets[first].name, b.sheets[last].name
	q := quoteSheet(a + z)
	if strings.HasPrefix(q, "'") {
		return "'" + strings.ReplaceAll(a, "'", "''") + ":" + strings.ReplaceAll(z, "'", "''") + "'!"
	}
	return a + ":" + z + "!"
}
