package office

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/color"
	"math"
	"strings"
	"testing"
	"unicode/utf16"
)

/* ---------------- metafile fixtures ---------------- */

var (
	mfRed   = color.NRGBA{255, 0, 0, 255}
	mfGreen = color.NRGBA{0, 255, 0, 255}
	mfBlue  = color.NRGBA{0, 0, 255, 255}
	mfWhite = color.NRGBA{255, 255, 255, 255}
)

func le16(v int) []byte {
	b := make([]byte, 2)
	binary.LittleEndian.PutUint16(b, uint16(int16(v)))
	return b
}

func le32(v int64) []byte {
	b := make([]byte, 4)
	binary.LittleEndian.PutUint32(b, uint32(v))
	return b
}

func cat(parts ...[]byte) []byte {
	return bytes.Join(parts, nil)
}

// dib24 builds a packed bottom-up 24-bit BITMAPINFOHEADER DIB
func dib24(w, h int, px func(x, y int) color.NRGBA) []byte {
	stride := (w*3 + 3) &^ 3
	hdr := cat(le32(40), le32(int64(w)), le32(int64(h)), le16(1), le16(24), le32(0),
		le32(int64(stride*h)), le32(0), le32(0), le32(0), le32(0))
	bits := make([]byte, stride*h)
	for y := 0; y < h; y++ {
		row := (h - 1 - y) * stride
		for x := 0; x < w; x++ {
			c := px(x, y)
			bits[row+3*x], bits[row+3*x+1], bits[row+3*x+2] = c.B, c.G, c.R
		}
	}
	return cat(hdr, bits)
}

// quadrants: red top-left, green top-right, blue bottom-left, white bottom-right
func quadrants(w, h int) func(x, y int) color.NRGBA {
	return func(x, y int) color.NRGBA {
		switch {
		case x < w/2 && y < h/2:
			return mfRed
		case y < h/2:
			return mfGreen
		case x < w/2:
			return mfBlue
		}
		return mfWhite
	}
}

// wmfRec builds one WMF record from 16-bit words and a byte tail
func wmfRec(fn uint16, words []int, tail []byte) []byte {
	if len(tail)%2 == 1 {
		tail = append(tail, 0)
	}
	var b bytes.Buffer
	b.Write(le32(int64(3 + len(words) + len(tail)/2)))
	binary.Write(&b, binary.LittleEndian, fn)
	for _, w := range words {
		b.Write(le16(w))
	}
	b.Write(tail)
	return b.Bytes()
}

func wmfColor(c color.NRGBA) []int {
	return []int{int(c.R) | int(c.G)<<8, int(c.B)}
}

// buildWmf wraps records in a placeable header (box in logical units,
// inch units per inch) and the standard header, ending with EOF
func buildWmf(box [4]int, inch int, recs ...[]byte) []byte {
	var b bytes.Buffer
	b.Write(le32(0x9AC6CDD7))
	b.Write(le16(0))
	for _, v := range box {
		b.Write(le16(v))
	}
	b.Write(le16(inch))
	b.Write(le32(0))
	b.Write(le16(0))
	b.Write(cat(le16(1), le16(9), le16(0x300), le32(0), le16(8), le32(0), le16(0)))
	for _, r := range recs {
		b.Write(r)
	}
	b.Write(wmfRec(0, nil, nil))
	return b.Bytes()
}

// emfRecBytes builds one EMF record from 32-bit values and a byte tail
func emfRecBytes(typ int, vals []int64, tail []byte) []byte {
	for len(tail)%4 != 0 {
		tail = append(tail, 0)
	}
	var b bytes.Buffer
	b.Write(le32(int64(typ)))
	b.Write(le32(int64(8 + 4*len(vals) + len(tail))))
	for _, v := range vals {
		b.Write(le32(v))
	}
	b.Write(tail)
	return b.Bytes()
}

