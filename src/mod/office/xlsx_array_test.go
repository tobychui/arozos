package office

import (
	"archive/zip"
	"bytes"
	"io"
	"strings"
	"testing"
)

func xlsxPart(t *testing.T, data []byte, name string) string {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name == name {
			rc, _ := f.Open()
			b, _ := io.ReadAll(rc)
			rc.Close()
			return string(b)
		}
	}
	return ""
}

func TestXlsxDynamicArrayWrite(t *testing.T) {
	wb := &Workbook{Sheets: []*WorkSheet{{Name: "S", Cells: map[string]*WorkCell{
		"B1": {V: "3"}, "B2": {V: "1"}, "B3": {V: "2"},
		"A1": {V: "=SORT(B1:B3)", A: "A1:A3"},
		"C1": {V: "=ARRAYFORMULA(B1:B3*2)"},
		"D1": {V: "=SUM(B1:B3)"},
	}}}}
	data, err := BuildXlsx(wb)
	if err != nil {
		t.Fatalf("BuildXlsx: %v", err)
	}
	sheet := xlsxPart(t, data, "xl/worksheets/sheet1.xml")
	for _, want := range []string{
		`<c r="A1" cm="1"><f t="array" ref="A1:A3">_xlfn._xlws.SORT(B1:B3)</f></c>`,
		`<c r="C1" cm="1"><f t="array" ref="C1">B1:B3*2</f></c>`,
		`<c r="D1"><f>SUM(B1:B3)</f></c>`,
	} {
		if !strings.Contains(sheet, want) {
			t.Errorf("sheet1.xml lacks %s\n%s", want, sheet)
		}
	}
	if meta := xlsxPart(t, data, "xl/metadata.xml"); !strings.Contains(meta, "XLDAPR") {
		t.Errorf("dynamic array metadata part missing")
	}
	if ct := xlsxPart(t, data, "[Content_Types].xml"); !strings.Contains(ct, "/xl/metadata.xml") {
		t.Errorf("metadata content type missing")
	}
	back, err := ParseXlsx(data)
	if err != nil {
		t.Fatalf("ParseXlsx: %v", err)
	}
	if got := back.Sheets[0].Cells["A1"].V; got != "=SORT(B1:B3)" {
		t.Errorf("A1 read back as %q", got)
	}

	// no dynamic arrays: no metadata part
	plain, _ := BuildXlsx(&Workbook{Sheets: []*WorkSheet{{Name: "S", Cells: map[string]*WorkCell{"A1": {V: "=1+1"}}}}})
	if xlsxPart(t, plain, "xl/metadata.xml") != "" {
		t.Errorf("metadata part written for a workbook without dynamic arrays")
	}
}

func TestXlsxArrayFormulaReadClearsCachedCells(t *testing.T) {
	sheet := `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>
<row r="1"><c r="A1" cm="1"><f t="array" ref="A1:A3">_xlfn.SEQUENCE(3)</f><v>1</v></c><c r="B1"><v>9</v></c></row>
<row r="2"><c r="A2"><v>2</v></c></row>
<row r="3"><c r="A3" s="0"><v>3</v></c></row>
</sheetData></worksheet>`
	tree, err := parseXMLTree([]byte(sheet))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	ws := parseWorksheet(tree, nil, nil)
	if got := ws.Cells["A1"]; got == nil || got.V != "=SEQUENCE(3)" {
		t.Errorf("A1 = %+v, want the formula", got)
	}
	if _, ok := ws.Cells["A2"]; ok {
		t.Errorf("A2 kept its cached value: %+v", ws.Cells["A2"])
	}
	if _, ok := ws.Cells["A3"]; ok {
		t.Errorf("A3 kept its cached value: %+v", ws.Cells["A3"])
	}
	if got := ws.Cells["B1"]; got == nil || got.V != "9" {
		t.Errorf("B1 outside the array changed: %+v", got)
	}
}

func TestArrayFormulaUnwrap(t *testing.T) {
	cases := []struct{ in, spill, body, ref string }{
		{"ARRAYFORMULA(A1:A3*2)", "", "A1:A3*2", "Z9"},
		{"arrayformula(SUM(A1:A3))", "", "SUM(A1:A3)", "Z9"},
		{"ARRAYFORMULA(A1)&ARRAYFORMULA(B1)", "", "ARRAYFORMULA(A1)&ARRAYFORMULA(B1)", ""},
		{"SORT(A1:A3)", "Z9:Z11", "SORT(A1:A3)", "Z9:Z11"},
		{"SUM(A1:A3)", "", "SUM(A1:A3)", ""},
	}
	for _, c := range cases {
		body, ref := arrayFormula(c.in, c.spill, "Z9")
		if body != c.body || ref != c.ref {
			t.Errorf("arrayFormula(%q) = %q, %q; want %q, %q", c.in, body, ref, c.body, c.ref)
		}
	}
}
