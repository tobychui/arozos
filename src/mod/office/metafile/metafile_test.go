package metafile

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"math"
	"testing"
	"unicode/utf16"

	"imuslab.com/arozos/mod/office/internal/officetest"
)

func render(t *testing.T, data []byte) (*image.RGBA, bool) {
	t.Helper()
	img, photo, err := renderMetafile(data)
	if err != nil {
		t.Fatalf("renderMetafile: %v", err)
	}
	rgba, ok := img.(*image.RGBA)
	if !ok {
		t.Fatalf("rendered image is %T", img)
	}
	return rgba, photo
}

func near(a, b color.NRGBA, tol int) bool {
	d := func(x, y uint8) bool { return int(x)-int(y) <= tol && int(y)-int(x) <= tol }
	return d(a.R, b.R) && d(a.G, b.G) && d(a.B, b.B) && d(a.A, b.A)
}

func pixel(img *image.RGBA, x, y int) color.NRGBA {
	return color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
}

/* ---------------- detection and pass-through ---------------- */

func TestMetafileKind(t *testing.T) {
	std := officetest.Cat(officetest.Le16(1), officetest.Le16(9), officetest.Le16(0x300), make([]byte, 12))
	tests := []struct {
		name string
		data []byte
		want string
	}{
		{"placeable wmf", officetest.BuildWmf([4]int{0, 0, 10, 10}, 96), "wmf"},
		{"standard wmf", std, "wmf"},
		{"emf", officetest.BuildEmf(10, 10), "emf"},
		{"png", []byte("\x89PNG\r\n\x1a\n0000000000"), ""},
		{"short", []byte{1, 2}, ""},
	}
	for _, tc := range tests {
		if got := metafileKind(tc.data); got != tc.want {
			t.Errorf("%s: metafileKind = %q, want %q", tc.name, got, tc.want)
		}
	}
}

func TestBrowserPicture(t *testing.T) {
	png := []byte("\x89PNG\r\n\x1a\nrest")
	tests := []struct {
		name    string
		data    []byte
		ext     string
		wantExt string
		wantOK  bool
		same    bool
	}{
		{"png passes through", png, "png", "png", true, true},
		{"unrenderable wmf keeps its bytes", []byte("not a metafile"), "wmf", "wmf", false, true},
		{"empty metafile fails", officetest.BuildWmf([4]int{0, 0, 10, 10}, 96), "wmf", "wmf", false, true},
		{"bitmap wmf becomes a JPEG", officetest.BuildWmf([4]int{0, 0, 8, 8}, 96,
			officetest.WmfRec(0x0B41, []int{0x0020, 0x00CC, 8, 8, 0, 0, 8, 8, 0, 0}, officetest.Dib24(8, 8, officetest.Quadrants(8, 8)))),
			"wmf", "jpeg", true, false},
		{"drawing emf becomes a PNG", officetest.BuildEmf(10, 10, append(officetest.EmfSolidBrush(1, officetest.MfBlue),
			officetest.EmfRecBytes(43, []int64{0, 0, 50, 50}, nil))...), "emf", "png", true, false},
	}
	for _, tc := range tests {
		out, ext, ok := BrowserPicture(tc.data, tc.ext)
		if ok != tc.wantOK || ext != tc.wantExt {
			t.Errorf("%s: got (%s, %v), want (%s, %v)", tc.name, ext, ok, tc.wantExt, tc.wantOK)
		}
		if same := bytes.Equal(out, tc.data); same != tc.same {
			t.Errorf("%s: output unchanged = %v, want %v", tc.name, same, tc.same)
		}
	}
}

/* ---------------- WMF ---------------- */

