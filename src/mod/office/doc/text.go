package doc

/*
	text.go - where the characters are and how they are formatted at the
	byte level (LibreOffice: WW8PLCFx_PCD, WW8PLCFx_Fc_FKP in ww8scan.cxx).

	Text is addressed by character position (CP). The piece table (CLX)
	maps CP ranges onto byte ranges (FC) of the WordDocument stream, each
	piece either 16-bit Unicode or "compressed" 8-bit cp1252 text: a
	fast-saved document is a patchwork of pieces in any order.

	Formatting is addressed by FC instead. Character and paragraph
	properties live in 512-byte formatted disk pages (FKPs) in the
	WordDocument stream; a bin table (PlcBteChpx / PlcBtePapx) in the
	table stream lists the pages, and each page maps FC runs to a CHPX or
	PAPX - a style number and a list of property modifiers (sprms).
*/

import (
	"encoding/binary"
	"sort"
	"unicode/utf16"

	"imuslab.com/arozos/mod/office/internal/codepage"
)

type piece struct {
	cpStart, cpEnd int
	fc             int // byte offset of the first character
	compressed     bool
	prm            uint16
}

// pieceTable reads the CLX: property groups (Prc) then the PlcPcd
func pieceTable(clx []byte, total int) ([]piece, [][]byte) {
	le := binary.LittleEndian
	var grpprls [][]byte
	p := 0
	for p < len(clx) && clx[p] == 0x01 {
		if p+3 > len(clx) {
			return nil, grpprls
		}
		cb := int(int16(le.Uint16(clx[p+1:])))
		if cb < 0 || p+3+cb > len(clx) {
			return nil, grpprls
		}
		grpprls = append(grpprls, clx[p+3:p+3+cb])
		p += 3 + cb
	}
	if p+5 > len(clx) || clx[p] != 0x02 {
		return nil, grpprls
	}
	lcb := int(le.Uint32(clx[p+1:]))
	p += 5
	if lcb < 4 || lcb > len(clx)-p {
		return nil, grpprls
	}
	plc := clx[p : p+lcb]
	n := (len(plc) - 4) / 12
	var out []piece
	for i := 0; i < n; i++ {
		cp1 := int(int32(le.Uint32(plc[4*i:])))
		cp2 := int(int32(le.Uint32(plc[4*i+4:])))
		pcd := plc[4*(n+1)+8*i:]
		fcRaw := le.Uint32(pcd[2:])
		pc := piece{cpStart: cp1, cpEnd: cp2, prm: le.Uint16(pcd[6:])}
		if fcRaw&0x40000000 != 0 {
			pc.compressed = true
			pc.fc = int(fcRaw&0x3FFFFFFF) / 2
		} else {
			pc.fc = int(fcRaw & 0x3FFFFFFF)
		}
		if cp2 < cp1 || cp1 < 0 {
			continue
		}
		out = append(out, pc)
	}
	return out, grpprls
}

// textUnits builds the UTF-16 code units of every CP of the document
func textUnits(wd []byte, pieces []piece, total int) []uint16 {
	units := make([]uint16, total)
	le := binary.LittleEndian
	for _, pc := range pieces {
		for cp := pc.cpStart; cp < pc.cpEnd && cp < total; cp++ {
			k := cp - pc.cpStart
			if pc.compressed {
				off := pc.fc + k
				if off < len(wd) {
					units[cp] = uint16(codepage.Rune1252(wd[off]))
				}
			} else {
				off := pc.fc + 2*k
				if off+2 <= len(wd) {
					units[cp] = le.Uint16(wd[off:])
				}
			}
		}
	}
	return units
}

// pieceAt finds the piece holding cp
func pieceAt(pieces []piece, cp int) int {
	i := sort.Search(len(pieces), func(i int) bool { return pieces[i].cpEnd > cp })
	if i < len(pieces) && pieces[i].cpStart <= cp {
		return i
	}
	return -1
}

// fcOf is the byte offset of a CP's character
func fcOf(pieces []piece, cp int) int {
	i := pieceAt(pieces, cp)
	if i < 0 {
		return -1
	}
	pc := pieces[i]
	if pc.compressed {
		return pc.fc + cp - pc.cpStart
	}
	return pc.fc + 2*(cp-pc.cpStart)
}

/* ---------------- PLCs and STTBs ---------------- */

// plc is a generic PLC: n+1 positions followed by n fixed size structures
type plc struct {
	pos  []int
	data []byte
	size int
}

func parsePLC(b []byte, size int) *plc {
	if len(b) < 4 {
		return &plc{}
	}
	n := (len(b) - 4) / (4 + size)
	p := &plc{size: size}
	for i := 0; i <= n; i++ {
		p.pos = append(p.pos, int(int32(binary.LittleEndian.Uint32(b[4*i:]))))
	}
	p.data = b[4*(n+1):]
	return p
}

