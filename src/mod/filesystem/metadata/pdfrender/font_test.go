package pdfrender

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"fmt"
	"image"
	"testing"

	"golang.org/x/image/font/gofont/goregular"
)

/*
	Fonts: every font program kind draws a square "A" (100..600 of a 1000
	unit em). Shown at size 100 from (20, 20) that is the square 30..80.
*/

// squareCharstring2 is a Type 2 charstring for that square
var squareCharstring2 = []byte{
	239, 239, 21, //100 100 rmoveto
	248, 136, 139, 5, //500 0 rlineto
	139, 248, 136, 5, //0 500 rlineto
	252, 136, 139, 5, //-500 0 rlineto
	14, //endchar
}

func cffInt(v int) []byte {
	//Five byte integers keep the offsets in the top DICT a fixed size
	b := []byte{29, 0, 0, 0, 0}
	binary.BigEndian.PutUint32(b[1:], uint32(int32(v)))
	return b
}

func cffIndexBytes(items ...[]byte) []byte {
	if len(items) == 0 {
		return []byte{0, 0}
	}
	out := []byte{0, byte(len(items)), 2}
	off := 1
	out = append(out, byte(off>>8), byte(off))
	for _, it := range items {
		off += len(it)
		out = append(out, byte(off>>8), byte(off))
	}
	for _, it := range items {
		out = append(out, it...)
	}
	return out
}

// buildCFF makes a two glyph CFF font: .notdef and the square "A"
func buildCFF() []byte {
	header := []byte{1, 0, 4, 2}
	name := cffIndexBytes([]byte("Square"))
	strs := cffIndexBytes()
	gsubrs := cffIndexBytes()
	charStrings := cffIndexBytes([]byte{14}, squareCharstring2)
	charset := []byte{0, 0, 34} //Format 0, glyph 1 is SID 34 ("A")
	//Top DICT size is fixed: charset, CharStrings and Private entries
	topLen := 5 + 1 + 5 + 1 + 5 + 5 + 1
	topIndexLen := 3 + 4 + topLen
	base := len(header) + len(name) + topIndexLen + len(strs) + len(gsubrs)
	charsetOff := base
	csOff := charsetOff + len(charset)
	privOff := csOff + len(charStrings)
	top := append(cffInt(charsetOff), 15)
	top = append(top, append(cffInt(csOff), 17)...)
	top = append(top, append(append(cffInt(0), cffInt(privOff)...), 18)...)
	out := append([]byte{}, header...)
	out = append(out, name...)
	out = append(out, cffIndexBytes(top)...)
	out = append(out, strs...)
	out = append(out, gsubrs...)
	out = append(out, charset...)
	out = append(out, charStrings...)
	return out
}

func encryptType1(plain []byte, r uint16) []byte {
	const c1, c2 = 52845, 22719
	out := make([]byte, len(plain))
	for i, p := range plain {
		c := p ^ byte(r>>8)
		out[i] = c
		r = (uint16(c)+r)*c1 + c2
	}
	return out
}

// buildType1 makes a Type 1 font program whose "A" is the square
func buildType1() ([]byte, int) {
	cs := []byte{
		139, 248, 236, 13, //0 600 hsbw
		239, 239, 21, //100 100 rmoveto
		248, 136, 139, 5, //500 0 rlineto
		139, 248, 136, 5, //0 500 rlineto
		252, 136, 139, 5, //-500 0 rlineto
		9, 14, //closepath endchar
	}
	encCS := encryptType1(append([]byte{1, 2, 3, 4}, cs...), 4330)
	notdef := encryptType1([]byte{1, 2, 3, 4, 139, 139, 13, 14}, 4330)
	var priv bytes.Buffer
	priv.WriteString("dup /Private 8 dict dup begin /RD{string currentfile exch readstring pop}executeonly def\n")
	priv.WriteString("/lenIV 4 def\n/Subrs 0 array\n2 index /CharStrings 2 dict dup begin\n")
	fmt.Fprintf(&priv, "/.notdef %d RD ", len(notdef))
	priv.Write(notdef)
	priv.WriteString(" ND\n")
	fmt.Fprintf(&priv, "/A %d RD ", len(encCS))
	priv.Write(encCS)
	priv.WriteString(" ND\nend end\n")
	clear := "%!PS-AdobeFont-1.0: Square 001.000\n/FontMatrix [0.001 0 0 0.001 0 0] readonly def\n/Encoding StandardEncoding def\ncurrentfile eexec\n"
	enc := encryptType1(append([]byte{9, 9, 9, 9}, priv.Bytes()...), 55665)
	return append([]byte(clear), enc...), len(clear)
}

func squareFontPage(fontDict func(b *pdfBuilder) string, text string) []byte {
	return onePage(100, 100, "/Font << /F1 4 0 R >>", "BT /F1 100 Tf 20 20 Td "+text+" Tj ET", func(b *pdfBuilder) string {
		b.reserve() //4: the font
		b.set(4, fontDict(b))
		return ""
	})
}

