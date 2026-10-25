package pdfrender

import (
	"strings"
	"unicode/utf16"
)

/*
	cmap.go

	CMaps of composite fonts (character code -> CID, with the codespace that
	splits a string into codes) and ToUnicode maps (code -> text). Of the
	predefined CMaps only the Identity ones are known exactly; the Unicode
	based ones (UniGB-UCS2-H, UniJIS-UTF16-H, ...) at least tell the code
	is a Unicode value, which an embedded TrueType font can map through its
	own cmap. Others are split into one and two byte codes by lead byte.
*/

type codeRange struct {
	n      int
	lo, hi uint32
}

type cidRange struct {
	n      int
	lo, hi uint32
	cid    int
}

type cmap struct {
	codespace  []codeRange
	cidRanges  []cidRange
	cidSingles map[uint64]int
	identity   bool
	unicode    bool //Codes are UCS-2 / UTF-16 values
	vertical   bool
	known      bool //CIDs come from real data
	toUni      map[uint64][]rune
	uniRanges  []cidRange //lo..hi -> base rune in cid
}

func codeKey(n int, code uint32) uint64 {
	return uint64(n)<<32 | uint64(code)
}

func bytesToCode(b []byte) uint32 {
	var v uint32
	for _, c := range b {
		v = v<<8 | uint32(c)
	}
	return v
}

// predefinedCMap builds what is known about a CMap given by name
func predefinedCMap(name string) *cmap {
	cm := &cmap{cidSingles: map[uint64]int{}}
	cm.vertical = strings.HasSuffix(name, "-V")
	switch {
	case name == "Identity-H" || name == "Identity-V":
		cm.identity = true
		cm.known = true
		cm.codespace = []codeRange{{2, 0, 0xFFFF}}
	case strings.Contains(name, "UCS2"):
		cm.unicode = true
		cm.codespace = []codeRange{{2, 0, 0xFFFF}}
	case strings.Contains(name, "UTF16"):
		cm.unicode = true
		cm.codespace = []codeRange{{2, 0, 0xD7FF}, {4, 0xD800DC00, 0xDBFFDFFF}, {2, 0xE000, 0xFFFF}}
	default:
		//Multi byte legacy encodings: ASCII is one byte, the rest two
		cm.codespace = []codeRange{{1, 0, 0x80}, {2, 0x8100, 0xFEFF}, {1, 0xA0, 0xDF}}
	}
	return cm
}