func (p *plc) n() int {
	if len(p.pos) == 0 {
		return 0
	}
	return len(p.pos) - 1
}

func (p *plc) item(i int) []byte {
	if p.size == 0 || (i+1)*p.size > len(p.data) {
		return nil
	}
	return p.data[i*p.size : (i+1)*p.size]
}

// sttb decodes a string table (extended UTF-16 or 8-bit); extra data
// after each string is skipped
func sttb(b []byte) []string {
	le := binary.LittleEndian
	if len(b) < 4 {
		return nil
	}
	ext := le.Uint16(b) == 0xFFFF
	p := 0
	if ext {
		p = 2
	}
	n := int(le.Uint16(b[p:]))
	p += 2
	if p+2 > len(b) {
		return nil
	}
	cbExtra := int(le.Uint16(b[p:]))
	p += 2
	var out []string
	for i := 0; i < n && p < len(b); i++ {
		if ext {
			if p+2 > len(b) {
				break
			}
			cch := int(le.Uint16(b[p:]))
			p += 2
			if p+2*cch > len(b) {
				break
			}
			out = append(out, utf16le(b[p:p+2*cch]))
			p += 2 * cch
		} else {
			cch := int(b[p])
			p++
			if p+cch > len(b) {
				break
			}
			out = append(out, codepage.For(1252).Decode(b[p:p+cch]))
			p += cch
		}
		p += cbExtra
	}
	return out
}

func utf16le(b []byte) string {
	u := make([]uint16, len(b)/2)
	for i := range u {
		u[i] = binary.LittleEndian.Uint16(b[2*i:])
	}
	return string(utf16.Decode(u))
}

// xst reads a Xst / Xstz (count of UTF-16 units, then the units) at p,
// returning the string and the offset after it
func xst(b []byte, p int) (string, int) {
	if p+2 > len(b) {
		return "", len(b)
	}
	n := int(binary.LittleEndian.Uint16(b[p:]))
	p += 2
	if p+2*n > len(b) {
		return "", len(b)
	}
	return utf16le(b[p : p+2*n]), p + 2*n
}

/* ---------------- formatted disk pages ---------------- */

type fkpRun struct {
	fcStart, fcEnd int
	istd           int // PAPX only
	grpprl         []byte
}

// readFKPs loads every run of the CHPX or PAPX pages a bin table lists
func readFKPs(wd, bte []byte, papx bool) []fkpRun {
	le := binary.LittleEndian
	bin := parsePLC(bte, 4)
	var runs []fkpRun
	seen := map[int]bool{}
	for i := 0; i < bin.n(); i++ {
		pn := int(le.Uint32(bin.item(i)) & 0x3FFFFF)
		if seen[pn] {
			continue
		}
		seen[pn] = true
		off := pn * 512
		if off > len(wd)-512 {
			continue
		}
		page := wd[off : off+512]
		crun := int(page[511])
		if crun == 0 || 4*(crun+1) > 511 {
			continue
		}
		for k := 0; k < crun; k++ {
			r := fkpRun{
				fcStart: int(le.Uint32(page[4*k:])),
				fcEnd:   int(le.Uint32(page[4*k+4:])),
			}
			if papx {
				bx := 4*(crun+1) + 13*k
				if bx >= 511 {
					break
				}
				b := int(page[bx]) * 2
				if b == 0 || b >= 511 {
					runs = append(runs, r)
					continue
				}
				cb := int(page[b])
				start := b + 1
				size := 2*cb - 1
				if cb == 0 {
					if b+1 >= 511 {
						continue
					}
					size = 2 * int(page[b+1])
					start = b + 2
				}
				if size < 2 || start+size > 512 {
					runs = append(runs, r)
					continue
				}
				r.istd = int(le.Uint16(page[start:]))
				r.grpprl = page[start+2 : start+size]
			} else {
				b := int(page[4*(crun+1)+k]) * 2
				if b != 0 && b < 511 {
					cb := int(page[b])
					if b+1+cb <= 512 {
						r.grpprl = page[b+1 : b+1+cb]
					}
				}
			}
			runs = append(runs, r)
		}
	}
	sort.SliceStable(runs, func(i, j int) bool { return runs[i].fcStart < runs[j].fcStart })
	return runs
}

// runAt finds the run covering fc (-1 when none does)
func runAt(runs []fkpRun, fc int) int {
	i := sort.Search(len(runs), func(i int) bool { return runs[i].fcEnd > fc })
	if i < len(runs) && runs[i].fcStart <= fc {
		return i
	}
	return -1
}
