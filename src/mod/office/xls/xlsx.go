package xls

/*
	xlsx.go - write the decoded workbook as SpreadsheetML (.xlsx).

	BIFF and SpreadsheetML describe the same workbook model, so the
	conversion is mostly a change of notation: every XF record becomes a
	cellXfs entry at the same index (cells keep their style numbers), the
	font table is renumbered past BIFF's missing font 4, fills and borders
	are pooled, palette indices are resolved to RGB, and formulas are the
	decompiled text with their cached results. A hyperlink becomes a
	HYPERLINK() formula, which is how the Sheets editor carries links.
*/

import (
	"math"
	"sort"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/office/internal/opc"
	"imuslab.com/arozos/mod/office/internal/xmltree"
)

const (
	ctWorkbook = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"
	ctSheet    = "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"
	ctStyles   = "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"
	ctShared   = "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"
	ctComments = "application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"
	nsMain     = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"
	nsRel      = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
	relSheet   = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet"
	relShared  = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings"
	relComment = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments"
	relVML     = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/vmlDrawing"
)

// formats SpreadsheetML has built in; any other FORMAT record is written
// out as a numFmt
var builtinFormat = map[int]bool{
	0: true, 1: true, 2: true, 3: true, 4: true, 9: true, 10: true, 11: true, 12: true,
	13: true, 14: true, 15: true, 16: true, 17: true, 18: true, 19: true, 20: true,
	21: true, 22: true, 37: true, 38: true, 39: true, 40: true, 45: true, 46: true,
	47: true, 48: true, 49: true,
}

var borderStyles = []string{"", "thin", "medium", "dashed", "dotted", "thick", "double", "hair",
	"mediumDashed", "dashDot", "mediumDashDot", "dashDotDot", "mediumDashDotDot", "slantDashDot"}

var patternNames = []string{"none", "solid", "mediumGray", "darkGray", "lightGray", "darkHorizontal",
	"darkVertical", "darkDown", "darkUp", "darkGrid", "darkTrellis", "lightHorizontal",
	"lightVertical", "lightDown", "lightUp", "lightGrid", "lightTrellis", "gray125", "gray0625"}

var hAligns = []string{"", "left", "center", "right", "fill", "justify", "centerContinuous", "distributed"}
var vAligns = []string{"top", "center", "", "justify", "distributed"}

func esc(s string) string { return xmltree.Escape(s) }

func argb(c uint32) string { return "FF" + strings.ToUpper(hex6(c)) }

// isDateFormat reports a number format code that shows a date or time
func isDateFormat(id int, code string) bool {
	if (id >= 14 && id <= 22) || (id >= 45 && id <= 47) {
		return true
	}
	if code == "" {
		return false
	}
	inQuote := false
	lc := strings.ToLower(code)
	for i := 0; i < len(lc); i++ {
		ch := lc[i]
		switch {
		case ch == '"':
			inQuote = !inQuote
		case inQuote:
		case ch == '\\' || ch == '_' || ch == '*':
			i++
		case ch == '[':
			// [h], [mm] are elapsed time; [Red], [$-404] are not dates
			j := strings.IndexByte(lc[i:], ']')
			if j < 0 {
				return false
			}
			inner := lc[i+1 : i+j]
			if inner == "h" || inner == "hh" || inner == "m" || inner == "mm" || inner == "s" || inner == "ss" {
				return true
			}
			i += j
		case ch == 'y' || ch == 'd' || ch == 'h' || ch == 's':
			return true
		case ch == 'm':
			return true
		}
	}
	return false
}

