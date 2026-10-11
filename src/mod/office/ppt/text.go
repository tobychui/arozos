package ppt

/*
	text.go - text and its formatting (LibreOffice: PPTStyleSheet,
	PPTParagraphObj / PPTPortionObj in svdfppt.cxx).

	A text block is a TextHeaderAtom (its text type: title, body, notes,
	other, ...), the characters (TextCharsAtom, UTF-16, or TextBytesAtom,
	Latin-1) with paragraphs ending in a carriage return, and a
	StyleTextPropAtom: runs of paragraph exceptions (with the indent
	level) and of character exceptions over the text. An exception holds
	only what differs from the master's text style for that text type and
	level, behind a mask saying which fields are present - and the fields
	are packed in a fixed order, so the mask decides how to read them.
*/

import (
	"encoding/binary"
	"unicode/utf16"

	"imuslab.com/arozos/mod/office/internal/officeart"
)

func decodeUTF16(u []uint16) []rune { return utf16.Decode(u) }

// paragraph exception masks
const (
	pfHasBullet     = 0x000001
	pfBulletHasFont = 0x000002
	pfBulletHasClr  = 0x000004
	pfBulletHasSize = 0x000008
	pfBulletFont    = 0x000010
	pfBulletColor   = 0x000020
	pfBulletSize    = 0x000040
	pfBulletChar    = 0x000080
	pfLeftMargin    = 0x000100
	pfIndent        = 0x000400
	pfAlign         = 0x000800
	pfLineSpacing   = 0x001000
	pfSpaceBefore   = 0x002000
	pfSpaceAfter    = 0x004000
	pfDefaultTab    = 0x008000
	pfFontAlign     = 0x010000
	pfCharWrap      = 0x020000
	pfWordWrap      = 0x040000
	pfOverflow      = 0x080000
	pfTabStops      = 0x100000
	pfTextDir       = 0x200000
)

// character exception masks
const (
	cfBold      = 0x000001
	cfItalic    = 0x000002
	cfUnderline = 0x000004
	cfShadow    = 0x000010
	cfStyleBits = 0x000001 | 0x000002 | 0x000004 | 0x000010 | 0x000020 | 0x000080 | 0x000200 | 0x003C00
	cfTypeface  = 0x010000
	cfSize      = 0x020000
	cfColor     = 0x040000
	cfPosition  = 0x080000
	cfOldEA     = 0x200000
	cfAnsi      = 0x400000
	cfSymbol    = 0x800000
)

// colorIdx is a ColorIndexStruct: an RGB colour or a scheme index
type colorIdx struct {
	r, g, b, index uint8
}

type pf struct {
	mask        uint32
	bulletFlags uint16
	bulletChar  rune
	bulletFont  int
	bulletSize  int
	bulletColor colorIdx
	align       int
	lineSpacing int
	spaceBefore int
	spaceAfter  int
	leftMargin  int
	indent      int
}

type cf struct {
	mask     uint32
	style    uint16
	font     int
	eaFont   int
	ansiFont int
	symFont  int
	size     int
	color    colorIdx
	position int
}

// rd is a bounds-checked little endian reader
type rd struct {
	b   []byte
	p   int
	bad bool
}

func (r *rd) u16() int {
	if r.p+2 > len(r.b) {
		r.bad = true
		r.p = len(r.b)
		return 0
	}
	v := int(binary.LittleEndian.Uint16(r.b[r.p:]))
	r.p += 2
	return v
}

func (r *rd) s16() int { return int(int16(r.u16())) }

func (r *rd) u32() uint32 {
	if r.p+4 > len(r.b) {
		r.bad = true
		r.p = len(r.b)
		return 0
	}
	v := binary.LittleEndian.Uint32(r.b[r.p:])
	r.p += 4
	return v
}

func (r *rd) color() colorIdx {
	if r.p+4 > len(r.b) {
		r.bad = true
		r.p = len(r.b)
		return colorIdx{index: 0xFF}
	}
	c := colorIdx{r.b[r.p], r.b[r.p+1], r.b[r.p+2], r.b[r.p+3]}
	r.p += 4
	return c
}