// buildEmf writes a header whose frame is w x h millimetres on a 1 px per
// 0.1 mm reference device (so a logical unit is 0.1 mm), records and EOF
func buildEmf(wMM, hMM int, recs ...[]byte) []byte {
	devW, devH := wMM*10, hMM*10
	hdr := cat(le32(1), le32(88),
		le32(0), le32(0), le32(int64(devW-1)), le32(int64(devH-1)),
		le32(0), le32(0), le32(int64(wMM*100)), le32(int64(hMM*100)),
		[]byte(" EMF"), le32(0x10000), le32(0), le32(0), le16(8), le16(0),
		le32(0), le32(0), le32(0),
		le32(int64(devW)), le32(int64(devH)), le32(int64(wMM)), le32(int64(hMM)))
	var b bytes.Buffer
	b.Write(hdr)
	for _, r := range recs {
		b.Write(r)
	}
	b.Write(emfRecBytes(14, []int64{0, 0, 20}, nil))
	return b.Bytes()
}

func emfColor(c color.NRGBA) int64 {
	return int64(c.R) | int64(c.G)<<8 | int64(c.B)<<16
}

// emfSolidBrush creates brush ih and selects it, with a null pen
func emfSolidBrush(ih int64, c color.NRGBA) [][]byte {
	return [][]byte{
		emfRecBytes(39, []int64{ih, 0, emfColor(c), 0}, nil),
		emfRecBytes(37, []int64{ih}, nil),
		emfRecBytes(37, []int64{0x80000008}, nil), // NULL_PEN
	}
}

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
	std := cat(le16(1), le16(9), le16(0x300), make([]byte, 12))
	tests := []struct {
		name string
		data []byte
		want string
	}{
		{"placeable wmf", buildWmf([4]int{0, 0, 10, 10}, 96), "wmf"},
		{"standard wmf", std, "wmf"},
		{"emf", buildEmf(10, 10), "emf"},
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
		{"empty metafile fails", buildWmf([4]int{0, 0, 10, 10}, 96), "wmf", "wmf", false, true},
		{"bitmap wmf becomes a JPEG", buildWmf([4]int{0, 0, 8, 8}, 96,
			wmfRec(0x0B41, []int{0x0020, 0x00CC, 8, 8, 0, 0, 8, 8, 0, 0}, dib24(8, 8, quadrants(8, 8)))),
			"wmf", "jpeg", true, false},
		{"drawing emf becomes a PNG", buildEmf(10, 10, append(emfSolidBrush(1, mfBlue),
			emfRecBytes(43, []int64{0, 0, 50, 50}, nil))...), "emf", "png", true, false},
	}
	for _, tc := range tests {
		out, ext, ok := browserPicture(tc.data, tc.ext)
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
	wmf := buildWmf([4]int{0, 0, 1440, 720}, 1440,
		wmfRec(0x0103, []int{8}, nil),
		wmfRec(0x020B, []int{0, 0}, nil),
		wmfRec(0x020C, []int{720, 1440}, nil),
		wmfRec(0x0B41, []int{0x0020, 0x00CC, 8, 16, 0, 0, 720, 1440, 0, 0}, dib24(16, 8, quadrants(16, 8))))
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
	}{{1, 1, mfRed}, {14, 1, mfGreen}, {1, 6, mfBlue}, {14, 6, mfWhite}}
	for _, c := range checks {
		if got := pixel(img, c.x, c.y); !near(got, c.want, 8) {
			t.Errorf("pixel (%d,%d) = %v, want %v", c.x, c.y, got, c.want)
		}
	}
}

func TestWmfSourceRectWiderThanBitmap(t *testing.T) {
	// PowerPoint writes source rectangles a pixel or two wider than the
	// DIB (the reference decks do): the part that exists is drawn
	wmf := buildWmf([4]int{0, 0, 10, 8}, 96,
		wmfRec(0x0B41, []int{0x0020, 0x00CC, 8, 10, 0, 0, 8, 10, 0, 0}, dib24(8, 8, quadrants(8, 8))))
	img, _ := render(t, wmf)
	if got := pixel(img, 0, 0); !near(got, mfRed, 8) {
		t.Errorf("top-left = %v, want red", got)
	}
	if got := pixel(img, img.Bounds().Dx()-1, 0); got.A != 0 && !near(got, mfWhite, 8) {
		t.Errorf("uncovered column = %v, want empty or the white page", got)
	}
}

