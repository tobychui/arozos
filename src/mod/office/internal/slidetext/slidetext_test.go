package slidetext

import "testing"

func TestParseParagraphsAndRuns(t *testing.T) {
	paras := Parse(`<div style="text-align:center">Plain <b>bold</b></div>`+
		`<div><span style="font-size:24px;color:#ff0000">big red</span><br>next</div>`,
		Style{SizePx: 16, Color: "#000000"})
	if len(paras) != 2 {
		t.Fatalf("Parse gave %d paragraphs, want 2", len(paras))
	}
	if paras[0].Align != "center" {
		t.Errorf("first paragraph align = %q, want center", paras[0].Align)
	}
	r := paras[0].Runs
	if len(r) != 2 || r[0].Text != "Plain " || r[0].Bold || r[1].Text != "bold" || !r[1].Bold {
		t.Errorf("first paragraph runs = %+v", r)
	}
	r = paras[1].Runs
	if len(r) < 3 {
		t.Fatalf("second paragraph runs = %+v, want text, break, text", r)
	}
	if r[0].SizePx != 24 || r[0].Color != "#ff0000" {
		t.Errorf("styled run = %+v, want 24px #ff0000", r[0])
	}
	if !r[1].Break || r[2].Text != "next" {
		t.Errorf("break then text expected, got %+v", r[1:])
	}
}

func TestParseWithoutBlocks(t *testing.T) {
	paras := Parse("just text", Style{SizePx: 18})
	if len(paras) != 1 || len(paras[0].Runs) != 1 || paras[0].Runs[0].Text != "just text" {
		t.Errorf("bare text should be one paragraph, got %+v", paras)
	}
}

func TestMarkers(t *testing.T) {
	tests := []struct {
		got, want string
	}{
		{AlphaMarker(1, 'a'), "a"},
		{AlphaMarker(26, 'a'), "z"},
		{AlphaMarker(27, 'A'), "AA"},
		{RomanMarker(4), "IV"},
		{RomanMarker(1994), "MCMXCIV"},
		{RomanMarker(0), ""},
	}
	for i, tc := range tests {
		if tc.got != tc.want {
			t.Errorf("case %d = %q, want %q", i, tc.got, tc.want)
		}
	}
}
