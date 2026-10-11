package xls

/*
	sheet.go - one worksheet substream.

	Cells come as one record each (NUMBER, RK, LABELSST, BOOLERR,
	FORMULA, BLANK) or several to a record (MULRK, MULBLANK). A formula
	that is copied down a range is stored once (SHRFMLA, with references
	relative to the cell using it) and every copy holds only a pointer to
	its first cell (ptgExp); array formulas (ARRAY) work the same way.
	Since the shared record follows the first FORMULA record, formulas are
	collected first and decompiled once the whole sheet has been read.

	Comments are NOTE records naming a drawing object whose text is in the
	TXO record after that object's OBJ; an embedded chart is a whole
	BOF..EOF substream inside the sheet and is skipped.
*/

import (
	"encoding/binary"
	"math"
	"strconv"
	"strings"
	"unicode/utf16"
)

type cellKind uint8

const (
	ckBlank cellKind = iota
	ckNumber
	ckString
	ckBool
	ckError
)

type cell struct {
	row, col int
	xf       int
	kind     cellKind // the value, or a formula's cached result
	num      float64
	str      string
	bval     bool
	errc     byte
	formula  string // without the leading "="
	array    string // the range of an array formula, on its first cell
	link     string // a hyperlink on the cell
}

type colInfo struct {
	first, last int
	width       float64 // characters
	hidden      bool
	xf          int
	custom      bool
}

type rowInfo struct {
	height float64 // points
	custom bool
	hidden bool
	xf     int
	hasXF  bool
}

type note struct {
	row, col int
	author   string
	text     string
}

type sheet struct {
	name         string
	cells        map[int]*cell // row*256 + col
	rows         map[int]*rowInfo
	cols         []colInfo
	merges       [][4]int // r1, c1, r2, c2
	frozenR      int
	frozenC      int
	selected     bool
	tabColor     string // "rrggbb"
	notes        []note
	defColWidth  float64 // characters
	defRowHeight float64 // points
	maxRow       int
	maxCol       int
}

func cellKey(row, col int) int { return row*256 + col }

// pending formula: tokens kept until the shared / array records are known
type pendingFormula struct {
	c          *cell
	rgce, rgcb []byte
}

type sharedRec struct {
	r1, r2, c1, c2 int
	rgce, rgcb     []byte
	array          bool
}

// rk decodes an RK number: a 30-bit integer or the top 30 bits of a
// double, optionally divided by 100
func rk(v uint32) float64 {
	var f float64
	if v&0x02 != 0 {
		f = float64(int32(v) >> 2)
	} else {
		f = math.Float64frombits(uint64(v&0xFFFFFFFC) << 32)
	}
	if v&0x01 != 0 {
		f /= 100
	}
	return f
}