func TestWmfMirroredBlit(t *testing.T) {
	// a negative destination width mirrors the bitmap
	wmf := buildWmf([4]int{0, 0, 8, 8}, 96,
		wmfRec(0x0B41, []int{0x0020, 0x00CC, 8, 8, 0, 0, 8, -8, 0, 8}, dib24(8, 8, quadrants(8, 8))))
	img, _ := render(t, wmf)
	if got := pixel(img, 1, 1); !near(got, mfGreen, 8) {
		t.Errorf("mirrored top-left = %v, want green", got)
	}
}

func TestWmfVectorShapes(t *testing.T) {
	brush := wmfRec(0x02FC, append([]int{0}, append(wmfColor(mfGreen), 0)...), nil)
	nullPen := wmfRec(0x02FA, []int{5, 0, 0, 0, 0}, nil)
	tests := []struct {
		name   string
		shape  []byte
		inside [2]int // in CSS px of a 100 x 100 frame
		out    [2]int
	}{
		{"rectangle", wmfRec(0x041B, []int{75, 75, 25, 25}, nil), [2]int{50, 50}, [2]int{10, 10}},
		{"ellipse", wmfRec(0x0418, []int{90, 90, 10, 10}, nil), [2]int{50, 50}, [2]int{12, 12}},
		{"polygon", wmfRec(0x0324, []int{3, 10, 10, 90, 10, 10, 90}, nil), [2]int{25, 25}, [2]int{80, 80}},
	}
	for _, tc := range tests {
		wmf := buildWmf([4]int{0, 0, 100, 100}, 96,
			brush, nullPen,
			wmfRec(0x012D, []int{0}, nil), wmfRec(0x012D, []int{1}, nil),
			tc.shape)
		img, photo := render(t, wmf)
		if photo {
			t.Errorf("%s: a drawing must not be encoded as a photo", tc.name)
		}
		if b := img.Bounds(); b.Dx() != 200 {
			t.Errorf("%s: width = %d, want 200 (drawings render at 2x)", tc.name, b.Dx())
		}
		if got := pixel(img, tc.inside[0]*2, tc.inside[1]*2); !near(got, mfGreen, 2) {
			t.Errorf("%s: inside = %v, want green", tc.name, got)
		}
		if got := pixel(img, tc.out[0]*2, tc.out[1]*2); got.A != 0 {
			t.Errorf("%s: outside = %v, want transparent", tc.name, got)
		}
	}
}

func TestWmfObjectTableReusesFreedSlots(t *testing.T) {
	red := wmfRec(0x02FC, append([]int{0}, append(wmfColor(mfRed), 0)...), nil)
	blue := wmfRec(0x02FC, append([]int{0}, append(wmfColor(mfBlue), 0)...), nil)
	wmf := buildWmf([4]int{0, 0, 10, 10}, 96,
		wmfRec(0x02FA, []int{5, 0, 0, 0, 0}, nil), // slot 0: null pen
		wmfRec(0x012D, []int{0}, nil),
		red,                           // slot 1
		wmfRec(0x01F0, []int{1}, nil), // free slot 1
		blue,                          // takes slot 1 again
		wmfRec(0x012D, []int{1}, nil),
		wmfRec(0x041B, []int{10, 10, 0, 0}, nil))
	img, _ := render(t, wmf)
	if got := pixel(img, 10, 10); !near(got, mfBlue, 2) {
		t.Errorf("fill = %v, want blue from the reused slot", got)
	}
}

