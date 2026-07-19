package office

/*
	pdf_sheet.go - Build a PDF from a Sheets workbook with REAL text.

	Formula evaluation and number formatting live in the web client, so
	the client posts a "print model": per sheet, the used-range grid of
	formatted display strings plus the visual styles that affect print
	(bold/italic/underline, font and fill colors, alignment) and the
	column widths in CSS pixels. The server lays that grid out on A4
	landscape pages, scaling the columns down when the sheet is wider
	than the printable area and splitting rows across pages.
*/

import (
	"encoding/json"
	"errors"

	"github.com/go-pdf/fpdf"
)

// SheetPrintCell is one formatted cell in the print model
type SheetPrintCell struct {
	T  string `json:"t"`            // display text
	B  bool   `json:"b,omitempty"`  // bold
	I  bool   `json:"i,omitempty"`  // italic
	U  bool   `json:"u,omitempty"`  // underline
	Fc string `json:"fc,omitempty"` // font color  (#rrggbb)
	Bg string `json:"bg,omitempty"` // fill color  (#rrggbb)
	Al string `json:"al,omitempty"` // l | c | r
}

// SheetPrintSheet is one sheet's used-range grid
type SheetPrintSheet struct {
	Name string              `json:"name"`
	ColW []float64           `json:"colW"`           // column widths, css px
	RowH []float64           `json:"rowH,omitempty"` // row heights, css px
	Rows [][]*SheetPrintCell `json:"rows"`
}

// SheetPrintModel is the whole workbook print model
type SheetPrintModel struct {
	Sheets []*SheetPrintSheet `json:"sheets"`
}

// ParseSheetPrintJSON decodes the print model posted by sheets.js
func ParseSheetPrintJSON(jsonStr string) (*SheetPrintModel, error) {
	m := SheetPrintModel{}
	if err := json.Unmarshal([]byte(jsonStr), &m); err != nil {
		return nil, errors.New("invalid print model JSON: " + err.Error())
	}
	if len(m.Sheets) == 0 {
		return nil, errors.New("print model has no sheets")
	}
	return &m, nil
}

// BuildSheetPdf renders the print model into PDF bytes
func BuildSheetPdf(m *SheetPrintModel) ([]byte, error) {
	const marginMM = 12.0
	pdf := fpdf.New("L", "mm", "A4", "")
	pdf.SetMargins(marginMM, marginMM, marginMM)
	pdf.SetAutoPageBreak(false, marginMM)
	tr := pdfTr(pdf)
	pageW, pageH := pdf.GetPageSize()
	usableW := pageW - 2*marginMM

	for _, sheet := range m.Sheets {
		pdf.AddPage()
		// sheet name heading
		pdf.SetFont("Arial", "B", 12)
		pdf.SetTextColor(31, 35, 40)
		pdf.SetXY(marginMM, marginMM)
		pdf.CellFormat(usableW, 6, tr(sheet.Name), "", 1, "L", false, 0, "")
		pdf.SetY(pdf.GetY() + 2)

		if len(sheet.Rows) == 0 {
			continue
		}
		cols := 0
		for _, row := range sheet.Rows {
			if len(row) > cols {
				cols = len(row)
			}
		}
		if cols == 0 {
			continue
		}
		// column widths: px -> mm, scaled to fit the page when too wide
		widths := make([]float64, cols)
		total := 0.0
		for i := 0; i < cols; i++ {
			w := 100.0 * pxToMM
			if i < len(sheet.ColW) && sheet.ColW[i] > 0 {
				w = sheet.ColW[i] * pxToMM
			}
			widths[i] = w
			total += w
		}
		scale := 1.0
		if total > usableW {
			scale = usableW / total
			for i := range widths {
				widths[i] *= scale
			}
		}
		fontPt := 9.0 * scale
		if fontPt < 5 {
			fontPt = 5
		}

		for r, row := range sheet.Rows {
			rowH := 24.0 * pxToMM * scale
			if r < len(sheet.RowH) && sheet.RowH[r] > 0 {
				rowH = sheet.RowH[r] * pxToMM * scale
			}
			minH := fontPt*0.3528 + 1.6
			if rowH < minH {
				rowH = minH
			}
			if pdf.GetY()+rowH > pageH-marginMM {
				pdf.AddPage()
				pdf.SetY(marginMM)
			}
			x := marginMM
			y := pdf.GetY()
			pdf.SetDrawColor(190, 194, 200)
			pdf.SetLineWidth(0.15)
			for c := 0; c < cols; c++ {
				var cell *SheetPrintCell
				if c < len(row) {
					cell = row[c]
				}
				fill := false
				if cell != nil && cell.Bg != "" {
					fill = pdfSetFillHex(pdf, cell.Bg)
				}
				pdf.Rect(x, y, widths[c], rowH, map[bool]string{true: "FD", false: "D"}[fill])
				if cell != nil && cell.T != "" {
					pdf.SetFont("Arial", pdfStyleStr(cell.B, cell.I, cell.U), fontPt)
					pdfSetTextHex(pdf, cell.Fc, 31, 35, 40)
					align := map[string]string{"c": "C", "r": "R"}[cell.Al]
					if align == "" {
						align = "L"
					}
					pdf.SetXY(x+0.8, y)
					pdf.CellFormat(widths[c]-1.6, rowH, tr(cell.T), "", 0, align, false, 0, "")
				}
				x += widths[c]
			}
			pdf.SetY(y + rowH)
		}
	}
	if pdf.Err() {
		return nil, pdf.Error()
	}
	return pdfOutput(pdf)
}