// readPF reads a TextPFException
func (r *rd) readPF() pf {
	var f pf
	f.mask = r.u32()
	m := f.mask
	if m&(pfHasBullet|pfBulletHasFont|pfBulletHasClr|pfBulletHasSize) != 0 {
		f.bulletFlags = uint16(r.u16())
	}
	if m&pfBulletChar != 0 {
		f.bulletChar = rune(r.u16())
	}
	if m&pfBulletFont != 0 {
		f.bulletFont = r.u16()
	}
	if m&pfBulletSize != 0 {
		f.bulletSize = r.s16()
	}
	if m&pfBulletColor != 0 {
		f.bulletColor = r.color()
	}
	if m&pfAlign != 0 {
		f.align = r.u16()
	}
	if m&pfLineSpacing != 0 {
		f.lineSpacing = r.s16()
	}
	if m&pfSpaceBefore != 0 {
		f.spaceBefore = r.s16()
	}
	if m&pfSpaceAfter != 0 {
		f.spaceAfter = r.s16()
	}
	if m&pfLeftMargin != 0 {
		f.leftMargin = r.s16()
	}
	if m&pfIndent != 0 {
		f.indent = r.s16()
	}
	if m&pfDefaultTab != 0 {
		r.u16()
	}
	if m&pfTabStops != 0 {
		n := r.u16()
		r.p += 4 * n
		if r.p > len(r.b) {
			r.bad = true
			r.p = len(r.b)
		}
	}
	if m&pfFontAlign != 0 {
		r.u16()
	}
	if m&(pfCharWrap|pfWordWrap|pfOverflow) != 0 {
		r.u16()
	}
	if m&pfTextDir != 0 {
		r.u16()
	}
	return f
}

// readCF reads a TextCFException
func (r *rd) readCF() cf {
	var f cf
	f.mask = r.u32()
	m := f.mask
	if m&cfStyleBits != 0 {
		f.style = uint16(r.u16())
	}
	if m&cfTypeface != 0 {
		f.font = r.u16()
	}
	if m&cfOldEA != 0 {
		f.eaFont = r.u16()
	}
	if m&cfAnsi != 0 {
		f.ansiFont = r.u16()
	}
	if m&cfSymbol != 0 {
		f.symFont = r.u16()
	}
	if m&cfSize != 0 {
		f.size = r.u16()
	}
	if m&cfColor != 0 {
		f.color = r.color()
	}
	if m&cfPosition != 0 {
		f.position = r.s16()
	}
	return f
}

// over lays the fields b states over a
func (a pf) over(b pf) pf {
	m := b.mask
	if m&(pfHasBullet|pfBulletHasFont|pfBulletHasClr|pfBulletHasSize) != 0 {
		for _, bit := range []uint32{pfHasBullet, pfBulletHasFont, pfBulletHasClr, pfBulletHasSize} {
			if m&bit != 0 {
				flag := uint16(0)
				switch bit {
				case pfHasBullet:
					flag = 1
				case pfBulletHasFont:
					flag = 2
				case pfBulletHasClr:
					flag = 4
				case pfBulletHasSize:
					flag = 8
				}
				a.bulletFlags = a.bulletFlags&^flag | b.bulletFlags&flag
			}
		}
	}
	if m&pfBulletChar != 0 {
		a.bulletChar = b.bulletChar
	}
	if m&pfBulletFont != 0 {
		a.bulletFont = b.bulletFont
	}
	if m&pfBulletSize != 0 {
		a.bulletSize = b.bulletSize
	}
	if m&pfBulletColor != 0 {
		a.bulletColor = b.bulletColor
	}
	if m&pfAlign != 0 {
		a.align = b.align
	}
	if m&pfLineSpacing != 0 {
		a.lineSpacing = b.lineSpacing
	}
	if m&pfSpaceBefore != 0 {
		a.spaceBefore = b.spaceBefore
	}
	if m&pfSpaceAfter != 0 {
		a.spaceAfter = b.spaceAfter
	}
	if m&pfLeftMargin != 0 {
		a.leftMargin = b.leftMargin
	}
	if m&pfIndent != 0 {
		a.indent = b.indent
	}
	a.mask |= m
	return a
}

