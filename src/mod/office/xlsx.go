package office

/*
	xlsx.go - shared types for the Excel (.xlsx) converters used by the
	Sheets webapp (src/web/Office/sheets). The JSON model mirrors the
	Sheets body schema documented in sheets.js.

	Legacy binary .xls (BIFF) is intentionally not supported.
*/

import (
	"encoding/json"
	"errors"
	"regexp"
	"strconv"
	"strings"
)

// Workbook is the Sheets document body
type Workbook struct {
	Sheets []*WorkSheet `json:"sheets"`
	Active int          `json:"active"`
}

// WorkSheet is one sheet tab
type WorkSheet struct {
	Name   string               `json:"name"`
	Color  string               `json:"color,omitempty"`
	Cols   int                  `json:"cols,omitempty"`
	Rows   int                  `json:"rows,omitempty"`
	Cells  map[string]*WorkCell `json:"cells"`
	ColW   map[string]float64   `json:"colW,omitempty"`
	RowH   map[string]float64   `json:"rowH,omitempty"`
	Merges []string             `json:"merges,omitempty"`
	Freeze *FreezePane          `json:"freeze,omitempty"`
	// Charts round-trip as native DrawingML chart parts (xlsx_charts.go);
	// Filter is a webapp-owned blob not representable in xlsx
	Charts json.RawMessage `json:"charts,omitempty"`
	Filter json.RawMessage `json:"filter,omitempty"`
}

// WorkCell holds the raw input ("=" prefix marks a formula) plus style
// and an optional cell note (round-tripped as an xlsx comment)
type WorkCell struct {
	V string     `json:"v"`
	S *CellStyle `json:"s,omitempty"`
	N string     `json:"n,omitempty"`
}

// CellStyle mirrors the "s" style object of sheets.js
type CellStyle struct {
	B    bool    `json:"b,omitempty"`
	I    bool    `json:"i,omitempty"`
	U    bool    `json:"u,omitempty"`
	Al   string  `json:"al,omitempty"`  // "l" | "c" | "r"
	Bg   string  `json:"bg,omitempty"`  // fill color
	Fc   string  `json:"fc,omitempty"`  // font color
	Fs   float64 `json:"fs,omitempty"`  // font size px
	Fmt  string  `json:"fmt,omitempty"` // general|number|percent|currency|date|text
	Dec  *int    `json:"dec,omitempty"` // decimals
	Wrap bool    `json:"wrap,omitempty"`
	Bd   int     `json:"bd,omitempty"` // 1 = thin borders
}

// FreezePane holds frozen row/column counts
type FreezePane struct {
	R int `json:"r"`
	C int `json:"c"`
}

// ParseWorkbookJSON decodes the Sheets body JSON into a Workbook
func ParseWorkbookJSON(jsonStr string) (*Workbook, error) {
	wb := Workbook{}
	if err := json.Unmarshal([]byte(jsonStr), &wb); err != nil {
		return nil, errors.New("invalid workbook JSON: " + err.Error())
	}
	if len(wb.Sheets) == 0 {
		return nil, errors.New("workbook contains no sheets")
	}
	return &wb, nil
}

// WorkbookToJSON serializes a Workbook back to the Sheets body JSON
func WorkbookToJSON(wb *Workbook) (string, error) {
	if wb == nil {
		return "", errors.New("nil workbook")
	}
	out, err := json.Marshal(wb)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

/* ---------- cell reference helpers (0-based) ---------- */

var cellKeyRe = regexp.MustCompile(`^([A-Za-z]{1,3})(\d+)$`)

func colName(i int) string {
	s := ""
	i = i + 1
	for i > 0 {
		m := (i - 1) % 26
		s = string(rune('A'+m)) + s
		i = (i - 1) / 26
	}
	return s
}

func colIndex(name string) int {
	n := 0
	for _, ch := range strings.ToUpper(name) {
		n = n*26 + int(ch-'A'+1)
	}
	return n - 1
}

func cellRef(col, row int) string {
	return colName(col) + strconv.Itoa(row+1)
}

func parseCellRef(ref string) (col, row int, ok bool) {
	m := cellKeyRe.FindStringSubmatch(strings.TrimSpace(ref))
	if m == nil {
		return 0, 0, false
	}
	r, err := strconv.Atoi(m[2])
	if err != nil || r < 1 {
		return 0, 0, false
	}
	return colIndex(m[1]), r - 1, true
}

// looksNumeric reports whether raw cell input parses as a plain number
var xlsxNumRe = regexp.MustCompile(`^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$`)

func looksNumeric(s string) bool {
	return xlsxNumRe.MatchString(strings.TrimSpace(s))
}

// px <-> Excel units: column width is in "characters" (~7px each at 96dpi),
// row height is in points
func pxToColChars(px float64) float64 { return px / 7.0 }
func colCharsToPx(ch float64) float64 { return ch * 7.0 }
func pxToRowPt(px float64) float64    { return px * 72.0 / 96.0 }
func rowPtToPx(pt float64) float64    { return pt * 96.0 / 72.0 }
