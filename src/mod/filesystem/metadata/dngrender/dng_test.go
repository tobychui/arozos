package dngrender

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/color"
	"math"
	"sort"
	"testing"
)

// testTag is one directory entry of a DNG built for a test
type testTag struct {
	fieldType uint16
	count     int
	value     []byte
}

// testDNG describes a DNG to build. All tags go in IFD0, as Android writes it.
type testDNG struct {
	order         binary.ByteOrder
	width, height int
	bits          int
	tile          int     // side of square tiles, 0 for one strip
	cfa           [4]byte // colour of each position of the 2x2 cell
	// stored is the value of the sensor at (x, y), which has this colour
	stored func(x, y, colour int) uint16
	tags   map[uint16]testTag // added to, or replacing, the standard ones
}

func (d testDNG) shorts(values ...uint16) testTag {
	b := make([]byte, 2*len(values))
	for i, v := range values {
		d.order.PutUint16(b[i*2:], v)
	}
	return testTag{3, len(values), b}
}

func (d testDNG) longs(values ...uint32) testTag {
	b := make([]byte, 4*len(values))
	for i, v := range values {
		d.order.PutUint32(b[i*4:], v)
	}
	return testTag{4, len(values), b}
}

// signed rationals with a denominator of 100000
func (d testDNG) rationals(values ...float64) testTag {
	b := make([]byte, 8*len(values))
	for i, v := range values {
		d.order.PutUint32(b[i*8:], uint32(int32(math.Round(v*100000))))
		d.order.PutUint32(b[i*8+4:], 100000)
	}
	return testTag{10, len(values), b}
}

// block packs the sensor values of one strip or tile
func (d testDNG) block(left, top, width, height int) []byte {
	var out bytes.Buffer
	for y := top; y < top+height; y++ {
		var buffer uint32
		bits := 0
		for x := left; x < left+width; x++ {
			var v uint16
			if x < d.width && y < d.height {
				v = d.stored(x, y, int(d.cfa[(y&1)*2+x&1]))
			}
			switch d.bits {
			case 16:
				var b [2]byte
				d.order.PutUint16(b[:], v)
				out.Write(b[:])
			case 8:
				out.WriteByte(byte(v))
			default:
				buffer = buffer<<d.bits | uint32(v)
				bits += d.bits
				for bits >= 8 {
					bits -= 8
					out.WriteByte(byte(buffer >> bits))
				}
			}
		}
		if bits > 0 {
			out.WriteByte(byte(buffer << (8 - bits)))
		}
	}
	return out.Bytes()
}

func (d testDNG) build() []byte {
	out := []byte("II*\x00\x00\x00\x00\x00")
	if d.order == binary.BigEndian {
		out = []byte("MM\x00*\x00\x00\x00\x00")
	}

	var offsets, counts []uint32
	add := func(block []byte) {
		offsets = append(offsets, uint32(len(out)))
		counts = append(counts, uint32(len(block)))
		out = append(out, block...)
	}
	tags := map[uint16]testTag{
		tagImageWidth:          d.longs(uint32(d.width)),
		tagImageLength:         d.longs(uint32(d.height)),
		tagBitsPerSample:       d.shorts(uint16(d.bits)),
		tagCompression:         d.shorts(1),
		tagPhotometric:         d.shorts(photometricCFA),
		tagCFARepeatPatternDim: d.shorts(2, 2),
		tagCFAPattern:          {1, 4, d.cfa[:]},
		tagDNGVersion:          {1, 4, []byte{1, 4, 0, 0}},
	}
	if d.tile > 0 {
		for top := 0; top < d.height; top += d.tile {
			for left := 0; left < d.width; left += d.tile {
				add(d.block(left, top, d.tile, d.tile))
			}
		}
		tags[tagTileWidth] = d.longs(uint32(d.tile))
		tags[tagTileLength] = d.longs(uint32(d.tile))
		tags[tagTileOffsets] = d.longs(offsets...)
		tags[tagTileByteCounts] = d.longs(counts...)
	} else {
		add(d.block(0, 0, d.width, d.height))
		tags[tagStripOffsets] = d.longs(offsets...)
		tags[tagStripByteCounts] = d.longs(counts...)
	}
	for id, tag := range d.tags {
		tags[id] = tag
	}

	ids := make([]int, 0, len(tags))
	for id := range tags {
		ids = append(ids, int(id))
	}
	sort.Ints(ids)

	var entries []byte
	for _, id := range ids {
		tag := tags[uint16(id)]
		entry := make([]byte, 12)
		d.order.PutUint16(entry, uint16(id))
		d.order.PutUint16(entry[2:], tag.fieldType)
		d.order.PutUint32(entry[4:], uint32(tag.count))
		if len(tag.value) <= 4 {
			copy(entry[8:], tag.value)
		} else {
			d.order.PutUint32(entry[8:], uint32(len(out)))
			out = append(out, tag.value...)
		}
		entries = append(entries, entry...)
	}
	d.order.PutUint32(out[4:], uint32(len(out)))
	var count [2]byte
	d.order.PutUint16(count[:], uint16(len(ids)))
	out = append(out, count[:]...)
	out = append(out, entries...)
	return append(out, 0, 0, 0, 0)
}

