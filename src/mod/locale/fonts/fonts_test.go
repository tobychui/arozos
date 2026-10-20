package fonts

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"reflect"
	"testing"

	"golang.org/x/image/font/gofont/goregular"
)

// goFont is a small, permissively licensed TrueType font to test with
func goFont(t *testing.T) []byte {
	t.Helper()
	return append([]byte(nil), goregular.TTF...)
}

// makeWOFF packs an sfnt into a WOFF 1.0 file, compressing every table
func makeWOFF(t *testing.T, sfnt []byte) []byte {
	t.Helper()
	font, err := ParseSFNT(sfnt)
	if err != nil {
		t.Fatalf("ParseSFNT: %v", err)
	}
	tags := sortedTags(font.Tables)
	header := make([]byte, 44+20*len(tags))
	binary.BigEndian.PutUint32(header, sigWOFF)
	binary.BigEndian.PutUint32(header[4:], font.Flavor)
	binary.BigEndian.PutUint16(header[12:], uint16(len(tags)))
	var data []byte
	for i, tag := range tags {
		table := font.Tables[tag]
		var z bytes.Buffer
		w := zlib.NewWriter(&z)
		w.Write(table)
		w.Close()
		stored := z.Bytes()
		if len(stored) >= len(table) {
			stored = table
		}
		rec := header[44+20*i:]
		copy(rec, tag)
		binary.BigEndian.PutUint32(rec[4:], uint32(len(header)+len(data)))
		binary.BigEndian.PutUint32(rec[8:], uint32(len(stored)))
		binary.BigEndian.PutUint32(rec[12:], uint32(len(table)))
		data = append(data, stored...)
		for len(data)%4 != 0 {
			data = append(data, 0)
		}
	}
	out := append(header, data...)
	binary.BigEndian.PutUint32(out[8:], uint32(len(out)))
	return out
}

func TestDecodeDetectsContainers(t *testing.T) {
	sfnt := goFont(t)
	collection := append([]byte("ttcf"), make([]byte, 40)...)
	tests := []struct {
		name      string
		data      []byte
		container string
		wantErr   bool
	}{
		{"truetype", sfnt, "sfnt", false},
		{"woff", makeWOFF(t, sfnt), "woff", false},
		{"collection", collection, "", true},
		{"garbage", []byte("definitely not a font file"), "", true},
		{"empty", nil, "", true},
		{"truncated directory", sfnt[:40], "", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, container, err := Decode(tt.data)
			if (err != nil) != tt.wantErr {
				t.Fatalf("Decode error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr && container != tt.container {
				t.Errorf("container = %q, want %q", container, tt.container)
			}
		})
	}
}

func TestInspectReadsNamesAndCoverage(t *testing.T) {
	font, _, err := Decode(goFont(t))
	if err != nil {
		t.Fatalf("Decode: %v", err)
	}
	info, cmap, err := Inspect(font)
	if err != nil {
		t.Fatalf("Inspect: %v", err)
	}
	if info.Family != "Go" || info.Style != "Regular" {
		t.Errorf("family/style = %q/%q, want Go/Regular", info.Family, info.Style)
	}
	if info.WeightMin != 400 || info.WeightMax != 400 || info.Italic || info.Variable {
		t.Errorf("weight %d-%d italic %v variable %v, want 400-400 upright static", info.WeightMin, info.WeightMax, info.Italic, info.Variable)
	}
	if info.Outline != "truetype" || info.Glyphs == 0 {
		t.Errorf("outline %q glyphs %d", info.Outline, info.Glyphs)
	}
	if cmap['A'] == 0 || info.Codepoints != len(cmap) {
		t.Errorf("cmap misses 'A' or count %d != %d", info.Codepoints, len(cmap))
	}
	if len(info.Scripts) == 0 || info.Scripts[0] != "latin" {
		t.Errorf("scripts = %v, want latin first", info.Scripts)
	}
}

func TestInspectRejectsIncompleteFonts(t *testing.T) {
	tests := []struct {
		name string
		drop string
	}{
		{"no cmap", "cmap"},
		{"no name", "name"},
		{"no outlines", "glyf"},
		{"no metrics", "hmtx"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			font, err := ParseSFNT(goFont(t))
			if err != nil {
				t.Fatalf("ParseSFNT: %v", err)
			}
			delete(font.Tables, tt.drop)
			if _, _, err := Inspect(font); err == nil {
				t.Errorf("Inspect without %q succeeded", tt.drop)
			}
		})
	}
}

