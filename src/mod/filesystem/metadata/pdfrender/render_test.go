package pdfrender

import (
	"bytes"
	"compress/zlib"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"testing"
	"time"
)

type check struct {
	x, y int
	want color.RGBA
}

func TestRenderPaths(t *testing.T) {
	tests := []struct {
		name    string
		content string
		checks  []check
	}{
		{"filled rectangle", "1 0 0 rg 10 10 30 30 re f", []check{{25, 25, red}, {5, 5, white}, {50, 50, white}}},
		{"cmyk fill", "0 1 1 0 k 0 0 100 100 re f", []check{{50, 50, red}}},
		{"grey fill", "0.5 g 0 0 100 100 re f", []check{{50, 50, color.RGBA{128, 128, 128, 255}}}},
		{"transform", "1 0 0 1 50 0 cm 0 0 1 rg 0 0 20 20 re f", []check{{60, 10, blue}, {10, 10, white}}},
		{"non-zero keeps the inner square", "0 g 10 10 80 80 re 30 30 40 40 re f", []check{{50, 50, black}, {20, 20, black}}},
		{"even-odd cuts the inner square", "0 g 10 10 80 80 re 30 30 40 40 re f*", []check{{50, 50, white}, {20, 20, black}}},
		{"clipping", "20 20 20 20 re W n 0 1 0 rg 0 0 100 100 re f", []check{{30, 30, green}, {60, 60, white}}},
		{"save and restore drops the clip", "q 20 20 20 20 re W n Q 0 1 0 rg 0 0 100 100 re f", []check{{60, 60, green}}},
		{"stroke", "0 0 1 RG 10 w 0 50 m 100 50 l S", []check{{50, 50, blue}, {50, 47, blue}, {50, 60, white}}},
		{"dashed stroke", "0 G 10 w [10 10] 0 d 0 50 m 100 50 l S", []check{{5, 50, black}, {15, 50, white}, {25, 50, black}}},
		{"bezier curve fill", "0 g 10 10 m 10 90 90 90 90 10 c f", []check{{50, 40, black}, {5, 80, white}}},
		{"constant alpha", "/GS1 gs 0 g 0 0 100 100 re f", []check{{50, 50, color.RGBA{128, 128, 128, 255}}}},
		{"multiply blend", "1 0 0 rg 0 0 100 100 re f /GSM gs 0 0 1 rg 0 0 100 100 re f", []check{{50, 50, black}}},
		{"separation all", "/CS0 cs 1 sc 0 0 100 100 re f", []check{{50, 50, black}}},
		{"separation with exponential tint", "/CS1 cs 1 sc 0 0 100 100 re f", []check{{50, 50, color.RGBA{0, 255, 255, 255}}}},
		{"indexed fill", "/CS2 cs 1 sc 0 0 100 100 re f", []check{{50, 50, green}}},
		{"separation none paints nothing", "/CS3 cs 1 sc 0 0 100 100 re f", []check{{50, 50, white}}},
	}
	res := `/ExtGState << /GS1 << /ca 0.5 >> /GSM << /BM /Multiply >> >>
		/ColorSpace << /CS0 [/Separation /All /DeviceGray << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1 >>]
		/CS1 [/Separation /Cyan /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [1 0 0 0] /N 1 >>]
		/CS2 [/Indexed /DeviceRGB 1 <ff000000ff00>]
		/CS3 [/Separation /None /DeviceGray << /FunctionType 2 /Domain [0 1] /C0 [1] /C1 [0] /N 1 >>] >>`
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			img := renderBytes(t, onePage(100, 100, res, tc.content, nil), 1)
			for _, c := range tc.checks {
				assertColor(t, img, c.x, c.y, 100, c.want, 6, tc.name)
			}
		})
	}
}

