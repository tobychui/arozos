// Package dngrender develops the raw sensor data of a DNG photo into a normal
// picture, in pure Go.
//
// Most DNG files carry a JPEG preview that can be shown as it is. Phone apps
// built on Android's DngCreator often write none, only the Bayer mosaic of the
// sensor, so it has to be developed here.
//
// Supported: uncompressed Bayer (2x2 CFA) data of 8 to 16 bits, in strips or
// tiles. Compressed raw data returns ErrUnsupported. The result is meant for
// viewing: black and white level, lens shading (GainMap), white balance, the
// camera colour matrix and a tone curve are applied and, at full resolution,
// colour noise is smoothed. Lens distortion is not corrected.
//
// The input is an untrusted file: every size and offset in it is checked
// before use, and memory is only allocated for data that is really there.
package dngrender

import (
	"errors"
	"fmt"
)

// ErrUnsupported is returned for DNG files this package cannot develop
var ErrUnsupported = errors.New("unsupported DNG")

const (
	photometricCFA = 32803

	// Largest sensor that is developed
	maxDimension = 1 << 15
	maxPixels    = 200 << 20
)

// rectangle is a half open area of the image, in pixels
type rectangle struct {
	left, top, width, height int
}

// rawImage is everything needed to develop the raw data of one file
type rawImage struct {
	file *tiffFile

	width, height int // stored size of the mosaic
	bits          int

	//Where the stored data lies: strips are tiles as wide as the image
	tileWidth, tileHeight int
	offsets, counts       []int64

	active rectangle // area holding picture data, in stored coordinates
	crop   rectangle // area to show, relative to active
	cfa    [4]int    // colour (0 red, 1 green, 2 blue) of each 2x2 position

	linearization []float64
	blackRows     int
	blackCols     int
	black         []float64
	white         float64

	gainMaps []gainMap

	orientation int
	colour      colourSettings
}

// Size returns the width and height of the picture Develop renders at full
// resolution, as it is shown (after the orientation of the file).
func Size(data []byte) (int, int, error) {
	r, err := parse(data)
	if err != nil {
		return 0, 0, err
	}
	if r.orientation >= 5 {
		return r.crop.height, r.crop.width, nil
	}
	return r.crop.width, r.crop.height, nil
}

// parse finds the raw mosaic of a DNG and reads how to develop it
func parse(data []byte) (*rawImage, error) {
	t, directories, err := readDirectories(data)
	if err != nil {
		return nil, err
	}
	first := directories[0]
	if _, ok := first[tagDNGVersion]; !ok {
		return nil, errors.New("not a DNG file")
	}

	//The raw mosaic is the largest CFA picture of the file
	var dir directory
	var best int64
	for _, d := range directories {
		if t.uintValue(d, tagPhotometric, 0) != photometricCFA {
			continue
		}
		area := t.uintValue(d, tagImageWidth, 0) * t.uintValue(d, tagImageLength, 0)
		if area > best {
			dir, best = d, area
		}
	}
	if dir == nil {
		return nil, fmt.Errorf("%w: no Bayer raw data", ErrUnsupported)
	}

	r := &rawImage{file: t}
	if err := r.readLayout(dir); err != nil {
		return nil, err
	}
	r.readGeometry(dir)
	if r.crop.width < 4 || r.crop.height < 4 {
		return nil, errors.New("DNG picture area too small")
	}
	if err := r.readCFA(dir); err != nil {
		return nil, err
	}
	if err := r.readLevels(dir); err != nil {
		return nil, err
	}
	if list, ok := dir[tagOpcodeList2]; ok {
		r.gainMaps = parseGainMaps(list.value)
	}

	r.orientation = int(t.uintValue(first, tagOrientation, 1))
	if r.orientation < 1 || r.orientation > 8 {
		r.orientation = 1
	}
	r.colour = readColourSettings(t, first)
	return r, nil
}

// readLayout reads the size of the mosaic and where its bytes are
func (r *rawImage) readLayout(dir directory) error {
	t := r.file
	width := t.uintValue(dir, tagImageWidth, 0)
	height := t.uintValue(dir, tagImageLength, 0)
	if width < 4 || height < 4 || width > maxDimension || height > maxDimension || width*height > maxPixels {
		return fmt.Errorf("%w: raw size %dx%d", ErrUnsupported, width, height)
	}
	if c := t.uintValue(dir, tagCompression, 1); c != 1 {
		return fmt.Errorf("%w: compression %d", ErrUnsupported, c)
	}
	if s := t.uintValue(dir, tagSamplesPerPixel, 1); s != 1 {
		return fmt.Errorf("%w: %d samples per pixel", ErrUnsupported, s)
	}
	bits := t.uintValue(dir, tagBitsPerSample, 0)
	if bits < 8 || bits > 16 {
		return fmt.Errorf("%w: %d bits per sample", ErrUnsupported, bits)
	}

	//An uncompressed mosaic cannot be larger than the file holding it
	if width*height*bits/8 > int64(len(t.data)) {
		return errors.New("DNG raw data is truncated")
	}
	r.width, r.height, r.bits = int(width), int(height), int(bits)

	offsetTag, countTag := uint16(tagStripOffsets), uint16(tagStripByteCounts)
	tileWidth, tileHeight := width, t.uintValue(dir, tagRowsPerStrip, height)
	if _, tiled := dir[tagTileOffsets]; tiled {
		offsetTag, countTag = tagTileOffsets, tagTileByteCounts
		tileWidth = t.uintValue(dir, tagTileWidth, 0)
		tileHeight = t.uintValue(dir, tagTileLength, 0)
	}
	if tileHeight > height && offsetTag == tagStripOffsets {
		tileHeight = height
	}
	if tileWidth < 1 || tileHeight < 1 || tileWidth > maxDimension || tileHeight > maxDimension {
		return errors.New("DNG has an invalid tile size")
	}
	r.tileWidth, r.tileHeight = int(tileWidth), int(tileHeight)

	across := (r.width + r.tileWidth - 1) / r.tileWidth
	down := (r.height + r.tileHeight - 1) / r.tileHeight
	total := int64(across) * int64(down)
	if total > int64(dir[offsetTag].count) || total > int64(dir[countTag].count) {
		return errors.New("DNG raw data is incomplete")
	}
	r.offsets = t.uints(dir[offsetTag], int(total))
	r.counts = t.uints(dir[countTag], int(total))
	if int64(len(r.offsets)) != total || int64(len(r.counts)) != total {
		return errors.New("DNG raw data is incomplete")
	}
	return nil
}

