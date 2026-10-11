package doc

/*
	styles.go - the style sheet and the font table (LibreOffice: WW8RStyle
	in ww8par2.cxx, WW8Fonts in ww8scan.cxx).

	The style sheet (STSH) is a header (STSHI) and an array of style
	definitions (STD), indexed by "istd". A style names its base style and
	its next style and carries its own property modifiers (UPX): a
	paragraph style a paragraph UPX (its istd and sprms) and a character
	UPX, a character style only the latter. Built-in styles are known by
	their "sti" number whatever language their stored name is in.

	The font table (SttbfFfn) lists the fonts sprms refer to by index.
*/

import (
	"encoding/binary"
	"strconv"
	"strings"
	"unicode"
)

const (
	stkPara  = 1
	stkChar  = 2
	stkTable = 3
	stkList  = 4
)

type style struct {
	istd   int
	sti    int
	stk    int
	base   int // istd, 0xFFF none
	next   int
	name   string
	id     string // styleId written to the .docx
	papx   []byte
	chpx   []byte
	hidden bool
}

type styleSheet struct {
	styles []*style // by istd (nil for empty slots)
	defFtc [3]int   // default fonts: ascii, east asian, other
	byID   map[string]bool
}

// built-in style names by sti, the names Word itself writes in a .docx
var stiNames = map[int]string{
	0: "Normal", 1: "heading 1", 2: "heading 2", 3: "heading 3", 4: "heading 4", 5: "heading 5",
	6: "heading 6", 7: "heading 7", 8: "heading 8", 9: "heading 9",
	10: "index 1", 11: "index 2", 12: "index 3", 13: "index 4", 14: "index 5", 15: "index 6",
	16: "index 7", 17: "index 8", 18: "index 9",
	19: "toc 1", 20: "toc 2", 21: "toc 3", 22: "toc 4", 23: "toc 5", 24: "toc 6", 25: "toc 7",
	26: "toc 8", 27: "toc 9", 28: "Normal Indent", 29: "footnote text", 30: "annotation text",
	31: "header", 32: "footer", 33: "index heading", 34: "caption", 35: "table of figures",
	36: "envelope address", 37: "envelope return", 38: "footnote reference",
	39: "annotation reference", 40: "line number", 41: "page number", 42: "endnote reference",
	43: "endnote text", 44: "table of authorities", 45: "macro", 46: "toa heading", 47: "List",
	48: "List Bullet", 49: "List Number", 50: "List 2", 51: "List 3", 52: "List 4", 53: "List 5",
	54: "List Bullet 2", 55: "List Bullet 3", 56: "List Bullet 4", 57: "List Bullet 5",
	58: "List Number 2", 59: "List Number 3", 60: "List Number 4", 61: "List Number 5",
	62: "Title", 63: "Closing", 64: "Signature", 65: "Default Paragraph Font", 66: "Body Text",
	67: "Body Text Indent", 68: "List Continue", 69: "List Continue 2", 70: "List Continue 3",
	71: "List Continue 4", 72: "List Continue 5", 73: "Message Header", 74: "Subtitle",
	75: "Salutation", 76: "Date", 77: "Body Text First Indent", 78: "Body Text First Indent 2",
	79: "Note Heading", 80: "Body Text 2", 81: "Body Text 3", 82: "Body Text Indent 2",
	83: "Body Text Indent 3", 84: "Block Text", 85: "Hyperlink", 86: "FollowedHyperlink",
	87: "Strong", 88: "Emphasis", 89: "Document Map", 90: "Plain Text",
	105: "Normal Table", 106: "annotation subject", 107: "No List", 153: "Balloon Text",
	154: "Table Grid",
}

// parseStyles reads the STSH
func parseStyles(b []byte) *styleSheet {
	le := binary.LittleEndian
	ss := &styleSheet{byID: map[string]bool{}}
	if len(b) < 2 {
		return ss
	}
	cbStshi := int(le.Uint16(b))
	if 2+cbStshi > len(b) || cbStshi < 4 {
		return ss
	}
	shi := b[2 : 2+cbStshi]
	cstd := int(le.Uint16(shi))
	cbBase := int(le.Uint16(shi[2:]))
	if len(shi) >= 18 {
		ss.defFtc = [3]int{int(le.Uint16(shi[12:])), int(le.Uint16(shi[14:])), int(le.Uint16(shi[16:]))}
	}
	p := 2 + cbStshi
	for i := 0; i < cstd && p+2 <= len(b); i++ {
		cb := int(le.Uint16(b[p:]))
		p += 2
		if cb == 0 {
			ss.styles = append(ss.styles, nil)
			continue
		}
		if p+cb > len(b) {
			break
		}
		std := b[p : p+cb]
		p += cb
		ss.styles = append(ss.styles, parseStd(std, cbBase, i))
	}
	ss.assignIDs()
	return ss
}