func (a cf) over(b cf) cf {
	m := b.mask
	for _, bit := range []uint32{cfBold, cfItalic, cfUnderline, cfShadow} {
		if m&bit != 0 {
			a.style = a.style&^uint16(bit) | b.style&uint16(bit)
		}
	}
	if m&cfTypeface != 0 {
		a.font = b.font
	}
	if m&cfOldEA != 0 {
		a.eaFont = b.eaFont
	}
	if m&cfAnsi != 0 {
		a.ansiFont = b.ansiFont
	}
	if m&cfSymbol != 0 {
		a.symFont = b.symFont
	}
	if m&cfSize != 0 {
		a.size = b.size
	}
	if m&cfColor != 0 {
		a.color = b.color
	}
	if m&cfPosition != 0 {
		a.position = b.position
	}
	a.mask |= m
	return a
}

/* ---------------- master text styles ---------------- */

type masterLevel struct {
	pf pf
	cf cf
}

type masterStyle struct {
	levels [5]*masterLevel
}

// parseMasterStyle reads a TxMasterStyleAtom; the text types from 5 on
// (centre body, centre title, half and quarter body) name each level. In
// the five base types a level only states what differs from the level
// above it, as LibreOffice's PPTStyleSheet reads them
func parseMasterStyle(r *officeart.Record) *masterStyle {
	ms := &masterStyle{}
	d := &rd{b: r.Data}
	n := d.u16()
	for i := 0; i < n && i < 5 && !d.bad; i++ {
		lvl := i
		if r.Instance >= 5 {
			lvl = d.u16()
		}
		l := &masterLevel{pf: d.readPF(), cf: d.readCF()}
		if r.Instance < 5 && lvl > 0 && ms.levels[lvl-1] != nil {
			above := ms.levels[lvl-1]
			l = &masterLevel{pf: above.pf.over(l.pf), cf: above.cf.over(l.cf)}
		}
		if lvl >= 0 && lvl < 5 {
			ms.levels[lvl] = l
		}
	}
	return ms
}

/* ---------------- text blocks ---------------- */

type pfRun struct {
	count int
	level int
	pf    pf
}

type cfRun struct {
	count int
	cf    cf
}

type linkRange struct {
	start, end int
	target     string // URL or "#N" (a slide)
}

type ruler struct {
	set        [5]bool
	leftMargin [5]int
	indent     [5]int
	marginSet  [5]bool
	indentSet  [5]bool
}

type textBlock struct {
	typ      int
	text     []uint16
	pfRuns   []pfRun
	cfRuns   []cfRun
	ruler    *ruler
	links    []linkRange
	slideNum []int // positions of slide number fields
	pending  *officeart.Record
}

// addTextRecord feeds one record of a text sequence (SlideListWithText or
// a ClientTextbox) into the blocks
func addTextRecord(blocks *[]*textBlock, r *officeart.Record) {
	cur := func() *textBlock {
		if len(*blocks) == 0 {
			return nil
		}
		return (*blocks)[len(*blocks)-1]
	}
	switch r.Type {
	case rtTextHeaderAtom:
		t := &textBlock{}
		if len(r.Data) >= 4 {
			t.typ = int(binary.LittleEndian.Uint32(r.Data))
		}
		*blocks = append(*blocks, t)
	case rtTextCharsAtom:
		if t := cur(); t != nil {
			t.text = make([]uint16, len(r.Data)/2)
			for i := range t.text {
				t.text[i] = binary.LittleEndian.Uint16(r.Data[2*i:])
			}
		}
	case rtTextBytesAtom:
		if t := cur(); t != nil {
			t.text = make([]uint16, len(r.Data))
			for i, c := range r.Data {
				t.text[i] = uint16(c)
			}
		}
	case rtStyleTextPropAtom:
		if t := cur(); t != nil {
			t.readStyleProps(r.Data)
		}
	case rtTextRulerAtom:
		if t := cur(); t != nil {
			t.ruler = readRuler(r.Data)
		}
	case rtInteractiveInfo:
		if t := cur(); t != nil {
			t.pending = r
		}
	case rtTxInteractiveInfo:
		if t := cur(); t != nil && t.pending != nil && len(r.Data) >= 8 {
			t.links = append(t.links, linkRange{
				start: int(binary.LittleEndian.Uint32(r.Data)), end: int(binary.LittleEndian.Uint32(r.Data[4:])),
				target: interactiveRef(t.pending),
			})
			t.pending = nil
		}
	case rtSlideNumberMC:
		if t := cur(); t != nil && len(r.Data) >= 4 {
			t.slideNum = append(t.slideNum, int(binary.LittleEndian.Uint32(r.Data)))
		}
	}
}

