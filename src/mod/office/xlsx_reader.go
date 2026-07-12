package office

/*
	xlsx_reader.go - Parse an Excel (.xlsx) file into a Workbook.

	Handles the common SpreadsheetML subset: shared + inline strings,
	numbers, booleans, formulas, cell styles (bold/italic/underline, font
	color/size, fill, alignment, wrap), number formats (mapped back to the
	webapp's fmt names), column widths, row heights, merged cells and
	frozen panes. Bar/line/pie charts are mapped back to the webapp chart
	model (xlsx_charts.go); pivot tables and conditional formatting are
	ignored. Legacy binary .xls is rejected up front.
*/

import (
	"archive/zip"
	"bytes"
	"errors"
	"io"
	"path"
	"strconv"
	"strings"
)

// ParseXlsx converts raw .xlsx bytes into a Workbook
func ParseXlsx(data []byte) (*Workbook, error) {
	if len(data) > 8 && data[0] == 0xD0 && data[1] == 0xCF {
		return nil, errors.New("legacy binary .xls files are not supported - save the file as .xlsx first")
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, errors.New("not a valid xlsx (zip) file")
	}

	files := map[string][]byte{}
	for _, f := range zr.File {
		name := path.Clean(f.Name)
		if strings.HasSuffix(name, ".xml") || strings.HasSuffix(name, ".rels") {
			rc, err := f.Open()
			if err != nil {
				continue
			}
			b, err := io.ReadAll(rc)
			rc.Close()
			if err != nil {
				continue
			}
			files[name] = b
		}
	}

	wbXML, ok := files["xl/workbook.xml"]
	if !ok {
		return nil, errors.New("xlsx is missing xl/workbook.xml")
	}
	wbTree, err := parseXMLTree(wbXML)
	if err != nil {
		return nil, errors.New("cannot parse workbook.xml: " + err.Error())
	}

	rels := parseRels(files["xl/_rels/workbook.xml.rels"])
	shared := parseSharedStrings(files["xl/sharedStrings.xml"])
	styleMap := parseXlsxStyles(files["xl/styles.xml"])

	wb := &Workbook{Sheets: []*WorkSheet{}, Active: 0}
	chartIDSeq := 0
	if bv := wbTree.path("bookViews", "workbookView"); bv != nil {
		if at, err := strconv.Atoi(bv.attr("activeTab")); err == nil {
			wb.Active = at
		}
	}

	sheetsNode := wbTree.first("sheets")
	if sheetsNode == nil {
		return nil, errors.New("workbook has no sheets")
	}
	for _, sn := range sheetsNode.all("sheet") {
		name := sn.attr("name")
		rid := ""
		for _, a := range sn.Attrs {
			if a.Name.Local == "id" && strings.HasPrefix(a.Value, "rId") {
				rid = a.Value
			}
		}
		target, ok2 := rels[rid]
		if !ok2 {
			continue
		}
		partPath := resolvePartPath("xl", target)
		raw, ok3 := files[partPath]
		if !ok3 {
			continue
		}
		tree, err := parseXMLTree(raw)
		if err != nil {
			continue
		}
		ws := parseWorksheet(tree, shared, styleMap)
		ws.Name = name
		parseSheetDrawing(files, partPath, tree, ws, &chartIDSeq)
		parseSheetComments(files, partPath, ws)
		wb.Sheets = append(wb.Sheets, ws)
	}
	if len(wb.Sheets) == 0 {
		return nil, errors.New("no readable worksheets found in xlsx")
	}
	if wb.Active < 0 || wb.Active >= len(wb.Sheets) {
		wb.Active = 0
	}
	return wb, nil
}

/* ---------- shared strings ---------- */

func parseSharedStrings(data []byte) []string {
	if data == nil {
		return nil
	}
	tree, err := parseXMLTree(data)
	if err != nil {
		return nil
	}
	var out []string
	for _, si := range tree.all("si") {
		var texts []string
		collectText(si, &texts)
		out = append(out, strings.Join(texts, ""))
	}
	return out
}

/* ---------- styles ---------- */

type xlsxXfInfo struct {
	style *CellStyle // nil = plain
}