func TestWmfMaskRasterOps(t *testing.T) {
	// the classic transparent-bitmap pair: AND a mask (black = keep), then
	// OR the image (black = transparent). The background stays empty.
	mask := dib24(8, 8, func(x, y int) color.NRGBA {
		if x < 4 {
			return color.NRGBA{A: 255}
		}
		return mfWhite
	})
	pic := dib24(8, 8, func(x, y int) color.NRGBA {
		if x < 4 {
			return mfRed
		}
		return color.NRGBA{A: 255}
	})
	wmf := buildWmf([4]int{0, 0, 8, 8}, 96,
		wmfRec(0x0B41, []int{0x00C6, 0x0088, 8, 8, 0, 0, 8, 8, 0, 0}, mask),
		wmfRec(0x0B41, []int{0x0086, 0x00EE, 8, 8, 0, 0, 8, 8, 0, 0}, pic))
	img, _ := render(t, wmf)
	if got := pixel(img, 1, 4); !near(got, mfRed, 8) {
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
	hdr := cat(le32(40), le32(2), le32(2), le16(1), le16(8), le32(0), le32(8), le32(0), le32(0), le32(2), le32(0))
	pal := cat([]byte{0, 0, 255, 0}, []byte{255, 0, 0, 0}) // index 0 red, 1 blue (BGRA)
	bits := []byte{1, 1, 0, 0, 0, 0, 0, 0}                 // bottom row blue, top row red
	bmi := cat(hdr, pal)
	const fixed = 80
	rec := emfRecBytes(81, []int64{
		0, 0, 1, 1, // bounds
		0, 0, 0, 0, 2, 2, // dest x y, src x y w h
		fixed, int64(len(bmi)), fixed + int64(len(bmi)), int64(len(bits)),
		0, ropSrcCopy, 100, 100,
	}, cat(bmi, bits))
	img, photo := render(t, buildEmf(10, 10, rec))
	if photo {
		t.Error("an 8-bit DIB is not a photo")
	}
	w, h := img.Bounds().Dx(), img.Bounds().Dy()
	if got := pixel(img, w/2, h/4); !near(got, mfRed, 8) {
		t.Errorf("top = %v, want red", got)
	}
	if got := pixel(img, w/2, 3*h/4); !near(got, mfBlue, 8) {
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
			tail = append(tail, le16(p)...)
		}
		return emfRecBytes(86, []int64{0, 0, 100, 100, int64(len(pts) / 2)}, tail)
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
			emfRecBytes(59, nil, nil),
			emfRecBytes(27, []int64{20, 20}, nil),
			emfRecBytes(54, []int64{80, 20}, nil),
			emfRecBytes(54, []int64{80, 80}, nil),
			emfRecBytes(61, nil, nil),
			emfRecBytes(60, nil, nil),
			emfRecBytes(62, []int64{0, 0, 100, 100}, nil),
		}, [2]float64{70, 30}, [2]float64{30, 70}},
		{"world transform", [][]byte{
			emfRecBytes(35, []int64{f(1), f(0), f(0), f(1), f(50), f(50)}, nil),
			emfRecBytes(43, []int64{0, 0, 40, 40}, nil),
		}, [2]float64{70, 70}, [2]float64{20, 20}},
		{"anisotropic window", [][]byte{
			emfRecBytes(17, []int64{mmAnisotropic}, nil),
			emfRecBytes(9, []int64{10, 10}, nil),
			emfRecBytes(11, []int64{100, 100}, nil),
			emfRecBytes(43, []int64{5, 5, 10, 10}, nil),
		}, [2]float64{75, 75}, [2]float64{25, 25}},
	}
	for _, tc := range tests {
		recs := append(emfSolidBrush(1, mfBlue), tc.recs...)
		img, _ := render(t, buildEmf(10, 10, recs...))
		x, y := at(tc.inside[0], tc.inside[1])
		if got := pixel(img, x, y); !near(got, mfBlue, 2) {
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
		emfRecBytes(38, []int64{1, 0, 4, 0, emfColor(mfRed)}, nil),
		emfRecBytes(37, []int64{1}, nil),
		emfRecBytes(27, []int64{10, 50}, nil),
		emfRecBytes(54, []int64{90, 50}, nil),
	}
	img, _ := render(t, buildEmf(10, 10, recs...))
	pxPer := 2 * 96 / 25.4 / 10
	if got := pixel(img, int(50*pxPer), int(50*pxPer)); !near(got, mfRed, 2) {
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
		str = append(str, le16(int(u))...)
	}
	// EXTCREATEFONTINDIRECTW: ih + LOGFONTW (92 bytes)
	logfont := cat(le32(-40), le32(0), le32(0), le32(0), le32(700), make([]byte, 8))
	face := utf16.Encode([]rune("Arial"))
	name := make([]byte, 64)
	for i, u := range face {
		binary.LittleEndian.PutUint16(name[2*i:], u)
	}
	logfont = cat(logfont, name)
	const strOff = 76 // 8 header + 68 bytes of fields
	recs := [][]byte{
		emfRecBytes(82, []int64{1}, logfont),
		emfRecBytes(37, []int64{1}, nil),
		emfRecBytes(24, []int64{emfColor(mfBlue)}, nil),
		emfRecBytes(22, []int64{24}, nil), // TA_BASELINE
		emfRecBytes(84, []int64{
			0, 0, 100, 100, // bounds
			1, 0, 0, // graphics mode, scales
			10, 60, 2, strOff, 0, // ref x y, chars, offString, options
			0, 0, 0, 0, 0, // rect, offDx
		}, str),
	}
	img, photo := render(t, buildEmf(10, 10, recs...))
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
		{"zero width", cat(le32(40), le32(0), le32(4), le16(1), le16(24), make([]byte, 24))},
		{"huge", cat(le32(40), le32(60000), le32(60000), le16(1), le16(24), make([]byte, 24))},
	}
	for _, tc := range tests {
		if _, err := parseDIBHeader(tc.hdr, 0); err == nil {
			t.Errorf("%s: parseDIBHeader accepted a bad header", tc.name)
		}
	}
}