func TestFontPrograms(t *testing.T) {
	cffData := buildCFF()
	t1Data, t1Len := buildType1()
	tests := []struct {
		name string
		font func(b *pdfBuilder) string
		text string
	}{
		{"type1c (cff)", func(b *pdfBuilder) string {
			ff := b.addStream("/Subtype /Type1C", cffData)
			fd := b.add(fmt.Sprintf("<< /Type /FontDescriptor /FontName /Square /Flags 32 /FontFile3 %d 0 R >>", ff))
			return fmt.Sprintf("<< /Type /Font /Subtype /Type1 /BaseFont /Square /FirstChar 65 /LastChar 65 /Widths [700] /Encoding /WinAnsiEncoding /FontDescriptor %d 0 R >>", fd)
		}, "(A)"},
		{"type1", func(b *pdfBuilder) string {
			ff := b.addStream(fmt.Sprintf("/Length1 %d /Length2 %d /Length3 0", t1Len, len(t1Data)-t1Len), t1Data)
			fd := b.add(fmt.Sprintf("<< /Type /FontDescriptor /FontName /Square /Flags 32 /FontFile %d 0 R >>", ff))
			return fmt.Sprintf("<< /Type /Font /Subtype /Type1 /BaseFont /Square /FirstChar 65 /LastChar 65 /Widths [700] /FontDescriptor %d 0 R >>", fd)
		}, "(A)"},
		{"type3", func(b *pdfBuilder) string {
			proc := b.addStream("", []byte("1000 0 0 0 1000 1000 d1 100 100 500 500 re f"))
			return fmt.Sprintf("<< /Type /Font /Subtype /Type3 /FontBBox [0 0 1000 1000] /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /sq %d 0 R >> /Encoding << /Type /Encoding /Differences [65 /sq] >> /FirstChar 65 /LastChar 65 /Widths [1000] /Resources << >> >>", proc)
		}, "(A)"},
		{"cid cff in a type0 font", func(b *pdfBuilder) string {
			ff := b.addStream("/Subtype /CIDFontType0C", cffData)
			fd := b.add(fmt.Sprintf("<< /Type /FontDescriptor /FontName /Square /Flags 4 /FontFile3 %d 0 R >>", ff))
			cid := b.add(fmt.Sprintf("<< /Type /Font /Subtype /CIDFontType0 /BaseFont /Square /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor %d 0 R /DW 1000 >>", fd))
			return fmt.Sprintf("<< /Type /Font /Subtype /Type0 /BaseFont /Square /Encoding /Identity-H /DescendantFonts [%d 0 R] >>", cid)
		}, "<0001>"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			img := renderBytes(t, squareFontPage(tc.font, tc.text), 1)
			assertColor(t, img, 55, 55, 100, black, 20, "inside the glyph")
			assertColor(t, img, 25, 25, 100, white, 20, "left of the glyph")
			assertColor(t, img, 90, 90, 100, white, 20, "beyond the glyph")
		})
	}
}

// textPage draws text with a font and returns the dark pixel count in the
// band where the glyphs sit, and below it
func textInk(t *testing.T, fontDict func(b *pdfBuilder) string, ops string) (int, int) {
	t.Helper()
	data := onePage(300, 100, "/Font << /F1 4 0 R >>", "BT /F1 60 Tf 10 30 Td "+ops+" ET", func(b *pdfBuilder) string {
		b.reserve()
		b.set(4, fontDict(b))
		return ""
	})
	img := renderBytes(t, data, 1)
	//Baseline at y = 30 points, so device rows 26..70 hold the caps
	return darkCount(img, image.Rect(0, 26, 300, 70)), darkCount(img, image.Rect(0, 75, 300, 100))
}

func TestTextRendering(t *testing.T) {
	helvetica := func(b *pdfBuilder) string {
		return "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
	}
	var z bytes.Buffer
	zw := zlib.NewWriter(&z)
	zw.Write(goregular.TTF)
	zw.Close()
	embeddedTT := func(b *pdfBuilder) string {
		ff := b.addStream(fmt.Sprintf("/Filter /FlateDecode /Length1 %d", len(goregular.TTF)), z.Bytes())
		fd := b.add(fmt.Sprintf("<< /Type /FontDescriptor /FontName /GoRegular /Flags 32 /FontFile2 %d 0 R >>", ff))
		return fmt.Sprintf("<< /Type /Font /Subtype /TrueType /BaseFont /GoRegular /Encoding /WinAnsiEncoding /FontDescriptor %d 0 R >>", fd)
	}
	tt, err := parseSFNT(goregular.TTF)
	if err != nil {
		t.Fatal(err)
	}
	gidH := tt.unicodeGID('H')
	cidTT := func(b *pdfBuilder) string {
		ff := b.addStream("/Filter /FlateDecode", z.Bytes())
		fd := b.add(fmt.Sprintf("<< /Type /FontDescriptor /FontName /GoRegular /Flags 4 /FontFile2 %d 0 R >>", ff))
		cid := b.add(fmt.Sprintf("<< /Type /Font /Subtype /CIDFontType2 /BaseFont /GoRegular /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor %d 0 R /CIDToGIDMap /Identity /DW 700 >>", fd))
		return fmt.Sprintf("<< /Type /Font /Subtype /Type0 /BaseFont /GoRegular /Encoding /Identity-H /DescendantFonts [%d 0 R] >>", cid)
	}
	hHex := fmt.Sprintf("<%04X%04X%04X>", gidH, gidH, gidH)
	tests := []struct {
		name    string
		font    func(b *pdfBuilder) string
		ops     string
		wantInk bool
	}{
		{"standard font through the fallback", helvetica, "(HHH) Tj", true},
		{"embedded truetype", embeddedTT, "(HHH) Tj", true},
		{"cid truetype identity-h", cidTT, hHex + " Tj", true},
		{"TJ with kerning", helvetica, "[(H) -200 (H) 300 (H)] TJ", true},
		{"invisible text (OCR layers)", helvetica, "3 Tr (HHH) Tj", false},
		{"stroked text", helvetica, "1 Tr 2 w (HHH) Tj", true},
		{"spaces only", helvetica, "(   ) Tj", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ink, below := textInk(t, tc.font, tc.ops)
			if tc.wantInk && ink < 300 {
				t.Errorf("only %d dark pixels where the text should be", ink)
			}
			if !tc.wantInk && ink > 0 {
				t.Errorf("%d dark pixels, want none", ink)
			}
			if below > 0 {
				t.Errorf("%d dark pixels below the text", below)
			}
		})
	}
}

