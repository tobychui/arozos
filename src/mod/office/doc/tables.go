package doc

/*
	tables.go - tables (LibreOffice: WW8TabDesc in ww8par2.cxx).

	Word 97 has no table container: a table is a run of paragraphs marked
	"in table". Each cell's last paragraph ends with a cell mark (0x07),
	and every row ends with an extra paragraph, the TTP, whose properties
	hold the row's TAP - its cell edges, merges, borders and shading. A
	nested table works the same way one level down, with the depth in
	sprmPItap and its own cell / row end flags. The grid of a w:tbl is the
	union of every row's cell edges.
*/

import (
	"sort"
	"strings"
)

type tableRow struct {
	cells [][]*para // the paragraphs of each cell (nested rows inside)
	tap   *tap
}

// collectTable gathers the rows of the table at depth d starting at
// paras[i]; it returns them and the index after the table
func collectTable(paras []*para, i, d int) ([]*tableRow, int) {
	var rows []*tableRow
	row := &tableRow{}
	var cell []*para
	for i < len(paras) && paras[i].depth() >= d {
		pg := paras[i]
		if pg.depth() == d && pg.isRowEnd(d) {
			if len(cell) > 0 {
				row.cells = append(row.cells, cell)
				cell = nil
			}
			row.tap = pg.p.tap
			if row.tap == nil {
				row.tap = newTap()
			}
			rows = append(rows, row)
			row = &tableRow{}
			i++
			continue
		}
		cell = append(cell, pg)
		if pg.depth() == d && pg.isCellEnd(d) {
			row.cells = append(row.cells, cell)
			cell = nil
		}
		i++
	}
	// a table cut short (no closing TTP): keep what there is
	if len(cell) > 0 {
		row.cells = append(row.cells, cell)
	}
	if len(row.cells) > 0 {
		row.tap = newTap()
		rows = append(rows, row)
	}
	return rows, i
}