func TestCmapRoundTrip(t *testing.T) {
	mappings := []Mapping{
		{0x41, 3}, {0x42, 4}, {0x43, 9}, // a run with non consecutive glyphs
		{0x4E00, 100}, {0x4E01, 101}, // consecutive both ways
		{0xFF01, 7},
		{0x20000, 200}, {0x20001, 201}, // beyond the BMP: format 12 only
	}
	table := BuildCmap(mappings)
	got, err := ParseCmap(table, 1000)
	if err != nil {
		t.Fatalf("ParseCmap: %v", err)
	}
	if len(got) != len(mappings) {
		t.Fatalf("got %d mappings, want %d", len(got), len(mappings))
	}
	for _, m := range mappings {
		if got[m.Codepoint] != m.Glyph {
			t.Errorf("U+%X -> %d, want %d", m.Codepoint, got[m.Codepoint], m.Glyph)
		}
	}

	// the format 4 subtable alone must agree for the BMP
	f4 := buildFormat4(mappings[:6])
	single := append([]byte{0, 0, 0, 1, 0, 3, 0, 1, 0, 0, 0, 12}, f4...)
	bmp, err := ParseCmap(single, 1000)
	if err != nil {
		t.Fatalf("ParseCmap(format 4): %v", err)
	}
	for _, m := range mappings[:6] {
		if bmp[m.Codepoint] != m.Glyph {
			t.Errorf("format 4: U+%X -> %d, want %d", m.Codepoint, bmp[m.Codepoint], m.Glyph)
		}
	}
}

func TestParseCmapDropsOutOfRangeGlyphs(t *testing.T) {
	table := BuildCmap([]Mapping{{0x41, 5}, {0x42, 50}})
	got, err := ParseCmap(table, 10)
	if err != nil {
		t.Fatalf("ParseCmap: %v", err)
	}
	if _, ok := got[0x42]; ok || got[0x41] != 5 {
		t.Errorf("got %v, want only U+41 -> 5", got)
	}
}

func TestWOFFDecodesToSameTables(t *testing.T) {
	sfnt := goFont(t)
	want, _ := ParseSFNT(sfnt)
	got, container, err := Decode(makeWOFF(t, sfnt))
	if err != nil || container != "woff" {
		t.Fatalf("Decode(woff) = %v, %q", err, container)
	}
	if !reflect.DeepEqual(got.Tables, want.Tables) {
		t.Error("WOFF tables differ from the sfnt ones")
	}
}

func TestWOFF2RoundTrip(t *testing.T) {
	want, _ := ParseSFNT(goFont(t))
	woff2, err := EncodeWOFF2(want.Flavor, want.Tables, 5)
	if err != nil {
		t.Fatalf("EncodeWOFF2: %v", err)
	}
	if len(woff2)%4 != 0 || int(binary.BigEndian.Uint32(woff2[8:])) != len(woff2) {
		t.Errorf("length field %d, file %d bytes", binary.BigEndian.Uint32(woff2[8:]), len(woff2))
	}
	if int(binary.BigEndian.Uint32(woff2[16:])) != sfntSize(want.Tables) {
		t.Error("totalSfntSize does not match the tables")
	}
	got, container, err := Decode(woff2)
	if err != nil || container != "woff2" {
		t.Fatalf("Decode(woff2) = %v, %q", err, container)
	}
	if len(got.Transformed) != 0 {
		t.Errorf("tables marked transformed: %v", got.Transformed)
	}
	if !reflect.DeepEqual(got.Tables, want.Tables) {
		t.Error("WOFF2 tables differ after a round trip")
	}
}

func TestBase128(t *testing.T) {
	for _, v := range []uint32{0, 1, 127, 128, 16383, 16384, 1 << 28, 0xFFFFFFFF} {
		enc := appendBase128(nil, v)
		off := 0
		got, err := readBase128(enc, &off)
		if err != nil || got != v || off != len(enc) {
			t.Errorf("round trip %d: got %d, %v, read %d of %d bytes", v, got, err, off, len(enc))
		}
	}
	bad := [][]byte{
		{0x80, 0x01},                   // leading zero
		{0xFF, 0xFF, 0xFF, 0xFF, 0x7F}, // overflows 32 bits
		{0x81, 0x81, 0x81, 0x81, 0x81}, // never ends
		{0x81},                         // truncated
	}
	for _, b := range bad {
		off := 0
		if _, err := readBase128(b, &off); err == nil {
			t.Errorf("readBase128(% x) succeeded", b)
		}
	}
}

