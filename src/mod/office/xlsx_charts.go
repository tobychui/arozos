package office

/*
	xlsx_charts.go - Native Excel chart support for the Sheets webapp.

	The webapp stores charts as JSON blobs on each sheet:
	    { id, x, y, w, h,            // px in grid space
	      range: "A1:B5",
	      opts: { type: "bar"|"line"|"pie", title,
	              headerRow: bool, labelCol: bool, stacked: bool } }

	Writer: every chart becomes a real DrawingML chart part
	(xl/drawings/drawingN.xml + xl/charts/chartN.xml) anchored absolutely,
	so Excel / LibreOffice render it and recalculate it from the referenced
	cell range. Reader: chart parts (ours or Excel-authored bar/line/pie
	charts) are mapped back to the webapp JSON model by reconstructing the
	bounding range from the series formulas.
*/

import (
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

// grid defaults must match sheets.js (DEF_COLW / DEF_ROWH)
const (
	xlsxDefColPx = 92.0
	xlsxDefRowPx = 24.0
)

type xlsxChartOpts struct {
	Type      string `json:"type,omitempty"`
	Title     string `json:"title,omitempty"`
	HeaderRow *bool  `json:"headerRow,omitempty"` // absent = true
	LabelCol  *bool  `json:"labelCol,omitempty"`  // absent = true
	Stacked   bool   `json:"stacked,omitempty"`
}

type xlsxChart struct {
	ID    string         `json:"id"`
	X     float64        `json:"x"`
	Y     float64        `json:"y"`
	W     float64        `json:"w"`
	H     float64        `json:"h"`
	Range string         `json:"range"`
	Opts  *xlsxChartOpts `json:"opts,omitempty"`
}

func (c *xlsxChart) headerRow() bool {
	return c.Opts == nil || c.Opts.HeaderRow == nil || *c.Opts.HeaderRow
}
func (c *xlsxChart) labelCol() bool {
	return c.Opts == nil || c.Opts.LabelCol == nil || *c.Opts.LabelCol
}
func (c *xlsxChart) chartType() string {
	if c.Opts != nil && (c.Opts.Type == "line" || c.Opts.Type == "pie") {
		return c.Opts.Type
	}
	return "bar"
}

// parseSheetCharts decodes the passthrough chart blob, dropping entries
// whose range does not parse
func parseSheetCharts(raw json.RawMessage) []*xlsxChart {
	if len(raw) == 0 {
		return nil
	}
	var list []*xlsxChart
	if err := json.Unmarshal(raw, &list); err != nil {
		return nil
	}
	out := make([]*xlsxChart, 0, len(list))
	for _, ch := range list {
		if ch == nil {
			continue
		}
		if _, _, _, _, ok := parseRangeRef(ch.Range); !ok {
			continue
		}
		out = append(out, ch)
	}
	return out
}

// parseRangeRef parses "A1:C5" (or a single "A1") into a normalized
// 0-based bounding box
func parseRangeRef(ref string) (c1, r1, c2, r2 int, ok bool) {
	ref = strings.ReplaceAll(strings.TrimSpace(ref), "$", "")
	parts := strings.Split(ref, ":")
	if len(parts) == 1 {
		parts = append(parts, parts[0])
	}
	if len(parts) != 2 {
		return 0, 0, 0, 0, false
	}
	c1, r1, ok1 := parseCellRef(parts[0])
	c2, r2, ok2 := parseCellRef(parts[1])
	if !ok1 || !ok2 {
		return 0, 0, 0, 0, false
	}
	if c2 < c1 {
		c1, c2 = c2, c1
	}
	if r2 < r1 {
		r1, r2 = r2, r1
	}
	return c1, r1, c2, r2, true
}

// sheetRefPrefix quotes a sheet name for use in a chart series formula
func sheetRefPrefix(name string) string {
	return "'" + strings.ReplaceAll(name, "'", "''") + "'!"
}

/* ==================== writer ==================== */

// cellText returns the literal display text of a cell ("" for formulas -
// Excel refreshes chart caches from the sheet on load anyway)
func chartCellText(ws *WorkSheet, col, row int) string {
	cell, ok := ws.Cells[cellRef(col, row)]
	if !ok || cell == nil {
		return ""
	}
	v := cell.V
	if strings.HasPrefix(v, "=") {
		return ""
	}
	return strings.TrimPrefix(v, "'")
}

// buildChartXML renders one c:chartSpace part for a webapp chart
func buildChartXML(ws *WorkSheet, ch *xlsxChart, sheetName string) string {
	c1, r1, c2, r2, _ := parseRangeRef(ch.Range)
	dataC1, dataR1 := c1, r1
	if ch.labelCol() {
		dataC1++
	}
	if ch.headerRow() {
		dataR1++
	}
	if dataC1 > c2 {
		dataC1 = c2
	}
	if dataR1 > r2 {
		dataR1 = r2
	}
	pre := sheetRefPrefix(sheetName)
	nPts := r2 - dataR1 + 1

	// category (label) reference shared by every series
	catXML := ""
	if ch.labelCol() {
		var cache strings.Builder
		cache.WriteString(fmt.Sprintf(`<c:ptCount val="%d"/>`, nPts))
		for r := dataR1; r <= r2; r++ {
			cache.WriteString(fmt.Sprintf(`<c:pt idx="%d"><c:v>%s</c:v></c:pt>`,
				r-dataR1, xmlEscape(chartCellText(ws, c1, r))))
		}
		catXML = fmt.Sprintf(
			`<c:cat><c:strRef><c:f>%s$%s$%d:$%s$%d</c:f><c:strCache>%s</c:strCache></c:strRef></c:cat>`,
			xmlEscape(pre), colName(c1), dataR1+1, colName(c1), r2+1, cache.String())
	}

	var sers strings.Builder
	serCount := 0
	for c := dataC1; c <= c2; c++ {
		idx := serCount
		serCount++
		sers.WriteString(fmt.Sprintf(`<c:ser><c:idx val="%d"/><c:order val="%d"/>`, idx, idx))
		if ch.headerRow() {
			sers.WriteString(fmt.Sprintf(
				`<c:tx><c:strRef><c:f>%s$%s$%d</c:f><c:strCache><c:ptCount val="1"/>`+
					`<c:pt idx="0"><c:v>%s</c:v></c:pt></c:strCache></c:strRef></c:tx>`,
				xmlEscape(pre), colName(c), r1+1, xmlEscape(chartCellText(ws, c, r1))))
		}
		if ch.chartType() == "line" {
			sers.WriteString(`<c:marker><c:symbol val="none"/></c:marker>`)
		}
		sers.WriteString(catXML)
		var vals strings.Builder
		vals.WriteString(`<c:formatCode>General</c:formatCode>`)
		vals.WriteString(fmt.Sprintf(`<c:ptCount val="%d"/>`, nPts))
		for r := dataR1; r <= r2; r++ {
			t := chartCellText(ws, c, r)
			if !looksNumeric(t) {
				continue // Excel fills the cache back in from the sheet
			}
			vals.WriteString(fmt.Sprintf(`<c:pt idx="%d"><c:v>%s</c:v></c:pt>`,
				r-dataR1, xmlEscape(strings.TrimSpace(t))))
		}
		sers.WriteString(fmt.Sprintf(
			`<c:val><c:numRef><c:f>%s$%s$%d:$%s$%d</c:f><c:numCache>%s</c:numCache></c:numRef></c:val>`,
			xmlEscape(pre), colName(c), dataR1+1, colName(c), r2+1, vals.String()))
		sers.WriteString(`</c:ser>`)
		if ch.chartType() == "pie" {
			break // a pie plots a single series
		}
	}

	grouping := "clustered"
	lineGrouping := "standard"
	if ch.Opts != nil && ch.Opts.Stacked {
		grouping = "stacked"
		lineGrouping = "stacked"
	}
	const axCat, axVal = "111111111", "222222222"
	axesXML := `<c:axId val="` + axCat + `"/><c:axId val="` + axVal + `"/>`
	catValAxes := `<c:catAx><c:axId val="` + axCat + `"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
		`<c:delete val="0"/><c:axPos val="b"/><c:crossAx val="` + axVal + `"/></c:catAx>` +
		`<c:valAx><c:axId val="` + axVal + `"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
		`<c:delete val="0"/><c:axPos val="l"/><c:crossAx val="` + axCat + `"/></c:valAx>`

	var plot string
	switch ch.chartType() {
	case "line":
		plot = `<c:lineChart><c:grouping val="` + lineGrouping + `"/><c:varyColors val="0"/>` +
			sers.String() + `<c:marker val="1"/>` + axesXML + `</c:lineChart>` + catValAxes
	case "pie":
		plot = `<c:pieChart><c:varyColors val="1"/>` + sers.String() +
			`<c:firstSliceAng val="0"/></c:pieChart>`
	default:
		overlap := ""
		if grouping == "stacked" {
			overlap = `<c:overlap val="100"/>`
		}
		plot = `<c:barChart><c:barDir val="col"/><c:grouping val="` + grouping + `"/><c:varyColors val="0"/>` +
			sers.String() + `<c:gapWidth val="150"/>` + overlap + axesXML + `</c:barChart>` + catValAxes
	}

	titleXML := `<c:autoTitleDeleted val="1"/>`
	if ch.Opts != nil && strings.TrimSpace(ch.Opts.Title) != "" {
		titleXML = `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>` +
			xmlEscape(ch.Opts.Title) + `</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>` +
			`<c:autoTitleDeleted val="0"/>`
	}

	return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"` +
		` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
		` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
		`<c:chart>` + titleXML +
		`<c:plotArea><c:layout/>` + plot + `</c:plotArea>` +
		`<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>` +
		`<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/>` +
		`</c:chart></c:chartSpace>`
}

// buildDrawingXML renders the xl/drawings part for one sheet; chartRelIDs
// pairs each chart with its relationship id in the drawing's rels
func buildDrawingXML(charts []*xlsxChart, chartRelIDs []string) string {
	var sb strings.Builder
	sb.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n")
	sb.WriteString(`<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing"` +
		` xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"` +
		` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`)
	for i, ch := range charts {
		w := ch.W
		if w < 40 {
			w = 480
		}
		h := ch.H
		if h < 30 {
			h = 300
		}
		sb.WriteString(`<xdr:absoluteAnchor>`)
		sb.WriteString(fmt.Sprintf(`<xdr:pos x="%d" y="%d"/><xdr:ext cx="%d" cy="%d"/>`,
			pxToEmu(ch.X), pxToEmu(ch.Y), pxToEmu(w), pxToEmu(h)))
		sb.WriteString(`<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr>` +
			fmt.Sprintf(`<xdr:cNvPr id="%d" name="Chart %d"/>`, i+2, i+1) +
			`<xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
			`<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>` +
			`<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">` +
			`<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart"` +
			` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"` +
			` r:id="` + chartRelIDs[i] + `"/></a:graphicData></a:graphic></xdr:graphicFrame>`)
		sb.WriteString(`<xdr:clientData/></xdr:absoluteAnchor>`)
	}
	sb.WriteString(`</xdr:wsDr>`)
	return sb.String()
}

/* ==================== reader ==================== */

// chartAnchorPx resolves a drawing anchor to grid-space pixels, using the
// sheet's column/row sizes (webapp defaults for the rest)
func chartAnchorPx(anchor *xnode, ws *WorkSheet) (x, y, w, h float64) {
	colX := func(col int, off int64) float64 {
		px := 0.0
		for i := 0; i < col; i++ {
			if cw, ok := ws.ColW[strconv.Itoa(i)]; ok && cw > 0 {
				px += cw
			} else {
				px += xlsxDefColPx
			}
		}
		return px + float64(off)/emuPerPx
	}
	rowY := func(row int, off int64) float64 {
		px := 0.0
		for i := 0; i < row; i++ {
			if rh, ok := ws.RowH[strconv.Itoa(i)]; ok && rh > 0 {
				px += rh
			} else {
				px += xlsxDefRowPx
			}
		}
		return px + float64(off)/emuPerPx
	}
	markerPx := func(m *xnode) (float64, float64) {
		col, _ := strconv.Atoi(strings.TrimSpace(m.first("col").Text))
		colOff, _ := strconv.ParseInt(strings.TrimSpace(m.first("colOff").Text), 10, 64)
		row, _ := strconv.Atoi(strings.TrimSpace(m.first("row").Text))
		rowOff, _ := strconv.ParseInt(strings.TrimSpace(m.first("rowOff").Text), 10, 64)
		return colX(col, colOff), rowY(row, rowOff)
	}

	x, y, w, h = 40, 40, 480, 300
	switch anchor.XMLName.Local {
	case "absoluteAnchor":
		if pos := anchor.first("pos"); pos != nil {
			px, _ := strconv.ParseInt(pos.attr("x"), 10, 64)
			py, _ := strconv.ParseInt(pos.attr("y"), 10, 64)
			x, y = float64(px)/emuPerPx, float64(py)/emuPerPx
		}
		if ext := anchor.first("ext"); ext != nil {
			cx, _ := strconv.ParseInt(ext.attr("cx"), 10, 64)
			cy, _ := strconv.ParseInt(ext.attr("cy"), 10, 64)
			w, h = float64(cx)/emuPerPx, float64(cy)/emuPerPx
		}
	case "oneCellAnchor":
		if from := anchor.first("from"); from != nil && from.first("col") != nil {
			x, y = markerPx(from)
		}
		if ext := anchor.first("ext"); ext != nil {
			cx, _ := strconv.ParseInt(ext.attr("cx"), 10, 64)
			cy, _ := strconv.ParseInt(ext.attr("cy"), 10, 64)
			w, h = float64(cx)/emuPerPx, float64(cy)/emuPerPx
		}
	case "twoCellAnchor":
		from, to := anchor.first("from"), anchor.first("to")
		if from != nil && from.first("col") != nil {
			x, y = markerPx(from)
		}
		if to != nil && to.first("col") != nil {
			x2, y2 := markerPx(to)
			if x2 > x {
				w = x2 - x
			}
			if y2 > y {
				h = y2 - y
			}
		}
	}
	if w < 60 {
		w = 480
	}
	if h < 40 {
		h = 300
	}
	return x, y, w, h
}

// parseChartFormulaRange strips the sheet prefix and $ from a series
// formula reference like "'Sheet 1'!$B$2:$B$10"
func parseChartFormulaRange(f string) (c1, r1, c2, r2 int, ok bool) {
	f = strings.TrimSpace(f)
	if i := strings.LastIndex(f, "!"); i >= 0 {
		f = f[i+1:]
	}
	return parseRangeRef(f)
}

// parseChartPart maps a c:chartSpace tree back to the webapp chart model
// (bounding range reconstructed from the series formulas); returns nil for
// chart types the webapp cannot represent
func parseChartPart(tree *xnode, idSeq int) *xlsxChart {
	chart := tree.first("chart")
	if chart == nil {
		return nil
	}
	plotArea := chart.path("plotArea")
	if plotArea == nil {
		return nil
	}
	var plot *xnode
	chType := ""
	for _, cand := range []struct{ node, t string }{
		{"barChart", "bar"}, {"bar3DChart", "bar"},
		{"lineChart", "line"}, {"line3DChart", "line"},
		{"pieChart", "pie"}, {"pie3DChart", "pie"}, {"doughnutChart", "pie"},
		{"areaChart", "line"},
	} {
		if n := plotArea.first(cand.node); n != nil {
			plot, chType = n, cand.t
			break
		}
	}
	if plot == nil {
		return nil
	}

	opts := &xlsxChartOpts{Type: chType}
	if g := plot.first("grouping"); g != nil &&
		(g.attr("val") == "stacked" || g.attr("val") == "percentStacked") {
		opts.Stacked = true
	}
	if t := chart.first("title"); t != nil {
		var texts []string
		collectText(t, &texts)
		opts.Title = strings.TrimSpace(strings.Join(texts, ""))
	}

	// union the series references back into one bounding range
	haveRange := false
	uc1, ur1, uc2, ur2 := 0, 0, 0, 0
	extend := func(c1, r1, c2, r2 int) {
		if !haveRange {
			uc1, ur1, uc2, ur2 = c1, r1, c2, r2
			haveRange = true
			return
		}
		if c1 < uc1 {
			uc1 = c1
		}
		if r1 < ur1 {
			ur1 = r1
		}
		if c2 > uc2 {
			uc2 = c2
		}
		if r2 > ur2 {
			ur2 = r2
		}
	}
	refOf := func(n *xnode) (int, int, int, int, bool) {
		if n == nil {
			return 0, 0, 0, 0, false
		}
		for _, holder := range []string{"strRef", "numRef", "multiLvlStrRef"} {
			if ref := n.first(holder); ref != nil {
				if fn := ref.first("f"); fn != nil {
					return parseChartFormulaRange(fn.Text)
				}
			}
		}
		return 0, 0, 0, 0, false
	}

	headerRow, labelCol := false, false
	for _, ser := range plot.all("ser") {
		if c1, r1, c2, r2, ok := refOf(ser.first("tx")); ok {
			headerRow = true
			extend(c1, r1, c2, r2)
		}
		if c1, r1, c2, r2, ok := refOf(ser.first("cat")); ok {
			labelCol = true
			extend(c1, r1, c2, r2)
		}
		if c1, r1, c2, r2, ok := refOf(ser.first("val")); ok {
			extend(c1, r1, c2, r2)
		}
	}
	if !haveRange {
		return nil
	}

	hr, lc := headerRow, labelCol
	opts.HeaderRow = &hr
	opts.LabelCol = &lc
	return &xlsxChart{
		ID:    fmt.Sprintf("ch-xlsx-%d", idSeq),
		Range: cellRef(uc1, ur1) + ":" + cellRef(uc2, ur2),
		Opts:  opts,
	}
}

// parseSheetDrawing extracts every chart anchored on a worksheet drawing
// part and stores them on the WorkSheet in webapp JSON form
func parseSheetDrawing(files map[string][]byte, sheetPart string, sheetTree *xnode, ws *WorkSheet, idSeq *int) {
	dn := sheetTree.first("drawing")
	if dn == nil {
		return
	}
	rid := ""
	for _, a := range dn.Attrs {
		if a.Name.Local == "id" {
			rid = a.Value
		}
	}
	sheetDir := pathDir(sheetPart)
	sheetRels := parseRels(files[sheetDir+"/_rels/"+pathBase(sheetPart)+".rels"])
	target, ok := sheetRels[rid]
	if !ok {
		return
	}
	drawingPart := resolvePartPath(sheetDir, target)
	tree, err := parseXMLTree(files[drawingPart])
	if err != nil {
		return
	}
	drawDir := pathDir(drawingPart)
	drawRels := parseRels(files[drawDir+"/_rels/"+pathBase(drawingPart)+".rels"])

	var charts []*xlsxChart
	for i := range tree.Nodes {
		anchor := &tree.Nodes[i]
		switch anchor.XMLName.Local {
		case "absoluteAnchor", "oneCellAnchor", "twoCellAnchor":
		default:
			continue
		}
		chartRef := anchor.path("graphicFrame", "graphic", "graphicData", "chart")
		if chartRef == nil {
			continue
		}
		crid := ""
		for _, a := range chartRef.Attrs {
			if a.Name.Local == "id" {
				crid = a.Value
			}
		}
		chartTarget, ok := drawRels[crid]
		if !ok {
			continue
		}
		chartTree, err := parseXMLTree(files[resolvePartPath(drawDir, chartTarget)])
		if err != nil {
			continue
		}
		*idSeq++
		ch := parseChartPart(chartTree, *idSeq)
		if ch == nil {
			continue
		}
		ch.X, ch.Y, ch.W, ch.H = chartAnchorPx(anchor, ws)
		charts = append(charts, ch)
	}
	if len(charts) > 0 {
		if b, err := json.Marshal(charts); err == nil {
			ws.Charts = b
		}
	}
}

func pathDir(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[:i]
	}
	return "."
}
func pathBase(p string) string {
	if i := strings.LastIndex(p, "/"); i >= 0 {
		return p[i+1:]
	}
	return p
}