func TestRenderShadings(t *testing.T) {
	res := `/Shading <<
		/Ax << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 100 0] /Extend [true true]
		       /Function << /FunctionType 2 /Domain [0 1] /C0 [1 0 0] /C1 [0 0 1] /N 1 >> >>
		/Rad << /ShadingType 3 /ColorSpace /DeviceRGB /Coords [50 50 0 50 50 50] /Extend [false false]
		       /Function << /FunctionType 2 /Domain [0 1] /C0 [0 1 0] /C1 [0 0 0] /N 1 >> >> >>
		/Pattern << /P1 << /PatternType 2 /Shading << /ShadingType 2 /ColorSpace /DeviceRGB /Coords [0 0 0 100]
		       /Function << /FunctionType 2 /Domain [0 1] /C0 [1 1 0] /C1 [0 1 1] /N 1 >> >> >> >>`
	t.Run("axial", func(t *testing.T) {
		img := renderBytes(t, onePage(100, 100, res, "/Ax sh", nil), 1)
		assertColor(t, img, 1, 50, 100, red, 12, "left end")
		assertColor(t, img, 98, 50, 100, blue, 12, "right end")
		mid := pixelAt(img, 50, 50, 100)
		if !near(mid.R, 128, 12) || !near(mid.B, 128, 12) {
			t.Errorf("middle = %v, want a red-blue mix", mid)
		}
	})
	t.Run("radial", func(t *testing.T) {
		img := renderBytes(t, onePage(100, 100, res, "/Rad sh", nil), 1)
		assertColor(t, img, 50, 50, 100, green, 16, "centre")
		assertColor(t, img, 2, 2, 100, white, 4, "outside the circle")
	})
	t.Run("shading pattern fill", func(t *testing.T) {
		img := renderBytes(t, onePage(100, 100, res, "/Pattern cs /P1 scn 0 0 100 100 re f", nil), 1)
		assertColor(t, img, 50, 1, 100, color.RGBA{255, 255, 0, 255}, 12, "bottom")
		assertColor(t, img, 50, 98, 100, color.RGBA{0, 255, 255, 255}, 12, "top")
	})
}

func TestRenderTilingPattern(t *testing.T) {
	data := onePage(100, 100, "/Pattern << /T 4 0 R >>", "/Pattern cs /T scn 0 0 100 100 re f", func(b *pdfBuilder) string {
		//A 20 x 20 cell with a red square in its lower left quarter
		b.addStream("/Type /Pattern /PatternType 1 /PaintType 1 /TilingType 1 /BBox [0 0 20 20] /XStep 20 /YStep 20 /Resources << >>", []byte("1 0 0 rg 0 0 10 10 re f"))
		return ""
	})
	img := renderBytes(t, data, 1)
	assertColor(t, img, 5, 5, 100, red, 10, "first cell")
	assertColor(t, img, 45, 65, 100, red, 10, "repeated cell")
	assertColor(t, img, 15, 15, 100, white, 10, "empty part of a cell")
}