func TestAssembleSFNTChecksums(t *testing.T) {
	font, _ := ParseSFNT(goFont(t))
	tables := map[string][]byte{}
	for tag, data := range font.Tables {
		tables[tag] = data
	}
	out, err := AssembleSFNT(font.Flavor, tables)
	if err != nil {
		t.Fatalf("AssembleSFNT: %v", err)
	}
	if checksum(out) != 0xB1B0AFBA {
		t.Errorf("file checksum %08x, want B1B0AFBA", checksum(out))
	}
	again, err := ParseSFNT(out)
	if err != nil || len(again.Tables) != len(font.Tables) {
		t.Fatalf("reparse: %v", err)
	}
}

/* ── GSUB ── */

// builder writes big endian values and patches offsets
type builder struct{ b []byte }

func (w *builder) u16(values ...int) {
	for _, v := range values {
		w.b = binary.BigEndian.AppendUint16(w.b, uint16(v))
	}
}
func (w *builder) tag(s string) { w.b = append(w.b, s...) }
func (w *builder) pos() int     { return len(w.b) }
func (w *builder) set16(at, v int) {
	binary.BigEndian.PutUint16(w.b[at:], uint16(v))
}

// testGSUB holds: liga f(10)+i(11) -> fi(50); calt chaining context on
// B(20) running nested single subst B -> B.alt(60); salt A(30) -> 70
func testGSUB() []byte {
	w := &builder{}
	w.u16(1, 0, 10, 12, 0) // version, scriptList, featureList, lookupList (patched)
	w.u16(0)               // ScriptList: no scripts

	features := w.pos()
	w.u16(3)
	recs := []struct {
		tag    string
		lookup int
	}{{"liga", 0}, {"calt", 1}, {"salt", 2}}
	for range recs {
		w.tag("xxxx")
		w.u16(0)
	}
	for i, r := range recs {
		copy(w.b[features+2+6*i:], r.tag)
		w.set16(features+2+6*i+4, w.pos()-features)
		w.u16(0, 1, r.lookup)
	}

	lookups := w.pos()
	w.set16(8, lookups)
	w.u16(4, 0, 0, 0, 0)
	lookup := func(i, kind int) int {
		w.set16(lookups+2+2*i, w.pos()-lookups)
		start := w.pos()
		w.u16(kind, 0, 1, 8)
		return start
	}
	coverage := func(subtable, field int, glyph int) {
		w.set16(field, w.pos()-subtable)
		w.u16(1, 1, glyph)
	}

	// 0: ligature f + i -> fi
	lookup(0, 4)
	sub := w.pos()
	w.u16(1, 0, 1, 0)
	coverage(sub, sub+2, 10)
	w.set16(sub+6, w.pos()-sub)
	set := w.pos()
	w.u16(1, 4)
	_ = set
	w.u16(50, 2, 11)

	// 1: chaining context format 3 on B, nested lookup 3
	lookup(1, 6)
	sub = w.pos()
	w.u16(3, 0, 1, 0, 0, 1, 0, 3) // format, backtrack 0, input 1 (cov patched), lookahead 0, 1 record (seq 0, lookup 3)
	coverage(sub, sub+6, 20)

	// 2: salt, single format 1 delta +40
	lookup(2, 1)
	sub = w.pos()
	w.u16(1, 0, 40)
	coverage(sub, sub+2, 30)

	// 3: nested, single format 2 B -> 60
	lookup(3, 1)
	sub = w.pos()
	w.u16(2, 0, 1, 60)
	coverage(sub, sub+2, 20)
	return w.b
}

func TestParseGSUBFollowsDefaultFeatures(t *testing.T) {
	rules, err := parseGSUB(testGSUB(), 100)
	if err != nil {
		t.Fatalf("parseGSUB: %v", err)
	}
	tests := []struct {
		name   string
		start  []int
		want   []int
		absent []int
	}{
		{"ligature needs every component", []int{10}, nil, []int{50}},
		{"ligature with both components", []int{10, 11}, []int{50}, nil},
		{"nested contextual lookup", []int{20}, []int{60}, nil},
		{"optional feature not followed", []int{30}, nil, []int{70}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			keep := make([]bool, 100)
			for _, g := range tt.start {
				keep[g] = true
			}
			rules.closure(keep)
			for _, g := range tt.want {
				if !keep[g] {
					t.Errorf("glyph %d not reached", g)
				}
			}
			for _, g := range tt.absent {
				if keep[g] {
					t.Errorf("glyph %d reached", g)
				}
			}
		})
	}
}

