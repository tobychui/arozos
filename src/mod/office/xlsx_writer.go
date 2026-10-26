package office

/*
	xlsx_writer.go - Build an Excel (.xlsx) file from a Workbook.

	Produced parts: [Content_Types].xml, root rels, xl/workbook.xml (+rels),
	xl/styles.xml (deduplicated dynamic style table) and one worksheet per
	sheet. Strings are written inline (no sharedStrings part). Formulas are
	written as <f> elements so Excel recalculates them on open. Webapp
	charts become native DrawingML chart parts (xlsx_charts.go); filters
	are not representable and are skipped.
*/

import (
	"archive/zip"
	"bytes"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

/* ---------- style table ---------- */

type xlsxStyleTable struct {
	numFmts []string // custom format codes, id = 164 + index
	fonts   []string // font xml fragments
	fills   []string // fill xml fragments
	xfs     []string // cellXfs xf fragments
	fontIdx map[string]int
	fillIdx map[string]int
	numIdx  map[string]int
	xfIdx   map[string]int
}

func newStyleTable() *xlsxStyleTable {
	t := &xlsxStyleTable{
		fontIdx: map[string]int{},
		fillIdx: map[string]int{},
		numIdx:  map[string]int{},
		xfIdx:   map[string]int{},
	}
	// required defaults: font 0, fill 0 (none) + fill 1 (gray125)
	t.font(`<font><sz val="11"/><name val="Calibri"/></font>`)
	t.fill(`<fill><patternFill patternType="none"/></fill>`)
	t.fill(`<fill><patternFill patternType="gray125"/></fill>`)
	// xf 0 = default
	t.xfs = append(t.xfs, `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`)
	t.xfIdx["default"] = 0
	return t
}
func (t *xlsxStyleTable) font(xml string) int {
	if i, ok := t.fontIdx[xml]; ok {
		return i
	}
	t.fonts = append(t.fonts, xml)
	t.fontIdx[xml] = len(t.fonts) - 1
	return len(t.fonts) - 1
}
func (t *xlsxStyleTable) fill(xml string) int {
	if i, ok := t.fillIdx[xml]; ok {
		return i
	}
	t.fills = append(t.fills, xml)
	t.fillIdx[xml] = len(t.fills) - 1
	return len(t.fills) - 1
}
func (t *xlsxStyleTable) numFmt(code string) int {
	if code == "" {
		return 0
	}
	// builtin ids pass through as "@id"
	if strings.HasPrefix(code, "@") {
		id, _ := strconv.Atoi(code[1:])
		return id
	}
	if i, ok := t.numIdx[code]; ok {
		return 164 + i
	}
	t.numFmts = append(t.numFmts, code)
	t.numIdx[code] = len(t.numFmts) - 1
	return 164 + len(t.numFmts) - 1
}

// numFmtCode maps the webapp fmt/dec to an Excel format code ("" = general;
// "@id" = builtin id)
func numFmtCode(s *CellStyle) string {
	if s == nil || s.Fmt == "" || s.Fmt == "general" {
		return ""
	}
	dec := 2
	if s.Dec != nil {
		dec = *s.Dec
	}
	decs := ""
	if dec > 0 {
		decs = "." + strings.Repeat("0", dec)
	}
	switch s.Fmt {
	case "number":
		return "#,##0" + decs
	case "percent":
		return "0" + decs + "%"
	case "currency":
		return "$#,##0" + decs
	case "date":
		return "@14" // builtin yyyy-mm-dd-ish (locale short date)
	case "text":
		return "@49" // builtin text
	}
	return ""
}

// xfFor returns (creating if needed) the cellXfs index for a style
func (t *xlsxStyleTable) xfFor(s *CellStyle) int {
	if s == nil {
		return 0
	}
	sig := fmt.Sprintf("%v|%v|%v|%s|%s|%s|%v|%s|%v|%v|%d",
		s.B, s.I, s.U, s.Al, s.Bg, s.Fc, s.Fs, s.Fmt, s.Dec != nil, s.Wrap, s.Bd)
	if s.Dec != nil {
		sig += "|" + strconv.Itoa(*s.Dec)
	}
	if i, ok := t.xfIdx[sig]; ok {
		return i
	}

	// font
	fx := "<font>"
	if s.B {
		fx += "<b/>"
	}
	if s.I {
		fx += "<i/>"
	}
	if s.U {
		fx += "<u/>"
	}
	sz := 11.0
	if s.Fs > 0 {
		sz = s.Fs * 72.0 / 96.0 // px -> pt
	}
	fx += fmt.Sprintf(`<sz val="%s"/>`, trimFloat(sz))
	if s.Fc != "" {
		fx += `<color rgb="FF` + hexColor(s.Fc, "000000") + `"/>`
	}
	fx += `<name val="Calibri"/></font>`
	fontID := t.font(fx)

	// fill
	fillID := 0
	if s.Bg != "" {
		fillID = t.fill(`<fill><patternFill patternType="solid"><fgColor rgb="FF` +
			hexColor(s.Bg, "FFFFFF") + `"/><bgColor indexed="64"/></patternFill></fill>`)
	}

	borderID := 0
	if s.Bd != 0 {
		borderID = 1
	}
	numID := t.numFmt(numFmtCode(s))

	xf := fmt.Sprintf(`<xf numFmtId="%d" fontId="%d" fillId="%d" borderId="%d" xfId="0"`,
		numID, fontID, fillID, borderID)
	applies := ""
	if numID != 0 {
		applies += ` applyNumberFormat="1"`
	}
	if fontID != 0 {
		applies += ` applyFont="1"`
	}
	if fillID != 0 {
		applies += ` applyFill="1"`
	}
	if borderID != 0 {
		applies += ` applyBorder="1"`
	}
	align := ""
	if s.Al != "" || s.Wrap {
		h := map[string]string{"l": "left", "c": "center", "r": "right"}[s.Al]
		align = "<alignment"
		if h != "" {
			align += ` horizontal="` + h + `"`
		}
		if s.Wrap {
			align += ` wrapText="1"`
		}
		align += "/>"
		applies += ` applyAlignment="1"`
	}
	if align != "" {
		xf += applies + ">" + align + "</xf>"
	} else {
		xf += applies + "/>"
	}
	t.xfs = append(t.xfs, xf)
	t.xfIdx[sig] = len(t.xfs) - 1
	return len(t.xfs) - 1
}

func (t *xlsxStyleTable) render() string {
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	sb.WriteString(`<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`)
	if len(t.numFmts) > 0 {
		sb.WriteString(fmt.Sprintf(`<numFmts count="%d">`, len(t.numFmts)))
		for i, code := range t.numFmts {
			sb.WriteString(fmt.Sprintf(`<numFmt numFmtId="%d" formatCode="%s"/>`, 164+i, xmlEscape(code)))
		}
		sb.WriteString(`</numFmts>`)
	}
	sb.WriteString(fmt.Sprintf(`<fonts count="%d">%s</fonts>`, len(t.fonts), strings.Join(t.fonts, "")))
	sb.WriteString(fmt.Sprintf(`<fills count="%d">%s</fills>`, len(t.fills), strings.Join(t.fills, "")))
	sb.WriteString(`<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>` +
		`<border><left style="thin"><color auto="1"/></left><right style="thin"><color auto="1"/></right>` +
		`<top style="thin"><color auto="1"/></top><bottom style="thin"><color auto="1"/></bottom><diagonal/></border></borders>`)
	sb.WriteString(`<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`)
	sb.WriteString(fmt.Sprintf(`<cellXfs count="%d">%s</cellXfs>`, len(t.xfs), strings.Join(t.xfs, "")))
	sb.WriteString(`<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`)
	sb.WriteString(`</styleSheet>`)
	return sb.String()
}

func trimFloat(f float64) string {
	s := strconv.FormatFloat(f, 'f', 2, 64)
	s = strings.TrimRight(s, "0")
	s = strings.TrimRight(s, ".")
	return s
}

/* ---------- workbook writer ---------- */

// BuildXlsx serializes a Workbook into a complete .xlsx file
func BuildXlsx(wb *Workbook) ([]byte, error) {
	if wb == nil || len(wb.Sheets) == 0 {
		return nil, errors.New("workbook has no sheets")
	}

	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)
	addFile := func(name, content string) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = w.Write([]byte(content))
		return err
	}

	styles := newStyleTable()

	// sheet names are needed up front: chart series formulas reference them
	usedNames := map[string]bool{}
	sheetNames := make([]string, len(wb.Sheets))
	for i, ws := range wb.Sheets {
		sheetNames[i] = sanitizeSheetName(ws.Name, i, usedNames)
	}

	// charts: every sheet with charts gets one drawing part; every chart
	// gets its own chart part (numbered globally). Notes become a
	// comments part + VML legacyDrawing per sheet.
	sheetCharts := make([][]*xlsxChart, len(wb.Sheets))
	sheetNoteList := make([][]xlsxNote, len(wb.Sheets))
	totalCharts := 0
	anyNotes := false
	for i, ws := range wb.Sheets {
		sheetCharts[i] = parseSheetCharts(ws.Charts)
		totalCharts += len(sheetCharts[i])
		sheetNoteList[i] = sheetNotes(ws)
		if len(sheetNoteList[i]) > 0 {
			anyNotes = true
		}
	}
	// relationship ids inside each sheet's rels file: drawing first (when
	// charts exist), then comments + vml - must match the writer loop below
	sheetLegacyRid := func(i int) string {
		if len(sheetNoteList[i]) == 0 {
			return ""
		}
		if len(sheetCharts[i]) > 0 {
			return "rId3"
		}
		return "rId2"
	}

	// worksheets (rendered first so the style table is complete)
	sheetXMLs := make([]string, len(wb.Sheets))
	for i, ws := range wb.Sheets {
		sheetXMLs[i] = buildWorksheetXML(ws, styles, len(sheetCharts[i]) > 0, sheetLegacyRid(i))
	}

	// [Content_Types].xml
	var ct strings.Builder
	ct.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	ct.WriteString(`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`)
	ct.WriteString(`<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`)
	ct.WriteString(`<Default Extension="xml" ContentType="application/xml"/>`)
	if anyNotes {
		ct.WriteString(`<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/>`)
	}
	ct.WriteString(`<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`)
	for i := range wb.Sheets {
		ct.WriteString(fmt.Sprintf(`<Override PartName="/xl/worksheets/sheet%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`, i+1))
	}
	drawingNo := 0
	for i := range wb.Sheets {
		if len(sheetCharts[i]) > 0 {
			drawingNo++
			ct.WriteString(fmt.Sprintf(`<Override PartName="/xl/drawings/drawing%d.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/>`, drawingNo))
		}
	}
	for c := 1; c <= totalCharts; c++ {
		ct.WriteString(fmt.Sprintf(`<Override PartName="/xl/charts/chart%d.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`, c))
	}
	commentsNo := 0
	for i := range wb.Sheets {
		if len(sheetNoteList[i]) > 0 {
			commentsNo++
			ct.WriteString(fmt.Sprintf(`<Override PartName="/xl/comments%d.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/>`, commentsNo))
		}
	}
	ct.WriteString(`<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`)
	ct.WriteString(`</Types>`)
	if err := addFile("[Content_Types].xml", ct.String()); err != nil {
		return nil, err
	}

	if err := addFile("_rels/.rels",
		`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`+"\n"+
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`+
			`<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`+
			`</Relationships>`); err != nil {
		return nil, err
	}

	// workbook.xml + rels
	var wbXML, wbRels strings.Builder
	wbXML.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	wbXML.WriteString(`<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`)
	active := wb.Active
	if active < 0 || active >= len(wb.Sheets) {
		active = 0
	}
	wbXML.WriteString(fmt.Sprintf(`<bookViews><workbookView activeTab="%d"/></bookViews><sheets>`, active))
	wbRels.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
	for i := range wb.Sheets {
		wbXML.WriteString(fmt.Sprintf(`<sheet name="%s" sheetId="%d" r:id="rId%d"/>`, xmlEscape(sheetNames[i]), i+1, i+1))
		wbRels.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>`, i+1, i+1))
	}
	wbXML.WriteString(`</sheets></workbook>`)
	wbRels.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`, len(wb.Sheets)+1))
	wbRels.WriteString(`</Relationships>`)
	if err := addFile("xl/workbook.xml", wbXML.String()); err != nil {
		return nil, err
	}
	if err := addFile("xl/_rels/workbook.xml.rels", wbRels.String()); err != nil {
		return nil, err
	}

	if err := addFile("xl/styles.xml", styles.render()); err != nil {
		return nil, err
	}
	for i, xml := range sheetXMLs {
		if err := addFile(fmt.Sprintf("xl/worksheets/sheet%d.xml", i+1), xml); err != nil {
			return nil, err
		}
	}

	// per-sheet extras: chart drawings and note comments (+VML). The rId
	// allocation here must match sheetLegacyRid above: drawing = rId1,
	// then comments, then vml.
	drawingNo = 0
	chartNo := 0
	commentsNo = 0
	for i, ws := range wb.Sheets {
		charts := sheetCharts[i]
		notes := sheetNoteList[i]
		if len(charts) == 0 && len(notes) == 0 {
			continue
		}
		var sRels strings.Builder
		sRels.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
			`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
		rid := 0
		if len(charts) > 0 {
			drawingNo++
			rid++
			sRels.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing%d.xml"/>`, rid, drawingNo))
			var dRels strings.Builder
			dRels.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
				`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
			relIDs := make([]string, len(charts))
			for j, ch := range charts {
				chartNo++
				relIDs[j] = fmt.Sprintf("rId%d", j+1)
				dRels.WriteString(fmt.Sprintf(`<Relationship Id="%s" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart%d.xml"/>`, relIDs[j], chartNo))
				if err := addFile(fmt.Sprintf("xl/charts/chart%d.xml", chartNo),
					buildChartXML(ws, ch, sheetNames[i])); err != nil {
					return nil, err
				}
			}
			dRels.WriteString(`</Relationships>`)
			if err := addFile(fmt.Sprintf("xl/drawings/_rels/drawing%d.xml.rels", drawingNo), dRels.String()); err != nil {
				return nil, err
			}
			if err := addFile(fmt.Sprintf("xl/drawings/drawing%d.xml", drawingNo),
				buildDrawingXML(charts, relIDs)); err != nil {
				return nil, err
			}
		}
		if len(notes) > 0 {
			commentsNo++
			rid++
			sRels.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="../comments%d.xml"/>`, rid, commentsNo))
			rid++
			sRels.WriteString(fmt.Sprintf(`<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing" Target="../drawings/vmlDrawing%d.vml"/>`, rid, commentsNo))
			if err := addFile(fmt.Sprintf("xl/comments%d.xml", commentsNo), buildCommentsXML(notes)); err != nil {
				return nil, err
			}
			if err := addFile(fmt.Sprintf("xl/drawings/vmlDrawing%d.vml", commentsNo), buildVmlXML(notes)); err != nil {
				return nil, err
			}
		}
		sRels.WriteString(`</Relationships>`)
		if err := addFile(fmt.Sprintf("xl/worksheets/_rels/sheet%d.xml.rels", i+1), sRels.String()); err != nil {
			return nil, err
		}
	}

	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