// writeXlsx renders the book and its parsed sheets
func (b *book) writeXlsx(sheets []*sheet, sheetIndex []int) ([]byte, error) {
	pkg := opc.New()
	var rootRels opc.Rels
	rootRels.Add(opc.RelOfficeDocument, "xl/workbook.xml", false)
	pkg.AddXML("_rels/.rels", "", rootRels.XML())

	// shared strings
	sst := []string{}
	sstIdx := map[string]int{}
	str := func(s string) int {
		if i, ok := sstIdx[s]; ok {
			return i
		}
		sstIdx[s] = len(sst)
		sst = append(sst, s)
		return len(sst) - 1
	}

	styles, dateXF := b.stylesXML()

	var wbRels opc.Rels
	var sheetsXML strings.Builder
	for i, s := range sheets {
		rid := wbRels.Add(relSheet, "worksheets/sheet"+strconv.Itoa(i+1)+".xml", false)
		sheetsXML.WriteString(`<sheet name="` + esc(sheetName(s.name, i)) + `" sheetId="` + strconv.Itoa(i+1) + `" r:id="` + rid + `"/>`)
		body, comments, vml := b.sheetXML(s, str, dateXF)
		part := "xl/worksheets/sheet" + strconv.Itoa(i+1) + ".xml"
		if comments != "" {
			var sr opc.Rels
			cid := sr.Add(relComment, "../comments"+strconv.Itoa(i+1)+".xml", false)
			vid := sr.Add(relVML, "../drawings/vmlDrawing"+strconv.Itoa(i+1)+".vml", false)
			_ = cid
			body = strings.Replace(body, "</worksheet>", `<legacyDrawing r:id="`+vid+`"/></worksheet>`, 1)
			pkg.AddXML(opc.RelsPath(part), "", sr.XML())
			pkg.AddXML("xl/comments"+strconv.Itoa(i+1)+".xml", ctComments, comments)
			pkg.Add("xl/drawings/vmlDrawing"+strconv.Itoa(i+1)+".vml", "", []byte(vml))
		}
		pkg.AddXML(part, ctSheet, body)
	}
	wbRels.Add(opc.RelStyles, "styles.xml", false)
	wbRels.Add(relShared, "sharedStrings.xml", false)

	active := 0
	for i, idx := range sheetIndex {
		if idx == b.active {
			active = i
		}
	}
	var wb strings.Builder
	wb.WriteString(`<workbook xmlns="` + nsMain + `" xmlns:r="` + nsRel + `">`)
	wb.WriteString(`<workbookPr/>`)
	wb.WriteString(`<bookViews><workbookView activeTab="` + strconv.Itoa(active) + `"/></bookViews>`)
	wb.WriteString(`<sheets>` + sheetsXML.String() + `</sheets>`)
	wb.WriteString(b.definedNamesXML(sheetIndex))
	wb.WriteString(`</workbook>`)
	pkg.AddXML("xl/workbook.xml", ctWorkbook, wb.String())
	pkg.AddXML("xl/_rels/workbook.xml.rels", "", wbRels.XML())
	pkg.AddXML("xl/styles.xml", ctStyles, styles)

	var ss strings.Builder
	ss.WriteString(`<sst xmlns="` + nsMain + `" count="` + strconv.Itoa(len(sst)) + `" uniqueCount="` + strconv.Itoa(len(sst)) + `">`)
	for _, s := range sst {
		ss.WriteString(`<si><t xml:space="preserve">` + esc(xmlSafe(s)) + `</t></si>`)
	}
	ss.WriteString(`</sst>`)
	pkg.AddXML("xl/sharedStrings.xml", ctShared, ss.String())
	return pkg.Bytes()
}

