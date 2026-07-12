package office

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"io"
	"strings"
	"testing"
)

func chartTestWorkbook(t *testing.T, chartsJSON string) *Workbook {
	t.Helper()
	wb := &Workbook{Sheets: []*WorkSheet{{
		Name: "Data",
		Cells: map[string]*WorkCell{
			"A1": {V: "Month"}, "B1": {V: "Sales"}, "C1": {V: "Cost"},
			"A2": {V: "Jan"}, "B2": {V: "10"}, "C2": {V: "4"},
			"A3": {V: "Feb"}, "B3": {V: "20"}, "C3": {V: "8"},
			"A4": {V: "Mar"}, "B4": {V: "=B2+B3"}, "C4": {V: "12"},
		},
	}}}
	if chartsJSON != "" {
		wb.Sheets[0].Charts = json.RawMessage(chartsJSON)
	}
	return wb
}

func zipPart(t *testing.T, data []byte, name string) []byte {
	t.Helper()
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatalf("output is not a zip: %v", err)
	}
	for _, f := range zr.File {
		if f.Name == name {
			rc, err := f.Open()
			if err != nil {
				t.Fatalf("open %s: %v", name, err)
			}
			defer rc.Close()
			b, err := io.ReadAll(rc)
			if err != nil {
				t.Fatalf("read %s: %v", name, err)
			}
			return b
		}
	}
	return nil
}

func TestBuildXlsxWritesChartParts(t *testing.T) {
	tests := []struct {
		name      string
		chart     string
		wantPlot  string
		wantExtra string
	}{
		{
			name:     "bar chart",
			chart:    `[{"id":"ch-1","x":100,"y":50,"w":480,"h":300,"range":"A1:C4","opts":{"type":"bar","title":"Sales chart"}}]`,
			wantPlot: "<c:barChart>", wantExtra: "Sales chart",
		},
		{
			name:     "stacked line chart",
			chart:    `[{"id":"ch-2","x":0,"y":0,"w":400,"h":200,"range":"A1:B4","opts":{"type":"line","stacked":true}}]`,
			wantPlot: "<c:lineChart>", wantExtra: `<c:grouping val="stacked"/>`,
		},
		{
			name:     "pie chart",
			chart:    `[{"id":"ch-3","x":0,"y":0,"w":300,"h":300,"range":"A1:B4","opts":{"type":"pie"}}]`,
			wantPlot: "<c:pieChart>", wantExtra: "",
		},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			data, err := BuildXlsx(chartTestWorkbook(t, tc.chart))
			if err != nil {
				t.Fatalf("BuildXlsx: %v", err)
			}
			chartXML := string(zipPart(t, data, "xl/charts/chart1.xml"))
			if chartXML == "" {
				t.Fatal("xl/charts/chart1.xml missing from output")
			}
			if !strings.Contains(chartXML, tc.wantPlot) {
				t.Errorf("chart1.xml missing %s", tc.wantPlot)
			}
			if tc.wantExtra != "" && !strings.Contains(chartXML, tc.wantExtra) {
				t.Errorf("chart1.xml missing %q", tc.wantExtra)
			}
			// the ' around the sheet name is XML-escaped in the part
			if !strings.Contains(chartXML, "&apos;Data&apos;!$B$2:$B$4") {
				t.Errorf("chart1.xml missing series value reference, got: %s", chartXML)
			}
			drawing := string(zipPart(t, data, "xl/drawings/drawing1.xml"))
			if !strings.Contains(drawing, "<xdr:absoluteAnchor>") {
				t.Error("drawing1.xml missing absolute anchor")
			}
			sheet := string(zipPart(t, data, "xl/worksheets/sheet1.xml"))
			if !strings.Contains(sheet, `<drawing r:id="rId1"/>`) {
				t.Error("sheet1.xml missing drawing reference")
			}
			ctypes := string(zipPart(t, data, "[Content_Types].xml"))
			if !strings.Contains(ctypes, "/xl/charts/chart1.xml") ||
				!strings.Contains(ctypes, "/xl/drawings/drawing1.xml") {
				t.Error("[Content_Types].xml missing chart/drawing overrides")
			}
		})
	}
}

func TestBuildXlsxNoChartsNoDrawing(t *testing.T) {
	data, err := BuildXlsx(chartTestWorkbook(t, ""))
	if err != nil {
		t.Fatalf("BuildXlsx: %v", err)
	}
	if zipPart(t, data, "xl/drawings/drawing1.xml") != nil {
		t.Error("drawing part written for a chartless workbook")
	}
	if strings.Contains(string(zipPart(t, data, "xl/worksheets/sheet1.xml")), "<drawing") {
		t.Error("sheet references a drawing that does not exist")
	}
}

