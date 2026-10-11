package xls

import (
	"encoding/binary"
	"math"
	"os"
	"strings"
	"testing"
	"unicode/utf16"

	"imuslab.com/arozos/mod/office/model"
)

func TestRK(t *testing.T) {
	tests := []struct {
		rk   uint32
		want float64
	}{
		{uint32(1)<<2 | 2, 1},                      // integer
		{negRK(-5), -5},                            // negative integer
		{uint32(12345)<<2 | 3, 123.45},             // integer / 100
		{uint32(math.Float64bits(2.5) >> 32), 2.5}, // IEEE high bits
		{uint32(math.Float64bits(1.5)>>32) | 1, 0.015},
	}
	for _, tc := range tests {
		if got := rk(tc.rk); math.Abs(got-tc.want) > 1e-12 {
			t.Errorf("rk(%#x) = %v, want %v", tc.rk, got, tc.want)
		}
	}
}

// biffRecord builds one record
func biffRecord(typ uint16, payload []byte) []byte {
	h := make([]byte, 4)
	binary.LittleEndian.PutUint16(h, typ)
	binary.LittleEndian.PutUint16(h[2:], uint16(len(payload)))
	return append(h, payload...)
}

func TestStringsAcrossContinue(t *testing.T) {
	// an SST whose second string is split: its first half 8-bit in the
	// SST record, the rest UTF-16 in a CONTINUE that starts with a flags
	// byte; a third string starts right at a second CONTINUE
	sst := []byte{3, 0, 0, 0, 3, 0, 0, 0}
	sst = append(sst, 2, 0, 0, 'h', 'i') // "hi"
	sst = append(sst, 4, 0, 0, 'a', 'b') // "ab" + ...
	cont := []byte{1}                    // flags: the rest is UTF-16
	for _, r := range "中文" {
		cont = append(cont, byte(r), byte(r>>8))
	}
	cont2 := []byte{3, 0, 1}
	for _, r := range "xyz" {
		cont2 = append(cont2, byte(r), 0)
	}
	stream := append(biffRecord(rtSST, sst), biffRecord(rtContinue, cont)...)
	stream = append(stream, biffRecord(rtContinue, cont2)...)
	recs, err := readRecords(stream)
	if err != nil || len(recs) != 1 || len(recs[0].conts) != 2 {
		t.Fatalf("readRecords: %v, %d records", err, len(recs))
	}
	rd := newReader(recs[0])
	rd.skip(8)
	want := []string{"hi", "ab中文", "xyz"}
	for _, w := range want {
		if got := rd.richString(); got != w {
			t.Errorf("richString = %q, want %q", got, w)
		}
	}
	if rd.err != nil {
		t.Errorf("reader error %v", rd.err)
	}
}

// tokens helpers
func u16(v int) []byte { return []byte{byte(v), byte(v >> 8)} }

func ptgRef(row, col int, rowRel, colRel bool) []byte {
	c := col
	if colRel {
		c |= 0x4000
	}
	if rowRel {
		c |= 0x8000
	}
	return append(append([]byte{0x24}, u16(row)...), u16(c)...)
}

func ptgArea(r1, r2, c1, c2 int) []byte {
	b := []byte{0x25}
	for _, v := range []int{r1, r2, c1 | 0xC000, c2 | 0xC000} {
		b = append(b, u16(v)...)
	}
	return b
}

func ptgStr(s string) []byte {
	u := utf16.Encode([]rune(s))
	b := []byte{0x17, byte(len(u)), 1}
	for _, c := range u {
		b = append(b, byte(c), byte(c>>8))
	}
	return b
}

func ptgNum(v float64) []byte {
	b := make([]byte, 9)
	b[0] = 0x1F
	binary.LittleEndian.PutUint64(b[1:], math.Float64bits(v))
	return b
}

