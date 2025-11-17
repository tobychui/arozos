package metadata

import (
	"encoding/binary"
	"fmt"
	"os"
	"testing"
)

// Test DNG file parsing
func TestDNGParsing(t *testing.T) {
	files := []string{
		"../../../L1004220.DNG",
		"../../../DSC00360.dng",
		"../../../PXL_20221216_222438616.dng",
	}

	for _, filename := range files {
		if _, err := os.Stat(filename); os.IsNotExist(err) {
			t.Logf("Skipping %s (not found)", filename)
			continue
		}

		t.Logf("\n========== Testing %s ==========", filename)
		data, err := os.ReadFile(filename)
		if err != nil {
			t.Errorf("Failed to read %s: %v", filename, err)
			continue
		}

		t.Logf("File size: %d bytes", len(data))

		// Test marker scanning
		jpegFromMarkers, err := extractLargestJPEG(data)
		if err != nil {
			t.Logf("Marker scan failed: %v", err)
		} else {
			t.Logf("Marker scan found JPEG: %d bytes", len(jpegFromMarkers))
		}

		// Test TIFF IFD parsing with debug output
		debugParseTIFF(t, data)

		// Test extractJPEGFromTIFF
		jpegFromTIFF, err := extractJPEGFromTIFF(data)
		if err != nil {
			t.Logf("TIFF IFD extraction failed: %v", err)
		} else {
			t.Logf("TIFF IFD extraction found JPEG: %d bytes", len(jpegFromTIFF))
		}
	}
}

func debugParseTIFF(t *testing.T, data []byte) {
	if len(data) < 8 {
		t.Log("File too small to be TIFF")
		return
	}

	// Check byte order
	var order binary.ByteOrder
	if data[0] == 'I' && data[1] == 'I' {
		order = binary.LittleEndian
		t.Log("Byte order: Little-endian (II)")
	} else if data[0] == 'M' && data[1] == 'M' {
		order = binary.BigEndian
		t.Log("Byte order: Big-endian (MM)")
	} else {
		t.Logf("Invalid TIFF byte order: %02X %02X", data[0], data[1])
		return
	}

	// Verify magic number
	magic := order.Uint16(data[2:4])
	if magic != 42 {
		t.Logf("Invalid TIFF magic number: %d (expected 42)", magic)
		return
	}
	t.Log("Magic number: 42 (valid TIFF)")

	// Get first IFD offset
	ifdOffset := order.Uint32(data[4:8])
	t.Logf("First IFD offset: 0x%X (%d)", ifdOffset, ifdOffset)

	// Parse IFD chain with debug output
	ifdNum := 0
	visited := make(map[uint32]bool)
	for ifdOffset != 0 {
		if visited[ifdOffset] {
			t.Logf("IFD loop detected at offset 0x%X", ifdOffset)
			break
		}
		visited[ifdOffset] = true

		t.Logf("\n--- IFD #%d at offset 0x%X ---", ifdNum, ifdOffset)
		nextIFD := debugParseIFD(t, data, order, uint64(ifdOffset), 0)
		ifdOffset = uint32(nextIFD)
		ifdNum++

		if ifdNum > 20 {
			t.Log("Too many IFDs, stopping")
			break
		}
	}
}