func TestRenderImages(t *testing.T) {
	t.Run("raw rgb", func(t *testing.T) {
		//2 x 2: red green / blue white, drawn over the whole page
		raw := []byte{255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255}
		data := onePage(100, 100, "/XObject << /Im 4 0 R >>", "q 100 0 0 100 0 0 cm /Im Do Q", func(b *pdfBuilder) string {
			b.addStream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8", raw)
			return ""
		})
		img := renderBytes(t, data, 1)
		assertColor(t, img, 10, 90, 100, red, 20, "top left")
		assertColor(t, img, 90, 90, 100, green, 20, "top right")
		assertColor(t, img, 10, 10, 100, blue, 20, "bottom left")
	})
	t.Run("flate 1 bit grey with decode", func(t *testing.T) {
		var z bytes.Buffer
		w := zlib.NewWriter(&z)
		w.Write([]byte{0x80, 0x00}) //1 0 / 0 0, inverted by Decode
		w.Close()
		data := onePage(100, 100, "/XObject << /Im 4 0 R >>", "q 100 0 0 100 0 0 cm /Im Do Q", func(b *pdfBuilder) string {
			b.addStream("/Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceGray /BitsPerComponent 1 /Decode [1 0] /Filter /FlateDecode", z.Bytes())
			return ""
		})
		img := renderBytes(t, data, 1)
		assertColor(t, img, 10, 90, 100, black, 30, "set bit (inverted)")
		assertColor(t, img, 90, 10, 100, white, 30, "clear bit (inverted)")
	})
	t.Run("stencil mask takes the fill colour", func(t *testing.T) {
		data := onePage(100, 100, "/XObject << /M 4 0 R >>", "0 0 1 rg q 100 0 0 100 0 0 cm /M Do Q", func(b *pdfBuilder) string {
			b.addStream("/Type /XObject /Subtype /Image /Width 2 /Height 1 /ImageMask true", []byte{0x40})
			return ""
		})
		img := renderBytes(t, data, 1)
		assertColor(t, img, 10, 50, 100, blue, 20, "painted half")
		assertColor(t, img, 90, 50, 100, white, 20, "masked half")
	})
	t.Run("soft mask", func(t *testing.T) {
		data := onePage(100, 100, "/XObject << /Im 5 0 R >>", "q 100 0 0 100 0 0 cm /Im Do Q", func(b *pdfBuilder) string {
			sm := b.addStream("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceGray /BitsPerComponent 8", []byte{128})
			b.addStream(fmt.Sprintf("/Type /XObject /Subtype /Image /Width 1 /Height 1 /ColorSpace /DeviceRGB /BitsPerComponent 8 /SMask %d 0 R", sm), []byte{0, 0, 0})
			return ""
		})
		img := renderBytes(t, data, 1)
		assertColor(t, img, 50, 50, 100, color.RGBA{127, 127, 127, 255}, 6, "half transparent black")
	})
	t.Run("jpeg", func(t *testing.T) {
		src := image.NewRGBA(image.Rect(0, 0, 16, 16))
		for i := 0; i < len(src.Pix); i += 4 {
			src.Pix[i], src.Pix[i+1], src.Pix[i+2], src.Pix[i+3] = 0, 200, 0, 255
		}
		var jb bytes.Buffer
		jpeg.Encode(&jb, src, &jpeg.Options{Quality: 95})
		data := onePage(100, 100, "/XObject << /Im 4 0 R >>", "q 100 0 0 100 0 0 cm /Im Do Q", func(b *pdfBuilder) string {
			b.addStream("/Type /XObject /Subtype /Image /Width 16 /Height 16 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode", jb.Bytes())
			return ""
		})
		img := renderBytes(t, data, 1)
		assertColor(t, img, 50, 50, 100, color.RGBA{0, 200, 0, 255}, 10, "jpeg colour")
	})
	t.Run("inline image", func(t *testing.T) {
		content := "q 100 0 0 100 0 0 cm BI /W 1 /H 1 /CS /RGB /BPC 8 ID \xff\x00\xff\nEI Q 0 0 1 rg 0 0 10 10 re f"
		img := renderBytes(t, onePage(100, 100, "", content, nil), 1)
		assertColor(t, img, 50, 50, 100, color.RGBA{255, 0, 255, 255}, 10, "inline image")
		assertColor(t, img, 5, 5, 100, blue, 10, "content after EI still runs")
	})
}

