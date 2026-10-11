package xlsx

/*
	cellstyle_test.go - the cell formatting the Sheets ribbon sets beyond
	bold / italic / underline: the font family, strikethrough and the
	vertical alignment, through .xlsx and .ods and back.
*/

import (
	"strings"
	"testing"

	"imuslab.com/arozos/mod/office/internal/officetest"
	"imuslab.com/arozos/mod/office/model"
)

func styledCellsWorkbook() *model.Workbook {
	return &model.Workbook{Sheets: []*model.WorkSheet{{
		Name: "Styles",
		Cells: map[string]*model.WorkCell{
			"A1": {V: "Georgia", S: &model.CellStyle{Ff: "Georgia"}},
			"A2": {V: "struck", S: &model.CellStyle{St: true}},
			"A3": {V: "top", S: &model.CellStyle{Va: "t"}},
			"A4": {V: "middle", S: &model.CellStyle{Va: "m"}},
			"A5": {V: "bottom", S: &model.CellStyle{Va: "b", Wrap: true}},
			"A6": {V: "all", S: &model.CellStyle{Ff: "Courier New", St: true, U: true, Va: "m", Al: "c"}},
			"A7": {V: "plain bold", S: &model.CellStyle{B: true}},
		},
	}}}
}

func checkStyledCells(t *testing.T, ws *model.WorkSheet) {
	t.Helper()
	cases := []struct {
		ref, ff, va string
		st          bool
	}{
		{"A1", "Georgia", "", false},
		{"A2", "", "", true},
		{"A3", "", "t", false},
		{"A4", "", "m", false},
		{"A5", "", "b", false},
		{"A6", "Courier New", "m", true},
		{"A7", "", "", false},
	}
	for _, c := range cases {
		cell := ws.Cells[c.ref]
		if cell == nil || cell.S == nil {
			t.Errorf("%s: style lost: %+v", c.ref, cell)
			continue
		}
		s := cell.S
		if s.Ff != c.ff {
			t.Errorf("%s: font = %q, want %q", c.ref, s.Ff, c.ff)
		}
		if s.Va != c.va {
			t.Errorf("%s: vertical alignment = %q, want %q", c.ref, s.Va, c.va)
		}
		if s.St != c.st {
			t.Errorf("%s: strikethrough = %v, want %v", c.ref, s.St, c.st)
		}
	}
	if s := ws.Cells["A6"].S; !s.U || s.Al != "c" {
		t.Errorf("A6: the other formatting went missing: %+v", s)
	}
	if s := ws.Cells["A5"].S; !s.Wrap {
		t.Errorf("A5: wrap lost next to the vertical alignment: %+v", s)
	}
}

func TestXlsxFontStrikeAndVerticalAlign(t *testing.T) {
	data, err := Build(styledCellsWorkbook())
	if err != nil {
		t.Fatalf("BuildXlsx: %v", err)
	}
	styles := string(officetest.ZipPart(t, data, "xl/styles.xml"))
	for _, want := range []string{`<strike/>`, `<name val="Georgia"/>`, `vertical="top"`, `vertical="center"`, `vertical="bottom"`} {
		if !strings.Contains(styles, want) {
			t.Errorf("styles.xml lacks %s", want)
		}
	}
	back, err := Parse(data)
	if err != nil {
		t.Fatalf("ParseXlsx: %v", err)
	}
	checkStyledCells(t, back.Sheets[0])
}

// a cell in the workbook's own font must not come back naming it
func TestXlsxDefaultFontIsNotStated(t *testing.T) {
	data, err := Build(sampleWorkbook())
	if err != nil {
		t.Fatalf("BuildXlsx: %v", err)
	}
	back, err := Parse(data)
	if err != nil {
		t.Fatalf("ParseXlsx: %v", err)
	}
	for ref, c := range back.Sheets[0].Cells {
		if c.S != nil && c.S.Ff != "" {
			t.Errorf("%s names the default font %q", ref, c.S.Ff)
		}
	}
}