/* ---------------- import integration ---------------- */

func TestPptxWmfPictureIsRendered(t *testing.T) {
	wmf := buildWmf([4]int{0, 0, 8, 8}, 96,
		wmfRec(0x0B41, []int{0x0020, 0x00CC, 8, 8, 0, 0, 8, 8, 0, 0}, dib24(8, 8, quadrants(8, 8))))
	pic := `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture 5"/><p:cNvPicPr/><p:nvPr/></p:nvPicPr>` +
		`<p:blipFill><a:blip r:embed="rId9"/><a:stretch><a:fillRect/></a:stretch></p:blipFill>` +
		`<p:spPr><a:xfrm><a:off x="914400" y="914400"/><a:ext cx="914400" cy="914400"/></a:xfrm></p:spPr></p:pic>`
	objs := parseOneSlide(t, pptxParts{
		slides:    []string{pic},
		slideRels: map[string]string{"rId9": "../media/image2.wmf"},
		media:     map[string][]byte{"ppt/media/image2.wmf": wmf},
	})
	if len(objs) != 1 || objs[0].Type != "image" {
		t.Fatalf("objects = %+v, want one image", objs)
	}
	if src := objs[0].Props.Src; !strings.HasPrefix(src, "data:image/jpeg;base64,") {
		t.Errorf("src = %.40s..., want a JPEG data URL", src)
	}
}

func TestDocxEmfPictureIsRendered(t *testing.T) {
	emf := buildEmf(10, 10, append(emfSolidBrush(1, mfBlue), emfRecBytes(43, []int64{0, 0, 50, 50}, nil))...)
	rels := `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		`<Relationship Id="rIdImg" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/p.emf"/></Relationships>`
	body := `<w:p><w:r><w:drawing><wp:inline><wp:extent cx="508000" cy="508000"/>` +
		`<a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rIdImg"/></pic:blipFill>` +
		`</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
	zipData := testDocx(t, body, map[string]string{"word/_rels/document.xml.rels": rels})
	doc := parseDocxWithMedia(t, zipData, "word/media/p.emf", emf)
	if !strings.Contains(doc.HTML, `<img src="data:image/png;base64,`) {
		t.Errorf("EMF picture not imported as PNG: %.300s", doc.HTML)
	}
}
