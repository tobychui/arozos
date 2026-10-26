package office

/*
	ods_reader.go - Parse an OpenDocument Spreadsheet (.ods) into a Workbook.

	Handles values / strings / booleans, formulas (translated from the ODF
	"of:=" syntax back to plain A1 references), cell styles, column widths,
	row heights, merges (column/row spans), repeated columns/rows/cells
	(capped, like the xlsx reader) and cell notes (office:annotation).
*/

import (
	"errors"
	"strconv"
	"strings"
)

// ParseOds converts raw .ods bytes into a Workbook
func ParseOds(data []byte) (*Workbook, error) {
	files, mime, err := readOdfZip(data)
	if err != nil {
		return nil, err
	}
	if mime != "" && mime != odsMime {
		return nil, errors.New("not an OpenDocument spreadsheet (mimetype " + mime + ")")
	}
	content, ok := files["content.xml"]
	if !ok {
		return nil, errors.New("ods is missing content.xml")
	}
	tree, err := parseOdfXML(content)
	if err != nil {
		return nil, errors.New("cannot parse content.xml: " + err.Error())
	}
	root := tree.first("document-content")
	if root == nil {
		return nil, errors.New("content.xml has no document-content root")
	}

	// automatic styles
	cellStyles := map[string]*CellStyle{}
	colWidths := map[string]float64{}
	rowHeights := map[string]float64{}
	if auto := root.first("automatic-styles"); auto != nil {
		for _, st := range auto.all("style") {
			name := st.attr("name")
			if name == "" {
				continue
			}
			switch st.attr("family") {
			case "table-cell":
				cs := &CellStyle{}
				any := false
				if tp := st.first("text-properties"); tp != nil {
					if tp.attr("font-weight") == "bold" {
						cs.B = true
						any = true
					}
					if tp.attr("font-style") == "italic" {
						cs.I = true
						any = true
					}
					if v := tp.attr("text-underline-style"); v != "" && v != "none" {
						cs.U = true
						any = true
					}
					if c := tp.attr("color"); strings.HasPrefix(c, "#") && strings.ToLower(c) != "#000000" {
						cs.Fc = strings.ToLower(c)
						any = true
					}
					if fs := tp.attr("font-size"); strings.HasSuffix(fs, "pt") {
						if px := odfLenToPx(fs); px > 0 {
							cs.Fs = px
							any = true
						}
					}
				}
				if cp := st.first("table-cell-properties"); cp != nil {
					if bg := cp.attr("background-color"); strings.HasPrefix(bg, "#") {
						cs.Bg = strings.ToLower(bg)
						any = true
					}
					if bd := cp.attr("border"); bd != "" && bd != "none" {
						cs.Bd = 1
						any = true
					}
				}
				if pp := st.first("paragraph-properties"); pp != nil {
					switch pp.attr("text-align") {
					case "center":
						cs.Al = "c"
						any = true
					case "end", "right":
						cs.Al = "r"
						any = true
					case "start", "left":
						cs.Al = "l"
						any = true
					}
				}
				if any {
					cellStyles[name] = cs
				}
			case "table-column":
				if cp := st.first("table-column-properties"); cp != nil {
					if px := odfLenToPx(cp.attr("column-width")); px > 0 {
						colWidths[name] = px
					}
				}
			case "table-row":
				if rp := st.first("table-row-properties"); rp != nil {
					if px := odfLenToPx(rp.attr("row-height")); px > 0 {
						rowHeights[name] = px
					}
				}
			}
		}
	}

	ss := root.path("body", "spreadsheet")
	if ss == nil {
		return nil, errors.New("ods has no spreadsheet body")
	}
	wb := &Workbook{Sheets: []*WorkSheet{}, Active: 0}
	for _, tbl := range ss.all("table") {
		ws := &WorkSheet{
			Name:  tbl.attr("name"),
			Cells: map[string]*WorkCell{},
			ColW:  map[string]float64{},
			RowH:  map[string]float64{},
		}
		ci := 0
		for _, col := range tbl.all("table-column") {
			rep := repeatOf(col.attr("number-columns-repeated"), 64)
			w, hasW := colWidths[col.attr("style-name")]
			for i := 0; i < rep && ci < 256; i++ {
				if hasW && absF(w-xlsxDefColPx) > 1 {
					ws.ColW[strconv.Itoa(ci)] = float64(int(w))
				}
				ci++
			}
		}
		maxCol, maxRow := 0, 0
		ri := 0
		for _, row := range tbl.all("table-row") {
			rowRep := repeatOf(row.attr("number-rows-repeated"), 1024)
			if !odsRowHasContent(row) {
				ri += rowRep
				continue
			}
			if rowRep > 32 {
				rowRep = 32
			}
			for k := 0; k < rowRep; k++ {
				if h, ok := rowHeights[row.attr("style-name")]; ok && absF(h-xlsxDefRowPx) > 1 {
					ws.RowH[strconv.Itoa(ri)] = float64(int(h))
				}
				ci = 0
				for _, c := range row.children {
					if c.el == nil {
						continue
					}
					cn := c.el
					isCovered := cn.name == "covered-table-cell"
					if cn.name != "table-cell" && !isCovered {
						continue
					}
					rep := repeatOf(cn.attr("number-columns-repeated"), 256)
					if isCovered {
						ci += rep
						continue
					}
					for j := 0; j < rep && ci < 1024; j++ {
						cell := odsCellOf(cn, cellStyles)
						if cell != nil {
							ws.Cells[cellRef(ci, ri)] = cell
							if ci > maxCol {
								maxCol = ci
							}
							if ri > maxRow {
								maxRow = ri
							}
						}
						if j == 0 {
							cs := repeatOf(cn.attr("number-columns-spanned"), 256)
							rs := repeatOf(cn.attr("number-rows-spanned"), 1024)
							if cs > 1 || rs > 1 {
								ws.Merges = append(ws.Merges,
									cellRef(ci, ri)+":"+cellRef(ci+cs-1, ri+rs-1))
								if ri+rs-1 > maxRow {
									maxRow = ri + rs - 1
								}
							}
						}
						ci++
					}
				}
				ri++
			}
		}
		ws.Cols = maxCol + 6
		if ws.Cols < 26 {
			ws.Cols = 26
		}
		ws.Rows = maxRow + 21
		if ws.Rows < 200 {
			ws.Rows = 200
		}
		wb.Sheets = append(wb.Sheets, ws)
	}
	if len(wb.Sheets) == 0 {
		return nil, errors.New("no sheets found in ods")
	}
	return wb, nil
}