func TestWmfStretchBltKeepsBitmapResolution(t *testing.T) {
	// a 16 x 8 scan stretched over a 1 x 0.5 inch frame (96 x 48 CSS px):
	// the picture is rendered at the scan's own 16 x 8 pixels
	wmf := officetest.BuildWmf([4]int{0, 0, 1440, 720}, 1440,
		officetest.WmfRec(0x0103, []int{8}, nil),
		officetest.WmfRec(0x020B, []int{0, 0}, nil),
		officetest.WmfRec(0x020C, []int{720, 1440}, nil),
		officetest.WmfRec(0x0B41, []int{0x0020, 0x00CC, 8, 16, 0, 0, 720, 1440, 0, 0}, officetest.Dib24(16, 8, officetest.Quadrants(16, 8))))
	img, photo := render(t, wmf)
	if b := img.Bounds(); b.Dx() != 16 || b.Dy() != 8 {
		t.Fatalf("size = %v, want 16x8", b)
	}
	if !photo {
		t.Error("a 24-bit scan should be kept as a photo (JPEG)")
	}
	checks := []struct {
		x, y int
		want color.NRGBA
	}{{1, 1, officetest.MfRed}, {14, 1, officetest.MfGreen}, {1, 6, officetest.MfBlue}, {14, 6, officetest.MfWhite}}
	for _, c := range checks {
		if got := pixel(img, c.x, c.y); !near(got, c.want, 8) {
			t.Errorf("pixel (%d,%d) = %v, want %v", c.x, c.y, got, c.want)
		}
	}
}

func TestWmfSourceRectWiderThanBitmap(t *testing.T) {
	// PowerPoint writes source rectangles a pixel or two wider than the
	// DIB (the reference decks do): the part that exists is drawn
	wmf := officetest.BuildWmf([4]int{0, 0, 10, 8}, 96,
		officetest.WmfRec(0x0B41, []int{0x0020, 0x00CC, 8, 10, 0, 0, 8, 10, 0, 0}, officetest.Dib24(8, 8, officetest.Quadrants(8, 8))))
	img, _ := render(t, wmf)
	if got := pixel(img, 0, 0); !near(got, officetest.MfRed, 8) {
		t.Errorf("top-left = %v, want red", got)
	}
	if got := pixel(img, img.Bounds().Dx()-1, 0); got.A != 0 && !near(got, officetest.MfWhite, 8) {
		t.Errorf("uncovered column = %v, want empty or the white page", got)
	}
}

func TestWmfMirroredBlit(t *testing.T) {
	// a negative destination width mirrors the bitmap
	wmf := officetest.BuildWmf([4]int{0, 0, 8, 8}, 96,
		officetest.WmfRec(0x0B41, []int{0x0020, 0x00CC, 8, 8, 0, 0, 8, -8, 0, 8}, officetest.Dib24(8, 8, officetest.Quadrants(8, 8))))
	img, _ := render(t, wmf)
	if got := pixel(img, 1, 1); !near(got, officetest.MfGreen, 8) {
		t.Errorf("mirrored top-left = %v, want green", got)
	}
}

func TestWmfVectorShapes(t *testing.T) {
	brush := officetest.WmfRec(0x02FC, append([]int{0}, append(officetest.WmfColor(officetest.MfGreen), 0)...), nil)
	nullPen := officetest.WmfRec(0x02FA, []int{5, 0, 0, 0, 0}, nil)
	tests := []struct {
		name   string
		shape  []byte
		inside [2]int // in CSS px of a 100 x 100 frame
		out    [2]int
	}{
		{"rectangle", officetest.WmfRec(0x041B, []int{75, 75, 25, 25}, nil), [2]int{50, 50}, [2]int{10, 10}},
		{"ellipse", officetest.WmfRec(0x0418, []int{90, 90, 10, 10}, nil), [2]int{50, 50}, [2]int{12, 12}},
		{"polygon", officetest.WmfRec(0x0324, []int{3, 10, 10, 90, 10, 10, 90}, nil), [2]int{25, 25}, [2]int{80, 80}},
	}
	for _, tc := range tests {
		wmf := officetest.BuildWmf([4]int{0, 0, 100, 100}, 96,
			brush, nullPen,
			officetest.WmfRec(0x012D, []int{0}, nil), officetest.WmfRec(0x012D, []int{1}, nil),
			tc.shape)
		img, photo := render(t, wmf)
		if photo {
			t.Errorf("%s: a drawing must not be encoded as a photo", tc.name)
		}
		if b := img.Bounds(); b.Dx() != 200 {
			t.Errorf("%s: width = %d, want 200 (drawings render at 2x)", tc.name, b.Dx())
		}
		if got := pixel(img, tc.inside[0]*2, tc.inside[1]*2); !near(got, officetest.MfGreen, 2) {
			t.Errorf("%s: inside = %v, want green", tc.name, got)
		}
		if got := pixel(img, tc.out[0]*2, tc.out[1]*2); got.A != 0 {
			t.Errorf("%s: outside = %v, want transparent", tc.name, got)
		}
	}
}

