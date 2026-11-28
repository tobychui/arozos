package metadata

import (
	"bytes"
	"encoding/binary"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"
	"testing"
)

// testIFD builds a little endian TIFF whose only directory has these entries
// of {tag, type, count, value}, followed by extra
func testIFD(entries [][4]uint32, extra []byte) []byte {
	le := binary.LittleEndian
	out := []byte("II*\x00\x08\x00\x00\x00")
	out = le.AppendUint16(out, uint16(len(entries)))
	for _, e := range entries {
		out = le.AppendUint16(out, uint16(e[0]))
		out = le.AppendUint16(out, uint16(e[1]))
		out = le.AppendUint32(out, e[2])
		out = le.AppendUint32(out, e[3])
	}
	out = le.AppendUint32(out, 0)
	return append(out, extra...)
}

// testDNGFile builds a DNG holding width x height of grey sensor data and,
// when previewWidth is not 0, a JPEG preview of that width (4:3)
func testDNGFile(t *testing.T, width, height int, compression uint32, previewWidth int) []byte {
	t.Helper()
	const entries = 10
	dataOffset := uint32(8 + 2 + entries*12 + 4)

	raw := make([]byte, width*height*2)
	for i := 0; i < len(raw); i += 2 {
		binary.LittleEndian.PutUint16(raw[i:], 2000)
	}
	out := testIFD([][4]uint32{
		{256, 4, 1, uint32(width)},
		{257, 4, 1, uint32(height)},
		{258, 3, 1, 12},
		{259, 3, 1, compression},
		{262, 3, 1, 32803},
		{273, 4, 1, dataOffset},
		{279, 4, 1, uint32(width * height * 2)},
		{33421, 3, 2, 0x00020002},
		{33422, 1, 4, 0x02010100}, // RGGB
		{50706, 1, 4, 0x00000401},
	}, nil)

	//The strip is 16 bit so that no marker bytes appear in it by chance
	le := binary.LittleEndian
	le.PutUint32(out[8+2+2*12+8:], 16)
	out = append(out, raw...)

	if previewWidth > 0 {
		var buf bytes.Buffer
		if err := jpeg.Encode(&buf, image.NewGray(image.Rect(0, 0, previewWidth, previewWidth*3/4)), nil); err != nil {
			t.Fatalf("encode preview: %v", err)
		}
		out = append(out, buf.Bytes()...)
	}
	return out
}

func jpegSize(t *testing.T, data []byte) image.Point {
	t.Helper()
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		t.Fatalf("not a JPEG: %v", err)
	}
	return image.Pt(cfg.Width, cfg.Height)
}

