package office

/*
	ods_writer.go - Build an OpenDocument Spreadsheet (.ods) from a Workbook.

	Covers the xlsx writer's subset: numbers / strings / booleans, formulas
	(rewritten to ODF "of:=" syntax with [.A1] references so LibreOffice
	recalculates them), cell styles (bold/italic/underline, colors, fill,
	alignment), column widths, row heights, merged cells and cell notes
	(office:annotation). Charts and filters are not representable.
*/

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// cell references (optionally absolute / ranges) outside string literals
var odsRefRe = regexp.MustCompile(`(\$?[A-Za-z]{1,3}\$?\d+)(:(\$?[A-Za-z]{1,3}\$?\d+))?`)

// formulaToOdf rewrites "=SUM(A1:B2)+C3" into `of:=SUM([.A1:.B2])+[.C3]`
func formulaToOdf(f string) string {
	f = strings.TrimPrefix(f, "=")
	var out strings.Builder
	inStr := false
	seg := strings.Builder{}
	flush := func() {
		out.WriteString(odsRefRe.ReplaceAllStringFunc(seg.String(), func(m string) string {
			if i := strings.Index(m, ":"); i >= 0 {
				return "[." + m[:i] + ":." + m[i+1:] + "]"
			}
			return "[." + m + "]"
		}))
		seg.Reset()
	}
	for _, r := range f {
		if r == '"' {
			if inStr {
				out.WriteString(seg.String())
				seg.Reset()
			} else {
				flush()
			}
			inStr = !inStr
			out.WriteRune(r)
			continue
		}
		seg.WriteRune(r)
	}
	if inStr {
		out.WriteString(seg.String())
	} else {
		flush()
	}
	return "of:=" + out.String()
}

// odfFormulaRe strips "[.A1]" / "[.A1:.B2]" / "[Sheet.A1]" back to plain refs
var odfBracketRe = regexp.MustCompile(`\[([^\]]+)\]`)

// formulaFromOdf rewrites `of:=SUM([.A1:.B2])` back into "=SUM(A1:B2)"
func formulaFromOdf(f string) string {
	f = strings.TrimPrefix(f, "of:")
	f = strings.TrimPrefix(f, "=")
	f = odfBracketRe.ReplaceAllStringFunc(f, func(m string) string {
		inner := m[1 : len(m)-1]
		parts := strings.Split(inner, ":")
		for i, p := range parts {
			// ".A1" (same sheet) or "Sheet1.A1" - keep the part after the dot
			if j := strings.LastIndex(p, "."); j >= 0 {
				parts[i] = p[j+1:]
			}
		}
		return strings.Join(parts, ":")
	})
	return "=" + f
}