// sheetName keeps a name SpreadsheetML accepts (no []:*?/\, 31 chars)
func sheetName(name string, i int) string {
	n := strings.Map(func(r rune) rune {
		if strings.ContainsRune(`[]:*?/\`, r) {
			return '_'
		}
		return r
	}, name)
	if r := []rune(n); len(r) > 31 {
		n = string(r[:31])
	}
	if strings.TrimSpace(n) == "" {
		n = "Sheet" + strconv.Itoa(i+1)
	}
	return n
}

// xmlSafe drops the control characters XML 1.0 cannot hold
func xmlSafe(s string) string {
	return strings.Map(func(r rune) rune {
		if r < 0x20 && r != '\t' && r != '\n' && r != '\r' {
			return -1
		}
		if r == 0xFFFE || r == 0xFFFF {
			return -1
		}
		return r
	}, s)
}

// defaultXF is the cell format of a cell that states none: the first
// cell (not style) XF, number 15 in files Excel writes
func (b *book) defaultXF() int {
	if b.defXF < 0 {
		b.defXF = 0
		for i, x := range b.xfs {
			if !x.style {
				b.defXF = i
				break
			}
		}
	}
	return b.defXF
}

// cellStyle is the cellXfs index a cell's XF becomes: the default cell
// format is written as entry 0, so a plain cell carries no style at all
func (b *book) cellStyle(xf int) int {
	if xf == b.defaultXF() || xf < 0 || xf >= len(b.xfs) {
		return 0
	}
	return xf
}

// stylesXML renders styles.xml; dateXF marks the XFs whose number format
// shows a date (for the 1904 date system shift)
func (b *book) stylesXML() (string, map[int]bool) {
	var sb strings.Builder
	sb.WriteString(`<styleSheet xmlns="` + nsMain + `">`)

	// number formats
	var ids []int
	for id := range b.formats {
		if !builtinFormat[id] {
			ids = append(ids, id)
		}
	}
	sort.Ints(ids)
	if len(ids) > 0 {
		sb.WriteString(`<numFmts count="` + strconv.Itoa(len(ids)) + `">`)
		for _, id := range ids {
			sb.WriteString(`<numFmt numFmtId="` + strconv.Itoa(id) + `" formatCode="` + esc(b.formats[id]) + `"/>`)
		}
		sb.WriteString(`</numFmts>`)
	}

	// fonts: renumbered past BIFF's missing font 4, plus a copy of a font
	// for each exact text colour an XFEXT gives it
	var fontXML []string
	fontIdx := map[string]int{}
	fontFor := func(fi int, color *uint32) int {
		if fi < 0 || fi >= len(b.fonts) || b.fonts[fi] == nil {
			fi = 0
			if len(b.fonts) == 0 || b.fonts[0] == nil {
				return 0
			}
		}
		f := b.fonts[fi]
		var x strings.Builder
		x.WriteString(`<font>`)
		if f.bold {
			x.WriteString(`<b/>`)
		}
		if f.italic {
			x.WriteString(`<i/>`)
		}
		if f.strike {
			x.WriteString(`<strike/>`)
		}
		switch f.underline {
		case 1:
			x.WriteString(`<u/>`)
		case 2:
			x.WriteString(`<u val="double"/>`)
		case 0x21:
			x.WriteString(`<u val="singleAccounting"/>`)
		case 0x22:
			x.WriteString(`<u val="doubleAccounting"/>`)
		}
		switch f.script {
		case 1:
			x.WriteString(`<vertAlign val="superscript"/>`)
		case 2:
			x.WriteString(`<vertAlign val="subscript"/>`)
		}
		x.WriteString(`<sz val="` + strconv.FormatFloat(float64(f.height)/20, 'f', -1, 64) + `"/>`)
		if color != nil {
			x.WriteString(`<color rgb="` + argb(*color) + `"/>`)
		} else if c, auto := b.color(f.color, 0); !auto {
			x.WriteString(`<color rgb="` + argb(c) + `"/>`)
		}
		name := f.name
		if name == "" {
			name = "Arial"
		}
		x.WriteString(`<name val="` + esc(name) + `"/></font>`)
		key := x.String()
		if id, ok := fontIdx[key]; ok {
			return id
		}
		fontIdx[key] = len(fontXML)
		fontXML = append(fontXML, key)
		return len(fontXML) - 1
	}
	// font 0 is the workbook's default font (what the Normal style uses)
	if len(b.fonts) > 0 && b.fonts[0] != nil {
		fontFor(0, nil)
	}

	// fills and borders are pooled
	fillXML := []string{`<fill><patternFill patternType="none"/></fill>`, `<fill><patternFill patternType="gray125"/></fill>`}
	fillIdx := map[string]int{}
	borderXML := []string{`<border><left/><right/><top/><bottom/><diagonal/></border>`}
	borderIdx := map[string]int{borderXML[0]: 0}
	sysColor := func(idx uint16, fg bool) uint32 {
		if c, auto := b.color(idx, 0); !auto {
			return c
		}
		if idx == 64 && fg {
			return 0x000000
		}
		return 0xFFFFFF
	}
	line := func(tag string, l borderLine, exact *uint32) string {
		if l.style == 0 || int(l.style) >= len(borderStyles) {
			return "<" + tag + "/>"
		}
		out := "<" + tag + ` style="` + borderStyles[l.style] + `">`
		if exact != nil {
			out += `<color rgb="` + argb(*exact) + `"/>`
		} else if c, auto := b.color(l.color, 0); !auto {
			out += `<color rgb="` + argb(c) + `"/>`
		} else {
			out += `<color auto="1"/>`
		}
		return out + "</" + tag + ">"
	}

	xfXML := func(i int) (string, bool) {
		x := b.xfs[i]
		ext := b.xfExts[i]
		if ext == nil {
			ext = &xfExt{}
		}
		fill := 0
		if x.pattern > 0 && int(x.pattern) < len(patternNames) {
			fg := sysColor(x.fg, x.pattern != 1)
			if ext.fg != nil {
				fg = *ext.fg
			}
			var f string
			if x.pattern == 1 {
				f = `<fill><patternFill patternType="solid"><fgColor rgb="` + argb(fg) + `"/><bgColor indexed="64"/></patternFill></fill>`
			} else {
				bg := sysColor(x.bg, false)
				if ext.bg != nil {
					bg = *ext.bg
				}
				f = `<fill><patternFill patternType="` + patternNames[x.pattern] + `"><fgColor rgb="` + argb(fg) +
					`"/><bgColor rgb="` + argb(bg) + `"/></patternFill></fill>`
			}
			id, ok := fillIdx[f]
			if !ok {
				id = len(fillXML)
				fillIdx[f] = id
				fillXML = append(fillXML, f)
			}
			fill = id
		}
		bx := `<border>` + line("left", x.left, ext.left) + line("right", x.right, ext.right) +
			line("top", x.top, ext.top) + line("bottom", x.bottom, ext.bottom) + `<diagonal/></border>`
		border, ok := borderIdx[bx]
		if !ok {
			border = len(borderXML)
			borderIdx[bx] = border
			borderXML = append(borderXML, bx)
		}
		fid := fontFor(x.font, ext.text)
		var xs strings.Builder
		xs.WriteString(`<xf numFmtId="` + strconv.Itoa(x.format) + `" fontId="` + strconv.Itoa(fid) + `" fillId="` + strconv.Itoa(fill) +
			`" borderId="` + strconv.Itoa(border) + `" xfId="0"`)
		if x.format != 0 {
			xs.WriteString(` applyNumberFormat="1"`)
		}
		if fid != 0 {
			xs.WriteString(` applyFont="1"`)
		}
		if fill != 0 {
			xs.WriteString(` applyFill="1"`)
		}
		if border != 0 {
			xs.WriteString(` applyBorder="1"`)
		}
		align := ""
		if int(x.hAlign) < len(hAligns) && hAligns[x.hAlign] != "" {
			align += ` horizontal="` + hAligns[x.hAlign] + `"`
		}
		if int(x.vAlign) < len(vAligns) && vAligns[x.vAlign] != "" {
			align += ` vertical="` + vAligns[x.vAlign] + `"`
		}
		if x.wrap {
			align += ` wrapText="1"`
		}
		if x.shrink {
			align += ` shrinkToFit="1"`
		}
		if x.indent > 0 {
			align += ` indent="` + strconv.Itoa(x.indent) + `"`
		}
		if x.rotation > 0 && x.rotation <= 180 || x.rotation == 255 {
			align += ` textRotation="` + strconv.Itoa(x.rotation) + `"`
		}
		if align != "" {
			xs.WriteString(` applyAlignment="1"><alignment` + align + `/></xf>`)
		} else {
			xs.WriteString(`/>`)
		}
		return xs.String(), isDateFormat(x.format, b.formats[x.format])
	}

	var xfs strings.Builder
	dateXF := map[int]bool{}
	def := b.defaultXF()
	for i := range b.xfs {
		// entry 0 is written as the default cell format (cellStyle)
		src := i
		if i == 0 {
			src = def
		}
		x, isDate := xfXML(src)
		xfs.WriteString(x)
		if isDate {
			dateXF[i] = true
		}
	}
	if len(b.xfs) == 0 {
		xfs.WriteString(`<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`)
	}
	if len(fontXML) == 0 {
		fontXML = append(fontXML, `<font><sz val="10"/><name val="Arial"/></font>`)
	}
	sb.WriteString(`<fonts count="` + strconv.Itoa(len(fontXML)) + `">` + strings.Join(fontXML, "") + `</fonts>`)
	sb.WriteString(`<fills count="` + strconv.Itoa(len(fillXML)) + `">` + strings.Join(fillXML, "") + `</fills>`)
	sb.WriteString(`<borders count="` + strconv.Itoa(len(borderXML)) + `">` + strings.Join(borderXML, "") + `</borders>`)
	sb.WriteString(`<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>`)
	n := len(b.xfs)
	if n == 0 {
		n = 1
	}
	sb.WriteString(`<cellXfs count="` + strconv.Itoa(n) + `">` + xfs.String() + `</cellXfs>`)
	sb.WriteString(`<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>`)
	sb.WriteString(`</styleSheet>`)
	return sb.String(), dateXF
}