func TestRenderDNG(t *testing.T) {
	tests := []struct {
		name          string
		width, height int
		compression   uint32
		preview       int
		want          image.Point // zero: an error is expected
	}{
		{"raw data only is developed", 64, 48, 1, 0, image.Pt(64, 48)},
		{"large preview is used", 64, 48, 1, 1200, image.Pt(1200, 900)},
		{"thumbnail sized preview is not", 640, 480, 1, 160, image.Pt(640, 480)},
		{"small preview when raw cannot be developed", 64, 48, 7, 160, image.Pt(160, 120)},
		{"nothing to show", 64, 48, 7, 0, image.Point{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got, err := renderDNG(testDNGFile(t, tc.width, tc.height, tc.compression, tc.preview))
			if tc.want == (image.Point{}) {
				if err == nil {
					t.Fatal("expected an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("renderDNG: %v", err)
			}
			if size := jpegSize(t, got); size != tc.want {
				t.Errorf("size = %v, want %v", size, tc.want)
			}
		})
	}
}

func TestDNGThumbnailSource(t *testing.T) {
	tests := []struct {
		name          string
		width, height int
		compression   uint32
		preview       int
		want          image.Point
	}{
		{"developed at a reduced size", 1920, 1440, 1, 0, image.Pt(960, 720)},
		{"preview large enough", 64, 48, 1, 800, image.Pt(800, 600)},
		{"preview too small", 640, 480, 1, 160, image.Pt(640, 480)},
		{"small preview when raw cannot be developed", 64, 48, 7, 160, image.Pt(160, 120)},
		{"nothing to show", 64, 48, 7, 0, image.Point{}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			img, err := dngThumbnailSource(testDNGFile(t, tc.width, tc.height, tc.compression, tc.preview))
			if tc.want == (image.Point{}) {
				if err == nil {
					t.Fatal("expected an error")
				}
				return
			}
			if err != nil {
				t.Fatalf("dngThumbnailSource: %v", err)
			}
			if size := img.Bounds().Size(); size != tc.want {
				t.Errorf("size = %v, want %v", size, tc.want)
			}
		})
	}
}

func TestRawOnlyDNGThumbnailAndRender(t *testing.T) {
	fsh, dir := newTestFSH(t)
	src := filepath.ToSlash(filepath.Join(dir, "20230618_144115.DNG"))
	if err := os.WriteFile(src, testDNGFile(t, 640, 480, 1, 0), 0644); err != nil {
		t.Fatalf("write: %v", err)
	}
	cache := filepath.ToSlash(dir) + "/"

	if _, err := generateThumbnailForRAW(fsh, cache, src, true); err != nil {
		t.Fatalf("thumbnail: %v", err)
	}
	thumbnail, err := os.ReadFile(cache + "20230618_144115.DNG.jpg")
	if err != nil {
		t.Fatalf("no thumbnail written: %v", err)
	}
	if size := jpegSize(t, thumbnail); size != image.Pt(480, 480) {
		t.Errorf("thumbnail size = %v, want 480x480", size)
	}

	full, err := RenderRAWImage(fsh, src)
	if err != nil {
		t.Fatalf("render: %v", err)
	}
	if size := jpegSize(t, full); size != image.Pt(640, 480) {
		t.Errorf("rendered size = %v, want 640x480", size)
	}
}

// Directories pointing back at themselves used to recurse until the stack
// overflowed, which no recover can catch
func TestParseTIFFIFDChain_SelfReference(t *testing.T) {
	data := testIFD([][4]uint32{{0x014A, 4, 1, 8}}, nil)
	binary.LittleEndian.PutUint32(data[len(data)-4:], 8) // next directory: itself

	var candidates [][]byte
	parseTIFFIFDChain(data, binary.LittleEndian, 8, &candidates)
	if len(candidates) != 0 {
		t.Errorf("got %d candidates, want none", len(candidates))
	}
}

// Strips naming the same bytes over and over must not multiply the file
func TestParseTIFFIFDChain_RepeatedStrips(t *testing.T) {
	const (
		strips  = 3
		offsets = 8 + 2 + 3*12 + 4 // right after the directory
		counts  = offsets + strips*4
		blob    = counts + strips*4
		length  = 1000
	)
	var extra []byte
	for i := 0; i < strips; i++ {
		extra = binary.LittleEndian.AppendUint32(extra, blob)
	}
	for i := 0; i < strips; i++ {
		extra = binary.LittleEndian.AppendUint32(extra, length)
	}
	extra = append(extra, 0xFF, 0xD8)
	extra = append(extra, make([]byte, length-2)...)
	data := testIFD([][4]uint32{
		{0x0103, 3, 1, 7},
		{0x0111, 4, strips, offsets},
		{0x0117, 4, strips, counts},
	}, extra)

	var candidates [][]byte
	parseTIFFIFDChain(data, binary.LittleEndian, 8, &candidates)
	if len(candidates) != 1 || len(candidates[0]) != length {
		t.Fatalf("got %d candidates, want one of %d bytes", len(candidates), length)
	}
}

func TestExtractUncompressedThumbnail_HugeSize(t *testing.T) {
	tests := []struct {
		name          string
		width, height uint32
	}{
		{"overflowing", 0xFFFFFFFF, 0xFFFFFFFF},
		{"larger than the data", 100000, 100000},
	}
	for _, tc := range tests {
		data := testIFD([][4]uint32{
			{0x0100, 4, 1, tc.width},
			{0x0101, 4, 1, tc.height},
			{0x0103, 3, 1, 1},
			{0x0106, 3, 1, 2},
			{0x0111, 4, 1, 8},
			{0x0117, 4, 1, 16},
		}, nil)
		if _, err := extractUncompressedThumbnail(data, binary.LittleEndian, 8); err == nil {
			t.Errorf("%s: expected an error", tc.name)
		}
	}
}
