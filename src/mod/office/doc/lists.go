package doc

/*
	lists.go - bullets and numbering (LibreOffice: WW8ListManager in
	ww8par3.cxx).

	A list definition (LSTF, in PlfLst) has nine levels (one for a
	"simple" list), each an LVL: start value, number format, the text
	around the number - with the characters 0-8 standing for the counters
	of levels 1-9 - and the indent / font the level adds. A paragraph names
	a list override (LFO, in PlfLfo) by its 1-based index, which points at
	a definition by its id (lsid) and may restart or reformat levels: in
	WordprocessingML terms LSTF is an abstractNum and LFO a num.
*/

import (
	"encoding/binary"
	"strconv"
	"strings"
)

type lvl struct {
	start   int
	nfc     int
	jc      int
	text    []uint16 // raw xst: units 0-8 are level placeholders
	follow  int      // 0 tab, 1 space, 2 nothing
	papx    []byte
	chpx    []byte
	legal   bool
	restart int // ilvlRestartLim
}

type lstf struct {
	lsid   int32
	simple bool
	levels []*lvl
}

type lfoLevel struct {
	ilvl      int
	start     int
	hasStart  bool
	formatted *lvl
}

type lfo struct {
	lsid   int32
	levels []lfoLevel
}

type lists struct {
	defs []*lstf
	lfos []*lfo
}

// readLvl reads one LVL at p, returning it and the offset after it
func readLvl(b []byte, p int) (*lvl, int) {
	le := binary.LittleEndian
	if p+28 > len(b) {
		return nil, len(b)
	}
	f := b[p : p+28]
	l := &lvl{
		start:   int(int32(le.Uint32(f))),
		nfc:     int(f[4]),
		jc:      int(f[5] & 3),
		legal:   f[5]&0x04 != 0,
		follow:  int(f[15]),
		restart: int(f[26]),
	}
	cbChpx := int(f[24])
	cbPapx := int(f[25])
	p += 28
	if p+cbPapx+cbChpx > len(b) {
		return nil, len(b)
	}
	l.papx = b[p : p+cbPapx]
	p += cbPapx
	l.chpx = b[p : p+cbChpx]
	p += cbChpx
	if p+2 > len(b) {
		return l, len(b)
	}
	n := int(le.Uint16(b[p:]))
	p += 2
	if p+2*n > len(b) {
		return l, len(b)
	}
	l.text = make([]uint16, n)
	for i := range l.text {
		l.text[i] = le.Uint16(b[p+2*i:])
	}
	return l, p + 2*n
}

// parseLists reads PlfLst and PlfLfo; both slices run to the end of the
// table stream, since the level data follows each beyond its stated size
func parseLists(plfLst, plfLfo []byte) *lists {
	le := binary.LittleEndian
	ls := &lists{}
	if len(plfLst) >= 2 {
		n := int(int16(le.Uint16(plfLst)))
		p := 2
		for i := 0; i < n && p+28 <= len(plfLst); i++ {
			d := &lstf{lsid: int32(le.Uint32(plfLst[p:])), simple: plfLst[p+26]&0x01 != 0}
			ls.defs = append(ls.defs, d)
			p += 28
		}
		// the levels follow all the definitions
		for _, d := range ls.defs {
			count := 9
			if d.simple {
				count = 1
			}
			for k := 0; k < count; k++ {
				l, next := readLvl(plfLst, p)
				if l == nil {
					break
				}
				d.levels = append(d.levels, l)
				p = next
			}
		}
	}
	if len(plfLfo) >= 4 {
		n := int(le.Uint32(plfLfo))
		p := 4
		var counts []int
		for i := 0; i < n && p+16 <= len(plfLfo); i++ {
			ls.lfos = append(ls.lfos, &lfo{lsid: int32(le.Uint32(plfLfo[p:]))})
			counts = append(counts, int(plfLfo[p+12]))
			p += 16
		}
		// then one LFOData per LFO: a CP, then its level overrides
		for i, o := range ls.lfos {
			if p+4 > len(plfLfo) {
				break
			}
			p += 4
			for k := 0; k < counts[i] && p+8 <= len(plfLfo); k++ {
				start := int(int32(le.Uint32(plfLfo[p:])))
				flags := le.Uint32(plfLfo[p+4:])
				p += 8
				lv := lfoLevel{ilvl: int(flags & 0x0F), start: start, hasStart: flags&0x10 != 0}
				if flags&0x20 != 0 {
					l, next := readLvl(plfLfo, p)
					lv.formatted = l
					p = next
				}
				o.levels = append(o.levels, lv)
			}
		}
	}
	return ls
}

// defIndex finds the definition an override uses
func (ls *lists) defIndex(lsid int32) int {
	for i, d := range ls.defs {
		if d.lsid == lsid {
			return i
		}
	}
	return -1
}

// nfcNames maps number formats to WordprocessingML
var nfcNames = map[int]string{
	0: "decimal", 1: "upperRoman", 2: "lowerRoman", 3: "upperLetter", 4: "lowerLetter",
	5: "ordinal", 6: "cardinalText", 7: "ordinalText", 8: "hex", 9: "chicago",
	10: "ideographDigital", 11: "japaneseCounting", 12: "aiueo", 13: "iroha",
	14: "decimalFullWidth", 15: "decimalHalfWidth", 16: "japaneseLegal", 17: "japaneseDigitalTenThousand",
	18: "decimalEnclosedCircle", 19: "decimalFullWidth2", 20: "aiueoFullWidth", 21: "irohaFullWidth",
	22: "decimalZero", 23: "bullet", 24: "ganada", 25: "chosung", 26: "decimalEnclosedFullstop",
	27: "decimalEnclosedParen", 28: "decimalEnclosedCircleChinese", 29: "ideographEnclosedCircle",
	30: "ideographTraditional", 31: "ideographZodiac", 32: "ideographZodiacTraditional",
	33: "taiwaneseCounting", 34: "ideographLegalTraditional", 35: "taiwaneseCountingThousand",
	36: "taiwaneseDigital", 37: "chineseCounting", 38: "chineseLegalSimplified",
	39: "chineseCountingThousand", 41: "koreanDigital", 42: "koreanCounting", 43: "koreanLegal",
	44: "koreanDigital2", 45: "hebrew1", 46: "arabicAlpha", 47: "hebrew2", 48: "arabicAbjad",
	49: "hindiVowels", 50: "hindiConsonants", 51: "hindiNumbers", 52: "hindiCounting",
	53: "thaiLetters", 54: "thaiNumbers", 55: "thaiCounting", 56: "vietnameseCounting",
	57: "numberInDash", 58: "russianLower", 59: "russianUpper", 255: "none",
}

// lvlText turns the raw level text into lvlText ("%1.%2")
func lvlText(text []uint16) string {
	var sb strings.Builder
	for _, u := range text {
		if u < 9 {
			sb.WriteString("%" + strconv.Itoa(int(u)+1))
			continue
		}
		sb.WriteRune(rune(u))
	}
	return sb.String()
}
