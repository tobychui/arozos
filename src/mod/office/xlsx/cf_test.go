package xlsx

import (
	"encoding/json"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/office/internal/officetest"
	"imuslab.com/arozos/mod/office/model"
)

func cfWorkbook(t *testing.T) *model.Workbook {
	t.Helper()
	body := `{"active":0,"sheets":[{"name":"Data","color":"#ff8800",` +
		`"filter":{"range":"A1:B5","excl":{"1":{"x":1}}},` +
		`"cells":{"B2":{"v":"250","cf":["hi","txt"]},"B3":{"v":"90","cf":["hi"]},"B4":{"v":"300","cf":["hi"]},` +
		`"D2":{"v":"x","cf":["rel"]},"D3":{"v":"y","cf":["rel"]}},` +
		`"cfDefs":{` +
		`"hi":{"anchor":"B2","type":"gt","v1":"200","style":{"bg":"#b7e1cd","b":true}},` +
		`"txt":{"anchor":"B2","type":"contains","v1":"5","style":{"fc":"#cc0000"}},` +
		`"rel":{"anchor":"D1","type":"formula","v1":"=$C1>A1","style":{"i":true}},` +
		`"unused":{"anchor":"A1","type":"empty"}}}]}`
	wb, err := model.ParseWorkbookJSON(body)
	if err != nil {
		t.Fatal(err)
	}
	return wb
}

func TestXlsxConditionalFormattingWriter(t *testing.T) {
	data, err := Build(cfWorkbook(t))
	if err != nil {
		t.Fatalf("BuildXlsx: %v", err)
	}
	parts := officetest.UnzipParts(t, data)
	sheet := parts["xl/worksheets/sheet1.xml"]
	cases := []string{
		`<sheetPr><tabColor rgb="FFFF8800"/></sheetPr>`,
		`<autoFilter ref="A1:B5"/>`,
		`sqref="B2:B4"`,
		`type="cellIs" dxfId=`,
		`operator="greaterThan"><formula>200</formula>`,
		`type="containsText"`,
		`NOT(ISERROR(SEARCH(&quot;5&quot;,B2)))`,
		// the formula is moved from its anchor D1 to the range corner D2
		`<formula>$C2&gt;A2</formula>`,
	}
	for _, want := range cases {
		if !strings.Contains(sheet, want) {
			t.Errorf("%s missing in\n%s", want, sheet)
		}
	}
	if strings.Contains(sheet, "containsBlanks") {
		t.Errorf("a rule no cell carries was written")
	}
	// schema order: autoFilter before mergeCells, CF after sheetData
	if strings.Index(sheet, "<autoFilter") < strings.Index(sheet, "</sheetData>") ||
		strings.Index(sheet, "<conditionalFormatting") < strings.Index(sheet, "<autoFilter") {
		t.Errorf("elements out of schema order")
	}
	styles := parts["xl/styles.xml"]
	if !strings.Contains(styles, `<dxfs count="3">`) || !strings.Contains(styles, `<bgColor rgb="FFB7E1CD"/>`) {
		t.Errorf("differential formats wrong:\n%s", styles)
	}
	if !strings.Contains(parts["xl/workbook.xml"], `_xlnm._FilterDatabase" localSheetId="0" hidden="1">&apos;Data&apos;!$A$1:$B$5`) {
		t.Errorf("filter database name missing:\n%s", parts["xl/workbook.xml"])
	}
}

func TestXlsxConditionalFormattingRoundTrip(t *testing.T) {
	data, err := Build(cfWorkbook(t))
	if err != nil {
		t.Fatal(err)
	}
	wb, err := Parse(data)
	if err != nil {
		t.Fatalf("ParseXlsx: %v", err)
	}
	ws := wb.Sheets[0]
	if ws.Color != "#ff8800" {
		t.Errorf("tab colour = %q", ws.Color)
	}
	var f struct{ Range string }
	json.Unmarshal(ws.Filter, &f)
	if f.Range != "A1:B5" {
		t.Errorf("filter range = %q", f.Range)
	}
	if len(ws.CfDefs) != 3 {
		t.Fatalf("rules = %d, want 3: %+v", len(ws.CfDefs), ws.CfDefs)
	}
	// B2 carries two rules, highest priority first
	b2 := ws.Cells["B2"]
	if b2 == nil || len(b2.Cf) != 2 {
		t.Fatalf("B2 rules = %+v", b2)
	}
	first := ws.CfDefs[b2.Cf[0]]
	if first.Type != "gt" || first.V1 != "200" || first.Style == nil || !first.Style.B || first.Style.Bg != "#b7e1cd" {
		t.Errorf("first rule = %+v %+v", first, first.Style)
	}
	second := ws.CfDefs[b2.Cf[1]]
	if second.Type != "contains" || second.V1 != "5" || second.Style.Fc != "#cc0000" {
		t.Errorf("second rule = %+v %+v", second, second.Style)
	}
	d2 := ws.Cells["D2"]
	if d2 == nil || len(d2.Cf) != 1 {
		t.Fatalf("D2 rules = %+v", d2)
	}
	if r := ws.CfDefs[d2.Cf[0]]; r.Type != "formula" || r.V1 != "=$C2>A2" || r.Anchor != "D2" {
		t.Errorf("formula rule = %+v", r)
	}
}

func TestCellsToRects(t *testing.T) {
	cases := []struct {
		name  string
		cells [][2]int
		want  []string
	}{
		{"single", [][2]int{{0, 0}}, []string{"A1"}},
		{"column", [][2]int{{1, 1}, {1, 2}, {1, 3}}, []string{"B2:B4"}},
		{"block", [][2]int{{0, 0}, {1, 0}, {0, 1}, {1, 1}}, []string{"A1:B2"}},
		{"gap", [][2]int{{0, 0}, {0, 2}}, []string{"A1", "A3"}},
		{"ragged", [][2]int{{0, 0}, {1, 0}, {0, 1}}, []string{"A1:B1", "A2"}},
	}
	for _, c := range cases {
		var got []string
		for _, r := range cellsToRects(c.cells) {
			got = append(got, r.ref())
		}
		if strings.Join(got, " ") != strings.Join(c.want, " ") {
			t.Errorf("%s: %v, want %v", c.name, got, c.want)
		}
	}
}

func TestCfOperandFormula(t *testing.T) {
	cases := []struct {
		v, kind string
		dC, dR  int
		want    string
	}{
		{"200", "num", 0, 0, "200"},
		{"abc", "num", 0, 0, `"abc"`},
		{`say "hi"`, "text", 0, 0, `"say ""hi"""`},
		{"B3", "text", 0, 0, `"B3"`},
		{"B3", "num", 1, 1, "C4"},
		{"=AVERAGE($F$2:$F$9)", "num", 3, 3, "AVERAGE($F$2:$F$9)"},
		{"2024-01-31", "date", 0, 0, "45322"},
		{"", "num", 0, 0, `""`},
	}
	for _, c := range cases {
		if got := cfOperandFormula(model.CfOperand(c.v), c.kind, c.dC, c.dR); got != c.want {
			t.Errorf("cfOperandFormula(%q, %s) = %s, want %s", c.v, c.kind, got, c.want)
		}
	}
}