func repeatOf(s string, max int) int {
	n := atoiSafe(s)
	if n < 1 {
		return 1
	}
	if n > max {
		return max
	}
	return n
}

// content = a value, a formula, a span (merge anchor) or an annotation
func odsRowHasContent(row *onode) bool {
	for _, c := range row.children {
		if c.el == nil || c.el.name != "table-cell" {
			continue
		}
		cn := c.el
		if cn.attr("formula") != "" || cn.attr("value-type") != "" ||
			cn.attr("number-columns-spanned") != "" ||
			cn.attr("number-rows-spanned") != "" || len(cn.children) > 0 {
			return true
		}
	}
	return false
}

// odsCellOf converts one table:table-cell to a WorkCell (nil when empty)
func odsCellOf(cn *onode, styles map[string]*CellStyle) *WorkCell {
	v := ""
	if f := cn.attr("formula"); f != "" {
		v = formulaFromOdf(f)
	} else {
		switch cn.attr("value-type") {
		case "float", "currency", "percentage":
			v = cn.attr("value")
		case "boolean":
			if cn.attr("boolean-value") == "true" {
				v = "TRUE"
			} else {
				v = "FALSE"
			}
		default:
			var texts []string
			for _, p := range cn.all("p") {
				texts = append(texts, p.allText())
			}
			v = textAsRaw(strings.Join(texts, "\n"))
		}
	}
	note := ""
	if an := cn.first("annotation"); an != nil {
		note = strings.TrimSpace(an.allText())
	}
	var st *CellStyle
	if cs, ok := styles[cn.attr("style-name")]; ok {
		cp := *cs
		st = &cp
	}
	if v == "" && st == nil && note == "" {
		return nil
	}
	return &WorkCell{V: v, S: st, N: note}
}