var rggb = [4]byte{0, 1, 1, 2}

// flat is a DNG whose whole sensor sees one colour, given as fractions of the
// white level for red, green and blue
func flat(width, height, bits int, colour [3]float64) testDNG {
	white := float64(int(1)<<bits - 1)
	return testDNG{
		order: binary.LittleEndian, width: width, height: height, bits: bits, cfa: rggb,
		stored: func(x, y, c int) uint16 { return uint16(math.Round(colour[c] * white)) },
		tags:   map[uint16]testTag{},
	}
}

// tone is the 8 bit value a linear value (0 to 1) is shown as
func tone(v float64) int {
	return int(toneCurve()[tableIndex(float32(v)*toneSteps, toneSteps)])
}

func rgbAt(img image.Image, x, y int) [3]int {
	c := color.NRGBAModel.Convert(img.At(x, y)).(color.NRGBA)
	return [3]int{int(c.R), int(c.G), int(c.B)}
}

// wantColour checks every pixel of a picture, allowing for rounding
func wantColour(t *testing.T, img image.Image, want [3]int) {
	t.Helper()
	b := img.Bounds()
	for y := b.Min.Y; y < b.Max.Y; y++ {
		for x := b.Min.X; x < b.Max.X; x++ {
			got := rgbAt(img, x, y)
			for c := range got {
				if got[c] < want[c]-4 || got[c] > want[c]+4 {
					t.Fatalf("pixel %d,%d = %v, want about %v", x, y, got, want)
				}
			}
		}
	}
}

func develop(t *testing.T, data []byte, minShortSide int) image.Image {
	t.Helper()
	img, err := Develop(data, minShortSide)
	if err != nil {
		t.Fatalf("Develop: %v", err)
	}
	return img
}

func TestDevelopLayouts(t *testing.T) {
	colour := [3]float64{1, 0.5, 0.25}
	want := [3]int{tone(1), tone(0.5), tone(0.25)}
	patterns := map[string][4]byte{
		"RGGB": {0, 1, 1, 2}, "BGGR": {2, 1, 1, 0}, "GRBG": {1, 0, 2, 1}, "GBRG": {1, 2, 0, 1},
	}
	for name, cfa := range patterns {
		for _, bits := range []int{8, 10, 12, 14, 16} {
			for _, tile := range []int{0, 8} {
				for _, order := range []binary.ByteOrder{binary.LittleEndian, binary.BigEndian} {
					d := flat(20, 14, bits, colour)
					d.cfa, d.tile, d.order = cfa, tile, order
					img := develop(t, d.build(), 0)
					if img.Bounds().Dx() != 20 || img.Bounds().Dy() != 14 {
						t.Fatalf("%s %d bit tile %d: size %v", name, bits, tile, img.Bounds())
					}
					wantColour(t, img, want)
					if t.Failed() {
						t.Fatalf("%s %d bit tile %d %v", name, bits, tile, order)
					}
				}
			}
		}
	}
}

func TestDevelopSizes(t *testing.T) {
	data := flat(64, 48, 12, [3]float64{1, 0.5, 0.25}).build()
	tests := []struct {
		name          string
		minShortSide  int
		width, height int
	}{
		{"full resolution", 0, 64, 48},
		{"one cell per pixel", 24, 32, 24},
		{"largest factor keeping the short side", 12, 16, 12},
		{"factor rounds down", 11, 16, 12},
		{"too small to halve", 40, 64, 48},
	}
	for _, tc := range tests {
		img := develop(t, data, tc.minShortSide)
		if img.Bounds().Dx() != tc.width || img.Bounds().Dy() != tc.height {
			t.Errorf("%s: size = %v, want %dx%d", tc.name, img.Bounds(), tc.width, tc.height)
		}
		wantColour(t, img, [3]int{tone(1), tone(0.5), tone(0.25)})
	}
}