func formatValue(v float64) string {
	if math.IsInf(v, 0) || math.IsNaN(v) {
		return "0"
	}
	return strconv.FormatFloat(v, 'g', -1, 64)
}

// sheetXML renders one worksheet plus its comments part and the VML that
// Excel needs to show them
func (b *book) sheetXML(s *sheet, str func(string) int, dateXF map[int]bool) (string, string, string) {
	var sb strings.Builder
	sb.WriteString(`<worksheet xmlns="` + nsMain + `" xmlns:r="` + nsRel + `">`)
	if s.tabColor != "" {
		sb.WriteString(`<sheetPr><tabColor rgb="FF` + strings.ToUpper(s.tabColor) + `"/></sheetPr>`)
	}
	sb.WriteString(`<dimension ref="A1:` + cellText(s.maxRow, s.maxCol, true, true) + `"/>`)
	sb.WriteString(`<sheetViews><sheetView workbookViewId="0"`)
	if s.selected {
		sb.WriteString(` tabSelected="1"`)
	}
	if s.frozenR > 0 || s.frozenC > 0 {
		pane := "bottomRight"
		switch {
		case s.frozenR == 0:
			pane = "topRight"
		case s.frozenC == 0:
			pane = "bottomLeft"
		}
		sb.WriteString(`><pane`)
		if s.frozenC > 0 {
			sb.WriteString(` xSplit="` + strconv.Itoa(s.frozenC) + `"`)
		}
		if s.frozenR > 0 {
			sb.WriteString(` ySplit="` + strconv.Itoa(s.frozenR) + `"`)
		}
		sb.WriteString(` topLeftCell="` + cellText(s.frozenR, s.frozenC, true, true) + `" activePane="` + pane + `" state="frozen"/></sheetView>`)
	} else {
		sb.WriteString(`/>`)
	}
	sb.WriteString(`</sheetViews>`)
	sb.WriteString(`<sheetFormatPr defaultRowHeight="` + strconv.FormatFloat(s.defRowHeight, 'f', -1, 64) + `"`)
	if s.defColWidth > 0 {
		sb.WriteString(` defaultColWidth="` + strconv.FormatFloat(s.defColWidth, 'f', 2, 64) + `"`)
	}
	sb.WriteString(`/>`)

	if len(s.cols) > 0 {
		cols := append([]colInfo(nil), s.cols...)
		sort.Slice(cols, func(i, j int) bool { return cols[i].first < cols[j].first })
		sb.WriteString(`<cols>`)
		for _, c := range cols {
			sb.WriteString(`<col min="` + strconv.Itoa(c.first+1) + `" max="` + strconv.Itoa(c.last+1) +
				`" width="` + strconv.FormatFloat(c.width, 'f', 2, 64) + `" customWidth="1"`)
			if c.hidden {
				sb.WriteString(` hidden="1"`)
			}
			if st := b.cellStyle(c.xf); st > 0 {
				sb.WriteString(` style="` + strconv.Itoa(st) + `"`)
			}
			sb.WriteString(`/>`)
		}
		sb.WriteString(`</cols>`)
	}

	// rows: every row with cells or row formatting, in order
	byRow := map[int][]*cell{}
	for _, c := range s.cells {
		byRow[c.row] = append(byRow[c.row], c)
	}
	var rows []int
	seen := map[int]bool{}
	for r := range byRow {
		rows = append(rows, r)
		seen[r] = true
	}
	for r, ri := range s.rows {
		if !seen[r] && (ri.custom || ri.hidden || ri.hasXF) {
			rows = append(rows, r)
		}
	}
	sort.Ints(rows)
	sb.WriteString(`<sheetData>`)
	for _, r := range rows {
		sb.WriteString(`<row r="` + strconv.Itoa(r+1) + `"`)
		if ri, ok := s.rows[r]; ok {
			if ri.custom && ri.height > 0 {
				sb.WriteString(` ht="` + strconv.FormatFloat(ri.height, 'f', -1, 64) + `" customHeight="1"`)
			}
			if ri.hidden {
				sb.WriteString(` hidden="1"`)
			}
			if st := b.cellStyle(ri.xf); ri.hasXF && st > 0 {
				sb.WriteString(` s="` + strconv.Itoa(st) + `" customFormat="1"`)
			}
		}
		cells := byRow[r]
		sort.Slice(cells, func(i, j int) bool { return cells[i].col < cells[j].col })
		if len(cells) == 0 {
			sb.WriteString(`/>`)
			continue
		}
		sb.WriteString(`>`)
		for _, c := range cells {
			b.writeCell(&sb, c, str, dateXF)
		}
		sb.WriteString(`</row>`)
	}
	sb.WriteString(`</sheetData>`)

	if len(s.merges) > 0 {
		sb.WriteString(`<mergeCells count="` + strconv.Itoa(len(s.merges)) + `">`)
		for _, m := range s.merges {
			sb.WriteString(`<mergeCell ref="` + cellText(m[0], m[1], true, true) + ":" + cellText(m[2], m[3], true, true) + `"/>`)
		}
		sb.WriteString(`</mergeCells>`)
	}
	sb.WriteString(`</worksheet>`)

	if len(s.notes) == 0 {
		return sb.String(), "", ""
	}
	authors := []string{}
	authorIdx := map[string]int{}
	var cl strings.Builder
	var vml strings.Builder
	vml.WriteString(`<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">`)
	vml.WriteString(`<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>`)
	for i, n := range s.notes {
		ai, ok := authorIdx[n.author]
		if !ok {
			ai = len(authors)
			authorIdx[n.author] = ai
			authors = append(authors, n.author)
		}
		cl.WriteString(`<comment ref="` + cellText(n.row, n.col, true, true) + `" authorId="` + strconv.Itoa(ai) + `"><text><t xml:space="preserve">` +
			esc(xmlSafe(n.text)) + `</t></text></comment>`)
		vml.WriteString(`<v:shape id="_x0000_s` + strconv.Itoa(1025+i) + `" type="#_x0000_t202" style="position:absolute;visibility:hidden;width:108pt;height:59pt" fillcolor="#ffffe1" o:insetmode="auto">` +
			`<v:fill color2="#ffffe1"/><v:shadow on="t" color="black" obscured="t"/><v:path o:connecttype="none"/><v:textbox/>` +
			`<x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill>` +
			`<x:Row>` + strconv.Itoa(n.row) + `</x:Row><x:Column>` + strconv.Itoa(n.col) + `</x:Column></x:ClientData></v:shape>`)
	}
	vml.WriteString(`</xml>`)
	var cm strings.Builder
	cm.WriteString(`<comments xmlns="` + nsMain + `"><authors>`)
	for _, a := range authors {
		cm.WriteString(`<author>` + esc(xmlSafe(a)) + `</author>`)
	}
	cm.WriteString(`</authors><commentList>` + cl.String() + `</commentList></comments>`)
	return sb.String(), cm.String(), vml.String()
}

