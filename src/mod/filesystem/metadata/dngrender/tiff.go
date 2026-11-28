package dngrender

import (
	"encoding/binary"
	"errors"
	"math"
)

/*
	The part of TIFF a DNG is built on

	Every offset and count comes from the file, so each one is checked against
	the bytes that are really there, and the directories are walked with a
	visited set: a directory that points back at itself must not loop.
*/

// Tags read from the directories
const (
	tagNewSubfileType      = 254
	tagImageWidth          = 256
	tagImageLength         = 257
	tagBitsPerSample       = 258
	tagCompression         = 259
	tagPhotometric         = 262
	tagStripOffsets        = 273
	tagOrientation         = 274
	tagSamplesPerPixel     = 277
	tagRowsPerStrip        = 278
	tagStripByteCounts     = 279
	tagTileWidth           = 322
	tagTileLength          = 323
	tagTileOffsets         = 324
	tagTileByteCounts      = 325
	tagSubIFDs             = 330
	tagCFARepeatPatternDim = 33421
	tagCFAPattern          = 33422
	tagDNGVersion          = 50706
	tagCFAPlaneColor       = 50710
	tagCFALayout           = 50711
	tagLinearizationTable  = 50712
	tagBlackLevelRepeatDim = 50713
	tagBlackLevel          = 50714
	tagWhiteLevel          = 50717
	tagDefaultCropOrigin   = 50719
	tagDefaultCropSize     = 50720
	tagColorMatrix1        = 50721
	tagColorMatrix2        = 50722
	tagAsShotNeutral       = 50728
	tagAsShotWhiteXY       = 50729
	tagBaselineExposure    = 50730
	tagCalibrationIllum1   = 50778
	tagCalibrationIllum2   = 50779
	tagActiveArea          = 50829
	tagOpcodeList2         = 51009
)

// Limits on what a file may ask the parser to do
const (
	maxDirectories = 32
	maxEntries     = 1024
)

// entry is one directory entry whose value lies inside the file
type entry struct {
	fieldType uint16
	count     int
	value     []byte
}

// directory is one image file directory, by tag
type directory map[uint16]entry

type tiffFile struct {
	data  []byte
	order binary.ByteOrder
}

// Bytes of one value of each TIFF field type, by type number
var typeSizes = [...]int{0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4}

// readDirectories returns every directory of a TIFF file: the main chain and
// the SubIFDs. The first one is IFD0.
func readDirectories(data []byte) (*tiffFile, []directory, error) {
	if len(data) < 8 {
		return nil, nil, errors.New("file too small to be a DNG")
	}
	t := &tiffFile{data: data}
	switch string(data[:2]) {
	case "II":
		t.order = binary.LittleEndian
	case "MM":
		t.order = binary.BigEndian
	default:
		return nil, nil, errors.New("not a TIFF based file")
	}
	if t.order.Uint16(data[2:4]) != 42 {
		return nil, nil, errors.New("not a TIFF based file")
	}

	var directories []directory
	visited := map[uint32]bool{}
	pending := []uint32{t.order.Uint32(data[4:8])}
	for len(pending) > 0 && len(directories) < maxDirectories {
		offset := pending[0]
		pending = pending[1:]
		if offset == 0 || visited[offset] {
			continue
		}
		visited[offset] = true

		dir, next, ok := t.readDirectory(offset)
		if !ok {
			continue
		}
		directories = append(directories, dir)
		for _, sub := range t.uints(dir[tagSubIFDs], maxDirectories) {
			pending = append(pending, uint32(sub))
		}
		pending = append(pending, next)
	}
	if len(directories) == 0 {
		return nil, nil, errors.New("no image directory found")
	}
	return t, directories, nil
}

// readDirectory reads the directory at offset and the offset of the next one
func (t *tiffFile) readDirectory(offset uint32) (directory, uint32, bool) {
	size := int64(len(t.data))
	pos := int64(offset)
	if pos > size-2 {
		return nil, 0, false
	}
	count := int(t.order.Uint16(t.data[pos:]))
	if count == 0 || count > maxEntries {
		return nil, 0, false
	}
	pos += 2

	dir := directory{}
	for i := 0; i < count; i++ {
		if pos > size-12 {
			return dir, 0, true
		}
		raw := t.data[pos : pos+12]
		pos += 12

		tag := t.order.Uint16(raw[0:])
		fieldType := t.order.Uint16(raw[2:])
		n := int64(t.order.Uint32(raw[4:]))
		if int(fieldType) >= len(typeSizes) || fieldType == 0 {
			continue
		}
		length := n * int64(typeSizes[fieldType])
		var value []byte
		if length <= 4 {
			value = raw[8 : 8+length]
		} else {
			start := int64(t.order.Uint32(raw[8:]))
			if length > size || start > size-length {
				continue
			}
			value = t.data[start : start+length]
		}
		dir[tag] = entry{fieldType: fieldType, count: int(n), value: value}
	}

	var next uint32
	if pos <= size-4 {
		next = t.order.Uint32(t.data[pos:])
	}
	return dir, next, true
}

// numbers decodes up to limit values of an entry as floating point
func (t *tiffFile) numbers(e entry, limit int) []float64 {
	n := min(e.count, limit)
	if n <= 0 {
		return nil
	}
	out := make([]float64, n)
	for i := range out {
		switch e.fieldType {
		case 1, 7: // BYTE, UNDEFINED
			out[i] = float64(e.value[i])
		case 6: // SBYTE
			out[i] = float64(int8(e.value[i]))
		case 3: // SHORT
			out[i] = float64(t.order.Uint16(e.value[i*2:]))
		case 8: // SSHORT
			out[i] = float64(int16(t.order.Uint16(e.value[i*2:])))
		case 4, 13: // LONG, IFD
			out[i] = float64(t.order.Uint32(e.value[i*4:]))
		case 9: // SLONG
			out[i] = float64(int32(t.order.Uint32(e.value[i*4:])))
		case 5: // RATIONAL
			if d := t.order.Uint32(e.value[i*8+4:]); d != 0 {
				out[i] = float64(t.order.Uint32(e.value[i*8:])) / float64(d)
			}
		case 10: // SRATIONAL
			if d := int32(t.order.Uint32(e.value[i*8+4:])); d != 0 {
				out[i] = float64(int32(t.order.Uint32(e.value[i*8:]))) / float64(d)
			}
		case 11: // FLOAT
			out[i] = float64(math.Float32frombits(t.order.Uint32(e.value[i*4:])))
		case 12: // DOUBLE
			out[i] = math.Float64frombits(t.order.Uint64(e.value[i*8:]))
		default:
			return nil
		}
		if math.IsNaN(out[i]) || math.IsInf(out[i], 0) {
			out[i] = 0
		}
	}
	return out
}

// uints decodes up to limit values of an entry as non negative integers
func (t *tiffFile) uints(e entry, limit int) []int64 {
	values := t.numbers(e, limit)
	if values == nil {
		return nil
	}
	out := make([]int64, len(values))
	for i, v := range values {
		if v > 0 && v <= math.MaxUint32 {
			out[i] = int64(v)
		}
	}
	return out
}

// uintValue is the first value of a tag, or fallback when the tag is missing
func (t *tiffFile) uintValue(dir directory, tag uint16, fallback int64) int64 {
	if v := t.uints(dir[tag], 1); len(v) == 1 {
		return v[0]
	}
	return fallback
}
