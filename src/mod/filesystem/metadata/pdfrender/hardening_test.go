package pdfrender

import (
	"bytes"
	"fmt"
	"runtime/debug"
	"strings"
	"testing"
	"time"

	"github.com/go-pdf/fpdf"
	"golang.org/x/image/font/gofont/goregular"
)

/*
	Untrusted input: every PDF in a user's folder gets parsed for its
	thumbnail, so crafted files must not panic, hang or allocate wildly.
*/

// renderUntrusted opens and renders data, turning a panic into an error
func renderUntrusted(data []byte) (err error, took time.Duration) {
	start := time.Now()
	defer func() {
		took = time.Since(start)
		if p := recover(); p != nil {
			err = fmt.Errorf("panic: %v\n%s", p, debug.Stack())
		}
	}()
	doc, e := Open(bytes.NewReader(data), int64(len(data)))
	if e != nil {
		return nil, 0
	}
	doc.Render(0, Options{Scale: 0.5, Timeout: 2 * time.Second})
	return nil, 0
}

func hardeningFixtures(t *testing.T) map[string][]byte {
	cffData := buildCFF()
	t1Data, t1Len := buildType1()
	fonts := onePage(100, 100, "/Font << /F1 4 0 R /F2 5 0 R /F3 6 0 R >>",
		"BT /F1 50 Tf 0 0 Td (AA) Tj /F2 50 Tf (AA) Tj /F3 50 Tf (AA) Tj ET", func(b *pdfBuilder) string {
			b.reserve()
			b.reserve()
			b.reserve()
			ff := b.addStream("/Subtype /Type1C", cffData)
			fd := b.add(fmt.Sprintf("<< /Type /FontDescriptor /Flags 32 /FontFile3 %d 0 R >>", ff))
			b.set(4, fmt.Sprintf("<< /Type /Font /Subtype /Type1 /FirstChar 65 /LastChar 65 /Widths [700] /FontDescriptor %d 0 R >>", fd))
			ff1 := b.addStream(fmt.Sprintf("/Length1 %d", t1Len), t1Data)
			fd1 := b.add(fmt.Sprintf("<< /Type /FontDescriptor /Flags 32 /FontFile %d 0 R >>", ff1))
			b.set(5, fmt.Sprintf("<< /Type /Font /Subtype /Type1 /FontDescriptor %d 0 R >>", fd1))
			proc := b.addStream("", []byte("1000 0 0 0 1000 1000 d1 100 100 500 500 re f"))
			b.set(6, fmt.Sprintf("<< /Type /Font /Subtype /Type3 /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /sq %d 0 R >> /Encoding << /Differences [65 /sq] >> /FirstChar 65 /LastChar 65 /Widths [1000] >>", proc))
			return ""
		})
	graphics := onePage(100, 100, `/Shading << /S << /ShadingType 3 /ColorSpace /DeviceRGB /Coords [50 50 0 50 50 50]
		/Function << /FunctionType 3 /Domain [0 1] /Bounds [0.5] /Encode [0 1 0 1] /Functions [
		<< /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 1 0] /N 1 >> << /FunctionType 2 /Domain [0 1] /C0 [0 1 0] /C1 [0 0 1] /N 1 >> ] >> >> >>
		/ColorSpace << /I [/Indexed /DeviceRGB 2 <ff0000 00ff00 0000ff>] /L [/Lab << /WhitePoint [0.95 1 1.09] >>] >>
		/XObject << /Im 4 0 R >> /ExtGState << /G << /ca 0.5 /BM /Multiply /D [[3 2] 0] /LW 2 >> >>`,
		"q 10 10 80 80 re W n /S sh Q /G gs /I cs 2 sc 0 0 50 50 re f /L cs 50 20 -30 sc 50 50 50 50 re f 0 G 1 J 1 j 10 10 m 90 90 l 10 90 l S q 50 0 0 50 0 0 cm /Im Do Q",
		func(b *pdfBuilder) string {
			b.addStream("/Type /XObject /Subtype /Image /Width 3 /Height 2 /ColorSpace /I /BitsPerComponent 4", []byte{0x01, 0x20, 0x12, 0x00})
			return ""
		})
	pdf := fpdf.New("P", "pt", "A4", "")
	pdf.SetCompression(false)
	pdf.AddUTF8FontFromBytes("gofont", "", goregular.TTF)
	pdf.AddPage()
	pdf.SetFont("gofont", "", 30)
	pdf.Text(40, 80, "Hello")
	pdf.SetFont("Times", "", 30)
	pdf.Text(40, 160, "World")
	var fb bytes.Buffer
	pdf.Output(&fb)
	return map[string][]byte{
		"fonts":    fonts,
		"graphics": graphics,
		"xrefstm":  xrefStreamDoc(t),
		"fpdf":     fb.Bytes(),
		"aes256":   aes256Doc(t, false),
	}
}

