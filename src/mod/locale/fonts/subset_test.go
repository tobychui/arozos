package fonts

import (
	"encoding/binary"
	"testing"

	"golang.org/x/image/font/sfnt"
	"golang.org/x/image/math/fixed"
)

// sliceToSFNT cuts the Go font to some runes and returns the font file
func sliceToSFNT(t *testing.T, runes string) []byte {
	t.Helper()
	font, err := ParseSFNT(goFont(t))
	if err != nil {
		t.Fatalf("ParseSFNT: %v", err)
	}
	src, err := newSource(font)
	if err != nil {
		t.Fatalf("newSource: %v", err)
	}
	var cps []uint32
	for _, r := range runes {
		cps = append(cps, uint32(r))
	}
	tables, err := src.slice(cps)
	if err != nil {
		t.Fatalf("slice: %v", err)
	}
	out, err := AssembleSFNT(font.Flavor, tables)
	if err != nil {
		t.Fatalf("AssembleSFNT: %v", err)
	}
	return out
}

func TestSliceKeepsOnlyRequestedGlyphs(t *testing.T) {
	data := sliceToSFNT(t, "AB")
	f, err := sfnt.Parse(data)
	if err != nil {
		t.Fatalf("x/image sfnt.Parse of the slice: %v", err)
	}
	var buf sfnt.Buffer
	for _, tt := range []struct {
		r      rune
		mapped bool
	}{{'A', true}, {'B', true}, {'Z', false}} {
		gid, err := f.GlyphIndex(&buf, tt.r)
		if err != nil {
			t.Fatalf("GlyphIndex(%q): %v", tt.r, err)
		}
		if (gid != 0) != tt.mapped {
			t.Errorf("%q mapped = %v, want %v", tt.r, gid != 0, tt.mapped)
		}
		if tt.mapped {
			segs, err := f.LoadGlyph(&buf, gid, fixed.I(32), nil)
			if err != nil || len(segs) == 0 {
				t.Errorf("glyph of %q: %d segments, %v", tt.r, len(segs), err)
			}
		}
	}

	// the glyph of 'Z' is still there, empty
	full, _ := ParseSFNT(goFont(t))
	info, cmap, _ := Inspect(full)
	sliced, _ := ParseSFNT(data)
	offsets, err := glyphOffsets(sliced, info.Glyphs)
	if err != nil {
		t.Fatalf("glyphOffsets: %v", err)
	}
	z := cmap['Z']
	if offsets[z] != offsets[z+1] {
		t.Error("the glyph of 'Z' kept its outline")
	}
	if a := cmap['A']; offsets[a] == offsets[a+1] {
		t.Error("the glyph of 'A' lost its outline")
	}
	if post := sliced.Table("post"); binary.BigEndian.Uint32(post) == 0x00020000 {
		t.Error("post table still carries glyph names")
	}
}

func TestSliceIsSmaller(t *testing.T) {
	whole := len(goFont(t))
	if part := len(sliceToSFNT(t, "ABC")); part >= whole/2 {
		t.Errorf("slice of 3 letters is %d bytes, the font %d", part, whole)
	}
}

func TestSliceWOFF2Decodes(t *testing.T) {
	font, _ := ParseSFNT(sliceToSFNT(t, "Hello"))
	woff2, err := EncodeWOFF2(font.Flavor, font.Tables, 5)
	if err != nil {
		t.Fatalf("EncodeWOFF2: %v", err)
	}
	back, container, err := Decode(woff2)
	if err != nil || container != "woff2" {
		t.Fatalf("Decode: %v %q", err, container)
	}
	if _, _, err := Inspect(back); err != nil {
		t.Errorf("Inspect of the decoded slice: %v", err)
	}
}

func TestSliceableRejectsCFFAndColour(t *testing.T) {
	font, _ := ParseSFNT(goFont(t))
	if !sliceable(font) {
		t.Fatal("the Go font should be sliceable")
	}
	for _, tag := range []string{"CFF ", "COLR", "sbix"} {
		font, _ := ParseSFNT(goFont(t))
		font.Tables[tag] = []byte{0, 0, 0, 0}
		if sliceable(font) {
			t.Errorf("font with %q is sliceable", tag)
		}
	}
}

// TestMalformedFontsDoNotPanic damages the font at the places parsers trust:
// headers, directories, offsets, lengths. Every step must fail or succeed
// without a panic.
func TestMalformedFontsDoNotPanic(t *testing.T) {
	original := goFont(t)
	font, _ := ParseSFNT(original)
	woff := makeWOFF(t, original)
	woff2, _ := EncodeWOFF2(font.Flavor, font.Tables, 1)

	// positions worth hitting: the first 512 bytes and the start of every table
	var spots []int
	for i := 0; i < 256; i++ {
		spots = append(spots, i)
	}
	for i := 0; i < int(binary.BigEndian.Uint16(original[4:])); i++ {
		off := int(binary.BigEndian.Uint32(original[12+16*i+8:]))
		for k := 0; k < 24; k++ {
			spots = append(spots, off+k)
		}
	}
	values := []byte{0x00, 0x80, 0xFF}

	exercise := func(data []byte) {
		defer func() {
			if r := recover(); r != nil {
				t.Fatalf("panic: %v", r)
			}
		}()
		f, _, err := Decode(data)
		if err != nil {
			return
		}
		if _, _, err := Inspect(f); err != nil {
			return
		}
		src, err := newSource(f)
		if err != nil {
			return
		}
		if tables, err := src.slice([]uint32{'A', 'g', 0x00E9}); err == nil {
			AssembleSFNT(f.Flavor, tables)
		}
	}

	for _, base := range [][]byte{original, woff, woff2} {
		for _, at := range spots {
			if at >= len(base) {
				continue
			}
			for _, v := range values {
				damaged := append([]byte(nil), base...)
				damaged[at] = v
				exercise(damaged)
			}
		}
		for cut := 0; cut < len(base); cut += 997 {
			exercise(base[:cut])
		}
	}
}