// BuildOds serializes a Workbook into a complete .ods file
func BuildOds(wb *Workbook) ([]byte, error) {
	var body strings.Builder
	var styles strings.Builder
	styleSeq := 0
	newStyle := func(family, props string) string {
		styleSeq++
		name := fmt.Sprintf("S%d", styleSeq)
		styles.WriteString(`<style:style style:name="` + name + `" style:family="` + family + `">` +
			props + `</style:style>`)
		return name
	}
	cellStyleCache := map[string]string{}
	cellStyleFor := func(s *CellStyle) string {
		if s == nil {
			return ""
		}
		sig := fmt.Sprintf("%v|%v|%v|%s|%s|%s|%v|%v", s.B, s.I, s.U, s.Al, s.Bg, s.Fc, s.Fs, s.Bd)
		if n, ok := cellStyleCache[sig]; ok {
			return n
		}
		tp := ""
		if s.B {
			tp += ` fo:font-weight="bold"`
		}
		if s.I {
			tp += ` fo:font-style="italic"`
		}
		if s.U {
			tp += ` style:text-underline-style="solid"`
		}
		if s.Fc != "" {
			tp += ` fo:color="#` + hexColor(s.Fc, "000000") + `"`
		}
		if s.Fs > 0 {
			tp += fmt.Sprintf(` fo:font-size="%.1fpt"`, s.Fs*72.0/96.0)
		}
		cp := ""
		if s.Bg != "" {
			cp += ` fo:background-color="#` + hexColor(s.Bg, "FFFFFF") + `"`
		}
		if s.Bd != 0 {
			cp += ` fo:border="0.5pt solid #666666"`
		}
		pp := ""
		switch s.Al {
		case "c":
			pp = `<style:paragraph-properties fo:text-align="center"/>`
		case "r":
			pp = `<style:paragraph-properties fo:text-align="end"/>`
		case "l":
			pp = `<style:paragraph-properties fo:text-align="start"/>`
		}
		props := ""
		if cp != "" {
			props += `<style:table-cell-properties` + cp + `/>`
		}
		if pp != "" {
			props += pp
		}
		if tp != "" {
			props += `<style:text-properties` + tp + `/>`
		}
		if props == "" {
			return ""
		}
		n := newStyle("table-cell", props)
		cellStyleCache[sig] = n
		return n
	}

	usedNames := map[string]bool{}
	for si, ws := range wb.Sheets {
		name := sanitizeSheetName(ws.Name, si, usedNames)
		body.WriteString(`<table:table table:name="` + xmlEscape(name) + `">`)

		// merge map: anchor -> span, covered set
		type span struct{ cs, rs int }
		anchors := map[string]span{}
		covered := map[string]bool{}
		for _, m := range ws.Merges {
			parts := strings.Split(m, ":")
			if len(parts) != 2 {
				continue
			}
			c1, r1, ok1 := parseCellRef(parts[0])
			c2, r2, ok2 := parseCellRef(parts[1])
			if !ok1 || !ok2 || c2 < c1 || r2 < r1 {
				continue
			}
			anchors[cellRef(c1, r1)] = span{cs: c2 - c1 + 1, rs: r2 - r1 + 1}
			for r := r1; r <= r2; r++ {
				for c := c1; c <= c2; c++ {
					if c == c1 && r == r1 {
						continue
					}
					covered[cellRef(c, r)] = true
				}
			}
		}

		// used extents (merged areas count even without cell content)
		maxCol, maxRow := 0, 0
		for key := range ws.Cells {
			if c, r, ok := parseCellRef(key); ok {
				if c > maxCol {
					maxCol = c
				}
				if r > maxRow {
					maxRow = r
				}
			}
		}
		for key, sp := range anchors {
			if c, r, ok := parseCellRef(key); ok {
				if c+sp.cs-1 > maxCol {
					maxCol = c + sp.cs - 1
				}
				if r+sp.rs-1 > maxRow {
					maxRow = r + sp.rs - 1
				}
			}
		}

		// columns (width styles)
		for c := 0; c <= maxCol; c++ {
			w := xlsxDefColPx
			if v, ok := ws.ColW[strconv.Itoa(c)]; ok && v > 0 {
				w = v
			}
			cs := newStyle("table-column",
				`<style:table-column-properties style:column-width="`+pxToCm(w)+`"/>`)
			body.WriteString(`<table:table-column table:style-name="` + cs + `"/>`)
		}

		for r := 0; r <= maxRow; r++ {
			rowAttr := ""
			if h, ok := ws.RowH[strconv.Itoa(r)]; ok && h > 0 {
				rs := newStyle("table-row",
					`<style:table-row-properties style:row-height="`+pxToCm(h)+`" style:use-optimal-row-height="false"/>`)
				rowAttr = ` table:style-name="` + rs + `"`
			}
			body.WriteString(`<table:table-row` + rowAttr + `>`)
			for c := 0; c <= maxCol; c++ {
				key := cellRef(c, r)
				if covered[key] {
					body.WriteString(`<table:covered-table-cell/>`)
					continue
				}
				cell := ws.Cells[key]
				attrs := ""
				if cell != nil {
					if sn := cellStyleFor(cell.S); sn != "" {
						attrs += ` table:style-name="` + sn + `"`
					}
				}
				if sp, ok := anchors[key]; ok {
					attrs += fmt.Sprintf(` table:number-columns-spanned="%d" table:number-rows-spanned="%d"`, sp.cs, sp.rs)
				}
				inner := ""
				if cell != nil {
					v := cell.V
					switch {
					case strings.HasPrefix(v, "="):
						attrs += ` table:formula="` + xmlEscape(formulaToOdf(v)) + `"` +
							` office:value-type="float" office:value="0"`
					case strings.HasPrefix(v, "'"):
						attrs += ` office:value-type="string"`
						inner = `<text:p>` + xmlEscape(v[1:]) + `</text:p>`
					case looksNumeric(v):
						attrs += ` office:value-type="float" office:value="` + xmlEscape(strings.TrimSpace(v)) + `"`
						inner = `<text:p>` + xmlEscape(strings.TrimSpace(v)) + `</text:p>`
					case strings.EqualFold(strings.TrimSpace(v), "TRUE") || strings.EqualFold(strings.TrimSpace(v), "FALSE"):
						bv := "false"
						if strings.EqualFold(strings.TrimSpace(v), "TRUE") {
							bv = "true"
						}
						attrs += ` office:value-type="boolean" office:boolean-value="` + bv + `"`
						inner = `<text:p>` + xmlEscape(strings.ToUpper(strings.TrimSpace(v))) + `</text:p>`
					case v != "":
						attrs += ` office:value-type="string"`
						inner = `<text:p>` + xmlEscape(v) + `</text:p>`
					}
					if strings.TrimSpace(cell.N) != "" {
						inner = `<office:annotation><text:p>` + xmlEscape(cell.N) + `</text:p></office:annotation>` + inner
					}
				}
				if attrs == "" && inner == "" {
					body.WriteString(`<table:table-cell/>`)
				} else {
					body.WriteString(`<table:table-cell` + attrs + `>` + inner + `</table:table-cell>`)
				}
			}
			body.WriteString(`</table:table-row>`)
		}
		body.WriteString(`</table:table>`)
	}

	content := `<?xml version="1.0" encoding="UTF-8"?>` + "\n" +
		`<office:document-content ` + odfNs + `>` +
		`<office:automatic-styles>` + styles.String() + `</office:automatic-styles>` +
		`<office:body><office:spreadsheet>` + body.String() + `</office:spreadsheet></office:body>` +
		`</office:document-content>`

	stylesXML := `<?xml version="1.0" encoding="UTF-8"?>` + "\n" +
		`<office:document-styles ` + odfNs + `></office:document-styles>`

	return buildOdfZip(odsMime, map[string]string{
		"content.xml": content,
		"styles.xml":  stylesXML,
		"meta.xml":    odfMeta(),
	}, nil)
}
