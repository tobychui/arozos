package odf

import (
	"testing"
)

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