func TestRenderFormsAndContent(t *testing.T) {
	t.Run("form xobject with matrix", func(t *testing.T) {
		data := onePage(100, 100, "/XObject << /F 4 0 R >>", "/F Do", func(b *pdfBuilder) string {
			b.addStream("/Type /XObject /Subtype /Form /BBox [0 0 10 10] /Matrix [2 0 0 2 50 50]", []byte("1 0 0 rg 0 0 10 10 re f 0 0 1 rg 0 0 100 100 re f"))
			return ""
		})
		img := renderBytes(t, data, 1)
		assertColor(t, img, 60, 60, 100, blue, 10, "inside the clipped bbox")
		assertColor(t, img, 80, 80, 100, white, 10, "outside the bbox")
	})
	t.Run("self referencing form does not loop", func(t *testing.T) {
		data := onePage(100, 100, "/XObject << /F 4 0 R >>", "/F Do", func(b *pdfBuilder) string {
			b.addStream("/Type /XObject /Subtype /Form /BBox [0 0 100 100] /Resources << /XObject << /F 4 0 R >> >>", []byte("0 g 0 0 10 10 re f /F Do"))
			return ""
		})
		img := renderBytes(t, data, 1)
		assertColor(t, img, 5, 5, 100, black, 10, "drawn once")
	})
	t.Run("optional content switched off", func(t *testing.T) {
		b := &pdfBuilder{}
		pages := b.reserve()
		ocg := b.add("<< /Type /OCG /Name (Hidden) >>")
		content := b.addStream("", []byte("/OC /L1 BDC 1 0 0 rg 0 0 100 100 re f EMC 0 0 1 rg 0 0 10 10 re f"))
		page := b.add(fmt.Sprintf("<< /Type /Page /Parent %d 0 R /MediaBox [0 0 100 100] /Resources << /Properties << /L1 %d 0 R >> >> /Contents %d 0 R >>", pages, ocg, content))
		b.set(pages, fmt.Sprintf("<< /Type /Pages /Kids [%d 0 R] /Count 1 >>", page))
		root := b.add(fmt.Sprintf("<< /Type /Catalog /Pages %d 0 R /OCProperties << /OCGs [%d 0 R] /D << /OFF [%d 0 R] >> >> >>", pages, ocg, ocg))
		img := renderBytes(t, b.bytes(root), 1)
		assertColor(t, img, 50, 50, 100, white, 4, "hidden layer")
		assertColor(t, img, 5, 5, 100, blue, 10, "visible content")
	})
	t.Run("annotation appearance", func(t *testing.T) {
		data := onePage(100, 100, "", "", func(b *pdfBuilder) string {
			ap := b.addStream("/Type /XObject /Subtype /Form /BBox [0 0 1 1]", []byte("0 1 0 rg 0 0 1 1 re f"))
			annot := b.add(fmt.Sprintf("<< /Type /Annot /Subtype /Square /Rect [20 20 40 40] /AP << /N %d 0 R >> >>", ap))
			return fmt.Sprintf("/Annots [%d 0 R]", annot)
		})
		img := renderBytes(t, data, 1)
		assertColor(t, img, 30, 30, 100, green, 10, "appearance stretched to the rect")
		assertColor(t, img, 50, 50, 100, white, 4, "outside the rect")
	})
	t.Run("rotated page", func(t *testing.T) {
		data := onePage(200, 100, "", "1 0 0 rg 0 0 20 20 re f", func(b *pdfBuilder) string { return "/Rotate 90" })
		doc, err := Open(bytes.NewReader(data), int64(len(data)))
		if err != nil {
			t.Fatal(err)
		}
		pg, _ := doc.Page(0)
		if w, h := pg.Size(); w != 100 || h != 200 {
			t.Fatalf("rotated size = %vx%v, want 100x200", w, h)
		}
		img, err := doc.Render(0, Options{Scale: 1})
		if err != nil {
			t.Fatal(err)
		}
		//Turned clockwise the bottom left corner goes to the top left
		if c := img.RGBAAt(5, 5); !near(c.R, 255, 10) || !near(c.G, 0, 10) {
			t.Errorf("top left after rotation = %v, want red", c)
		}
	})
}

func TestThumbnailLayout(t *testing.T) {
	t.Run("portrait shows the top of the page", func(t *testing.T) {
		data := onePage(100, 200, "", "1 0 0 rg 0 190 100 10 re f 0 0 1 rg 0 0 100 10 re f", nil)
		img, err := Thumbnail(bytes.NewReader(data), int64(len(data)), 120, time.Second)
		if err != nil {
			t.Fatal(err)
		}
		if b := img.Bounds(); b.Dx() != 120 || b.Dy() != 120 {
			t.Fatalf("size = %v", b)
		}
		if c := img.RGBAAt(60, 2); !near(c.R, 255, 10) || !near(c.B, 0, 10) {
			t.Errorf("top band = %v, want red", c)
		}
		if c := img.RGBAAt(60, 118); !near(c.B, 255, 10) == true && near(c.R, 0, 10) {
			t.Errorf("bottom of the page should be cropped away, got %v", c)
		}
	})
	t.Run("landscape is shown whole on a band", func(t *testing.T) {
		data := onePage(200, 100, "", "0 0 1 rg 0 0 200 100 re f", nil)
		img, err := Thumbnail(bytes.NewReader(data), int64(len(data)), 120, time.Second)
		if err != nil {
			t.Fatal(err)
		}
		if c := img.RGBAAt(60, 60); !near(c.B, 255, 10) || !near(c.R, 0, 10) {
			t.Errorf("page centre = %v, want blue", c)
		}
		if c := img.RGBAAt(60, 2); c != thumbBackground {
			t.Errorf("band = %v, want %v", c, thumbBackground)
		}
	})
}

func TestRenderTimeoutReturnsPartialImage(t *testing.T) {
	var content bytes.Buffer
	content.WriteString("1 0 0 rg 0 0 100 100 re f ")
	for i := 0; i < 200000; i++ {
		content.WriteString("0.5 g 0 0 1 1 re f ")
	}
	data := onePage(100, 100, "", content.String(), nil)
	doc, err := Open(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		t.Fatal(err)
	}
	img, err := doc.Render(0, Options{Scale: 1, Timeout: time.Nanosecond})
	if err != ErrTimeout {
		t.Fatalf("err = %v, want ErrTimeout", err)
	}
	if img == nil {
		t.Fatal("expected the partial image")
	}
}