func TestWmfObjectTableReusesFreedSlots(t *testing.T) {
	red := officetest.WmfRec(0x02FC, append([]int{0}, append(officetest.WmfColor(officetest.MfRed), 0)...), nil)
	blue := officetest.WmfRec(0x02FC, append([]int{0}, append(officetest.WmfColor(officetest.MfBlue), 0)...), nil)
	wmf := officetest.BuildWmf([4]int{0, 0, 10, 10}, 96,
		officetest.WmfRec(0x02FA, []int{5, 0, 0, 0, 0}, nil), // slot 0: null pen
		officetest.WmfRec(0x012D, []int{0}, nil),
		red,                                      // slot 1
		officetest.WmfRec(0x01F0, []int{1}, nil), // free slot 1
		blue,                                     // takes slot 1 again
		officetest.WmfRec(0x012D, []int{1}, nil),
		officetest.WmfRec(0x041B, []int{10, 10, 0, 0}, nil))
	img, _ := render(t, wmf)
	if got := pixel(img, 10, 10); !near(got, officetest.MfBlue, 2) {
		t.Errorf("fill = %v, want blue from the reused slot", got)
	}
}

func TestWmfMaskRasterOps(t *testing.T) {
	// the classic transparent-bitmap pair: AND a mask (black = keep), then
	// OR the image (black = transparent). The background stays empty.
	mask := officetest.Dib24(8, 8, func(x, y int) color.NRGBA {
		if x < 4 {
			return color.NRGBA{A: 255}
		}
		return officetest.MfWhite
	})
	pic := officetest.Dib24(8, 8, func(x, y int) color.NRGBA {
		if x < 4 {
			return officetest.MfRed
		}
		return color.NRGBA{A: 255}
	})
	wmf := officetest.BuildWmf([4]int{0, 0, 8, 8}, 96,
		officetest.WmfRec(0x0B41, []int{0x00C6, 0x0088, 8, 8, 0, 0, 8, 8, 0, 0}, mask),
		officetest.WmfRec(0x0B41, []int{0x0086, 0x00EE, 8, 8, 0, 0, 8, 8, 0, 0}, pic))
	img, _ := render(t, wmf)
	if got := pixel(img, 1, 4); !near(got, officetest.MfRed, 8) {
		t.Errorf("masked-in pixel = %v, want red", got)
	}
	if got := pixel(img, 6, 4); got.A != 0 {
		t.Errorf("masked-out pixel = %v, want transparent", got)
	}
}

/* ---------------- EMF ---------------- */

func TestEmfStretchDIBits(t *testing.T) {
	// an 8-bit palette DIB, bottom-up: the first row in the file is the
	// bottom of the picture
	hdr := officetest.Cat(officetest.Le32(40), officetest.Le32(2), officetest.Le32(2), officetest.Le16(1), officetest.Le16(8), officetest.Le32(0), officetest.Le32(8), officetest.Le32(0), officetest.Le32(0), officetest.Le32(2), officetest.Le32(0))
	pal := officetest.Cat([]byte{0, 0, 255, 0}, []byte{255, 0, 0, 0}) // index 0 red, 1 blue (BGRA)
	bits := []byte{1, 1, 0, 0, 0, 0, 0, 0}                            // bottom row blue, top row red
	bmi := officetest.Cat(hdr, pal)
	const fixed = 80
	rec := officetest.EmfRecBytes(81, []int64{
		0, 0, 1, 1, // bounds
		0, 0, 0, 0, 2, 2, // dest x y, src x y w h
		fixed, int64(len(bmi)), fixed + int64(len(bmi)), int64(len(bits)),
		0, ropSrcCopy, 100, 100,
	}, officetest.Cat(bmi, bits))
	img, photo := render(t, officetest.BuildEmf(10, 10, rec))
	if photo {
		t.Error("an 8-bit DIB is not a photo")
	}
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	if got := pixel(img, w/2, h/4); !near(got, officetest.MfRed, 8) {
		t.Errorf("top = %v, want red", got)
	}
	if got := pixel(img, w/2, 3*h/4); !near(got, officetest.MfBlue, 8) {
		t.Errorf("bottom = %v, want blue", got)
	}
}