// parseSheet reads the substream whose BOF starts at records[start]
func (b *book) parseSheet(start int, name string) *sheet {
	s := &sheet{name: name, cells: map[int]*cell{}, rows: map[int]*rowInfo{}, defRowHeight: 15}
	le := binary.LittleEndian
	var pending []pendingFormula
	shared := map[int]*sharedRec{}
	var lastFormula *cell // waiting for its STRING record
	objText := map[int]string{}
	lastObj := -1
	var notes []struct {
		row, col, obj int
		author        string
	}
	setCell := func(c *cell) {
		if c.row < 0 || c.col < 0 || c.col > 255 || c.row >= b.maxRows() {
			return
		}
		s.cells[cellKey(c.row, c.col)] = c
		if c.row > s.maxRow {
			s.maxRow = c.row
		}
		if c.col > s.maxCol {
			s.maxCol = c.col
		}
	}
	depth := 0
	for i := start; i < len(b.records); i++ {
		r := b.records[i]
		d := r.data
		rd := newReader(r)
		if i > start && r.typ == rtBOF {
			depth++ // an embedded chart
			continue
		}
		if r.typ == rtEOF {
			if depth == 0 {
				break
			}
			depth--
			continue
		}
		if depth > 0 {
			continue
		}
		switch r.typ {
		case rtNumber:
			if len(d) >= 14 {
				setCell(&cell{row: int(le.Uint16(d)), col: int(le.Uint16(d[2:])), xf: int(le.Uint16(d[4:])),
					kind: ckNumber, num: math.Float64frombits(le.Uint64(d[6:]))})
			}
		case rtRK:
			if len(d) >= 10 {
				setCell(&cell{row: int(le.Uint16(d)), col: int(le.Uint16(d[2:])), xf: int(le.Uint16(d[4:])),
					kind: ckNumber, num: rk(le.Uint32(d[6:]))})
			}
		case rtMulRk:
			if len(d) >= 6 {
				row := int(le.Uint16(d))
				col := int(le.Uint16(d[2:]))
				for p := 4; p+6 <= len(d)-2; p += 6 {
					setCell(&cell{row: row, col: col, xf: int(le.Uint16(d[p:])), kind: ckNumber, num: rk(le.Uint32(d[p+2:]))})
					col++
				}
			}
		case rtLabelSST:
			if len(d) >= 10 {
				idx := int(le.Uint32(d[6:]))
				str := ""
				if idx >= 0 && idx < len(b.sst) {
					str = b.sst[idx]
				}
				setCell(&cell{row: int(le.Uint16(d)), col: int(le.Uint16(d[2:])), xf: int(le.Uint16(d[4:])), kind: ckString, str: str})
			}
		case rtLabel, rtRString:
			c := &cell{row: int(rd.u16()), col: int(rd.u16()), xf: int(rd.u16()), kind: ckString}
			if b.biff8 {
				c.str = rd.xlString()
			} else {
				c.str = rd.byteString(int(rd.u16()), b.cp)
			}
			if rd.err == nil {
				setCell(c)
			}
		case rtBoolErr:
			if len(d) >= 8 {
				c := &cell{row: int(le.Uint16(d)), col: int(le.Uint16(d[2:])), xf: int(le.Uint16(d[4:]))}
				if d[7] != 0 {
					c.kind, c.errc = ckError, d[6]
				} else {
					c.kind, c.bval = ckBool, d[6] != 0
				}
				setCell(c)
			}
		case rtBlank:
			if len(d) >= 6 {
				setCell(&cell{row: int(le.Uint16(d)), col: int(le.Uint16(d[2:])), xf: int(le.Uint16(d[4:]))})
			}
		case rtMulBlank:
			if len(d) >= 6 {
				row := int(le.Uint16(d))
				col := int(le.Uint16(d[2:]))
				for p := 4; p+2 <= len(d)-2; p += 2 {
					setCell(&cell{row: row, col: col, xf: int(le.Uint16(d[p:]))})
					col++
				}
			}
		case rtFormula, rtFormula4:
			if len(d) < 22 {
				continue
			}
			c := &cell{row: int(le.Uint16(d)), col: int(le.Uint16(d[2:])), xf: int(le.Uint16(d[4:]))}
			val := d[6:14]
			if val[6] == 0xFF && val[7] == 0xFF {
				switch val[0] {
				case 0:
					c.kind = ckString
					lastFormula = c
				case 1:
					c.kind, c.bval = ckBool, val[2] != 0
				case 2:
					c.kind, c.errc = ckError, val[2]
				case 3:
					c.kind, c.str = ckString, ""
				}
			} else {
				c.kind, c.num = ckNumber, math.Float64frombits(le.Uint64(val))
			}
			cce := int(le.Uint16(d[20:]))
			if 22+cce <= len(d) {
				pending = append(pending, pendingFormula{c: c, rgce: d[22 : 22+cce], rgcb: d[22+cce:]})
			}
			setCell(c)
		case rtString:
			if lastFormula != nil {
				if b.biff8 {
					lastFormula.str = rd.xlString()
				} else {
					lastFormula.str = rd.byteString(int(rd.u16()), b.cp)
				}
			}
			lastFormula = nil
		case rtShrFmla, rtArray:
			if len(d) < 6 {
				continue
			}
			sr := &sharedRec{r1: int(le.Uint16(d)), r2: int(le.Uint16(d[2:])), c1: int(d[4]), c2: int(d[5]), array: r.typ == rtArray}
			off := 8 // RefU + reserved + cUse
			if r.typ == rtArray {
				off = 12 // RefU + grbit + chn
			}
			if off+2 > len(d) {
				continue
			}
			cce := int(le.Uint16(d[off:]))
			if off+2+cce > len(d) {
				continue
			}
			sr.rgce = d[off+2 : off+2+cce]
			sr.rgcb = d[off+2+cce:]
			shared[cellKey(sr.r1, sr.c1)] = sr
		case rtRow:
			if len(d) >= 16 {
				row := int(le.Uint16(d))
				ri := &rowInfo{height: float64(le.Uint16(d[6:])&0x7FFF) / 20}
				fl := le.Uint16(d[12:])
				ri.hidden = fl&0x20 != 0
				ri.custom = fl&0x40 != 0
				if fl&0x80 != 0 {
					ri.hasXF = true
					ri.xf = int(le.Uint16(d[14:]) & 0x0FFF)
				}
				s.rows[row] = ri
			}
		case rtColInfo:
			if len(d) >= 10 {
				ci := colInfo{first: int(le.Uint16(d)), last: int(le.Uint16(d[2:])), width: float64(le.Uint16(d[4:])) / 256,
					xf: int(le.Uint16(d[6:]))}
				fl := le.Uint16(d[8:])
				ci.hidden = fl&0x01 != 0
				ci.custom = fl&0x02 != 0
				if ci.last > 255 {
					ci.last = 255
				}
				if ci.first <= ci.last {
					s.cols = append(s.cols, ci)
				}
			}
		case rtDefColWidth:
			if len(d) >= 2 {
				s.defColWidth = float64(le.Uint16(d))
			}
		case rtStandardWidth:
			if len(d) >= 2 {
				s.defColWidth = float64(le.Uint16(d)) / 256
			}
		case rtDefaultRowHgt:
			if len(d) >= 4 {
				if h := float64(le.Uint16(d[2:])) / 20; h > 0 {
					s.defRowHeight = h
				}
			}
		case rtMergeCells:
			n := int(rd.u16())
			for k := 0; k < n && rd.left() >= 8; k++ {
				r1, r2, c1, c2 := int(rd.u16()), int(rd.u16()), int(rd.u16()), int(rd.u16())
				s.merges = append(s.merges, [4]int{r1, c1, r2, c2})
			}
		case rtWindow2:
			if len(d) >= 2 {
				g := le.Uint16(d)
				s.selected = g&0x0200 != 0
				if g&0x0008 == 0 {
					s.frozenR, s.frozenC = -1, -1 // not frozen: PANE is a split
				}
			}
		case rtPane:
			if len(d) >= 4 && s.frozenR >= 0 {
				s.frozenC = int(le.Uint16(d))
				s.frozenR = int(le.Uint16(d[2:]))
			}
		case rtHLink:
			b.parseHLink(s, r)
		case rtObj:
			// FtCmo: ft, cb, ot, id
			if len(d) >= 8 && le.Uint16(d) == 0x15 {
				lastObj = int(le.Uint16(d[6:]))
			}
		case rtTxo:
			if lastObj >= 0 && len(r.conts) > 0 && len(d) >= 14 {
				cch := int(le.Uint16(d[10:]))
				tr := &reader{b: d, conts: r.conts, pos: r.conts[0]}
				var text string
				if b.biff8 {
					text = tr.noCchString(cch)
				} else {
					text = tr.byteString(cch, b.cp)
				}
				objText[lastObj] = strings.ReplaceAll(text, "\r\n", "\n")
			}
		case rtNote:
			if b.biff8 {
				if len(d) >= 8 {
					n := struct {
						row, col, obj int
						author        string
					}{row: int(rd.u16()), col: int(rd.u16())}
					rd.u16()
					n.obj = int(rd.u16())
					n.author = rd.xlString()
					notes = append(notes, n)
				}
			} else if len(d) >= 6 {
				row, col := int(rd.u16()), int(rd.u16())
				cch := int(rd.u16())
				text := rd.byteString(cch, b.cp)
				if row == 0xFFFF && len(s.notes) > 0 {
					s.notes[len(s.notes)-1].text += text
				} else {
					s.notes = append(s.notes, note{row: row, col: col, text: text})
				}
			}
		case rtSheetExt:
			b.parseSheetExt(s, d)
		}
	}
	if s.frozenR < 0 {
		s.frozenR, s.frozenC = 0, 0
	}
	for _, n := range notes {
		if t, ok := objText[n.obj]; ok {
			s.notes = append(s.notes, note{row: n.row, col: n.col, author: n.author, text: t})
		}
	}

	// decompile the formulas now that shared and array records are known
	for _, pf := range pending {
		c := pf.c
		if len(pf.rgce) == 5 && pf.rgce[0] == 0x01 {
			ar := int(le.Uint16(pf.rgce[1:]))
			ac := int(le.Uint16(pf.rgce[3:]))
			sr, ok := shared[cellKey(ar, ac)]
			if !ok {
				continue
			}
			if sr.array {
				if c.row == sr.r1 && c.col == sr.c1 {
					if f, err := b.decompile(sr.rgce, sr.rgcb, c.row, c.col); err == nil {
						c.formula = f
						c.array = cellText(sr.r1, sr.c1, true, true)
						if sr.r2 != sr.r1 || sr.c2 != sr.c1 {
							c.array += ":" + cellText(sr.r2, sr.c2, true, true)
						}
					}
				}
				continue
			}
			if f, err := b.decompile(sr.rgce, sr.rgcb, c.row, c.col); err == nil {
				c.formula = f
			}
			continue
		}
		if len(pf.rgce) > 0 && pf.rgce[0] == 0x02 {
			continue // a data table cell keeps its value
		}
		if f, err := b.decompile(pf.rgce, pf.rgcb, c.row, c.col); err == nil {
			c.formula = f
		}
	}
	return s
}

