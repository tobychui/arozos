package office

/*
	xlsx_formula.go - Shared formulas.

	Excel stores a filled-down formula once: the first cell carries
	<f t="shared" ref="K3:K66" si="0">B3-C3</f> and every other cell in
	the block only <f t="shared" si="0"/>. Each follower's own formula is
	the master's with its relative references moved by the follower's
	offset from the master, so K4 is B4-C4.
*/

import (
	"strconv"
	"strings"
)

type sharedFormula struct {
	text     string
	col, row int
}

// shiftFormulaRefs moves every relative cell reference in an A1-style
// formula (without the leading "=") by dCol columns and dRow rows. $-anchored
// parts stay, string literals and quoted sheet names are left alone, and a
// reference pushed off the grid becomes #REF!.
func shiftFormulaRefs(f string, dCol, dRow int) string {
	if dCol == 0 && dRow == 0 {
		return f
	}
	var out strings.Builder
	n := len(f)
	for i := 0; i < n; {
		ch := f[i]
		if ch == '"' || ch == '\'' {
			// copy a "string" or 'sheet name' through, honouring doubled quotes
			j := i + 1
			for j < n {
				if f[j] == ch {
					if j+1 < n && f[j+1] == ch {
						j += 2
						continue
					}
					break
				}
				j++
			}
			if j < n {
				j++
			}
			out.WriteString(f[i:j])
			i = j
			continue
		}
		if (ch == '$' || isASCIILetter(ch)) && (i == 0 || !isFormulaIdentChar(f[i-1])) {
			if ref, l, ok := matchCellRef(f[i:]); ok {
				out.WriteString(ref.shifted(dCol, dRow))
				i += l
				continue
			}
			// not a reference: copy the whole identifier so its tail is not
			// mistaken for one (LOG10 must not turn into LOG11)
			j := i + 1
			for j < n && isFormulaIdentChar(f[j]) {
				j++
			}
			out.WriteString(f[i:j])
			i = j
			continue
		}
		out.WriteByte(ch)
		i++
	}
	return out.String()
}

type a1Ref struct {
	absC, absR bool
	col, row   int // 0-based
}

func (r a1Ref) shifted(dCol, dRow int) string {
	c, rw := r.col, r.row
	if !r.absC {
		c += dCol
	}
	if !r.absR {
		rw += dRow
	}
	if c < 0 || rw < 0 {
		return "#REF!"
	}
	var b strings.Builder
	if r.absC {
		b.WriteByte('$')
	}
	b.WriteString(colName(c))
	if r.absR {
		b.WriteByte('$')
	}
	b.WriteString(strconv.Itoa(rw + 1))
	return b.String()
}

// matchCellRef reads $A$1 / A1 / $AB12 at the start of s. It refuses
// function names (LOG10(), sheet names (Q1!) and longer identifiers.
func matchCellRef(s string) (a1Ref, int, bool) {
	var r a1Ref
	i := 0
	if i < len(s) && s[i] == '$' {
		r.absC = true
		i++
	}
	ls := i
	for i < len(s) && isASCIILetter(s[i]) {
		i++
	}
	if i == ls || i-ls > 3 {
		return r, 0, false
	}
	letters := strings.ToUpper(s[ls:i])
	if i < len(s) && s[i] == '$' {
		r.absR = true
		i++
	}
	ds := i
	for i < len(s) && s[i] >= '0' && s[i] <= '9' {
		i++
	}
	if i == ds {
		return r, 0, false
	}
	if i < len(s) && (isFormulaIdentChar(s[i]) || s[i] == '(' || s[i] == '!') {
		return r, 0, false
	}
	rowNum, err := strconv.Atoi(s[ds:i])
	if err != nil || rowNum < 1 {
		return r, 0, false
	}
	col := 0
	for k := 0; k < len(letters); k++ {
		col = col*26 + int(letters[k]-'A'+1)
	}
	r.col = col - 1
	r.row = rowNum - 1
	return r, i, true
}

