package office

/*
	cellstyle_test.go - the cell formatting the Sheets ribbon sets beyond
	bold / italic / underline: the font family, strikethrough and the
	vertical alignment, through .xlsx and .ods and back.
*/

import (
	"strings"
	"testing"
)

func styledCellsWorkbook() *Workbook {
	return &Workbook{Sheets: []*WorkSheet{{
		Name: "Styles",
		Cells: map[string]*WorkCell{
			"A1": {V: "Georgia", S: &CellStyle{Ff: "Georgia"}},
			"A2": {V: "struck", S: &CellStyle{St: true}},
			"A3": {V: "top", S: &CellStyle{Va: "t"}},
			"A4": {V: "middle", S: &CellStyle{Va: "m"}},
			"A5": {V: "bottom", S: &CellStyle{Va: "b", Wrap: true}},
			"A6": {V: "all", S: &CellStyle{Ff: "Courier New", St: true, U: true, Va: "m", Al: "c"}},
			"A7": {V: "plain bold", S: &CellStyle{B: true}},
		},
	}}}
}

func checkStyledCells(t *testing.T, ws *WorkSheet) {
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
	data, err := BuildXlsx(styledCellsWorkbook())
	if err != nil {
		t.Fatalf("BuildXlsx: %v", err)
	}
	styles := string(zipPart(t, data, "xl/styles.xml"))
	for _, want := range []string{`<strike/>`, `<name val="Georgia"/>`, `vertical="top"`, `vertical="center"`, `vertical="bottom"`} {
		if !strings.Contains(styles, want) {
			t.Errorf("styles.xml lacks %s", want)
		}
	}
	back, err := ParseXlsx(data)
	if err != nil {
		t.Fatalf("ParseXlsx: %v", err)
	}
	checkStyledCells(t, back.Sheets[0])
}

// a cell in the workbook's own font must not come back naming it
func TestXlsxDefaultFontIsNotStated(t *testing.T) {
	data, err := BuildXlsx(sampleWorkbook())
	if err != nil {
		t.Fatalf("BuildXlsx: %v", err)
	}
	back, err := ParseXlsx(data)
	if err != nil {
		t.Fatalf("ParseXlsx: %v", err)
	}
	for ref, c := range back.Sheets[0].Cells {
		if c.S != nil && c.S.Ff != "" {
			t.Errorf("%s names the default font %q", ref, c.S.Ff)
		}
	}
}

func TestOdsFontStrikeAndVerticalAlign(t *testing.T) {
	data, err := BuildOds(styledCellsWorkbook())
	if err != nil {
		t.Fatalf("BuildOds: %v", err)
	}
	back, err := ParseOds(data)
	if err != nil {
		t.Fatalf("ParseOds: %v", err)
	}
	checkStyledCells(t, back.Sheets[0])
}

func TestPptxRunBaselines(t *testing.T) {
	cases := []struct {
		name, html string
		want       []string // in the slide XML
		wantCSS    string   // in the text read back
	}{
		{
			"tags from the editor",
			`<div>E = mc<sup>2</sup> and H<sub>2</sub>O</div>`,
			[]string{`baseline="30000"`, `baseline="-25000"`},
			"vertical-align:super",
		},
		{
			// what the reader wrote for a raised run: the size goes back
			// at full size, PowerPoint shrinks it itself
			"a run the reader drew",
			`<div><span style="font-size:24px;">x</span><span style="vertical-align:super;font-size:15.6px;">2</span></div>`,
			[]string{`baseline="30000"`},
			"vertical-align:super",
		},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			slide, back := writeOneObject(t, textObj(c.html, nil))
			for _, w := range c.want {
				if !strings.Contains(slide, w) {
					t.Errorf("slide XML lacks %s:\n%s", w, slide)
				}
			}
			if strings.Count(slide, `sz="1800"`) < 2 {
				t.Errorf("a raised run lost its size (want sz=1800 on both runs):\n%s", slide)
			}
			if !strings.Contains(back.Props.HTML, c.wantCSS) {
				t.Errorf("read back without %s: %s", c.wantCSS, back.Props.HTML)
			}
		})
	}
}