func TestBoundaryValuesDoNotPanic(t *testing.T) {
	patterns := [][]byte{
		[]byte("0"), []byte("-1"), []byte("2147483647"), []byte("4294967295"),
		[]byte("99999999999"), {0xff, 0xff, 0xff, 0xff}, {0x7f, 0xff, 0xff, 0xff}, []byte("[[<<"),
	}
	positions := 120
	if testing.Short() {
		positions = 30
	}
	failures := 0
	for name, data := range hardeningFixtures(t) {
		step := len(data) / positions
		if step < 1 {
			step = 1
		}
		for pos := 0; pos < len(data); pos += step {
			for _, pat := range patterns {
				m := append([]byte{}, data...)
				copy(m[pos:], pat)
				err, took := renderUntrusted(m)
				if err != nil && failures < 5 {
					failures++
					t.Errorf("%s: %q at %d: %v", name, pat, pos, err)
				}
				if took > 4*time.Second && failures < 5 {
					failures++
					t.Errorf("%s: %q at %d took %v", name, pat, pos, took)
				}
			}
		}
	}
}

// Font programs straight into their parsers, every glyph drawn
func TestFontParsersBoundaryValues(t *testing.T) {
	t1Data, t1Len := buildType1()
	blobs := map[string][]byte{"truetype": goregular.TTF, "cff": buildCFF(), "type1": t1Data}
	words := [][]byte{{0x7f, 0xff, 0xff, 0xff}, {0x80, 0, 0, 0}, {0xff, 0xff, 0xff, 0xff}, {0x01, 0, 0, 0}, {0, 0, 0, 0}}
	positions := 300
	if testing.Short() {
		positions = 60
	}
	for name, blob := range blobs {
		step := len(blob) / positions
		if step < 1 {
			step = 1
		}
		for pos := 0; pos+4 <= len(blob); pos += step {
			for _, w := range words {
				m := append([]byte{}, blob...)
				copy(m[pos:], w)
				func() {
					defer func() {
						if p := recover(); p != nil {
							t.Fatalf("%s: word %x at %d: panic %v\n%s", name, w, pos, p, debug.Stack())
						}
					}()
					switch name {
					case "truetype":
						if f, err := parseSFNT(m); err == nil {
							for g := 0; g < f.numGlyphs && g < 400; g++ {
								f.glyphPath(g).flatten(identity, 1)
							}
							f.unicodeGID('A')
							f.cmapLookup(3, 0, 0xF041)
						}
					case "cff":
						if f, err := parseCFF(m); err == nil {
							for g := 0; g < len(f.charStrings); g++ {
								f.glyphPath(g)
							}
							f.gidForName("A")
						}
					case "type1":
						if f, err := parseType1(m, t1Len); err == nil {
							f.glyphPath("A")
						}
					}
				}()
			}
		}
	}
}