func debugParseIFD(t *testing.T, data []byte, order binary.ByteOrder, ifdOffset uint64, depth int) uint64 {
	if ifdOffset >= uint64(len(data))-2 {
		t.Logf("IFD offset out of bounds: 0x%X", ifdOffset)
		return 0
	}

	indent := ""
	for i := 0; i < depth; i++ {
		indent += "  "
	}

	numEntries := order.Uint16(data[ifdOffset : ifdOffset+2])
	t.Logf("%sNumber of entries: %d", indent, numEntries)

	if numEntries > 512 {
		t.Logf("%sToo many entries, skipping", indent)
		return 0
	}

	entryOffset := ifdOffset + 2

	// Track important tags
	var compression uint16
	var width, height uint32
	var subIFDs []uint64

	for i := 0; i < int(numEntries); i++ {
		if entryOffset+12 > uint64(len(data)) {
			break
		}

		tag := order.Uint16(data[entryOffset : entryOffset+2])
		fieldType := order.Uint16(data[entryOffset+2 : entryOffset+4])
		count := order.Uint32(data[entryOffset+4 : entryOffset+8])
		valueOffset := entryOffset + 8

		// Get value
		var value uint64
		typeSize := getSizeForType(fieldType)
		if count*typeSize <= 4 {
			// Value is inline
			if fieldType == 3 { // SHORT
				value = uint64(order.Uint16(data[valueOffset : valueOffset+2]))
			} else if fieldType == 4 { // LONG
				value = uint64(order.Uint32(data[valueOffset : valueOffset+4]))
			}
		} else {
			// Value is a pointer
			value = uint64(order.Uint32(data[valueOffset : valueOffset+4]))
		}

		tagName := getTagName(tag)
		t.Logf("%s  Tag 0x%04X (%s): type=%d count=%d value=0x%X", indent, tag, tagName, fieldType, count, value)

		switch tag {
		case 0x0100: // ImageWidth
			width = uint32(value)
		case 0x0101: // ImageLength
			height = uint32(value)
		case 0x0103: // Compression
			compression = uint16(value)
			t.Logf("%s    -> Compression type: %d", indent, compression)
		case 0x002E: // Tag 46 - JPEG preview
			t.Logf("%s    -> Tag 46 detected! JPEG at 0x%X, length %d", indent, value, count)
		case 0x0111: // StripOffsets
			t.Logf("%s    -> StripOffsets found", indent)
		case 0x0117: // StripByteCounts
			t.Logf("%s    -> StripByteCounts found", indent)
		case 0x0201: // JPEGInterchangeFormat
			t.Logf("%s    -> JPEGInterchangeFormat at 0x%X", indent, value)
		case 0x0202: // JPEGInterchangeFormatLength
			t.Logf("%s    -> JPEGInterchangeFormatLength: %d bytes", indent, value)
		case 0x014A: // SubIFD
			t.Logf("%s    -> SubIFD pointer found", indent)
			// Read SubIFD offsets
			if count*typeSize > 4 {
				dataOffset := value
				for j := uint32(0); j < count; j++ {
					offset := dataOffset + uint64(j*4)
					if offset+4 <= uint64(len(data)) {
						subOffset := uint64(order.Uint32(data[offset : offset+4]))
						subIFDs = append(subIFDs, subOffset)
						t.Logf("%s      SubIFD[%d] at 0x%X", indent, j, subOffset)
					}
				}
			}
		}

		entryOffset += 12
	}

	if width > 0 || height > 0 {
		t.Logf("%sImage dimensions: %dx%d, compression=%d", indent, width, height, compression)
	}

	// Parse SubIFDs
	for i, subOffset := range subIFDs {
		t.Logf("%s\n%s--- SubIFD #%d at 0x%X ---", indent, indent, i, subOffset)
		debugParseIFD(t, data, order, subOffset, depth+1)
	}

	// Get next IFD offset
	nextIFDOffset := entryOffset
	if nextIFDOffset+4 <= uint64(len(data)) {
		nextIFD := order.Uint32(data[nextIFDOffset : nextIFDOffset+4])
		if nextIFD > 0 {
			t.Logf("%sNext IFD at 0x%X", indent, nextIFD)
		}
		return uint64(nextIFD)
	}

	return 0
}

func getTagName(tag uint16) string {
	names := map[uint16]string{
		0x002E: "JPEGPreview",
		0x0100: "ImageWidth",
		0x0101: "ImageLength",
		0x0103: "Compression",
		0x0111: "StripOffsets",
		0x0117: "StripByteCounts",
		0x014A: "SubIFD",
		0x0201: "JPEGInterchangeFormat",
		0x0202: "JPEGInterchangeFormatLength",
		0x0106: "PhotometricInterpretation",
		0x010E: "ImageDescription",
		0x010F: "Make",
		0x0110: "Model",
		0x0112: "Orientation",
	}
	if name, ok := names[tag]; ok {
		return name
	}
	return "Unknown"
}