func TestEmfShapesPathsAndTransforms(t *testing.T) {
	// the frame is 10 x 10 mm = 100 x 100 logical units; output pixels per
	// logical unit: 10 mm -> 37.8 CSS px -> 75.6 px at 2x
	pxPer := 2 * 96 / 25.4 / 10
	at := func(lx, ly float64) (int, int) {
		return int(math.Round(lx * pxPer)), int(math.Round(ly * pxPer))
	}
	poly16 := func(pts ...int) []byte {
		var tail []byte
		for _, p := range pts {
			tail = append(tail, officetest.Le16(p)...)
		}
		return officetest.EmfRecBytes(86, []int64{0, 0, 100, 100, int64(len(pts) / 2)}, tail)
	}
	f := func(v float32) int64 { return int64(math.Float32bits(v)) }
	tests := []struct {
		name    string
		recs    [][]byte
		inside  [2]float64
		outside [2]float64
	}{
		{"polygon16", [][]byte{poly16(10, 10, 90, 10, 10, 90)}, [2]float64{25, 25}, [2]float64{80, 80}},
		{"filled path", [][]byte{
			officetest.EmfRecBytes(59, nil, nil),
			officetest.EmfRecBytes(27, []int64{20, 20}, nil),
			officetest.EmfRecBytes(54, []int64{80, 20}, nil),
			officetest.EmfRecBytes(54, []int64{80, 80}, nil),
			officetest.EmfRecBytes(61, nil, nil),
			officetest.EmfRecBytes(60, nil, nil),
			officetest.EmfRecBytes(62, []int64{0, 0, 100, 100}, nil),
		}, [2]float64{70, 30}, [2]float64{30, 70}},
		{"world transform", [][]byte{
			officetest.EmfRecBytes(35, []int64{f(1), f(0), f(0), f(1), f(50), f(50)}, nil),
			officetest.EmfRecBytes(43, []int64{0, 0, 40, 40}, nil),
		}, [2]float64{70, 70}, [2]float64{20, 20}},
		{"anisotropic window", [][]byte{
			officetest.EmfRecBytes(17, []int64{mmAnisotropic}, nil),
			officetest.EmfRecBytes(9, []int64{10, 10}, nil),
			officetest.EmfRecBytes(11, []int64{100, 100}, nil),
			officetest.EmfRecBytes(43, []int64{5, 5, 10, 10}, nil),
		}, [2]float64{75, 75}, [2]float64{25, 25}},
	}
	for _, tc := range tests {
		recs := append(officetest.EmfSolidBrush(1, officetest.MfBlue), tc.recs...)
		img, _ := render(t, officetest.BuildEmf(10, 10, recs...))
		x, y := at(tc.inside[0], tc.inside[1])
		if got := pixel(img, x, y); !near(got, officetest.MfBlue, 2) {
			t.Errorf("%s: inside (%d,%d) = %v, want blue", tc.name, x, y, got)
		}
		x, y = at(tc.outside[0], tc.outside[1])
		if got := pixel(img, x, y); got.A != 0 {
			t.Errorf("%s: outside (%d,%d) = %v, want transparent", tc.name, x, y, got)
		}
	}
}

func TestEmfStrokedLine(t *testing.T) {
	// a 4-unit red pen from (10,50) to (90,50)
	recs := [][]byte{
		officetest.EmfRecBytes(38, []int64{1, 0, 4, 0, officetest.EmfColor(officetest.MfRed)}, nil),
		officetest.EmfRecBytes(37, []int64{1}, nil),
		officetest.EmfRecBytes(27, []int64{10, 50}, nil),
		officetest.EmfRecBytes(54, []int64{90, 50}, nil),
	}
	img, _ := render(t, officetest.BuildEmf(10, 10, recs...))
	pxPer := 2 * 96 / 25.4 / 10
	if got := pixel(img, int(50*pxPer), int(50*pxPer)); !near(got, officetest.MfRed, 2) {
		t.Errorf("on the line = %v, want red", got)
	}
	if got := pixel(img, int(50*pxPer), int(60*pxPer)); got.A != 0 {
		t.Errorf("off the line = %v, want transparent", got)
	}
}