func TestPathologicalInputs(t *testing.T) {
	recursiveType3 := onePage(100, 100, "/Font << /F 4 0 R >>", "BT /F 10 Tf (AAAA) Tj ET", func(b *pdfBuilder) string {
		b.reserve()
		proc := b.addStream("", []byte("1000 0 d0 BT /F 10 Tf (AAAA) Tj ET"))
		b.set(4, fmt.Sprintf("<< /Type /Font /Subtype /Type3 /FontMatrix [0.001 0 0 0.001 0 0] /CharProcs << /a %d 0 R >> /Encoding << /Differences [65 /a] >> /FirstChar 65 /LastChar 65 /Widths [1000] /Resources << /Font << /F 4 0 R >> >> >>", proc))
		return ""
	})
	formCycle := onePage(100, 100, "/XObject << /A 4 0 R >>", "/A Do", func(b *pdfBuilder) string {
		b.addStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /XObject << /B 5 0 R >> >>", []byte("/B Do"))
		b.addStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /XObject << /A 4 0 R >> >>", []byte("/A Do"))
		return ""
	})
	selfPattern := onePage(100, 100, "/Pattern << /P 4 0 R >>", "/Pattern cs /P scn 0 0 100 100 re f", func(b *pdfBuilder) string {
		b.addStream("/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 1 1] /XStep 1 /YStep 1 /Resources << /Pattern << /P 4 0 R >> >>", []byte("/Pattern cs /P scn 0 0 1 1 re f"))
		return ""
	})
	selfSMask := onePage(100, 100, "/ExtGState << /G << /SMask << /S /Luminosity /G 4 0 R >> >> >>", "/G gs 0 0 100 100 re f", func(b *pdfBuilder) string {
		b.addStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Group << /S /Transparency >> /Resources << /ExtGState << /G << /SMask << /S /Luminosity /G 4 0 R >> >> >> >>", []byte("/G gs 1 g 0 0 100 100 re f"))
		return ""
	})
	hugeImage := onePage(100, 100, "/XObject << /I 4 0 R >>", "100 0 0 100 0 0 cm /I Do", func(b *pdfBuilder) string {
		b.addStream("/Type /XObject /Subtype /Image /Width 2000000000 /Height 2000000000 /ColorSpace /DeviceRGB /BitsPerComponent 8", []byte{1, 2, 3})
		return ""
	})
	//A long zigzag stroked very wide with round joins: one paint operator
	//whose outline alone outlasts the time budget
	var zig strings.Builder
	zig.WriteString("1 j 1 J 0.2 0 0 0.2 0 0 cm 5000 w 0 0 m ")
	for i := 0; i < 200000; i++ {
		fmt.Fprintf(&zig, "%d %d l ", i%500, (i*7)%499)
	}
	zig.WriteString("S")
	refCycle := []byte("%PDF-1.4\n1 0 obj\n2 0 R\nendobj\n2 0 obj\n1 0 R\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n")
	prevLoop := []byte("%PDF-1.4\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 /Prev 9 >>\nstartxref\n9\n%%EOF\n")
	cases := map[string][]byte{
		"recursive type3 glyph":  recursiveType3,
		"form cycle":             formCycle,
		"pattern using itself":   selfPattern,
		"soft mask using itself": selfSMask,
		"huge image":             hugeImage,
		"reference cycle":        refCycle,
		"xref prev loop":         prevLoop,
		"deep content nesting":   onePage(100, 100, "", strings.Repeat("[", 200000)+" Tj", nil),
		"wide zigzag stroke":     onePage(100, 100, "", zig.String(), nil),
		"tiny dashes":            onePage(100, 100, "", "[0.0001 0.0001] 0 d 1e6 w 0 0 m 1e9 1e9 l S", nil),
		"huge coordinates":       onePage(100, 100, "", "1e30 1e30 m -1e30 1e30 l 1e30 -1e30 l f 1e38 0 0 1e38 0 0 cm 0 0 1 1 re f", nil),
		"unbalanced state":       onePage(100, 100, "", strings.Repeat("q ", 10000)+strings.Repeat("Q ", 20000)+"BT BT ET ET EMC EMC", nil),
		"degenerate matrix": onePage(100, 100, "/XObject << /I 4 0 R >>", "0 0 0 0 0 0 cm /I Do 0 0 m 10 10 l S", func(b *pdfBuilder) string {
			b.addStream("/Subtype /Image /Width 1 /Height 1 /BitsPerComponent 8 /ColorSpace /DeviceGray", []byte{0})
			return ""
		}),
		"postscript stack abuse": onePage(100, 100, "/ColorSpace << /C [/Separation /X /DeviceRGB 4 0 R] >>", "/C cs 1 sc 0 0 100 100 re f", func(b *pdfBuilder) string {
			b.addStream("/FunctionType 4 /Domain [0 1] /Range [0 1 0 1 0 1]", []byte("{ "+strings.Repeat("dup ", 500)+strings.Repeat("{ ", 40)+" }"))
			return ""
		}),
		"sampled function sizes": onePage(100, 100, "/ColorSpace << /C [/Separation /X /DeviceRGB 4 0 R] >>", "/C cs 1 sc 0 0 100 100 re f", func(b *pdfBuilder) string {
			b.addStream("/FunctionType 0 /Domain [0 1 0 1 0 1 0 1] /Range [0 1] /Size [65536 65536 65536 65536] /BitsPerSample 8", []byte{1})
			return ""
		}),
	}
	for name, data := range cases {
		t.Run(name, func(t *testing.T) {
			err, took := renderUntrusted(data)
			if err != nil {
				t.Fatal(err)
			}
			if took > 4*time.Second {
				t.Errorf("took %v", took)
			}
		})
	}
}