func TestXlsxChartRoundTrip(t *testing.T) {
	src := `[{"id":"ch-1","x":120,"y":60,"w":500,"h":320,"range":"A1:C4",` +
		`"opts":{"type":"bar","title":"Quarterly","headerRow":true,"labelCol":true,"stacked":true}}]`
	data, err := BuildXlsx(chartTestWorkbook(t, src))
	if err != nil {
		t.Fatalf("BuildXlsx: %v", err)
	}
	wb2, err := ParseXlsx(data)
	if err != nil {
		t.Fatalf("ParseXlsx: %v", err)
	}
	var charts []*xlsxChart
	if err := json.Unmarshal(wb2.Sheets[0].Charts, &charts); err != nil {
		t.Fatalf("reimported charts blob invalid: %v (%s)", err, wb2.Sheets[0].Charts)
	}
	if len(charts) != 1 {
		t.Fatalf("expected 1 chart after round trip, got %d", len(charts))
	}
	ch := charts[0]
	if ch.Range != "A1:C4" {
		t.Errorf("range: got %s, want A1:C4", ch.Range)
	}
	if ch.chartType() != "bar" {
		t.Errorf("type: got %s, want bar", ch.chartType())
	}
	if ch.Opts == nil || !ch.Opts.Stacked {
		t.Error("stacked flag lost in round trip")
	}
	if ch.Opts.Title != "Quarterly" {
		t.Errorf("title: got %q, want Quarterly", ch.Opts.Title)
	}
	if !ch.headerRow() || !ch.labelCol() {
		t.Error("headerRow/labelCol lost in round trip")
	}
	// absolute anchor position survives (px in, px out)
	if ch.X < 119 || ch.X > 121 || ch.Y < 59 || ch.Y > 61 {
		t.Errorf("position drifted: got (%v, %v), want (~120, ~60)", ch.X, ch.Y)
	}
	if ch.W < 499 || ch.W > 501 || ch.H < 319 || ch.H > 321 {
		t.Errorf("size drifted: got (%v, %v), want (~500, ~320)", ch.W, ch.H)
	}
}

func TestXlsxChartRoundTripNoHeaderNoLabel(t *testing.T) {
	src := `[{"id":"ch-1","x":0,"y":0,"w":400,"h":300,"range":"B2:C4",` +
		`"opts":{"type":"line","headerRow":false,"labelCol":false}}]`
	data, err := BuildXlsx(chartTestWorkbook(t, src))
	if err != nil {
		t.Fatalf("BuildXlsx: %v", err)
	}
	wb2, err := ParseXlsx(data)
	if err != nil {
		t.Fatalf("ParseXlsx: %v", err)
	}
	var charts []*xlsxChart
	if err := json.Unmarshal(wb2.Sheets[0].Charts, &charts); err != nil || len(charts) != 1 {
		t.Fatalf("expected 1 chart, got %s", wb2.Sheets[0].Charts)
	}
	ch := charts[0]
	if ch.Range != "B2:C4" {
		t.Errorf("range: got %s, want B2:C4", ch.Range)
	}
	if ch.headerRow() || ch.labelCol() {
		t.Errorf("headerRow/labelCol should be false, got %v/%v", ch.headerRow(), ch.labelCol())
	}
	if ch.chartType() != "line" {
		t.Errorf("type: got %s, want line", ch.chartType())
	}
}

func TestParseRangeRef(t *testing.T) {
	tests := []struct {
		in             string
		c1, r1, c2, r2 int
		ok             bool
	}{
		{"A1:C5", 0, 0, 2, 4, true},
		{"$B$2:$D$9", 1, 1, 3, 8, true},
		{"C5:A1", 0, 0, 2, 4, true}, // normalized
		{"A1", 0, 0, 0, 0, true},
		{"nope", 0, 0, 0, 0, false},
		{"", 0, 0, 0, 0, false},
	}
	for _, tc := range tests {
		c1, r1, c2, r2, ok := parseRangeRef(tc.in)
		if ok != tc.ok {
			t.Errorf("parseRangeRef(%q) ok = %v, want %v", tc.in, ok, tc.ok)
			continue
		}
		if ok && (c1 != tc.c1 || r1 != tc.r1 || c2 != tc.c2 || r2 != tc.r2) {
			t.Errorf("parseRangeRef(%q) = (%d,%d,%d,%d), want (%d,%d,%d,%d)",
				tc.in, c1, r1, c2, r2, tc.c1, tc.r1, tc.c2, tc.r2)
		}
	}
}