// parseXlsxStyles maps every cellXfs index to a webapp CellStyle
func parseXlsxStyles(data []byte) []xlsxXfInfo {
	if data == nil {
		return nil
	}
	tree, err := parseXMLTree(data)
	if err != nil {
		return nil
	}

	// custom number format codes
	numCodes := map[int]string{}
	if nf := tree.first("numFmts"); nf != nil {
		for _, n := range nf.all("numFmt") {
			if id, err := strconv.Atoi(n.attr("numFmtId")); err == nil {
				numCodes[id] = n.attr("formatCode")
			}
		}
	}

	type fontInfo struct {
		b, i, u bool
		color   string
		sizePx  float64
	}
	var fonts []fontInfo
	if fs := tree.first("fonts"); fs != nil {
		for _, f := range fs.all("font") {
			fi := fontInfo{}
			if f.first("b") != nil {
				fi.b = true
			}
			if f.first("i") != nil {
				fi.i = true
			}
			if f.first("u") != nil {
				fi.u = true
			}
			if c := f.first("color"); c != nil {
				if rgb := c.attr("rgb"); len(rgb) == 8 {
					fi.color = "#" + strings.ToLower(rgb[2:])
				}
			}
			if sz := f.first("sz"); sz != nil {
				if v, err := strconv.ParseFloat(sz.attr("val"), 64); err == nil {
					fi.sizePx = v * 96.0 / 72.0
				}
			}
			fonts = append(fonts, fi)
		}
	}

	var fills []string
	if fl := tree.first("fills"); fl != nil {
		for _, f := range fl.all("fill") {
			bg := ""
			if pf := f.first("patternFill"); pf != nil && pf.attr("patternType") == "solid" {
				if fg := pf.first("fgColor"); fg != nil {
					if rgb := fg.attr("rgb"); len(rgb) == 8 {
						bg = "#" + strings.ToLower(rgb[2:])
					}
				}
			}
			fills = append(fills, bg)
		}
	}

	var out []xlsxXfInfo
	if cx := tree.first("cellXfs"); cx != nil {
		for _, xf := range cx.all("xf") {
			st := &CellStyle{}
			any := false
			if fid, err := strconv.Atoi(xf.attr("fontId")); err == nil && fid >= 0 && fid < len(fonts) {
				fi := fonts[fid]
				if fi.b {
					st.B = true
					any = true
				}
				if fi.i {
					st.I = true
					any = true
				}
				if fi.u {
					st.U = true
					any = true
				}
				if fi.color != "" && fi.color != "#000000" {
					st.Fc = fi.color
					any = true
				}
				if fi.sizePx > 0 && (fi.sizePx < 14 || fi.sizePx > 15.5) { // != default 11pt
					st.Fs = fi.sizePx
					any = true
				}
			}
			if flid, err := strconv.Atoi(xf.attr("fillId")); err == nil && flid >= 0 && flid < len(fills) {
				if fills[flid] != "" {
					st.Bg = fills[flid]
					any = true
				}
			}
			if bid, err := strconv.Atoi(xf.attr("borderId")); err == nil && bid > 0 {
				st.Bd = 1
				any = true
			}
			if al := xf.first("alignment"); al != nil {
				switch al.attr("horizontal") {
				case "left":
					st.Al = "l"
					any = true
				case "center":
					st.Al = "c"
					any = true
				case "right":
					st.Al = "r"
					any = true
				}
				if al.attr("wrapText") == "1" || al.attr("wrapText") == "true" {
					st.Wrap = true
					any = true
				}
			}
			if nid, err := strconv.Atoi(xf.attr("numFmtId")); err == nil && nid > 0 {
				fmtName, dec := numFmtIDToName(nid, numCodes)
				if fmtName != "" {
					st.Fmt = fmtName
					if dec >= 0 {
						d := dec
						st.Dec = &d
					}
					any = true
				}
			}
			if any {
				out = append(out, xlsxXfInfo{style: st})
			} else {
				out = append(out, xlsxXfInfo{})
			}
		}
	}
	return out
}

// numFmtIDToName maps builtin/custom number format ids to webapp fmt names
func numFmtIDToName(id int, custom map[int]string) (string, int) {
	switch {
	case id >= 1 && id <= 2:
		return "number", decimalsInCode("0.00")
	case id == 3:
		return "number", 0
	case id == 4:
		return "number", 2
	case id == 9:
		return "percent", 0
	case id == 10:
		return "percent", 2
	case id >= 14 && id <= 17 || id == 22:
		return "date", -1
	case id == 44 || id == 5 || id == 6 || id == 7 || id == 8 || id == 42:
		return "currency", 2
	case id == 49:
		return "text", -1
	}
	code, ok := custom[id]
	if !ok {
		return "", -1
	}
	lc := strings.ToLower(code)
	switch {
	case strings.Contains(lc, "%"):
		return "percent", decimalsInCode(code)
	case strings.Contains(code, "$") || strings.Contains(code, "¤"):
		return "currency", decimalsInCode(code)
	case strings.Contains(lc, "yy") || strings.Contains(lc, "dd") ||
		(strings.Contains(lc, "mm") && !strings.Contains(lc, "0")):
		return "date", -1
	case code == "@":
		return "text", -1
	case strings.Contains(code, "0"):
		return "number", decimalsInCode(code)
	}
	return "", -1
}

func decimalsInCode(code string) int {
	i := strings.Index(code, ".")
	if i < 0 {
		return 0
	}
	n := 0
	for j := i + 1; j < len(code) && code[j] == '0'; j++ {
		n++
	}
	return n
}

