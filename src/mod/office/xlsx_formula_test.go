package office

import "testing"

func TestShiftFormulaRefs(t *testing.T) {
	cases := []struct {
		name       string
		in         string
		dCol, dRow int
		want       string
	}{
		{"relative", "B3-C3", 0, 1, "B4-C4"},
		{"absolute parts stay", "$A$1+A$1+$A1+A1", 1, 1, "$A$1+B$1+$A2+B2"},
		{"range", "SUM(A1:B2)", 2, 0, "SUM(C1:D2)"},
		{"strings untouched", `IF(A1="B2",C3,"x""D4")`, 0, 1, `IF(A2="B2",C4,"x""D4")`},
		{"quoted sheet name untouched", "'Q1 A1'!A1+'It''s'!B2", 0, 1, "'Q1 A1'!A2+'It''s'!B3"},
		{"unquoted sheet name", "Analysis!$H$2+Analysis!H2", 0, 1, "Analysis!$H$2+Analysis!H3"},
		{"cell-like sheet name", "AB1!A1", 0, 1, "AB1!A2"},
		{"function names untouched", "LOG10(A1)+ATAN2(B1,C1)", 0, 1, "LOG10(A2)+ATAN2(B2,C2)"},
		{"lowercase refs", "sum(a1:a3)", 0, 2, "sum(A3:A5)"},
		{"off grid", "A1+B2", 0, -2, "#REF!+#REF!"},
		{"no offset", "A1", 0, 0, "A1"},
		{"numbers untouched", "1E5+A1*2", 0, 1, "1E5+A2*2"},
		{"nested IF chain", "IF(AND($V$4<=M3,M3<$W$4),1,2)", 0, 1, "IF(AND($V$4<=M4,M4<$W$4),1,2)"},
	}
	for _, c := range cases {
		if got := shiftFormulaRefs(c.in, c.dCol, c.dRow); got != c.want {
			t.Errorf("%s: shiftFormulaRefs(%q, %d, %d) = %q, want %q", c.name, c.in, c.dCol, c.dRow, got, c.want)
		}
	}
}

func TestParseWorksheetSharedFormulas(t *testing.T) {
	sheet := `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="3"><c r="K3"><f t="shared" ref="K3:K5" si="0">B3-C3</f><v>1</v></c><c r="L3"><f>INT(C3)</f><v>2</v></c></row>
<row r="4"><c r="K4"><f t="shared" si="0"/><v>9</v></c><c r="L4"><f t="shared" ref="L4:M4" si="1">$A$1+C4</f><v>0</v></c><c r="M4"><f t="shared" si="1"/><v>0</v></c></row>
<row r="5"><c r="K5"><f t="shared" si="0"/><v>9</v></c><c r="N5"><f t="shared" si="7"/><v>42</v></c></row>
</sheetData></worksheet>`
	tree, err := parseXMLTree([]byte(sheet))
	if err != nil {
		t.Fatalf("parse sheet xml: %v", err)
	}
	ws := parseWorksheet(tree, nil, nil)
	want := map[string]string{
		"K3": "=B3-C3",
		"K4": "=B4-C4",
		"K5": "=B5-C5",
		"L3": "=INT(C3)",
		"L4": "=$A$1+C4",
		"M4": "=$A$1+D4",
		"N5": "42", // follower whose master is missing keeps the cached value
	}
	for ref, v := range want {
		cell := ws.Cells[ref]
		if cell == nil {
			t.Errorf("%s: missing cell", ref)
			continue
		}
		if cell.V != v {
			t.Errorf("%s = %q, want %q", ref, cell.V, v)
		}
	}
}