func TestEmfTextDrawsGlyphs(t *testing.T) {
	text := utf16.Encode([]rune("Hi"))
	var str []byte
	for _, u := range text {
		str = append(str, officetest.Le16(int(u))...)
	}
	// EXTCREATEFONTINDIRECTW: ih + LOGFONTW (92 bytes)
	logfont := officetest.Cat(officetest.Le32(-40), officetest.Le32(0), officetest.Le32(0), officetest.Le32(0), officetest.Le32(700), make([]byte, 8))
	face := utf16.Encode([]rune("Arial"))
	name := make([]byte, 64)
	for i, u := range face {
		binary.LittleEndian.PutUint16(name[2*i:], u)
	}
	logfont = officetest.Cat(logfont, name)
	const strOff = 76 // 8 header + 68 bytes of fields
	recs := [][]byte{
		officetest.EmfRecBytes(82, []int64{1}, logfont),
		officetest.EmfRecBytes(37, []int64{1}, nil),
		officetest.EmfRecBytes(24, []int64{officetest.EmfColor(officetest.MfBlue)}, nil),
		officetest.EmfRecBytes(22, []int64{24}, nil), // TA_BASELINE
		officetest.EmfRecBytes(84, []int64{
			0, 0, 100, 100, // bounds
			1, 0, 0, // graphics mode, scales
			10, 60, 2, strOff, 0, // ref x y, chars, offString, options
			0, 0, 0, 0, 0, // rect, offDx
		}, str),
	}
	img, photo := render(t, officetest.BuildEmf(10, 10, recs...))
	if photo {
		t.Error("text must not be encoded as a photo")
	}
	ink := 0
	for y := 0; y < img.Bounds().Dy(); y++ {
		for x := 0; x < img.Bounds().Dx(); x++ {
			if c := pixel(img, x, y); c.A > 200 && c.B > 200 && c.R < 60 {
				ink++
			}
		}
	}
	if ink < 50 {
		t.Errorf("text drew %d blue pixels, want glyphs", ink)
	}
}

/* ---------------- DIB decoding ---------------- */

func TestDecodeRLE(t *testing.T) {
	tests := []struct {
		name string
		data []byte
		w, h int
		four bool
		want []uint8
	}{
		{"rle8 runs", []byte{3, 7, 0, 0, 2, 1, 0, 1}, 3, 2, false, []uint8{7, 7, 7, 1, 1, 0}},
		{"rle8 absolute", []byte{0, 3, 4, 5, 6, 0, 0, 1}, 3, 1, false, []uint8{4, 5, 6}},
		{"rle8 delta", []byte{0, 2, 1, 1, 1, 9, 0, 1}, 3, 2, false, []uint8{0, 0, 0, 0, 9, 0}},
		{"rle4 runs", []byte{4, 0x12, 0, 1}, 4, 1, true, []uint8{1, 2, 1, 2}},
	}
	for _, tc := range tests {
		got := decodeRLE(tc.data, tc.w, tc.h, tc.four)
		if !bytes.Equal(got, tc.want) {
			t.Errorf("%s: got %v, want %v", tc.name, got, tc.want)
		}
	}
}

func TestParseDIBHeaderRejectsBadSizes(t *testing.T) {
	tests := []struct {
		name string
		hdr  []byte
	}{
		{"truncated", []byte{40, 0, 0}},
		{"zero width", officetest.Cat(officetest.Le32(40), officetest.Le32(0), officetest.Le32(4), officetest.Le16(1), officetest.Le16(24), make([]byte, 24))},
		{"huge", officetest.Cat(officetest.Le32(40), officetest.Le32(60000), officetest.Le32(60000), officetest.Le16(1), officetest.Le16(24), make([]byte, 24))},
	}
	for _, tc := range tests {
		if _, err := parseDIBHeader(tc.hdr, 0); err == nil {
			t.Errorf("%s: parseDIBHeader accepted a bad header", tc.name)
		}
	}
}