func cat(parts ...[]byte) []byte {
	var out []byte
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

func testBook() *book {
	b := newBook(true)
	b.sheets = []*boundSheet{{name: "Data"}, {name: "My Sheet"}, {name: "Q4"}}
	b.supbooks = []*supBook{{self: true}, {addin: true, names: []string{"_xlfn.IFERROR"}}}
	b.xtis = []xti{{book: 0, first: 1, last: 1}, {book: 0, first: 0, last: 2}, {book: 1, first: -2, last: -2}}
	b.names = []*definedName{{name: "Prices"}}
	return b
}

func TestDecompile(t *testing.T) {
	b := testBook()
	tests := []struct {
		name     string
		rgce     []byte
		rgcb     []byte
		row, col int
		want     string
	}{
		{"add with parens", cat(ptgRef(0, 0, true, true), ptgRef(0, 1, true, true), []byte{0x03}, []byte{0x15}, ptgNum(2), []byte{0x05}), nil, 0, 0, "(A1+B1)*2"},
		{"absolute refs", cat(ptgRef(1, 1, false, false), ptgRef(2, 1, false, true), []byte{0x03}, ptgRef(3, 1, true, false), []byte{0x03}), nil, 0, 0, "$B$2+B$3+$B4"},
		{"tAttrSum", cat(ptgArea(1, 4, 1, 1), []byte{0x19, 0x10, 0, 0}), nil, 0, 0, "SUM(B2:B5)"},
		{"fixed function", cat([]byte{0x41, 19, 0}, ptgNum(4), []byte{0x21, 27, 0}), nil, 0, 0, "ROUND(PI(),4)"},
		{"variable function", cat(ptgRef(2, 1, true, true), []byte{0x1E, 4, 0}, []byte{0x0D}, ptgStr("many"), ptgStr("few"), []byte{0x42, 3, 1, 0}), nil, 0, 0, `IF(B3>4,"many","few")`},
		{"string with quote", ptgStr(`say "hi"`), nil, 0, 0, `"say ""hi"""`},
		{"bool err int", cat([]byte{0x1D, 1}, []byte{0x1C, 0x07}, []byte{0x1E, 7, 0}, []byte{0x42, 3, 1, 0}), nil, 0, 0, "IF(TRUE,#DIV/0!,7)"},
		{"unary and percent", cat(ptgNum(5), []byte{0x13}, []byte{0x14}), nil, 0, 0, "-5%"},
		{"3D ref quoted", cat([]byte{0x3A}, u16(0), u16(1), u16(1|0xC000)), nil, 0, 0, "'My Sheet'!B2"},
		{"3D sheet range", cat([]byte{0x3B}, u16(1), u16(0), u16(9), u16(0|0xC000), u16(0|0xC000)), nil, 0, 0, "Data:Q4!A1:A10"},
		{"name", cat([]byte{0x23}, u16(1), u16(0), []byte{0x22, 1, 4, 0}), nil, 0, 0, "SUM(Prices)"},
		{"add-in function", cat([]byte{0x39}, u16(2), u16(1), u16(0), ptgNum(1), ptgNum(0), []byte{0x06}, ptgStr("x"), []byte{0x42, 3, 255, 0}), nil, 0, 0, `_xlfn.IFERROR(1/0,"x")`},
		{"shared formula relative", cat([]byte{0x2C}, u16(0), u16(0xFFFF&^0x3F00|0xC000), []byte{0x2C}, u16(0xFFFF), u16(0xC000), []byte{0x05}), nil, 5, 3, "C6*D5"},
		{"whole column", cat([]byte{0x25}, u16(0), u16(65535), u16(0|0x4000), u16(1|0x4000)), nil, 0, 0, "A:B"},
		{"array constant", []byte{0x60, 0, 0, 0, 0, 0, 0, 0}, cat([]byte{1}, u16(1), []byte{1}, ptgNum(1)[1:], []byte{2}, u16(1), []byte{0}, []byte("a"), []byte{4, 1, 0, 0, 0, 0, 0, 0, 0}, []byte{16, 0x2A, 0, 0, 0, 0, 0, 0, 0}), 0, 0, `{1,"a";TRUE,#N/A}`},
		{"missing argument", cat([]byte{0x16}, ptgNum(1), []byte{0x42, 2, 4, 0}), nil, 0, 0, "SUM(,1)"},
		{"union in parens", cat(ptgRef(0, 0, true, true), ptgRef(0, 1, true, true), []byte{0x10}, []byte{0x15}, []byte{0x42, 1, 4, 0}), nil, 0, 0, "SUM((A1,B1))"},
	}
	for _, tc := range tests {
		got, err := b.decompile(tc.rgce, tc.rgcb, tc.row, tc.col)
		if err != nil {
			t.Errorf("%s: %v", tc.name, err)
			continue
		}
		if got != tc.want {
			t.Errorf("%s: got %q, want %q", tc.name, got, tc.want)
		}
	}
	// broken token streams fail instead of panicking
	for _, bad := range [][]byte{{0x03}, {0x24, 1}, {0x21, 0xFF, 0x7F}, {0x42, 9, 4, 0}, {0x99}} {
		if _, err := b.decompile(bad, nil, 0, 0); err == nil {
			t.Errorf("decompile(%x) should fail", bad)
		}
	}
}

func TestQuoteSheetAndNumbers(t *testing.T) {
	for in, want := range map[string]string{
		"Data": "Data", "My Sheet": "'My Sheet'", "2024": "'2024'", "A1": "'A1'",
		"it's": "'it''s'", "報表": "報表",
	} {
		if got := quoteSheet(in); got != want {
			t.Errorf("quoteSheet(%q) = %q, want %q", in, got, want)
		}
	}
	for in, want := range map[float64]string{2: "2", 0.5: "0.5", -1.25: "-1.25", 1e-7: "1E-07", 1e20: "1E+20"} {
		if got := formatNumber(in); got != want {
			t.Errorf("formatNumber(%v) = %q, want %q", in, got, want)
		}
	}
	if colName(0) != "A" || colName(25) != "Z" || colName(26) != "AA" || colName(255) != "IV" {
		t.Error("colName")
	}
}

func TestIsDateFormat(t *testing.T) {
	tests := []struct {
		id   int
		code string
		want bool
	}{
		{14, "", true},
		{0, "", false},
		{164, "yyyy-mm-dd", true},
		{165, `#,##0.00 "days"`, false},
		{166, "[Red]0.00", false},
		{167, "[h]:mm", true},
		{168, "0.0%", false},
		{169, `"Q"0`, false},
		{170, "$#,##0.00", false},
	}
	for _, tc := range tests {
		if got := isDateFormat(tc.id, tc.code); got != tc.want {
			t.Errorf("isDateFormat(%d, %q) = %v", tc.id, tc.code, got)
		}
	}
}

func TestApplyTint(t *testing.T) {
	tests := []struct {
		c    uint32
		tint float64
		want uint32
	}{
		{0x000000, 0.5, 0x808080},
		{0xFFFFFF, -0.5, 0x808080},
		{0x4F81BD, 0, 0x4F81BD},
	}
	for _, tc := range tests {
		got := applyTint(tc.c, tc.tint)
		d := func(a, b uint32) int {
			x := int(a) - int(b)
			if x < 0 {
				return -x
			}
			return x
		}
		if d(got>>16, tc.want>>16) > 1 || d(got>>8&0xFF, tc.want>>8&0xFF) > 1 || d(got&0xFF, tc.want&0xFF) > 1 {
			t.Errorf("applyTint(%06x, %v) = %06x, want %06x", tc.c, tc.tint, got, tc.want)
		}
	}
}

func cellOf(t *testing.T, wb *model.Workbook, sheet, ref string) *model.WorkCell {
	t.Helper()
	for _, s := range wb.Sheets {
		if s.Name == sheet {
			c := s.Cells[ref]
			if c == nil {
				t.Fatalf("%s!%s missing", sheet, ref)
			}
			return c
		}
	}
	t.Fatalf("sheet %s missing", sheet)
	return nil
}

// testdata/workbook.xls was saved by Excel 2007 as an Excel 97-2003
// workbook (the twin .xlsx Excel wrote imports to the same model)
func TestParseExcelWorkbook(t *testing.T) {
	data, err := os.ReadFile("testdata/workbook.xls")
	if err != nil {
		t.Fatal(err)
	}
	wb, err := Parse(data)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if len(wb.Sheets) != 3 || wb.Sheets[0].Name != "Data" || wb.Sheets[1].Name != "Second" || wb.Active != 0 {
		t.Fatalf("sheets = %d, active %d", len(wb.Sheets), wb.Active)
	}
	values := map[string]string{
		"A1":  "Item",
		"B2":  "3",
		"C3":  "0.8",
		"D3":  "=B3*C3", // a copy of a shared formula
		"B6":  "=SUM(B2:B5)",
		"B9":  "=$B$2+B$3+$B4",
		"C8":  "=ROUND(PI(),4)",
		"D8":  `=IFERROR(1/0,"div0")`,
		"E8":  "=SUM(B2:B5*C2:C5)", // array formula
		"G4":  `=VLOOKUP("Cherry",A2:C5,3,FALSE)`,
		"A8":  "TRUE",
		"B8":  "=1/0",
		"A9":  "'00123",
		"A16": "=SUM(Prices)",
		"A15": `=HYPERLINK("https://arozos.com/","ArozOS website")`,
		"E2":  "46306",
	}
	for ref, want := range values {
		if got := cellOf(t, wb, "Data", ref).V; got != want {
			t.Errorf("Data!%s = %q, want %q", ref, got, want)
		}
	}
	hdr := cellOf(t, wb, "Data", "A1").S
	if hdr == nil || !hdr.B || hdr.Bg != "#6699cc" || hdr.Fc != "#ffffff" || hdr.Al != "c" {
		t.Errorf("header style = %+v (want bold, white on the exact #6699cc)", hdr)
	}
	if s := cellOf(t, wb, "Data", "C2").S; s == nil || s.Fmt != "currency" || s.Dec == nil || *s.Dec != 2 {
		t.Errorf("currency style = %+v", s)
	}
	if s := cellOf(t, wb, "Data", "F2").S; s == nil || s.Fmt != "percent" {
		t.Errorf("percent style = %+v", s)
	}
	if s := cellOf(t, wb, "Data", "E2").S; s == nil || s.Fmt != "date" {
		t.Errorf("date style = %+v", s)
	}
	if s := cellOf(t, wb, "Data", "C13").S; s == nil || s.Ff != "Georgia" {
		t.Errorf("font = %+v", s)
	}
	if s := cellOf(t, wb, "Data", "A13").S; s == nil || !s.St {
		t.Errorf("strikethrough = %+v", s)
	}
	if s := cellOf(t, wb, "Data", "G2").S; s == nil || !s.Wrap {
		t.Errorf("wrap = %+v", s)
	}
	if c := cellOf(t, wb, "Data", "B2"); c.S != nil {
		t.Errorf("a plain cell should carry no style, got %+v", c.S)
	}
	if n := cellOf(t, wb, "Data", "A2").N; n != "Fruit names come from the market list" {
		t.Errorf("comment = %q", n)
	}
	ws := wb.Sheets[0]
	if len(ws.Merges) != 1 || ws.Merges[0] != "A11:C11" {
		t.Errorf("merges = %v", ws.Merges)
	}
	if ws.Freeze == nil || ws.Freeze.R != 1 || ws.Freeze.C != 1 {
		t.Errorf("freeze = %+v", ws.Freeze)
	}
	if len(ws.HiddenRows) != 1 || ws.HiddenRows[0] != 13 {
		t.Errorf("hidden rows = %v", ws.HiddenRows)
	}
	if ws.RowH["12"] != 40 || ws.ColW["0"] != 116 {
		t.Errorf("sizes: row 13 = %v, col A = %v", ws.RowH["12"], ws.ColW["0"])
	}
	if wb.Sheets[1].Color != "#00c000" {
		t.Errorf("tab colour = %q", wb.Sheets[1].Color)
	}
	if len(wb.Names) != 1 || wb.Names[0].Name != "Prices" || wb.Names[0].Formula != "=Data!$C$2:$C$5" {
		t.Errorf("names = %+v", wb.Names)
	}
}

func TestRejectsOtherFiles(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		msg  string
	}{
		{"zip", []byte("PK\x03\x04 not a workbook at all"), "not an Excel"},
		{"biff4", []byte{0x09, 0x04, 0x06, 0x00, 0, 0, 0x10, 0}, "Excel 2.x"},
	}
	for _, tc := range tests {
		_, err := ToXlsx(tc.data)
		if err == nil || !strings.Contains(err.Error(), tc.msg) {
			t.Errorf("%s: err = %v, want %q", tc.name, err, tc.msg)
		}
	}
}