func isASCIILetter(c byte) bool {
	return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z')
}

func isFormulaIdentChar(c byte) bool {
	return isASCIILetter(c) || (c >= '0' && c <= '9') || c == '_' || c == '.' || c == '$'
}

/*
	Excel "future function" prefixes. Functions newer than the original
	OOXML function list are stored as _xlfn.NAME (and dynamic-array ones as
	_xlfn._xlws.NAME, LAMBDA parameters as _xlpm.name). Excel shows #NAME?
	for those names without the prefix, and the webapp does not want to see
	the prefix at all, so the reader strips it and the writer adds it back.
*/

// xlFutureFunctions lists the functions the engine implements that Excel
// stores with an _xlfn. prefix
var xlFutureFunctions = map[string]bool{
	"ACOT": true, "ACOTH": true, "ARABIC": true, "BASE": true, "BITAND": true, "BITLSHIFT": true,
	"BITOR": true, "BITRSHIFT": true, "BITXOR": true, "CEILING.MATH": true, "CEILING.PRECISE": true,
	"COMBINA": true, "CONCAT": true, "COT": true, "COTH": true, "COVARIANCE.P": true, "COVARIANCE.S": true,
	"CSC": true, "CSCH": true, "DAYS": true, "DECIMAL": true, "ENCODEURL": true, "FLOOR.MATH": true,
	"FLOOR.PRECISE": true, "FORECAST.LINEAR": true, "IFNA": true, "IFS": true, "ISFORMULA": true,
	"ISOWEEKNUM": true, "MAXIFS": true, "MINIFS": true, "MODE.SNGL": true, "NETWORKDAYS.INTL": true,
	"NUMBERVALUE": true, "PDURATION": true, "PERCENTILE.EXC": true, "PERCENTILE.INC": true,
	"PERCENTRANK.EXC": true, "PERCENTRANK.INC": true, "PERMUTATIONA": true, "QUARTILE.EXC": true,
	"QUARTILE.INC": true, "RANK.AVG": true, "RANK.EQ": true, "RRI": true, "SEC": true, "SECH": true,
	"SKEW.P": true, "STDEV.P": true, "STDEV.S": true, "SWITCH": true, "TEXTAFTER": true,
	"TEXTBEFORE": true, "TEXTJOIN": true, "UNICHAR": true, "UNICODE": true, "VAR.P": true, "VAR.S": true,
	"WORKDAY.INTL": true, "XLOOKUP": true, "XMATCH": true, "XOR": true,
}

// xlDynamicArrayFunctions are the dynamic-array functions Excel stores
// with the longer _xlfn._xlws. prefix
var xlDynamicArrayFunctions = map[string]bool{"FILTER": true, "SORT": true}

func init() {
	for _, n := range []string{"UNIQUE", "SEQUENCE", "RANDARRAY", "TAKE", "DROP", "EXPAND", "HSTACK", "VSTACK",
		"TOCOL", "TOROW", "CHOOSECOLS", "CHOOSEROWS", "WRAPCOLS", "WRAPROWS", "TEXTSPLIT", "MODE.MULT", "SINGLE"} {
		xlFutureFunctions[n] = true
	}
}