// parseCMap reads an embedded CMap (or ToUnicode) stream
func parseCMap(data []byte) *cmap {
	cm := &cmap{cidSingles: map[uint64]int{}, toUni: map[uint64][]rune{}, known: true}
	l := &lexer{buf: data}
	var prev token
	readStr := func() ([]byte, bool) {
		t := l.next()
		if t.kind != tokString {
			return nil, false
		}
		return []byte(t.s), true
	}
	for steps := 0; steps < 2000000; steps++ {
		t := l.next()
		if t.kind == tokEOF {
			break
		}
		if t.kind == tokName && t.s == "WMode" {
			if v := l.next(); v.kind == tokInt && v.i == 1 {
				cm.vertical = true
			}
			continue
		}
		if t.kind != tokKeyword {
			prev = t
			continue
		}
		switch t.s {
		case "usecmap":
			if prev.kind == tokName {
				base := predefinedCMap(prev.s)
				cm.codespace = append(cm.codespace, base.codespace...)
				if base.identity {
					cm.identity = true
				}
				cm.unicode = cm.unicode || base.unicode
			}
		case "begincodespacerange":
			for {
				lo, ok := readStr()
				if !ok {
					break
				}
				hi, ok := readStr()
				if !ok || len(lo) == 0 || len(lo) > 4 {
					break
				}
				cm.codespace = append(cm.codespace, codeRange{len(lo), bytesToCode(lo), bytesToCode(hi)})
			}
		case "begincidrange":
			for {
				lo, ok := readStr()
				if !ok {
					break
				}
				hi, ok := readStr()
				if !ok {
					break
				}
				c := l.next()
				if c.kind != tokInt || len(lo) == 0 || len(lo) > 4 {
					break
				}
				cm.cidRanges = append(cm.cidRanges, cidRange{len(lo), bytesToCode(lo), bytesToCode(hi), c.i})
			}
		case "begincidchar":
			for {
				code, ok := readStr()
				if !ok {
					break
				}
				c := l.next()
				if c.kind != tokInt || len(code) == 0 || len(code) > 4 {
					break
				}
				cm.cidSingles[codeKey(len(code), bytesToCode(code))] = c.i
			}
		case "beginbfchar":
			for {
				code, ok := readStr()
				if !ok {
					break
				}
				dst := l.next()
				if len(code) == 0 || len(code) > 4 {
					break
				}
				switch dst.kind {
				case tokString:
					cm.toUni[codeKey(len(code), bytesToCode(code))] = utf16BE([]byte(dst.s))
				case tokName:
					if r, ok := glyphNameToRune(dst.s); ok {
						cm.toUni[codeKey(len(code), bytesToCode(code))] = []rune{r}
					}
				}
			}
		case "beginbfrange":
			for {
				lo, ok := readStr()
				if !ok {
					break
				}
				hi, ok := readStr()
				if !ok || len(lo) == 0 || len(lo) > 4 {
					break
				}
				n := len(lo)
				a, b := bytesToCode(lo), bytesToCode(hi)
				dst := l.next()
				if dst.kind == tokString {
					rs := utf16BE([]byte(dst.s))
					if len(rs) == 1 {
						cm.uniRanges = append(cm.uniRanges, cidRange{n, a, b, int(rs[0])})
					} else if len(rs) > 1 && b >= a && b-a < 4096 {
						for c := a; c <= b; c++ {
							out := append([]rune{}, rs...)
							out[len(out)-1] += rune(c - a)
							cm.toUni[codeKey(n, c)] = out
						}
					}
				} else if dst.kind == tokArrayOpen {
					c := a
					for {
						e := l.next()
						if e.kind != tokString {
							break
						}
						cm.toUni[codeKey(n, c)] = utf16BE([]byte(e.s))
						c++
					}
				} else {
					break
				}
			}
		}
		prev = t
	}
	if len(cm.codespace) == 0 {
		cm.codespace = []codeRange{{2, 0, 0xFFFF}}
	}
	return cm
}

func utf16BE(b []byte) []rune {
	u := make([]uint16, 0, len(b)/2)
	for i := 0; i+1 < len(b); i += 2 {
		u = append(u, uint16(b[i])<<8|uint16(b[i+1]))
	}
	if len(b) == 1 {
		return []rune{rune(b[0])}
	}
	return utf16.Decode(u)
}

// nextCode splits the next character code off s
func (cm *cmap) nextCode(s []byte) (uint32, int) {
	for n := 1; n <= 4 && n <= len(s); n++ {
		code := bytesToCode(s[:n])
		for _, r := range cm.codespace {
			if r.n == n && code >= r.lo && code <= r.hi {
				return code, n
			}
		}
	}
	//No range matched: use the shortest code length
	n := 4
	for _, r := range cm.codespace {
		if r.n < n {
			n = r.n
		}
	}
	if n > len(s) {
		n = len(s)
	}
	if n < 1 {
		n = 1
	}
	return bytesToCode(s[:n]), n
}

func (cm *cmap) cid(code uint32, n int) int {
	if cm.identity && n == 2 {
		return int(code)
	}
	if c, ok := cm.cidSingles[codeKey(n, code)]; ok {
		return c
	}
	for _, r := range cm.cidRanges {
		if r.n == n && code >= r.lo && code <= r.hi {
			return r.cid + int(code-r.lo)
		}
	}
	if cm.identity {
		return int(code)
	}
	return 0
}

// unicodeOf looks a code up in a ToUnicode map
func (cm *cmap) unicodeOf(code uint32, n int) []rune {
	if cm == nil {
		return nil
	}
	if rs, ok := cm.toUni[codeKey(n, code)]; ok {
		return rs
	}
	for _, r := range cm.uniRanges {
		if r.n == n && code >= r.lo && code <= r.hi {
			return []rune{rune(r.cid + int(code-r.lo))}
		}
	}
	return nil
}