// negRK encodes a negative integer RK value
func negRK(v int32) uint32 { return uint32(v<<2) | 2 }

// a damaged file must fail or degrade, never panic
func TestCorruptWorkbookDoesNotPanic(t *testing.T) {
	data, err := os.ReadFile("testdata/workbook.xls")
	if err != nil {
		t.Fatal(err)
	}
	for off := 512; off < len(data); off += 61 {
		bad := append([]byte(nil), data...)
		for k := 0; k < 4 && off+k < len(bad); k++ {
			bad[off+k] ^= 0xA5
		}
		func() {
			defer func() {
				if r := recover(); r != nil {
					t.Fatalf("panic with bytes flipped at %d: %v", off, r)
				}
			}()
			ToXlsx(bad)
		}()
	}
}

func TestBoundaryValuesDoNotPanic(t *testing.T) {
	data, err := os.ReadFile("testdata/workbook.xls")
	if err != nil {
		t.Fatal(err)
	}
	// the int limits of a 32-bit target and the largest 32-bit values
	for off := 512; off+4 <= len(data); off += 53 {
		for _, v := range []uint32{0x7FFFFFFF, 0x80000000, 0xFFFFFFFF} {
			bad := append([]byte(nil), data...)
			binary.LittleEndian.PutUint32(bad[off:], v)
			func() {
				defer func() {
					if r := recover(); r != nil {
						t.Fatalf("panic with %#x at %d: %v", v, off, r)
					}
				}()
				ToXlsx(bad)
			}()
		}
	}
}
