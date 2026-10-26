package office

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestXlsxNotesRoundTrip(t *testing.T) {
	wb := &Workbook{Sheets: []*WorkSheet{{
		Name: "Notes",
		Cells: map[string]*WorkCell{
			"A1": {V: "Value", N: "This header explains the column"},
			"B3": {V: "42", N: "Answer\nwith two lines"},
			"C5": {V: "", N: "note on an otherwise empty cell"},
			"D1": {V: "no note here"},
		},
	}}}
	data, err := BuildXlsx(wb)
	if err != nil {
		t.Fatalf("BuildXlsx: %v", err)
	}

	// parts exist and are wired up
	if zipPart(t, data, "xl/comments1.xml") == nil {
		t.Fatal("xl/comments1.xml missing")
	}
	if zipPart(t, data, "xl/drawings/vmlDrawing1.vml") == nil {
		t.Fatal("vmlDrawing1.vml missing")
	}
	sheetRels := string(zipPart(t, data, "xl/worksheets/_rels/sheet1.xml.rels"))
	if !strings.Contains(sheetRels, "comments1.xml") || !strings.Contains(sheetRels, "vmlDrawing1.vml") {
		t.Errorf("sheet rels missing comments/vml relationships: %s", sheetRels)
	}
	if !strings.Contains(string(zipPart(t, data, "xl/worksheets/sheet1.xml")), "<legacyDrawing") {
		t.Error("sheet1.xml missing legacyDrawing reference")
	}
	ctypes := string(zipPart(t, data, "[Content_Types].xml"))
	if !strings.Contains(ctypes, `Extension="vml"`) || !strings.Contains(ctypes, "/xl/comments1.xml") {
		t.Error("[Content_Types].xml missing vml/comments entries")
	}

	// round trip back to the webapp model
	wb2, err := ParseXlsx(data)
	if err != nil {
		t.Fatalf("ParseXlsx: %v", err)
	}
	cells := wb2.Sheets[0].Cells
	tests := []struct{ ref, note string }{
		{"A1", "This header explains the column"},
		{"B3", "Answer\nwith two lines"},
		{"C5", "note on an otherwise empty cell"},
	}
	for _, tc := range tests {
		if cells[tc.ref] == nil {
			t.Errorf("%s: cell missing after round trip", tc.ref)
			continue
		}
		if cells[tc.ref].N != tc.note {
			t.Errorf("%s note: got %q, want %q", tc.ref, cells[tc.ref].N, tc.note)
		}
	}
	if cells["D1"] != nil && cells["D1"].N != "" {
		t.Errorf("D1 gained an unexpected note: %q", cells["D1"].N)
	}
}

func TestXlsxNotesAndChartsShareRels(t *testing.T) {
	wb := &Workbook{Sheets: []*WorkSheet{{
		Name: "Both",
		Cells: map[string]*WorkCell{
			"A1": {V: "H", N: "noted"}, "A2": {V: "x"}, "B1": {V: "V"}, "B2": {V: "3"},
		},
		Charts: json.RawMessage(`[{"id":"c1","x":0,"y":0,"w":300,"h":200,"range":"A1:B2","opts":{"type":"bar"}}]`),
	}}}
	data, err := BuildXlsx(wb)
	if err != nil {
		t.Fatalf("BuildXlsx: %v", err)
	}
	rels := string(zipPart(t, data, "xl/worksheets/_rels/sheet1.xml.rels"))
	// drawing = rId1, comments = rId2, vml = rId3 (must match legacyDrawing)
	if !strings.Contains(rels, `Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing"`) {
		t.Errorf("rId1 is not the drawing: %s", rels)
	}
	if !strings.Contains(string(zipPart(t, data, "xl/worksheets/sheet1.xml")), `<legacyDrawing r:id="rId3"/>`) {
		t.Error("legacyDrawing should be rId3 when the sheet also has charts")
	}
	wb2, err := ParseXlsx(data)
	if err != nil {
		t.Fatalf("ParseXlsx: %v", err)
	}
	if wb2.Sheets[0].Cells["A1"] == nil || wb2.Sheets[0].Cells["A1"].N != "noted" {
		t.Error("note lost when the sheet also has charts")
	}
	if len(wb2.Sheets[0].Charts) == 0 {
		t.Error("charts lost when the sheet also has notes")
	}
}
