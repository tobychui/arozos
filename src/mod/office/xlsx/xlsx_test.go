package xlsx

import (
	"archive/zip"
	"bytes"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/office/model"
)

func intp(v int) *int { return &v }

func sampleWorkbook() *model.Workbook {
	return &model.Workbook{
		Active: 1,
		Sheets: []*model.WorkSheet{
			{
				Name: "Data",
				Cols: 26, Rows: 200,
				Cells: map[string]*model.WorkCell{
					"A1": {V: "Product", S: &model.CellStyle{B: true, Bg: "#ddeeff", Al: "c"}},
					"B1": {V: "Price", S: &model.CellStyle{B: true}},
					"A2": {V: "Widget"},
					"B2": {V: "19.99", S: &model.CellStyle{Fmt: "currency", Dec: intp(2)}},
					"A3": {V: "Gadget & Co <tag>"},
					"B3": {V: "5"},
					"B4": {V: "=SUM(B2:B3)"},
					"C2": {V: "0.5", S: &model.CellStyle{Fmt: "percent", Dec: intp(0)}},
					"D2": {V: "TRUE"},
					"E2": {V: "'0123"}, // forced text with leading zero
					"F2": {V: "wrapped text", S: &model.CellStyle{Wrap: true, Fc: "#cc0000", Fs: 18}},
				},
				ColW:   map[string]float64{"0": 140},
				RowH:   map[string]float64{"0": 36},
				Merges: []string{"A5:C6"},
				Freeze: &model.FreezePane{R: 1, C: 0},
			},
			{
				Name: "Notes[weird]/name:that*is?way\\too long for excel to accept",
				Cells: map[string]*model.WorkCell{
					"A1": {V: "second sheet"},
				},
			},
		},
	}
}

func TestBuildXlsxStructure(t *testing.T) {
	data, err := Build(sampleWorkbook())
	if err != nil {
		t.Fatalf("BuildXlsx failed: %v", err)
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("output is not a valid zip: %v", err)
	}
	want := []string{
		"[Content_Types].xml", "_rels/.rels",
		"xl/workbook.xml", "xl/_rels/workbook.xml.rels",
		"xl/styles.xml", "xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml",
	}
	have := map[string]bool{}
	for _, f := range zr.File {
		have[f.Name] = true
	}
	for _, p := range want {
		if !have[p] {
			t.Errorf("missing expected xlsx part: %s", p)
		}
	}
}

func TestBuildXlsxErrors(t *testing.T) {
	if _, err := Build(nil); err == nil {
		t.Errorf("nil workbook: expected error")
	}
	if _, err := Build(&model.Workbook{}); err == nil {
		t.Errorf("empty workbook: expected error")
	}
}

func TestParseXlsxInvalid(t *testing.T) {
	if _, err := Parse([]byte("not a zip")); err == nil {
		t.Errorf("garbage: expected error")
	}
	// legacy .xls magic (CFB header) gets a specific message
	xls := append([]byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}, make([]byte, 64)...)
	_, err := Parse(xls)
	if err == nil || !strings.Contains(err.Error(), ".xls") {
		t.Errorf("legacy xls: want specific error, got %v", err)
	}
}

