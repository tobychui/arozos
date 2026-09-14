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
