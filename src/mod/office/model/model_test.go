package model

import (
	"testing"
)

func TestParseDocumentJSON(t *testing.T) {
	if _, err := ParseDocumentJSON(`{"html":"<p>x</p>"}`); err != nil {
		t.Errorf("valid doc: %v", err)
	}
	if _, err := ParseDocumentJSON(`{bad`); err == nil {
		t.Errorf("invalid json: expected error")
	}
}

func TestParsePresentationJSON(t *testing.T) {
	tests := []struct {
		name    string
		json    string
		wantErr bool
	}{
		{"valid", `{"size":[960,540],"slides":[{"objects":[]}]}`, false},
		{"no slides", `{"size":[960,540],"slides":[]}`, true},
		{"invalid json", `{not json`, true},
		{"empty", ``, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParsePresentationJSON(tc.json)
			if (err != nil) != tc.wantErr {
				t.Errorf("err = %v, wantErr = %v", err, tc.wantErr)
			}
		})
	}
}

/* ---------------- slide size ---------------- */

func TestSlideSizeFor(t *testing.T) {
	tests := []struct {
		name string
		w, h float64
		ww   int
		wh   int
	}{
		{"4:3 PowerPoint", 9144000, 6858000, 960, 720},
		{"16:9 widescreen", 12192000, 6858000, 960, 540},
		{"16:9 Google Slides", 9144000, 5143500, 960, 540},
		{"16:10", 1600, 1000, 960, 600},
		{"no size", 0, 0, 960, 540},
		{"absurd shape", 100000, 1, 960, 540},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			w, h := SlideSizeFor(tc.w, tc.h)
			if w != tc.ww || h != tc.wh {
				t.Errorf("slideSizeFor(%v, %v) = %dx%d, want %dx%d", tc.w, tc.h, w, h, tc.ww, tc.wh)
			}
		})
	}
}

func TestParseWorkbookJSON(t *testing.T) {
	tests := []struct {
		name    string
		json    string
		wantErr bool
	}{
		{"valid", `{"sheets":[{"name":"S1","cells":{}}],"active":0}`, false},
		{"no sheets", `{"sheets":[],"active":0}`, true},
		{"invalid", `{nope`, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			_, err := ParseWorkbookJSON(tc.json)
			if (err != nil) != tc.wantErr {
				t.Errorf("err = %v, wantErr %v", err, tc.wantErr)
			}
		})
	}
}

func TestCellRefHelpers(t *testing.T) {
	tests := []struct {
		col, row int
		ref      string
	}{
		{0, 0, "A1"}, {25, 9, "Z10"}, {26, 0, "AA1"}, {701, 99, "ZZ100"},
	}
	for _, tc := range tests {
		if got := CellRef(tc.col, tc.row); got != tc.ref {
			t.Errorf("cellRef(%d,%d) = %q, want %q", tc.col, tc.row, got, tc.ref)
		}
		c, r, ok := ParseCellRef(tc.ref)
		if !ok || c != tc.col || r != tc.row {
			t.Errorf("parseCellRef(%q) = %d,%d,%v", tc.ref, c, r, ok)
		}
	}
	if _, _, ok := ParseCellRef("1A"); ok {
		t.Errorf("parseCellRef(1A) should fail")
	}
}