// parseHLink reads a hyperlink: a URL or file moniker, and/or a location
// inside the workbook
func (b *book) parseHLink(s *sheet, r *record) {
	d := r.data
	le := binary.LittleEndian
	if len(d) < 32 {
		return
	}
	r1, r2 := int(le.Uint16(d)), int(le.Uint16(d[2:]))
	c1, c2 := int(le.Uint16(d[4:])), int(le.Uint16(d[6:]))
	p := 8 + 16 + 4 // ref, CLSID, version
	flags := le.Uint32(d[p:])
	p += 4
	hstr := func() string {
		if p+4 > len(d) {
			p = len(d)
			return ""
		}
		n := int(le.Uint32(d[p:]))
		p += 4
		// against the bytes left: 2*n overflows a 32-bit int
		if n < 0 || n > (len(d)-p)/2 {
			p = len(d)
			return ""
		}
		u := make([]uint16, 0, n)
		for i := 0; i < n; i++ {
			ch := le.Uint16(d[p+2*i:])
			if ch == 0 {
				break
			}
			u = append(u, ch)
		}
		p += 2 * n
		return string(utf16.Decode(u))
	}
	if flags&0x10 != 0 { // display name
		hstr()
	}
	if flags&0x80 != 0 { // target frame
		hstr()
	}
	url := ""
	if flags&0x01 != 0 {
		if flags&0x100 != 0 {
			url = hstr()
		} else if p+16 <= len(d) {
			clsid := d[p : p+16]
			p += 16
			switch {
			case clsid[0] == 0xE0 && clsid[1] == 0xC9 && clsid[2] == 0xEA && clsid[3] == 0x79: // URL moniker
				if p+4 <= len(d) {
					n := int(le.Uint32(d[p:]))
					p += 4
					if n >= 0 && n <= len(d)-p {
						u := make([]uint16, 0, n/2)
						for i := 0; i+1 < n; i += 2 {
							ch := le.Uint16(d[p+i:])
							if ch == 0 {
								break
							}
							u = append(u, ch)
						}
						url = string(utf16.Decode(u))
						p += n
					}
				}
			case clsid[0] == 0x03 && clsid[1] == 0x03 && clsid[2] == 0 && clsid[3] == 0: // file moniker
				if p+6 <= len(d) {
					up := int(le.Uint16(d[p:])) // ".." count
					n := int(le.Uint32(d[p+2:]))
					p += 6
					if n >= 0 && n <= len(d)-p {
						path := strings.TrimRight(string(d[p:p+n]), "\x00")
						p += n
						url = strings.Repeat("../", up) + strings.ReplaceAll(path, `\`, "/")
						// endServer, version and reserved fields, then the
						// optional Unicode path, which wins when present
						if p+28 <= len(d) {
							p += 24
							size := int(le.Uint32(d[p:]))
							p += 4
							if size > 6 && size <= len(d)-p {
								bytesLen := int(le.Uint32(d[p:]))
								if bytesLen > 0 && bytesLen <= len(d)-p-6 {
									u := make([]uint16, bytesLen/2)
									for i := range u {
										u[i] = le.Uint16(d[p+6+2*i:])
									}
									url = strings.Repeat("../", up) + strings.ReplaceAll(string(utf16.Decode(u)), `\`, "/")
								}
								p += size
							}
						}
					}
				}
			}
		}
	}
	if flags&0x08 != 0 { // location in the workbook (or a URL fragment)
		loc := hstr()
		if loc != "" {
			if url != "" {
				url += "#" + loc
			} else {
				url = "#" + loc
			}
		}
	}
	if url == "" {
		return
	}
	for row := r1; row <= r2 && row-r1 < 1000; row++ {
		for col := c1; col <= c2 && col-c1 < 256; col++ {
			c, ok := s.cells[cellKey(row, col)]
			if !ok {
				c = &cell{row: row, col: col}
				s.cells[cellKey(row, col)] = c
			}
			c.link = url
		}
	}
}

// parseSheetExt reads the sheet tab colour (SHEETEXT, Excel 2002+)
func (b *book) parseSheetExt(s *sheet, d []byte) {
	le := binary.LittleEndian
	if len(d) < 20 {
		return
	}
	cb := le.Uint32(d[12:])
	idx := le.Uint32(d[16:]) & 0x7F
	if c, auto := b.color(uint16(idx), 0); !auto && idx != 0x7F {
		s.tabColor = hex6(c)
	}
	// the optional part carries the exact colour as RGB
	if cb >= 0x28 && len(d) >= 40 {
		xclrType := le.Uint32(d[24:])
		if xclrType == 2 {
			s.tabColor = hex6(uint32(d[28])<<16 | uint32(d[29])<<8 | uint32(d[30]))
		}
	}
}

func hex6(c uint32) string {
	s := strconv.FormatUint(uint64(c&0xFFFFFF), 16)
	return strings.Repeat("0", 6-len(s)) + s
}