func TestDevelopColourAndLevels(t *testing.T) {
	grey := func(v float64) [3]int { return [3]int{tone(v), tone(v), tone(v)} }
	d := testDNG{order: binary.LittleEndian}

	//A real camera matrix: whatever it holds, a neutral subject stays neutral
	sony := d.rationals(1.43907, -0.7894, -0.06345, -0.43902, 1.40078, 0.2289, -0.02661, 0.1622, 0.61441)

	tests := []struct {
		name   string
		colour [3]float64
		tags   map[uint16]testTag
		want   [3]int
	}{
		{"white balance and matrix keep neutral white", [3]float64{0.5, 1, 0.5},
			map[uint16]testTag{tagAsShotNeutral: d.rationals(0.5, 1, 0.5), tagColorMatrix1: sony}, grey(1)},
		{"auto exposure brightens a dim picture", [3]float64{0.5, 0.5, 0.5}, nil, grey(1)},
		{"auto exposure is limited to 4x", [3]float64{0.05, 0.05, 0.05}, nil, grey(0.2)},
		{"baseline exposure", [3]float64{1, 1, 1},
			map[uint16]testTag{tagBaselineExposure: d.rationals(-1)}, grey(1)},
		{"black level is subtracted", [3]float64{0.25, 0.25, 0.25},
			map[uint16]testTag{tagBlackLevel: d.longs(16384)}, grey(0)},
		{"white level", [3]float64{0.25, 0.125, 0.125},
			map[uint16]testTag{tagWhiteLevel: d.longs(16384)}, [3]int{tone(1), tone(0.5), tone(0.5)}},
		{"linearization table", [3]float64{0, 0, 0},
			map[uint16]testTag{tagLinearizationTable: d.longs(65535)}, grey(1)},
		{"unusable matrix is ignored", [3]float64{1, 0.5, 0.25},
			map[uint16]testTag{tagColorMatrix1: d.rationals(0, 0, 0, 0, 0, 0, 0, 0, 0)},
			[3]int{tone(1), tone(0.5), tone(0.25)}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dng := flat(16, 12, 16, tc.colour)
			dng.tags = tc.tags
			wantColour(t, develop(t, dng.build(), 0), tc.want)
		})
	}
}

// gainMapList is an opcode list with one GainMap of a single point
func gainMapList(width, height int, gain float32) testTag {
	be := binary.BigEndian
	body := make([]byte, 80)
	for i, v := range []uint32{0, 0, uint32(height), uint32(width), 0, 1, 2, 2, 1, 1} {
		be.PutUint32(body[i*4:], v)
	}
	be.PutUint64(body[40:], math.Float64bits(1))
	be.PutUint64(body[48:], math.Float64bits(1))
	be.PutUint32(body[72:], 1)
	be.PutUint32(body[76:], math.Float32bits(gain))

	list := make([]byte, 20)
	be.PutUint32(list, 1)
	be.PutUint32(list[4:], opcodeGainMap)
	be.PutUint32(list[16:], uint32(len(body)))
	list = append(list, body...)
	return testTag{7, len(list), list}
}

func TestDevelopGainMap(t *testing.T) {
	d := flat(16, 12, 16, [3]float64{1, 1, 1})
	//The map starts at row 0, column 0 with a pitch of 2: only red pixels
	d.tags[tagOpcodeList2] = gainMapList(16, 12, 0.5)
	wantColour(t, develop(t, d.build(), 0), [3]int{tone(0.5), tone(1), tone(1)})
}

func TestGridPosition(t *testing.T) {
	tests := []struct {
		name      string
		position  float64
		points    int
		low, high int
		fraction  float32
	}{
		{"before the grid", -1, 3, 0, 0, 0},
		{"between points", 0.25, 3, 0, 1, 0.5},
		{"past the grid", 2, 3, 2, 2, 0},
		{"single point", 0.5, 1, 0, 0, 0},
		{"not a number", math.NaN(), 3, 0, 0, 0},
	}
	for _, tc := range tests {
		low, high, fraction := gridPosition(tc.position, 0, 0.5, tc.points)
		if low != tc.low || high != tc.high || fraction != tc.fraction {
			t.Errorf("%s: got %d,%d,%v", tc.name, low, high, fraction)
		}
	}
}