func sanitizeSheetName(name string, idx int, used map[string]bool) string {
	n := strings.TrimSpace(name)
	if n == "" {
		n = fmt.Sprintf("Sheet%d", idx+1)
	}
	// Excel forbids these characters and names > 31 chars
	n = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`[]:*?/\`, r) {
			return '_'
		}
		return r
	}, n)
	if len(n) > 31 {
		n = n[:31]
	}
	base := n
	for i := 2; used[strings.ToLower(n)]; i++ {
		suffix := fmt.Sprintf(" %d", i)
		if len(base)+len(suffix) > 31 {
			n = base[:31-len(suffix)] + suffix
		} else {
			n = base + suffix
		}
	}
	used[strings.ToLower(n)] = true
	return n
}

type xlsxCellOut struct {
	col int
	xml string
}

func buildWorksheetXML(ws *WorkSheet, styles *xlsxStyleTable, hasDrawing bool, legacyRid string) string {
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	sb.WriteString(`<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"` +
		` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`)

	// freeze pane
	if ws.Freeze != nil && (ws.Freeze.R > 0 || ws.Freeze.C > 0) {
		top := cellRef(ws.Freeze.C, ws.Freeze.R)
		pane := `<pane`
		if ws.Freeze.C > 0 {
			pane += fmt.Sprintf(` xSplit="%d"`, ws.Freeze.C)
		}
		if ws.Freeze.R > 0 {
			pane += fmt.Sprintf(` ySplit="%d"`, ws.Freeze.R)
		}
		pane += ` topLeftCell="` + top + `" state="frozen"/>`
		sb.WriteString(`<sheetViews><sheetView workbookViewId="0">` + pane + `</sheetView></sheetViews>`)
	} else {
		sb.WriteString(`<sheetViews><sheetView workbookViewId="0"/></sheetViews>`)
	}

	// column widths
	if len(ws.ColW) > 0 {
		var idxs []int
		for k := range ws.ColW {
			if i, err := strconv.Atoi(k); err == nil {
				idxs = append(idxs, i)
			}
		}
		sort.Ints(idxs)
		sb.WriteString("<cols>")
		for _, i := range idxs {
			sb.WriteString(fmt.Sprintf(`<col min="%d" max="%d" width="%s" customWidth="1"/>`,
				i+1, i+1, trimFloat(pxToColChars(ws.ColW[strconv.Itoa(i)]))))
		}
		sb.WriteString("</cols>")
	}

	// bucket cells by row
	rows := map[int][]xlsxCellOut{}
	maxRow := 0
	for key, cell := range ws.Cells {
		if cell == nil {
			continue
		}
		col, row, ok := parseCellRef(key)
		if !ok {
			continue
		}
		x := buildCellXML(col, row, cell, styles)
		if x == "" {
			continue
		}
		rows[row] = append(rows[row], xlsxCellOut{col: col, xml: x})
		if row > maxRow {
			maxRow = row
		}
	}
	var rowIdxs []int
	for r := range rows {
		rowIdxs = append(rowIdxs, r)
	}
	sort.Ints(rowIdxs)

	sb.WriteString("<sheetData>")
	for _, r := range rowIdxs {
		cells := rows[r]
		sort.Slice(cells, func(a, b int) bool { return cells[a].col < cells[b].col })
		attrs := fmt.Sprintf(` r="%d"`, r+1)
		if h, ok := ws.RowH[strconv.Itoa(r)]; ok && h > 0 {
			attrs += fmt.Sprintf(` ht="%s" customHeight="1"`, trimFloat(pxToRowPt(h)))
		}
		sb.WriteString("<row" + attrs + ">")
		for _, c := range cells {
			sb.WriteString(c.xml)
		}
		sb.WriteString("</row>")
	}
	sb.WriteString("</sheetData>")

	// merges
	if len(ws.Merges) > 0 {
		var ms []string
		for _, m := range ws.Merges {
			parts := strings.Split(m, ":")
			if len(parts) == 2 {
				if _, _, ok1 := parseCellRef(parts[0]); ok1 {
					if _, _, ok2 := parseCellRef(parts[1]); ok2 {
						ms = append(ms, m)
					}
				}
			}
		}
		if len(ms) > 0 {
			sb.WriteString(fmt.Sprintf(`<mergeCells count="%d">`, len(ms)))
			for _, m := range ms {
				sb.WriteString(`<mergeCell ref="` + xmlEscape(m) + `"/>`)
			}
			sb.WriteString(`</mergeCells>`)
		}
	}

	if hasDrawing {
		sb.WriteString(`<drawing r:id="rId1"/>`)
	}
	if legacyRid != "" {
		sb.WriteString(`<legacyDrawing r:id="` + legacyRid + `"/>`)
	}
	sb.WriteString(`</worksheet>`)
	return sb.String()
}