func TestParseGSUBToleratesDamage(t *testing.T) {
	table := testGSUB()
	for cut := 0; cut < len(table); cut++ {
		parseGSUB(table[:cut], 100) // must not panic
	}
	for i := range table {
		damaged := append([]byte(nil), table...)
		damaged[i] ^= 0xFF
		parseGSUB(damaged, 100)
	}
}

func TestComponents(t *testing.T) {
	glyph := []byte{0xFF, 0xFF, 0, 0, 0, 0, 0, 0, 0, 0} // numberOfContours -1, bbox
	// component 1: words args, a scale, more components
	glyph = binary.BigEndian.AppendUint16(glyph, 0x0001|0x0008|0x0020)
	glyph = binary.BigEndian.AppendUint16(glyph, 7)
	glyph = append(glyph, 0, 0, 0, 0, 0x40, 0)
	// component 2: byte args, last
	glyph = binary.BigEndian.AppendUint16(glyph, 0)
	glyph = binary.BigEndian.AppendUint16(glyph, 9)
	glyph = append(glyph, 0, 0)

	if got := components(glyph); !reflect.DeepEqual(got, []uint16{7, 9}) {
		t.Errorf("components = %v, want [7 9]", got)
	}
	if got := components([]byte{0, 1, 0, 0, 0, 0, 0, 0, 0, 0}); got != nil {
		t.Errorf("simple glyph has components %v", got)
	}
	if got := components(glyph[:13]); len(got) > 1 {
		t.Errorf("truncated composite yields %v", got)
	}
}

func TestSliceGvar(t *testing.T) {
	// 3 glyphs, 1 axis, 1 shared tuple, short offsets
	gvar := []byte{0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0, 28, 0, 3, 0, 0, 0, 0, 0, 30}
	gvar = binary.BigEndian.AppendUint16(gvar, 0) // offsets / 2
	gvar = binary.BigEndian.AppendUint16(gvar, 2)
	gvar = binary.BigEndian.AppendUint16(gvar, 3)
	gvar = binary.BigEndian.AppendUint16(gvar, 5)
	gvar = append(gvar, 0x40, 0)                      // shared tuple at 28
	gvar = append(gvar, 1, 1, 1, 1, 2, 2, 3, 3, 3, 3) // data at 30: 4 + 2 + 4 bytes

	out, err := sliceGvar(gvar, []bool{true, false, true})
	if err != nil {
		t.Fatalf("sliceGvar: %v", err)
	}
	if binary.BigEndian.Uint16(out[14:])&1 == 0 {
		t.Error("output does not use long offsets")
	}
	shared := binary.BigEndian.Uint32(out[8:])
	if !bytes.Equal(out[shared:shared+2], []byte{0x40, 0}) {
		t.Error("shared tuples not copied")
	}
	base := binary.BigEndian.Uint32(out[16:])
	offs := make([]uint32, 4)
	for i := range offs {
		offs[i] = binary.BigEndian.Uint32(out[20+4*i:])
	}
	if want := []uint32{0, 4, 4, 8}; !reflect.DeepEqual(offs, want) {
		t.Fatalf("offsets = %v, want %v", offs, want)
	}
	if !bytes.Equal(out[base:base+8], []byte{1, 1, 1, 1, 3, 3, 3, 3}) {
		t.Errorf("data = % x", out[base:base+8])
	}
	if _, err := sliceGvar(gvar, []bool{true}); err == nil {
		t.Error("glyph count mismatch accepted")
	}
}

func TestUnicodeRange(t *testing.T) {
	tests := []struct {
		cps  []uint32
		gap  uint32
		want string
	}{
		{nil, 0, ""},
		{[]uint32{0x41}, 0, "U+41"},
		{[]uint32{0x41, 0x42, 0x43, 0x50}, 0, "U+41-43, U+50"},
		{[]uint32{0x41, 0x42, 0x43, 0x50}, 16, "U+41-50"},
	}
	for _, tt := range tests {
		if got := unicodeRange(tt.cps, tt.gap); got != tt.want {
			t.Errorf("unicodeRange(%v, %d) = %q, want %q", tt.cps, tt.gap, got, tt.want)
		}
	}
}