// interactiveRef encodes an InteractiveInfo container's link as
// "link:<id>" for hyperlinks, "#next" / "#prev" / ... for jumps
func interactiveRef(ii *officeart.Record) string {
	a := ii.Child(rtInteractiveAtom)
	if a == nil || len(a.Data) < 12 {
		return ""
	}
	action := a.Data[8]
	jump := a.Data[10]
	switch action {
	case 3: // jump
		switch jump {
		case 1:
			return "#next"
		case 2:
			return "#prev"
		case 3:
			return "#first"
		case 4:
			return "#last"
		}
	case 4: // hyperlink
		return "link:" + itoaU(binary.LittleEndian.Uint32(a.Data[4:]))
	}
	return ""
}

func itoaU(v uint32) string {
	if v == 0 {
		return "0"
	}
	var b []byte
	for v > 0 {
		b = append([]byte{byte('0' + v%10)}, b...)
		v /= 10
	}
	return string(b)
}

// readStyleProps reads a StyleTextPropAtom: paragraph runs, then
// character runs, each covering the text plus one character
func (t *textBlock) readStyleProps(b []byte) {
	r := &rd{b: b}
	n := len(t.text) + 1
	for got := 0; got < n && !r.bad && r.p < len(b); {
		run := pfRun{count: int(r.u32())}
		run.level = r.u16()
		run.pf = r.readPF()
		if run.count <= 0 {
			break
		}
		t.pfRuns = append(t.pfRuns, run)
		got += run.count
	}
	for got := 0; got < n && !r.bad && r.p < len(b); {
		run := cfRun{count: int(r.u32())}
		run.cf = r.readCF()
		if run.count <= 0 {
			break
		}
		t.cfRuns = append(t.cfRuns, run)
		got += run.count
	}
}

// readRuler reads a TextRulerAtom: per level margins and indents
func readRuler(b []byte) *ruler {
	r := &rd{b: b}
	m := r.u32()
	ru := &ruler{}
	if m&0x2 != 0 {
		r.u16() // cLevels
	}
	if m&0x1 != 0 {
		r.u16() // default tab
	}
	if m&0x4 != 0 {
		n := r.u16()
		r.p += 4 * n
	}
	for lvl := 0; lvl < 5 && !r.bad; lvl++ {
		if m&(0x8<<lvl) != 0 {
			ru.leftMargin[lvl] = r.u16()
			ru.marginSet[lvl] = true
		}
		if m&(0x100<<lvl) != 0 {
			ru.indent[lvl] = r.u16()
			ru.indentSet[lvl] = true
		}
	}
	return ru
}

/* ---------------- resolving ---------------- */

// basePF / baseCF are the formatting text has before any style applies
var basePF = pf{bulletChar: 0x2022, bulletSize: 100, lineSpacing: 100, bulletColor: colorIdx{index: 0xFF}}
var baseCF = cf{size: 18, color: colorIdx{index: 1}}

// styleChain lists the master text styles a text type inherits, the most
// general first: the document's default style, the master's style for
// the basic type (title, body, notes, other) and the master's own style
// for a derived type (centre title, centre / half / quarter body)
func (p *pres) styleChain(m *slideRec, typ int) []*masterStyle {
	var out []*masterStyle
	if p.envStyle != nil {
		out = append(out, p.envStyle)
	}
	if m == nil {
		return out
	}
	base := typ
	switch typ {
	case 5, 7, 8:
		base = 1
	case 6:
		base = 0
	case 0, 1, 2, 4:
	default:
		base = 4
	}
	if m.styles[base] != nil {
		out = append(out, m.styles[base])
	}
	if typ != base && typ >= 0 && typ < 9 && m.styles[typ] != nil {
		out = append(out, m.styles[typ])
	}
	return out
}

// resolve gives the paragraph and character formatting a run of text of
// type typ at an indent level ends up with
func resolve(chain []*masterStyle, level int) (pf, cf) {
	p, c := basePF, baseCF
	if level > 4 {
		level = 4
	}
	if level < 0 {
		level = 0
	}
	for _, ms := range chain {
		// a level a style does not state falls back to its first level
		l := ms.levels[level]
		if l == nil {
			continue
		}
		p = p.over(l.pf)
		c = c.over(l.cf)
	}
	return p, c
}
