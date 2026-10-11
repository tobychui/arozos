package model

/*
	workbook.go - the Sheets document body (src/web/Office/sheets). The
	JSON model mirrors the Sheets body schema documented in sheets.js.

	Excel (.xlsx, .xls) and OpenDocument spreadsheets (.ods) both read
	into it; the cell reference and sheet naming rules here are the ones
	every converter shares.
*/

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// Workbook is the Sheets document body
type Workbook struct {
	Sheets []*WorkSheet   `json:"sheets"`
	Active int            `json:"active"`
	Names  []*DefinedName `json:"names,omitempty"`
}

/*
DefinedName is a workbook label for a range or value (SUM(Sales) instead
of SUM(Data!B2:B99)). Formula is the text it stands for, with a leading
"=" as the webapp stores it; Sheet is the index a sheet-local name
belongs to, or nil for a workbook-wide one.
*/
type DefinedName struct {
	Name    string `json:"name"`
	Formula string `json:"formula"`
	Sheet   *int   `json:"sheet,omitempty"`
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
	// HiddenRows lists 0-based rows the user hid (<row hidden="1"> in xlsx);
	// rows hidden by a filter are not in it
	HiddenRows []int `json:"hiddenRows,omitempty"`
	// Charts round-trip as native DrawingML chart parts (xlsx/charts.go);
	// Filter is the webapp's filter blob - its range becomes the sheet's
	// <autoFilter>, the hidden values stay the editor's own
	Charts json.RawMessage `json:"charts,omitempty"`
	Filter json.RawMessage `json:"filter,omitempty"`
	// conditional rule bodies, referenced by id from WorkCell.Cf
	// (xlsx/cf.go)
	CfDefs map[string]*CfRule `json:"cfDefs,omitempty"`
}

// WorkCell holds the raw input ("=" prefix marks a formula) plus style
// and an optional cell note (round-tripped as an xlsx comment)
type WorkCell struct {
	V string     `json:"v"`
	S *CellStyle `json:"s,omitempty"`
	N string     `json:"n,omitempty"`
	// A is the range a spilling (dynamic array) formula fills, e.g. "B2:B9".
	// The webapp sets it on export only; it marks the formula for Excel.
	A string `json:"a,omitempty"`
	// Cf lists the conditional rules this cell carries (WorkSheet.CfDefs)
	Cf []string `json:"cf,omitempty"`
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
	Ff   string  `json:"ff,omitempty"` // font family ("" = the workbook's default)
	St   bool    `json:"st,omitempty"` // strikethrough
	Va   string  `json:"va,omitempty"` // vertical alignment "t" | "m" | "b"
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

func ColName(i int) string {
	s := ""
	i = i + 1
	for i > 0 {
		m := (i - 1) % 26
		s = string(rune('A'+m)) + s
		i = (i - 1) / 26
	}
	return s
}

func ColIndex(name string) int {
	n := 0
	for _, ch := range strings.ToUpper(name) {
		n = n*26 + int(ch-'A'+1)
	}
	return n - 1
}

func CellRef(col, row int) string {
	return ColName(col) + strconv.Itoa(row+1)
}

func ParseCellRef(ref string) (col, row int, ok bool) {
	m := cellKeyRe.FindStringSubmatch(strings.TrimSpace(ref))
	if m == nil {
		return 0, 0, false
	}
	r, err := strconv.Atoi(m[2])
	if err != nil || r < 1 {
		return 0, 0, false
	}
	return ColIndex(m[1]), r - 1, true
}

// LooksNumeric reports whether raw cell input parses as a plain number
var xlsxNumRe = regexp.MustCompile(`^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$`)

func LooksNumeric(s string) bool {
	return xlsxNumRe.MatchString(strings.TrimSpace(s))
}

// CfRule is one conditional format rule body (sheet.cfDefs[id])
type CfRule struct {
	Anchor string    `json:"anchor,omitempty"`
	Type   string    `json:"type"`
	V1     CfOperand `json:"v1,omitempty"`
	V2     CfOperand `json:"v2,omitempty"`
	Style  *CfStyle  `json:"style,omitempty"`
}

// CfStyle is what a matching cell gets
type CfStyle struct {
	Bg string `json:"bg,omitempty"`
	Fc string `json:"fc,omitempty"`
	B  bool   `json:"b,omitempty"`
	I  bool   `json:"i,omitempty"`
	U  bool   `json:"u,omitempty"`
}

// CfOperand is an operand "as typed": the editor stores strings, but a
// number in the JSON is accepted as well
type CfOperand string

func (o *CfOperand) UnmarshalJSON(b []byte) error {
	var s string
	if err := json.Unmarshal(b, &s); err == nil {
		*o = CfOperand(s)
		return nil
	}
	var n json.Number
	if err := json.Unmarshal(b, &n); err == nil {
		*o = CfOperand(n.String())
		return nil
	}
	*o = ""
	return nil
}

// grid defaults must match sheets.js (DEF_COLW / DEF_ROWH)
const (
	DefaultColPx = 92.0
	DefaultRowPx = 24.0
)

// TextAsRaw keeps string-typed values as strings in the editor: text that
// would re-parse as a number/bool gets Excel's leading-quote escape
func TextAsRaw(s string) string {
	t := strings.TrimSpace(s)
	if t == "" {
		return s
	}
	up := strings.ToUpper(t)
	if LooksNumeric(t) || up == "TRUE" || up == "FALSE" || strings.HasPrefix(t, "=") || strings.HasPrefix(t, "'") {
		return "'" + s
	}
	return s
}

func SanitizeSheetName(name string, idx int, used map[string]bool) string {
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
