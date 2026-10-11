package doc

/*
	story.go - turn a CP range (the main text, a footnote, a header, a text
	box) into paragraphs and formatted runs (LibreOffice: the text loop of
	SwWW8ImplReader::ReadText in ww8par.cxx).

	A paragraph ends at a paragraph mark (0x0D), at a cell mark (0x07)
	when its properties put it in a table, or at a section mark (0x0C)
	that ends a section. Its properties come from the PAPX of the FC of
	that last character; the runs inside it from the CHPX runs, cut
	wherever a piece or a CHPX run ends.
*/

import "encoding/binary"

type run struct {
	cpStart, cpEnd int
	c              *chp
}

type para struct {
	cpStart, cpEnd int // the end mark included
	end            uint16
	istd           int
	p              *pap
	runs           []run
	mark           *chp // the paragraph mark's own formatting
}

// depth is the table nesting depth of the paragraph (0 = body text)
func (pg *para) depth() int {
	if !pg.p.inTable {
		return 0
	}
	if pg.p.itap > maxTableDepth {
		return maxTableDepth // a damaged file: Word nests far less deep
	}
	if pg.p.itap > 0 {
		return pg.p.itap
	}
	return 1
}

// maxTableDepth bounds table nesting (and so the writer's recursion)
const maxTableDepth = 64

// isRowEnd reports the paragraph that closes a table row at depth d
func (pg *para) isRowEnd(d int) bool {
	if d <= 1 {
		return pg.p.ttp && pg.depth() <= 1
	}
	return pg.p.innerTtp && pg.depth() == d
}

// isCellEnd reports the paragraph that closes a cell at depth d
func (pg *para) isCellEnd(d int) bool {
	if d <= 1 {
		return pg.end == 0x07 && pg.depth() <= 1
	}
	return pg.p.innerCell && pg.depth() == d
}

// papAt resolves the paragraph properties for the paragraph whose end
// mark is at cp
func (d *docFile) papAt(cp int) (int, *pap) {
	p := newPap()
	istd := 0
	fc := fcOf(d.pieces, cp)
	if i := runAt(d.papx, fc); i >= 0 {
		r := d.papx[i]
		istd = r.istd
		eachSprm(r.grpprl, p.apply)
		if p.hugePapx >= 0 {
			// the real property list is in the Data stream
			if off := p.hugePapx; off+2 <= len(d.data) {
				n := int(binary.LittleEndian.Uint16(d.data[off:]))
				if off+2+n <= len(d.data) {
					huge := newPap()
					eachSprm(d.data[off+2:off+2+n], huge.apply)
					huge.hugePapx = -1
					p = huge
				}
			}
		}
	}
	// piece-level properties
	if pi := pieceAt(d.pieces, cp); pi >= 0 {
		d.pieceSprms(d.pieces[pi].prm, p.apply)
	}
	return istd, p
}

// pieceSprms applies the property group a piece's Prm points at
func (d *docFile) pieceSprms(prm uint16, fn func(uint16, []byte)) {
	if prm&1 == 0 {
		return // Prm0: a single, rarely used modifier from a fixed table
	}
	i := int(prm >> 1)
	if i < len(d.prc) {
		eachSprm(d.prc[i], fn)
	}
}

// chpRuns splits [cp1, cp2) into runs of uniform character formatting
func (d *docFile) chpRuns(cp1, cp2 int) []run {
	var out []run
	cp := cp1
	for cp < cp2 {
		pi := pieceAt(d.pieces, cp)
		if pi < 0 {
			out = append(out, run{cpStart: cp, cpEnd: cp2, c: newChp()})
			break
		}
		pc := d.pieces[pi]
		segEnd := pc.cpEnd
		if segEnd > cp2 {
			segEnd = cp2
		}
		width := 2
		if pc.compressed {
			width = 1
		}
		for cp < segEnd {
			fc := pc.fc + (cp-pc.cpStart)*width
			c := newChp()
			end := segEnd
			if ri := runAt(d.chpx, fc); ri >= 0 {
				r := d.chpx[ri]
				eachSprm(r.grpprl, c.apply)
				if e := pc.cpStart + (r.fcEnd-pc.fc)/width; e < end && e > cp {
					end = e
				}
			} else if next := nextRunStart(d.chpx, fc); next > fc {
				if e := pc.cpStart + (next-pc.fc)/width; e < end && e > cp {
					end = e
				}
			}
			d.pieceSprms(pc.prm, c.apply)
			out = append(out, run{cpStart: cp, cpEnd: end, c: c})
			cp = end
		}
	}
	return out
}

// nextRunStart is the start of the first run after fc (-1 when none)
func nextRunStart(runs []fkpRun, fc int) int {
	lo, hi := 0, len(runs)
	for lo < hi {
		m := (lo + hi) / 2
		if runs[m].fcStart <= fc {
			lo = m + 1
		} else {
			hi = m
		}
	}
	if lo < len(runs) {
		return runs[lo].fcStart
	}
	return -1
}

// paragraphs splits a story into paragraphs; sectionEnds holds the CPs
// right after each section mark (main text only)
func (d *docFile) paragraphs(cp1, cp2 int, sectionEnds map[int]bool) []*para {
	var out []*para
	start := cp1
	for cp := cp1; cp < cp2; cp++ {
		u := d.text[cp]
		isEnd := false
		switch u {
		case 0x0D:
			isEnd = true
		case 0x07:
			// a cell mark ends a paragraph in a table; elsewhere it is a
			// stray bell character
			_, p := d.papAt(cp)
			isEnd = p.inTable
		case 0x0C:
			isEnd = sectionEnds[cp+1]
		}
		if !isEnd && cp != cp2-1 {
			continue
		}
		pg := &para{cpStart: start, cpEnd: cp + 1, end: u}
		pg.istd, pg.p = d.papAt(cp)
		if pg.cpEnd-1 > pg.cpStart {
			pg.runs = d.chpRuns(pg.cpStart, pg.cpEnd-1)
		}
		if mr := d.chpRuns(cp, cp+1); len(mr) > 0 {
			pg.mark = mr[0].c
		}
		if !isEnd {
			// a story that does not end with a mark: its last character
			// is text
			pg.end = 0
			pg.runs = d.chpRuns(pg.cpStart, pg.cpEnd)
		}
		out = append(out, pg)
		start = cp + 1
	}
	return out
}
