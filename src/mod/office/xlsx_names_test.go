package office

import "testing"

func TestXlsxDefinedNamesRoundTrip(t *testing.T) {
	local := 1
	wb := &Workbook{
		Sheets: []*WorkSheet{
			{Name: "Report", Cells: map[string]*WorkCell{"A1": {V: "=SUM(Sales)"}}},
			{Name: "Data", Cells: map[string]*WorkCell{"B2": {V: "5"}, "B3": {V: "7"}}},
		},
		Names: []*DefinedName{
			{Name: "Sales", Formula: "=Data!$B$2:$B$3"},
			{Name: "Rate", Formula: "=0.2"},
			{Name: "Local", Formula: "=Data!$B$2", Sheet: &local},
		},
	}
	data, err := BuildXlsx(wb)
	if err != nil {
		t.Fatalf("BuildXlsx: %v", err)
	}
	back, err := ParseXlsx(data)
	if err != nil {
		t.Fatalf("ParseXlsx: %v", err)
	}
	if len(back.Names) != 3 {
		t.Fatalf("got %d names, want 3: %+v", len(back.Names), back.Names)
	}
	for i, want := range []DefinedName{
		{Name: "Sales", Formula: "=Data!$B$2:$B$3"},
		{Name: "Rate", Formula: "=0.2"},
		{Name: "Local", Formula: "=Data!$B$2"},
	} {
		if back.Names[i].Name != want.Name || back.Names[i].Formula != want.Formula {
			t.Errorf("name %d = %+v, want %+v", i, back.Names[i], want)
		}
	}
	if back.Names[2].Sheet == nil || *back.Names[2].Sheet != 1 {
		t.Errorf("sheet-local scope lost: %+v", back.Names[2].Sheet)
	}
}

func TestXlsxSkipsBuiltinNames(t *testing.T) {
	sheet := `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
		`<sheets><sheet name="S" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets>` +
		`<definedNames>` +
		`<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">S!$A$1:$B$9</definedName>` +
		`<definedName name="_xlnm.Print_Area" localSheetId="0">S!$A$1:$B$9</definedName>` +
		`<definedName name="Keep">S!$A$1</definedName>` +
		`</definedNames></workbook>`
	tree, err := parseXMLTree([]byte(sheet))
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	names := parseDefinedNames(tree)
	if len(names) != 1 || names[0].Name != "Keep" || names[0].Formula != "=S!$A$1" {
		t.Errorf("got %+v, want only Keep", names)
	}
}