/*
dynamicArrayMetadata is the xl/metadata.xml part Excel writes for
dynamic-array formulas: one XLDAPR cell-metadata record that every
spilling formula cell points at with cm="1".
*/
const dynamicArrayMetadata = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
	`<metadata xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
	`xmlns:xda="http://schemas.microsoft.com/office/spreadsheetml/2017/dynamicarray">` +
	`<metadataTypes count="1"><metadataType name="XLDAPR" minSupportedVersion="120000" copy="1" ` +
	`pasteAll="1" pasteValues="1" merge="1" splitFirst="1" rowColShift="1" clearFormats="1" ` +
	`clearComments="1" assign="1" coerce="1" cellMeta="1"/></metadataTypes>` +
	`<futureMetadata name="XLDAPR" count="1"><bk><extLst>` +
	`<ext uri="{bdbb8cdc-fa1e-496e-a857-3f3f03c5ec27}"><xda:dynamicArrayProperties fDynamic="1" fCollapsed="0"/></ext>` +
	`</extLst></bk></futureMetadata>` +
	`<cellMetadata count="1"><bk><rc t="1" v="0"/></bk></cellMetadata></metadata>`

/*
arrayFormula decides whether a formula is written as a dynamic array and
returns the formula text plus the range it fills ("" when it is a plain
formula). The webapp marks spilling formulas with the range they fill;
Google Sheets ARRAYFORMULA(x), which Excel does not know, is written as a
dynamic-array x anchored at the cell itself.
*/
func arrayFormula(body, spill, cellRef string) (string, string) {
	trimmed := strings.TrimSpace(body)
	if strings.HasPrefix(strings.ToUpper(trimmed), "ARRAYFORMULA(") && strings.HasSuffix(trimmed, ")") {
		inner := trimmed[len("ARRAYFORMULA(") : len(trimmed)-1]
		if balancedParens(inner) {
			if spill == "" {
				spill = cellRef
			}
			return inner, spill
		}
	}
	return body, spill
}

// balancedParens reports whether the parentheses outside string literals pair up
func balancedParens(f string) bool {
	depth, inStr := 0, false
	for i := 0; i < len(f); i++ {
		switch f[i] {
		case '"':
			inStr = !inStr
		case '(':
			if !inStr {
				depth++
			}
		case ')':
			if !inStr {
				depth--
				if depth < 0 {
					return false
				}
			}
		}
	}
	return depth == 0 && !inStr
}

// scanFormula walks a formula, handing every identifier outside string
// literals and quoted sheet names to fn, which returns its replacement
func scanFormula(f string, fn func(ident string, callsFunction bool) string) string {
	var out strings.Builder
	n := len(f)
	for i := 0; i < n; {
		ch := f[i]
		if ch == '"' || ch == '\'' {
			j := i + 1
			for j < n {
				if f[j] == ch {
					if j+1 < n && f[j+1] == ch {
						j += 2
						continue
					}
					break
				}
				j++
			}
			if j < n {
				j++
			}
			out.WriteString(f[i:j])
			i = j
			continue
		}
		if (isASCIILetter(ch) || ch == '_') && (i == 0 || !isFormulaIdentChar(f[i-1])) {
			j := i + 1
			for j < n && (isFormulaIdentChar(f[j]) && f[j] != '$') {
				j++
			}
			out.WriteString(fn(f[i:j], j < n && f[j] == '('))
			i = j
			continue
		}
		out.WriteByte(ch)
		i++
	}
	return out.String()
}

// stripXlPrefixes removes _xlfn. / _xlws. / _xlpm. from a formula read from xlsx
func stripXlPrefixes(f string) string {
	if !strings.Contains(strings.ToLower(f), "_xl") {
		return f
	}
	return scanFormula(f, func(ident string, _ bool) string {
		for {
			low := strings.ToLower(ident)
			if strings.HasPrefix(low, "_xlfn.") || strings.HasPrefix(low, "_xlws.") || strings.HasPrefix(low, "_xlpm.") {
				ident = ident[6:]
				continue
			}
			return ident
		}
	})
}

// addXlPrefixes marks future functions with _xlfn. for a formula written to xlsx
func addXlPrefixes(f string) string {
	return scanFormula(f, func(ident string, callsFunction bool) string {
		up := strings.ToUpper(ident)
		if callsFunction && xlDynamicArrayFunctions[up] {
			return "_xlfn._xlws." + ident
		}
		if callsFunction && xlFutureFunctions[up] {
			return "_xlfn." + ident
		}
		return ident
	})
}