// writeCell renders one <c>
func (b *book) writeCell(sb *strings.Builder, c *cell, str func(string) int, dateXF map[int]bool) {
	ref := cellText(c.row, c.col, true, true)
	sb.WriteString(`<c r="` + ref + `"`)
	if st := b.cellStyle(c.xf); st > 0 {
		sb.WriteString(` s="` + strconv.Itoa(st) + `"`)
	}
	num := c.num
	if b.date1904 && c.kind == ckNumber && dateXF[b.cellStyle(c.xf)] {
		num += 1462 // to the 1900 date system the .xlsx is written in
	}
	formula := c.formula
	if formula == "" && c.link != "" {
		// a link on a constant: carried as a HYPERLINK formula
		label := ""
		switch c.kind {
		case ckString:
			label = quoteString(c.str)
		case ckNumber:
			label = formatValue(num)
		}
		formula = "HYPERLINK(" + quoteString(c.link) + ","
		if label == "" {
			label = quoteString(c.link)
			c.kind, c.str = ckString, c.link
		}
		formula += label + ")"
	}
	if formula != "" {
		switch c.kind {
		case ckString:
			sb.WriteString(` t="str"`)
		case ckBool:
			sb.WriteString(` t="b"`)
		case ckError:
			sb.WriteString(` t="e"`)
		}
		sb.WriteString(`><f`)
		if c.array != "" {
			sb.WriteString(` t="array" ref="` + c.array + `"`)
		}
		sb.WriteString(`>` + esc(xmlSafe(formula)) + `</f>`)
		switch c.kind {
		case ckNumber:
			sb.WriteString(`<v>` + formatValue(num) + `</v>`)
		case ckString:
			sb.WriteString(`<v>` + esc(xmlSafe(c.str)) + `</v>`)
		case ckBool:
			if c.bval {
				sb.WriteString(`<v>1</v>`)
			} else {
				sb.WriteString(`<v>0</v>`)
			}
		case ckError:
			sb.WriteString(`<v>` + errText(c.errc) + `</v>`)
		}
		sb.WriteString(`</c>`)
		return
	}
	switch c.kind {
	case ckNumber:
		sb.WriteString(`><v>` + formatValue(num) + `</v></c>`)
	case ckString:
		sb.WriteString(` t="s"><v>` + strconv.Itoa(str(c.str)) + `</v></c>`)
	case ckBool:
		if c.bval {
			sb.WriteString(` t="b"><v>1</v></c>`)
		} else {
			sb.WriteString(` t="b"><v>0</v></c>`)
		}
	case ckError:
		sb.WriteString(` t="e"><v>` + errText(c.errc) + `</v></c>`)
	default:
		sb.WriteString(`/>`)
	}
}

// definedNamesXML renders the workbook's names; sheetIndex maps output
// sheets to BOUNDSHEET indices
func (b *book) definedNamesXML(sheetIndex []int) string {
	outIdx := map[int]int{}
	for i, idx := range sheetIndex {
		outIdx[idx] = i
	}
	var items []string
	for _, dn := range b.names {
		if len(dn.rgce) == 0 || dn.name == "" {
			continue
		}
		f, err := b.decompileName(dn.rgce, dn.rgcb)
		if err != nil || f == "" || f == "#REF!" {
			continue
		}
		name := dn.name
		if dn.builtin {
			name = "_xlnm." + name
		}
		item := `<definedName name="` + esc(xmlSafe(name)) + `"`
		if dn.local > 0 {
			oi, ok := outIdx[dn.local-1]
			if !ok {
				continue // a name local to a sheet that is not written
			}
			item += ` localSheetId="` + strconv.Itoa(oi) + `"`
		}
		if dn.hidden {
			item += ` hidden="1"`
		}
		items = append(items, item+`>`+esc(xmlSafe(f))+`</definedName>`)
	}
	if len(items) == 0 {
		return ""
	}
	return `<definedNames>` + strings.Join(items, "") + `</definedNames>`
}