func parseStd(std []byte, cbBase, istd int) *style {
	le := binary.LittleEndian
	if len(std) < 10 || cbBase < 10 || cbBase > len(std) {
		return nil
	}
	w0 := int(le.Uint16(std))
	w1 := int(le.Uint16(std[2:]))
	w2 := int(le.Uint16(std[4:]))
	st := &style{
		istd: istd,
		sti:  w0 & 0x0FFF,
		stk:  w1 & 0x000F,
		base: w1 >> 4,
		next: w2 >> 4,
	}
	cupx := w2 & 0x000F
	st.hidden = le.Uint16(std[8:])&0x0002 != 0
	name, q := xst(std, cbBase)
	st.name = name
	q += 2 // the name's null terminator
	for k := 0; k < cupx && q+2 <= len(std); k++ {
		if q%2 == 1 {
			q++
		}
		if q+2 > len(std) {
			break
		}
		n := int(le.Uint16(std[q:]))
		q += 2
		if q+n > len(std) {
			break
		}
		upx := std[q : q+n]
		q += n
		switch st.stk {
		case stkPara:
			if k == 0 && len(upx) >= 2 {
				st.papx = upx[2:] // the istd, then the sprms
			} else if k == 1 {
				st.chpx = upx
			}
		case stkChar:
			if k == 0 {
				st.chpx = upx
			}
		case stkTable:
			if k == 1 && len(upx) >= 2 {
				st.papx = upx[2:]
			} else if k == 2 {
				st.chpx = upx
			}
		case stkList:
			if k == 0 && len(upx) >= 2 {
				st.papx = upx[2:]
			}
		}
	}
	return st
}

// assignIDs gives every style a unique styleId: the built-in ones their
// usual id, the rest one made from their name
func (ss *styleSheet) assignIDs() {
	for _, st := range ss.styles {
		if st == nil {
			continue
		}
		if n, ok := stiNames[st.sti]; ok && st.sti < 4094 {
			st.name = n
		}
		if st.name == "" {
			st.name = "Style " + strconv.Itoa(st.istd)
		}
		id := styleIDFor(st.name)
		if id == "" || ss.byID[id] {
			id = id + strconv.Itoa(st.istd)
		}
		ss.byID[id] = true
		st.id = id
	}
}

func styleIDFor(name string) string {
	var sb strings.Builder
	upper := true
	for _, r := range name {
		if unicode.IsLetter(r) || unicode.IsDigit(r) {
			if upper {
				sb.WriteRune(unicode.ToUpper(r))
			} else {
				sb.WriteRune(r)
			}
			upper = false
		} else {
			upper = true
		}
	}
	return sb.String()
}

func (ss *styleSheet) get(istd int) *style {
	if istd < 0 || istd >= len(ss.styles) {
		return nil
	}
	return ss.styles[istd]
}

// chain lists a style and its bases, the style itself first
func (ss *styleSheet) chain(istd int) []*style {
	var out []*style
	seen := map[int]bool{}
	for st := ss.get(istd); st != nil && !seen[st.istd] && len(out) < 32; st = ss.get(st.base) {
		seen[st.istd] = true
		out = append(out, st)
	}
	return out
}

// toggles resolves the toggle properties a paragraph style plus a
// character style give a run (what a "flip" in direct formatting flips)
func (ss *styleSheet) toggles(paraIstd, charIstd int) uint32 {
	var val uint32
	apply := func(chain []*style) {
		for i := len(chain) - 1; i >= 0; i-- {
			c := newChp()
			eachSprm(chain[i].chpx, c.apply)
			val = (val &^ c.togSet) | (c.togVal & c.togSet)
			val ^= c.togFlip
		}
	}
	apply(ss.chain(paraIstd))
	if charIstd >= 0 {
		apply(ss.chain(charIstd))
	}
	return val
}

/* ---------------- fonts ---------------- */

type font struct {
	name    string
	alt     string
	charset int
	family  int
}

// parseFonts reads the SttbfFfn
func parseFonts(b []byte) []font {
	le := binary.LittleEndian
	if len(b) < 4 {
		return nil
	}
	n := int(le.Uint16(b))
	p := 4
	var out []font
	for i := 0; i < n && p < len(b); i++ {
		cb := int(b[p]) + 1
		if p+cb > len(b) || cb < 40 {
			break
		}
		ffn := b[p+1 : p+cb]
		p += cb
		f := font{charset: int(ffn[3]), family: int(ffn[0]>>4) & 7}
		ixAlt := int(ffn[4])
		names := ffn[39:]
		u := make([]uint16, len(names)/2)
		for k := range u {
			u[k] = le.Uint16(names[2*k:])
		}
		end := 0
		for end < len(u) && u[end] != 0 {
			end++
		}
		f.name = utf16le(names[:2*end])
		if ixAlt > 0 && ixAlt < len(u) {
			e := ixAlt
			for e < len(u) && u[e] != 0 {
				e++
			}
			f.alt = utf16le(names[2*ixAlt : 2*e])
		}
		out = append(out, f)
	}
	return out
}