func buildCellXML(col, row int, cell *WorkCell, styles *xlsxStyleTable) string {
	v := cell.V
	xf := styles.xfFor(cell.S)
	sAttr := ""
	if xf != 0 {
		sAttr = fmt.Sprintf(` s="%d"`, xf)
	}
	ref := cellRef(col, row)
	if v == "" {
		if xf == 0 {
			return "" // nothing to store
		}
		return fmt.Sprintf(`<c r="%s"%s/>`, ref, sAttr)
	}
	if strings.HasPrefix(v, "=") {
		return fmt.Sprintf(`<c r="%s"%s><f>%s</f></c>`, ref, sAttr, xmlEscape(v[1:]))
	}
	if strings.HasPrefix(v, "'") {
		// forced text
		return inlineStrCell(ref, sAttr, v[1:])
	}
	if looksNumeric(v) {
		return fmt.Sprintf(`<c r="%s"%s><v>%s</v></c>`, ref, sAttr, xmlEscape(strings.TrimSpace(v)))
	}
	up := strings.ToUpper(strings.TrimSpace(v))
	if up == "TRUE" || up == "FALSE" {
		bv := "0"
		if up == "TRUE" {
			bv = "1"
		}
		return fmt.Sprintf(`<c r="%s"%s t="b"><v>%s</v></c>`, ref, sAttr, bv)
	}
	return inlineStrCell(ref, sAttr, v)
}

func inlineStrCell(ref, sAttr, text string) string {
	return fmt.Sprintf(`<c r="%s"%s t="inlineStr"><is><t xml:space="preserve">%s</t></is></c>`,
		ref, sAttr, xmlEscape(text))
}