// tableXML writes a table at depth d
func (w *writer) tableXML(rows []*tableRow, d int, st *storyState) string {
	// the grid: every cell edge of every row
	edgeSet := map[int]bool{}
	for _, r := range rows {
		for _, e := range r.tap.centers {
			edgeSet[e] = true
		}
	}
	var edges []int
	for e := range edgeSet {
		edges = append(edges, e)
	}
	sort.Ints(edges)
	colOf := func(e int) int { return sort.SearchInts(edges, e) }

	var sb strings.Builder
	sb.WriteString("<w:tbl><w:tblPr>")
	first := rows[0].tap
	switch first.widthFts {
	case 2:
		sb.WriteString(`<w:tblW w:w="` + itoa(first.width) + `" w:type="pct"/>`)
	case 3:
		sb.WriteString(`<w:tblW w:w="` + itoa(first.width) + `" w:type="dxa"/>`)
	default:
		sb.WriteString(`<w:tblW w:w="0" w:type="auto"/>`)
	}
	switch first.jc {
	case 1:
		sb.WriteString(`<w:jc w:val="center"/>`)
	case 2:
		sb.WriteString(`<w:jc w:val="right"/>`)
	}
	if len(first.centers) > 0 {
		sb.WriteString(`<w:tblInd w:w="` + itoa(first.centers[0]+first.gapHalf) + `" w:type="dxa"/>`)
	}
	var bd strings.Builder
	for i, tag := range []string{"top", "left", "bottom", "right", "insideH", "insideV"} {
		bd.WriteString(borderXML(tag, first.borders[i]))
	}
	if bd.Len() > 0 {
		sb.WriteString("<w:tblBorders>" + bd.String() + "</w:tblBorders>")
	}
	sb.WriteString(`<w:tblLayout w:type="fixed"/>`)
	pad := first.padding
	gap := first.gapHalf
	sb.WriteString("<w:tblCellMar>")
	for i, tag := range []string{"top", "left", "bottom", "right"} {
		v := pad[i]
		if v < 0 {
			v = 0
			if i == 1 || i == 3 {
				v = gap
			}
		}
		sb.WriteString(`<w:` + tag + ` w:w="` + itoa(v) + `" w:type="dxa"/>`)
	}
	sb.WriteString("</w:tblCellMar>")
	sb.WriteString(`<w:tblLook w:val="0000"/></w:tblPr><w:tblGrid>`)
	for k := 0; k+1 < len(edges); k++ {
		sb.WriteString(`<w:gridCol w:w="` + itoa(edges[k+1]-edges[k]) + `"/>`)
	}
	if len(edges) < 2 {
		sb.WriteString(`<w:gridCol w:w="2000"/>`)
	}
	sb.WriteString("</w:tblGrid>")

	for _, r := range rows {
		t := r.tap
		sb.WriteString("<w:tr>")
		var trPr strings.Builder
		if len(t.centers) > 0 && len(edges) > 0 {
			if before := colOf(t.centers[0]); before > 0 {
				trPr.WriteString(`<w:gridBefore w:val="` + itoa(before) + `"/>`)
			}
		}
		if t.cantSplit {
			trPr.WriteString(`<w:cantSplit/>`)
		}
		if t.rowHeight > 0 {
			trPr.WriteString(`<w:trHeight w:val="` + itoa(t.rowHeight) + `" w:hRule="atLeast"/>`)
		} else if t.rowHeight < 0 {
			trPr.WriteString(`<w:trHeight w:val="` + itoa(-t.rowHeight) + `" w:hRule="exact"/>`)
		}
		if t.header {
			trPr.WriteString(`<w:tblHeader/>`)
		}
		if trPr.Len() > 0 {
			sb.WriteString("<w:trPr>" + trPr.String() + "</w:trPr>")
		}
		for ci := 0; ci < len(r.cells); ci++ {
			var c tc
			if ci < len(t.cells) {
				c = t.cells[ci]
			}
			if c.merged {
				continue // merged into the cell before it
			}
			span := 1
			width := 0
			if ci+1 < len(t.centers) {
				end := ci + 1
				for end < len(t.cells) && end < len(r.cells) && t.cells[end].merged {
					end++
				}
				if end < len(t.centers) {
					width = t.centers[end] - t.centers[ci]
					span = colOf(t.centers[end]) - colOf(t.centers[ci])
				}
			}
			sb.WriteString("<w:tc><w:tcPr>")
			sb.WriteString(`<w:tcW w:w="` + itoa(width) + `" w:type="dxa"/>`)
			if span > 1 {
				sb.WriteString(`<w:gridSpan w:val="` + itoa(span) + `"/>`)
			}
			switch {
			case c.vertRestart:
				sb.WriteString(`<w:vMerge w:val="restart"/>`)
			case c.vertMerge:
				sb.WriteString(`<w:vMerge/>`)
			}
			var cb strings.Builder
			for k, tag := range []string{"top", "left", "bottom", "right"} {
				if b := c.borders[k]; b != nil && b.typ != 0 && b.typ != 0xFF {
					cb.WriteString(borderXML(tag, b))
				}
			}
			if cb.Len() > 0 {
				sb.WriteString("<w:tcBorders>" + cb.String() + "</w:tcBorders>")
			}
			if ci < len(t.shades) {
				sb.WriteString(shdXML(t.shades[ci]))
			}
			switch c.vAlign {
			case 1:
				sb.WriteString(`<w:vAlign w:val="center"/>`)
			case 2:
				sb.WriteString(`<w:vAlign w:val="bottom"/>`)
			}
			sb.WriteString("</w:tcPr>")
			content := w.blocksXML(r.cells[ci], d, st, nil)
			if !strings.Contains(content, "<w:p>") && !strings.Contains(content, "<w:p ") {
				content += "<w:p/>"
			}
			sb.WriteString(content)
			sb.WriteString("</w:tc>")
		}
		sb.WriteString("</w:tr>")
	}
	sb.WriteString("</w:tbl>")
	return sb.String()
}

// blocksXML writes paragraphs and the tables among them. level is the
// table depth of the text being written (0 for body text, d for the
// content of a depth d cell): a paragraph deeper than that starts a
// table one level down. sectPr maps a paragraph to the section it closes.
func (w *writer) blocksXML(paras []*para, level int, st *storyState, sectPr map[*para]string) string {
	var sb strings.Builder
	for i := 0; i < len(paras); {
		pg := paras[i]
		if pg.depth() > level {
			rows, next := collectTable(paras, i, level+1)
			if len(rows) == 0 || next <= i {
				sb.WriteString(w.paraXML(pg, st, sectPr[pg]))
				i++
				continue
			}
			sb.WriteString(w.tableXML(rows, level+1, st))
			// a section can end inside a table: Word then puts the break
			// in an empty paragraph after it
			for k := i; k < next; k++ {
				if s := sectPr[paras[k]]; s != "" {
					sb.WriteString("<w:p><w:pPr>" + s + "</w:pPr></w:p>")
				}
			}
			i = next
			continue
		}
		sb.WriteString(w.paraXML(pg, st, sectPr[pg]))
		i++
	}
	return sb.String()
}