// readGeometry reads the active area and the default crop inside it. Values
// that do not fit the image are ignored.
func (r *rawImage) readGeometry(dir directory) {
	t := r.file
	r.active = rectangle{0, 0, r.width, r.height}
	if a := t.uints(dir[tagActiveArea], 4); len(a) == 4 {
		top, left, bottom, right := a[0], a[1], a[2], a[3]
		if top < bottom && left < right && bottom <= int64(r.height) && right <= int64(r.width) {
			r.active = rectangle{int(left), int(top), int(right - left), int(bottom - top)}
		}
	}

	r.crop = rectangle{0, 0, r.active.width, r.active.height}
	origin := t.numbers(dir[tagDefaultCropOrigin], 2)
	size := t.numbers(dir[tagDefaultCropSize], 2)
	if len(origin) == 2 && len(size) == 2 {
		inside := func(start, length float64, limit int) bool {
			return start >= 0 && length >= 1 && start <= float64(limit) && length <= float64(limit)-start
		}
		if inside(origin[0], size[0], r.active.width) && inside(origin[1], size[1], r.active.height) {
			r.crop = rectangle{int(origin[0]), int(origin[1]), int(size[0]), int(size[1])}
		}
	}
}

// readCFA reads which colour each pixel of the 2x2 mosaic cell carries
func (r *rawImage) readCFA(dir directory) error {
	t := r.file
	repeat := t.uints(dir[tagCFARepeatPatternDim], 2)
	pattern := t.uints(dir[tagCFAPattern], 4)
	if len(repeat) != 2 || repeat[0] != 2 || repeat[1] != 2 || len(pattern) != 4 {
		return fmt.Errorf("%w: not a 2x2 colour filter", ErrUnsupported)
	}
	if layout := t.uintValue(dir, tagCFALayout, 1); layout != 1 {
		return fmt.Errorf("%w: colour filter layout %d", ErrUnsupported, layout)
	}

	//CFAPlaneColor maps the plane numbers used by the colour matrices to
	//colours; only the usual red, green, blue order is handled
	if planes := t.uints(dir[tagCFAPlaneColor], 4); len(planes) > 0 {
		if len(planes) != 3 || planes[0] != 0 || planes[1] != 1 || planes[2] != 2 {
			return fmt.Errorf("%w: colour filter is not RGB", ErrUnsupported)
		}
	}

	var found [3]int
	for i, c := range pattern {
		if c > 2 {
			return fmt.Errorf("%w: colour filter is not RGB", ErrUnsupported)
		}
		r.cfa[i] = int(c)
		found[c]++
	}
	//A Bayer cell has red and blue once and green on one of its diagonals
	if found[0] != 1 || found[1] != 2 || found[2] != 1 || (r.cfa[0] == 1) != (r.cfa[3] == 1) {
		return fmt.Errorf("%w: colour filter is not Bayer", ErrUnsupported)
	}
	return nil
}

// readLevels reads the values the sensor stores for black and for white
func (r *rawImage) readLevels(dir directory) error {
	t := r.file
	//Levels and table values beyond any sensor would overflow the arithmetic
	const maxLevel = 1 << 24
	r.white = float64(int64(1)<<r.bits - 1)
	if w := t.numbers(dir[tagWhiteLevel], 1); len(w) == 1 && w[0] > 0 && w[0] <= maxLevel {
		r.white = w[0]
	}

	r.blackRows, r.blackCols = 1, 1
	if dim := t.uints(dir[tagBlackLevelRepeatDim], 2); len(dim) == 2 {
		if dim[0] < 1 || dim[1] < 1 || dim[0] > 16 || dim[1] > 16 {
			return errors.New("DNG has an invalid black level pattern")
		}
		r.blackRows, r.blackCols = int(dim[0]), int(dim[1])
	}
	r.black = make([]float64, r.blackRows*r.blackCols)
	levels := t.numbers(dir[tagBlackLevel], len(r.black))
	for i := range r.black {
		if len(levels) > 0 {
			r.black[i] = levels[i%len(levels)]
		}
		if r.black[i] >= r.white || r.black[i] < -maxLevel {
			return errors.New("DNG black level is not below its white level")
		}
	}

	r.linearization = t.numbers(dir[tagLinearizationTable], 1<<16)
	if !boundedValues(r.linearization, maxLevel) {
		return errors.New("DNG has an invalid linearization table")
	}
	return nil
}