func TestOrient(t *testing.T) {
	//Where the top left and top right pixel of a 3x2 picture end up
	tests := []struct {
		orientation       int
		topLeft, topRight image.Point
	}{
		{1, image.Pt(0, 0), image.Pt(2, 0)},
		{2, image.Pt(2, 0), image.Pt(0, 0)},
		{3, image.Pt(2, 1), image.Pt(0, 1)},
		{4, image.Pt(0, 1), image.Pt(2, 1)},
		{5, image.Pt(0, 0), image.Pt(0, 2)},
		{6, image.Pt(1, 0), image.Pt(1, 2)},
		{7, image.Pt(1, 2), image.Pt(1, 0)},
		{8, image.Pt(0, 2), image.Pt(0, 0)},
	}
	for _, tc := range tests {
		lx, ly := orient(tc.orientation, 0, 0, 3, 2)
		rx, ry := orient(tc.orientation, 2, 0, 3, 2)
		if image.Pt(lx, ly) != tc.topLeft || image.Pt(rx, ry) != tc.topRight {
			t.Errorf("orientation %d: top left %d,%d top right %d,%d", tc.orientation, lx, ly, rx, ry)
		}
	}
}

func TestDevelopOrientationAndSize(t *testing.T) {
	//Left half white, right half black; turned 90 degrees clockwise the
	//white half is on top
	d := flat(32, 16, 12, [3]float64{})
	d.stored = func(x, y, c int) uint16 {
		if x < 16 {
			return 4095
		}
		return 0
	}
	d.tags[tagOrientation] = d.shorts(6)
	data := d.build()

	width, height, err := Size(data)
	if err != nil || width != 16 || height != 32 {
		t.Fatalf("Size = %d, %d, %v; want 16, 32", width, height, err)
	}
	img := develop(t, data, 0)
	if img.Bounds().Dx() != 16 || img.Bounds().Dy() != 32 {
		t.Fatalf("size = %v", img.Bounds())
	}
	if top, bottom := rgbAt(img, 8, 4), rgbAt(img, 8, 27); top[1] < 250 || bottom[1] > 5 {
		t.Errorf("top = %v, bottom = %v, want white above black", top, bottom)
	}
}

func TestDevelopCrop(t *testing.T) {
	//A masked (black) border outside the active area must not show
	d := flat(28, 22, 16, [3]float64{})
	d.stored = func(x, y, c int) uint16 {
		if x >= 4 && x < 24 && y >= 2 && y < 20 {
			return 65535
		}
		return 0
	}
	d.tags[tagActiveArea] = d.longs(2, 4, 20, 24)
	d.tags[tagDefaultCropOrigin] = d.longs(2, 3)
	d.tags[tagDefaultCropSize] = d.longs(16, 12)
	img := develop(t, d.build(), 0)
	if img.Bounds().Dx() != 16 || img.Bounds().Dy() != 12 {
		t.Fatalf("size = %v, want 16x12", img.Bounds())
	}
	wantColour(t, img, [3]int{255, 255, 255})
}

func TestDevelopErrors(t *testing.T) {
	base := func() testDNG { return flat(16, 12, 16, [3]float64{1, 1, 1}) }
	with := func(tag uint16, value testTag) []byte {
		d := base()
		d.tags[tag] = value
		return d.build()
	}
	d := base()
	notDNG := base().build()
	//Rename the DNGVersion tag
	notDNG = bytes.Replace(notDNG, []byte{0x12, 0xC6, 1, 0}, []byte{0xFF, 0xFE, 1, 0}, 1)

	tests := []struct {
		name        string
		data        []byte
		unsupported bool
	}{
		{"empty", nil, false},
		{"not a TIFF", []byte("this is not a picture at all"), false},
		{"TIFF without DNG version", notDNG, false},
		{"compressed", with(tagCompression, d.shorts(7)), true},
		{"not Bayer", with(tagCFAPattern, testTag{1, 4, []byte{0, 0, 1, 2}}), true},
		{"no CFA picture", with(tagPhotometric, d.shorts(2)), true},
		{"floating point depth", with(tagBitsPerSample, d.shorts(32)), true},
		{"size beyond the data", with(tagImageWidth, d.longs(30000)), false},
		{"short strip", with(tagStripByteCounts, d.longs(10)), false},
		{"strip outside the file", with(tagStripOffsets, d.longs(1<<31)), false},
		{"black above white", with(tagBlackLevel, d.longs(70000)), false},
	}
	for _, tc := range tests {
		_, err := Develop(tc.data, 0)
		if err == nil {
			t.Errorf("%s: expected an error", tc.name)
		} else if errors.Is(err, ErrUnsupported) != tc.unsupported {
			t.Errorf("%s: unsupported = %v, error %v", tc.name, !tc.unsupported, err)
		}
	}
}

