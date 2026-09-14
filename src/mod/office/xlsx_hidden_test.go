package office

import (
	"reflect"
	"testing"
)

func TestXlsxHiddenRowsRoundTrip(t *testing.T) {
	cases := []struct {
		name   string
		hidden []int
	}{
		{"none", nil},
		{"row with data", []int{1}},
		{"empty rows past the data", []int{1, 6, 7}},
	}
	for _, c := range cases {
		wb := &Workbook{Sheets: []*WorkSheet{{
			Name: "Data",
			Cells: map[string]*WorkCell{
				"A1": {V: "keep"},
				"A2": {V: "hidden"},
				"A3": {V: "=A1&A2"},
			},
			HiddenRows: c.hidden,
		}}}
		data, err := BuildXlsx(wb)
		if err != nil {
			t.Fatalf("%s: BuildXlsx: %v", c.name, err)
		}
		back, err := ParseXlsx(data)
		if err != nil {
			t.Fatalf("%s: ParseXlsx: %v", c.name, err)
		}
		ws := back.Sheets[0]
		if !reflect.DeepEqual(ws.HiddenRows, c.hidden) {
			t.Errorf("%s: hidden rows = %v, want %v", c.name, ws.HiddenRows, c.hidden)
		}
		if ws.Cells["A2"] == nil || ws.Cells["A2"].V != "hidden" {
			t.Errorf("%s: A2 lost its value: %+v", c.name, ws.Cells["A2"])
		}
	}
}