/* ---------- worksheet ---------- */

func parseWorksheet(tree *xnode, shared []string, styleMap []xlsxXfInfo) *WorkSheet {
	ws := &WorkSheet{
		Cells: map[string]*WorkCell{},
		ColW:  map[string]float64{},
		RowH:  map[string]float64{},
	}

	// frozen panes
	if pane := tree.path("sheetViews", "sheetView", "pane"); pane != nil && pane.attr("state") == "frozen" {
		fz := &FreezePane{}
		if x, err := strconv.Atoi(pane.attr("xSplit")); err == nil {
			fz.C = x
		}
		if y, err := strconv.Atoi(pane.attr("ySplit")); err == nil {
			fz.R = y
		}
		if fz.R > 0 || fz.C > 0 {
			ws.Freeze = fz
		}
	}

	// column widths
	if cols := tree.first("cols"); cols != nil {
		for _, c := range cols.all("col") {
			min, e1 := strconv.Atoi(c.attr("min"))
			max, e2 := strconv.Atoi(c.attr("max"))
			w, e3 := strconv.ParseFloat(c.attr("width"), 64)
			if e1 != nil || e2 != nil || e3 != nil {
				continue
			}
			if max-min > 64 {
				max = min + 64 // ignore column-range floods
			}
			for i := min; i <= max; i++ {
				ws.ColW[strconv.Itoa(i-1)] = float64(int(colCharsToPx(w)))
			}
		}
	}

	maxCol, maxRow := 0, 0
	if sd := tree.first("sheetData"); sd != nil {
		for _, row := range sd.all("row") {
			rIdx, err := strconv.Atoi(row.attr("r"))
			if err != nil {
				continue
			}
			if ht, err := strconv.ParseFloat(row.attr("ht"), 64); err == nil && row.attr("customHeight") == "1" {
				ws.RowH[strconv.Itoa(rIdx-1)] = float64(int(rowPtToPx(ht)))
			}
			for _, c := range row.all("c") {
				ref := c.attr("r")
				col, rw, ok := parseCellRef(ref)
				if !ok {
					continue
				}
				cell := parseXlsxCell(c, shared)
				var st *CellStyle
				if sIdx, err := strconv.Atoi(c.attr("s")); err == nil && sIdx >= 0 && sIdx < len(styleMap) {
					st = styleMap[sIdx].style
				}
				if cell == "" && st == nil {
					continue
				}
				wc := &WorkCell{V: cell}
				if st != nil {
					cp := *st
					wc.S = &cp
				}
				ws.Cells[cellRef(col, rw)] = wc
				if col > maxCol {
					maxCol = col
				}
				if rw > maxRow {
					maxRow = rw
				}
			}
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

	// merges
	if mc := tree.first("mergeCells"); mc != nil {
		for _, m := range mc.all("mergeCell") {
			if ref := m.attr("ref"); ref != "" {
				ws.Merges = append(ws.Merges, ref)
			}
		}
	}
	return ws
}

// parseXlsxCell extracts the raw editor value from a <c> element
func parseXlsxCell(c *xnode, shared []string) string {
	// formulas win: the webapp recalculates them
	if f := c.first("f"); f != nil && strings.TrimSpace(f.Text) != "" {
		return "=" + f.Text
	}
	t := c.attr("t")
	switch t {
	case "inlineStr":
		if is := c.first("is"); is != nil {
			var texts []string
			collectText(is, &texts)
			return textAsRaw(strings.Join(texts, ""))
		}
		return ""
	case "s":
		if v := c.first("v"); v != nil {
			if idx, err := strconv.Atoi(strings.TrimSpace(v.Text)); err == nil && idx >= 0 && idx < len(shared) {
				return textAsRaw(shared[idx])
			}
		}
		return ""
	case "b":
		if v := c.first("v"); v != nil {
			if strings.TrimSpace(v.Text) == "1" {
				return "TRUE"
			}
			return "FALSE"
		}
		return ""
	case "str":
		if v := c.first("v"); v != nil {
			return textAsRaw(v.Text)
		}
		return ""
	default: // "n" or absent = number
		if v := c.first("v"); v != nil {
			return strings.TrimSpace(v.Text)
		}
		return ""
	}
}

// textAsRaw keeps string-typed values as strings in the editor: text that
// would re-parse as a number/bool gets Excel's leading-quote escape
func textAsRaw(s string) string {
	t := strings.TrimSpace(s)
	if t == "" {
		return s
	}
	up := strings.ToUpper(t)
	if looksNumeric(t) || up == "TRUE" || up == "FALSE" || strings.HasPrefix(t, "=") || strings.HasPrefix(t, "'") {
		return "'" + s
	}
	return s
}