// A directory that names itself as its child and as the next one is read once
func TestSelfReferencingDirectory(t *testing.T) {
	d := flat(16, 12, 16, [3]float64{1, 1, 1})
	d.tags[tagSubIFDs] = d.longs(0)
	data := d.build()
	ifd := binary.LittleEndian.Uint32(data[4:])
	count := int(binary.LittleEndian.Uint16(data[ifd:]))
	for i := 0; i < count; i++ {
		entry := data[int(ifd)+2+i*12:]
		if binary.LittleEndian.Uint16(entry) == tagSubIFDs {
			binary.LittleEndian.PutUint32(entry[8:], ifd)
		}
	}
	binary.LittleEndian.PutUint32(data[len(data)-4:], ifd)

	_, directories, err := readDirectories(data)
	if err != nil || len(directories) != 1 {
		t.Fatalf("got %d directories, %v; want 1", len(directories), err)
	}
	develop(t, data, 0)
}

// Damaged and hostile files must end in a picture or an error, never a panic
func TestBoundaryValuesDoNotPanic(t *testing.T) {
	d := flat(24, 20, 12, [3]float64{1, 0.5, 0.25})
	d.tile = 8
	for id, tag := range map[uint16]testTag{
		tagOrientation:         d.shorts(6),
		tagActiveArea:          d.longs(0, 0, 20, 24),
		tagDefaultCropOrigin:   d.longs(2, 2),
		tagDefaultCropSize:     d.longs(20, 16),
		tagBlackLevelRepeatDim: d.shorts(2, 2),
		tagBlackLevel:          d.longs(0, 1, 2, 3),
		tagLinearizationTable:  d.shorts(0, 1000, 2000, 4095),
		tagAsShotNeutral:       d.rationals(0.5, 1, 0.5),
		tagColorMatrix1:        d.rationals(1, 0, 0, 0, 1, 0, 0, 0, 1),
		tagBaselineExposure:    d.rationals(1),
		tagOpcodeList2:         gainMapList(24, 20, 1.5),
	} {
		d.tags[id] = tag
	}
	data := d.build()
	develop(t, data, 0)

	mutated := make([]byte, len(data))
	for _, value := range []uint32{0, 1, 0x7FFFFFFF, 0x80000000, 0xFFFFFFFF, 0x01000000, 0x00010001, 0x7F800000} {
		for offset := 0; offset+4 <= len(data); offset += 2 {
			copy(mutated, data)
			binary.LittleEndian.PutUint32(mutated[offset:], value)
			Develop(mutated, 0)
			Develop(mutated, 4)
		}
	}
	for length := 0; length < len(data); length += 7 {
		Develop(data[:length], 0)
	}
}

func TestSmoothChroma(t *testing.T) {
	//Odd size, grey with a single coloured speckle
	src := image.NewRGBA(image.Rect(0, 0, 21, 15))
	for i := range src.Pix {
		src.Pix[i] = 128
	}
	src.SetRGBA(10, 6, color.RGBA{255, 0, 0, 255})
	out := smoothChroma(src)
	if out.Bounds() != src.Bounds() {
		t.Fatalf("bounds = %v", out.Bounds())
	}
	if got := rgbAt(out, 2, 2); got != [3]int{128, 128, 128} {
		t.Errorf("grey changed to %v", got)
	}
	//The speckle keeps its brightness but loses most of its colour
	speckle := rgbAt(out, 10, 6)
	if speckle[0]-speckle[1] > 30 {
		t.Errorf("speckle is still coloured: %v", speckle)
	}
}