func TestTrueTypeAndEncodings(t *testing.T) {
	tt, err := parseSFNT(goregular.TTF)
	if err != nil {
		t.Fatalf("parseSFNT: %v", err)
	}
	if tt.unitsPerEm != 2048 {
		t.Errorf("unitsPerEm = %d", tt.unitsPerEm)
	}
	for _, r := range "Aa1&" {
		gid := tt.unicodeGID(r)
		if gid == 0 {
			t.Errorf("no glyph for %q", r)
			continue
		}
		if p := tt.glyphPath(gid); p.empty() {
			t.Errorf("empty outline for %q", r)
		}
		if tt.advance(gid) <= 0 {
			t.Errorf("no advance for %q", r)
		}
	}
	if len(macGlyphNames) != 258 {
		t.Errorf("mac glyph names = %d, want 258", len(macGlyphNames))
	}
	if len(cffStandardStrings) != 391 {
		t.Errorf("cff standard strings = %d, want 391", len(cffStandardStrings))
	}
	names := []struct {
		name string
		want rune
	}{
		{"A", 'A'}, {"quoteright", 0x2019}, {"uni4E2D", 0x4E2D}, {"u1F600", 0x1F600}, {"a.sc", 'a'}, {"Euro", 0x20AC},
	}
	for _, n := range names {
		if r, ok := glyphNameToRune(n.name); !ok || r != n.want {
			t.Errorf("glyphNameToRune(%q) = %U, want %U", n.name, r, n.want)
		}
	}
	encs := []struct {
		enc  *[256]string
		code int
		want string
	}{
		{&winAnsiEncoding, 0x80, "Euro"}, {&winAnsiEncoding, 0xE9, "eacute"}, {&standardEncoding, 0x27, "quoteright"},
		{&macRomanEncoding, 0x80, "Adieresis"}, {&symbolEncoding, 'a', "alpha"}, {&symbolEncoding, 0xB7, "bullet"},
	}
	for _, e := range encs {
		if got := e.enc[e.code]; got != e.want {
			t.Errorf("encoding[%#x] = %q, want %q", e.code, got, e.want)
		}
	}
}

func TestCMapParsing(t *testing.T) {
	data := []byte(`/CIDInit /ProcSet findresource begin 12 dict begin begincmap
		1 begincodespacerange <00> <7F> endcodespacerange
		1 begincodespacerange <8140> <FEFE> endcodespacerange
		2 begincidrange <20> <7E> 1 <8140> <817E> 633 endcidrange
		1 begincidchar <8180> 9000 endcidchar
		2 beginbfchar <20> <0020> <8180> <4E2D> endbfchar
		1 beginbfrange <41> <43> <0061> endbfrange
		endcmap`)
	cm := parseCMap(data)
	codes := []struct {
		in      []byte
		code    uint32
		n       int
		cid     int
		unicode rune
	}{
		{[]byte{0x41}, 0x41, 1, 34, 'a'},
		{[]byte{0x43}, 0x43, 1, 36, 'c'},
		{[]byte{0x81, 0x41}, 0x8141, 2, 634, 0},
		{[]byte{0x81, 0x80}, 0x8180, 2, 9000, 0x4E2D},
	}
	for _, c := range codes {
		code, n := cm.nextCode(c.in)
		if code != c.code || n != c.n {
			t.Errorf("nextCode(%x) = %x/%d, want %x/%d", c.in, code, n, c.code, c.n)
			continue
		}
		if cid := cm.cid(code, n); cid != c.cid {
			t.Errorf("cid(%x) = %d, want %d", code, cid, c.cid)
		}
		if c.unicode != 0 {
			if u := cm.unicodeOf(code, n); len(u) != 1 || u[0] != c.unicode {
				t.Errorf("unicodeOf(%x) = %v, want %U", code, u, c.unicode)
			}
		}
	}
}