func TestXlsxRoundtrip(t *testing.T) {
	src := sampleWorkbook()
	data, err := Build(src)
	if err != nil {
		t.Fatalf("BuildXlsx failed: %v", err)
	}
	got, err := Parse(data)
	if err != nil {
		t.Fatalf("ParseXlsx failed on own output: %v", err)
	}

	if len(got.Sheets) != 2 {
		t.Fatalf("sheet count = %d, want 2", len(got.Sheets))
	}
	if got.Active != 1 {
		t.Errorf("active = %d, want 1", got.Active)
	}
	ws := got.Sheets[0]
	if ws.Name != "Data" {
		t.Errorf("sheet name = %q, want Data", ws.Name)
	}
	// second sheet name must be sanitized but present
	if strings.ContainsAny(got.Sheets[1].Name, `[]:*?/\`) || len(got.Sheets[1].Name) > 31 {
		t.Errorf("sheet 2 name not sanitized: %q", got.Sheets[1].Name)
	}

	cell := func(ref string) *model.WorkCell { return ws.Cells[ref] }
	if c := cell("A1"); c == nil || c.V != "Product" {
		t.Fatalf("A1 = %+v, want Product", cell("A1"))
	}
	if c := cell("A1"); c.S == nil || !c.S.B || c.S.Al != "c" || c.S.Bg != "#ddeeff" {
		t.Errorf("A1 style lost: %+v", cell("A1").S)
	}
	if c := cell("B2"); c == nil || c.V != "19.99" {
		t.Errorf("B2 = %+v, want 19.99", cell("B2"))
	}
	if c := cell("B2"); c.S == nil || c.S.Fmt != "currency" {
		t.Errorf("B2 currency fmt lost: %+v", cell("B2").S)
	}
	if c := cell("A3"); c == nil || c.V != "Gadget & Co <tag>" {
		t.Errorf("A3 escaping broken: %+v", cell("A3"))
	}
	if c := cell("B4"); c == nil || c.V != "=SUM(B2:B3)" {
		t.Errorf("B4 formula lost: %+v", cell("B4"))
	}
	if c := cell("C2"); c == nil || c.S == nil || c.S.Fmt != "percent" || c.S.Dec == nil || *c.S.Dec != 0 {
		t.Errorf("C2 percent fmt lost: %+v", cell("C2"))
	}
	if c := cell("D2"); c == nil || c.V != "TRUE" {
		t.Errorf("D2 boolean lost: %+v", cell("D2"))
	}
	if c := cell("E2"); c == nil || c.V != "'0123" {
		t.Errorf("E2 forced text lost leading zero: %+v", cell("E2"))
	}
	if c := cell("F2"); c == nil || c.S == nil || !c.S.Wrap || c.S.Fc != "#cc0000" {
		t.Errorf("F2 wrap/color lost: %+v", cell("F2"))
	}
	if c := cell("F2"); c.S == nil || c.S.Fs < 17 || c.S.Fs > 19 {
		t.Errorf("F2 font size = %v, want ~18", cell("F2").S.Fs)
	}

	// merges / freeze / geometry
	if len(ws.Merges) != 1 || ws.Merges[0] != "A5:C6" {
		t.Errorf("merges = %v, want [A5:C6]", ws.Merges)
	}
	if ws.Freeze == nil || ws.Freeze.R != 1 || ws.Freeze.C != 0 {
		t.Errorf("freeze = %+v, want r1 c0", ws.Freeze)
	}
	if w, ok := ws.ColW["0"]; !ok || w < 130 || w > 150 {
		t.Errorf("col A width = %v, want ~140", w)
	}
	if h, ok := ws.RowH["0"]; !ok || h < 32 || h > 40 {
		t.Errorf("row 1 height = %v, want ~36", h)
	}
}

func TestNumFmtMapping(t *testing.T) {
	tests := []struct {
		id   int
		code map[int]string
		want string
	}{
		{9, nil, "percent"},
		{14, nil, "date"},
		{44, nil, "currency"},
		{49, nil, "text"},
		{164, map[int]string{164: "0.000%"}, "percent"},
		{165, map[int]string{165: "$#,##0.00"}, "currency"},
		{166, map[int]string{166: "yyyy-mm-dd"}, "date"},
		{167, map[int]string{167: "#,##0.0"}, "number"},
		{99, nil, ""},
	}
	for _, tc := range tests {
		got, _ := numFmtIDToName(tc.id, tc.code)
		if got != tc.want {
			t.Errorf("numFmtIDToName(%d) = %q, want %q", tc.id, got, tc.want)
		}
	}
}

// A column width must survive any number of trips through .xlsx: the
// writer states it to 1/100 of a character, and the reader used to truncate
// that back to a pixel less every time.
func TestXlsxColumnWidthIsStable(t *testing.T) {
	for _, px := range []float64{7, 36, 57, 61, 68, 85, 96, 165, 208} {
		wb := &model.Workbook{Sheets: []*model.WorkSheet{{
			Name: "S", Cells: map[string]*model.WorkCell{"A1": {V: "x"}},
			ColW: map[string]float64{"0": px},
		}}}
		for trip := 1; trip <= 3; trip++ {
			data, err := Build(wb)
			if err != nil {
				t.Fatalf("BuildXlsx: %v", err)
			}
			if wb, err = Parse(data); err != nil {
				t.Fatalf("ParseXlsx: %v", err)
			}
			if got := wb.Sheets[0].ColW["0"]; got != px {
				t.Fatalf("%vpx column after %d trip(s) = %vpx", px, trip, got)
			}
		}
	}
}
