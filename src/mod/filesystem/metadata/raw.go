package metadata

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/jpeg"
	"path/filepath"
	"strings"

	"github.com/nfnt/resize"
	"github.com/oliamb/cutter"
	"imuslab.com/arozos/mod/filesystem"
)

// Generate thumbnail for RAW image files by extracting embedded JPEG
func generateThumbnailForRAW(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (string, error) {
	if fsh.RequireBuffer {
		return "", errors.New("RAW thumbnail generation not supported for buffered file systems")
	}

	fshAbs := fsh.FileSystemAbstraction

	// Check file size - skip files larger than 100MB to prevent memory issues
	fileSize := fshAbs.GetFileSize(file)
	if fileSize > (100 << 20) {
		return "", errors.New("RAW file too large (>100MB)")
	}

	// Read the RAW file
	rawData, err := fshAbs.ReadFile(file)
	if err != nil {
		return "", errors.New("failed to read RAW file: " + err.Error())
	}

	// Try to decode the RAW image
	var img image.Image
	var jpegData []byte

	ext := filepath.Ext(file)
	if strings.ToLower(ext) == ".dng" {
		// For DNG files, try both marker scanning and TIFF IFD parsing
		// Then use the largest JPEG found
		jpegFromMarkers, err1 := extractLargestJPEG(rawData)
		jpegFromTIFF, err2 := extractJPEGFromTIFF(rawData)

		// Use whichever is largest
		if err1 == nil && err2 == nil {
			if len(jpegFromMarkers) > len(jpegFromTIFF) {
				jpegData = jpegFromMarkers
			} else {
				jpegData = jpegFromTIFF
			}
		} else if err1 == nil {
			jpegData = jpegFromMarkers
		} else if err2 == nil {
			jpegData = jpegFromTIFF
		} else {
			return "", errors.New("failed to extract any JPEG from DNG file: " + err1.Error() + "; " + err2.Error())
		}

		img, _, err = image.Decode(bytes.NewReader(jpegData))
		if err != nil {
			return "", errors.New("failed to decode DNG JPEG data: " + err.Error())
		}
	} else {
		// For other RAW formats (ARW, CR2, NEF, RAF, ORF), only use marker scanning
		jpegData, err = extractLargestJPEG(rawData)
		if err != nil {
			return "", errors.New("failed to extract thumbnail from RAW file: " + err.Error())
		}
		img, _, err = image.Decode(bytes.NewReader(jpegData))
		if err != nil {
			return "", errors.New("failed to decode extracted thumbnail: " + err.Error())
		}
	}

	// Resize and crop to match standard thumbnail size (480x480 square)
	// Strategy: Resize so the SMALLER dimension is 480, ensuring both dimensions >= 480
	// Then crop to 480x480 from center (object-fit: cover behavior)
	b := img.Bounds()
	imgWidth := b.Max.X
	imgHeight := b.Max.Y

	var m image.Image
	if imgWidth < imgHeight {
		// Portrait or tall image: set width to 480, height will be larger
		m = resize.Resize(480, 0, img, resize.Lanczos3)
	} else if imgHeight < imgWidth {
		// Landscape or wide image: set height to 480, width will be larger
		m = resize.Resize(0, 480, img, resize.Lanczos3)
	} else {
		// Square image: resize to 480x480
		m = resize.Resize(480, 480, img, resize.Lanczos3)
	}

	// Crop out the center to create square thumbnail
	croppedImg, err := cutter.Crop(m, cutter.Config{
		Width:  480,
		Height: 480,
		Mode:   cutter.Centered,
	})
	if err != nil {
		return "", errors.New("failed to crop thumbnail: " + err.Error())
	}

	// Create the thumbnail file with the full filename + .jpg
	// e.g., DSC02977.ARW.jpg
	outputPath := cacheFolder + filepath.Base(file) + ".jpg"
	out, err := fshAbs.Create(outputPath)
	if err != nil {
		return "", err
	}
	defer out.Close()

	// Write JPEG thumbnail
	err = jpeg.Encode(out, croppedImg, &jpeg.Options{Quality: 90})
	if err != nil {
		return "", err
	}

	if !generateOnly {
		// Return the image as base64
		ctx, err := getImageAsBase64(fsh, outputPath)
		return ctx, err
	}

	return "", nil
}

// Extract largest embedded JPEG from RAW file
// Most RAW files (ARW, CR2, DNG, NEF, etc.) are TIFF-based and contain embedded JPEG previews
// This follows the approach used by dcraw.c for thumbnail extraction
func extractLargestJPEG(data []byte) ([]byte, error) {
	// JPEG markers
	jpegSOI := []byte{0xFF, 0xD8} // Start of Image (SOI)
	jpegEOI := []byte{0xFF, 0xD9} // End of Image (EOI)

	// Find all embedded JPEGs
	type jpegCandidate struct {
		data   []byte
		offset int
		width  int
		height int
		pixels int
	}
	var candidates []jpegCandidate
	searchStart := 0

	for searchStart < len(data)-1 {
		// Find JPEG start marker (0xFF 0xD8)
		startIdx := bytes.Index(data[searchStart:], jpegSOI)
		if startIdx == -1 {
			break // No more JPEGs
		}
		startIdx += searchStart

		// Find JPEG end marker (0xFF 0xD9)
		// Search from after the SOI marker
		searchEnd := startIdx + 2
		endIdx := -1

		for searchEnd < len(data)-1 {
			if data[searchEnd] == jpegEOI[0] && data[searchEnd+1] == jpegEOI[1] {
				endIdx = searchEnd + 2 // Include the EOI marker
				break
			}
			searchEnd++
		}

		if endIdx == -1 || endIdx <= startIdx {
			// No valid end marker found, try next SOI
			searchStart = startIdx + 2
			continue
		}

		// Extract the JPEG data
		jpegData := data[startIdx:endIdx]

		// Validate this is a real JPEG by decoding its header
		// This also gives us the dimensions
		cfg, format, err := image.DecodeConfig(bytes.NewReader(jpegData))
		if err == nil && format == "jpeg" && cfg.Width > 0 && cfg.Height > 0 {
			candidates = append(candidates, jpegCandidate{
				data:   jpegData,
				offset: startIdx,
				width:  cfg.Width,
				height: cfg.Height,
				pixels: cfg.Width * cfg.Height,
			})
		}

		// Continue searching from after this JPEG
		searchStart = endIdx
	}

	if len(candidates) == 0 {
		return nil, errors.New("no valid embedded JPEG found in RAW file")
	}

	// Find the largest JPEG by pixel count
	// DNG files often have multiple JPEGs: small thumbnail, medium preview, large preview
	largestIdx := 0
	largestPixels := 0

	for i, candidate := range candidates {
		if candidate.pixels > largestPixels {
			largestPixels = candidate.pixels
			largestIdx = i
		}
	}

	return candidates[largestIdx].data, nil
}

// Extract JPEG data from TIFF/DNG file with JPEG compression
// This handles DNG files where the main image is JPEG-compressed within TIFF structure
// Based on dcraw.c approach for parsing TIFF IFDs
func extractJPEGFromTIFF(data []byte) ([]byte, error) {
	if len(data) < 8 {
		return nil, errors.New("file too small to be valid TIFF")
	}

	// Check TIFF byte order
	var order binary.ByteOrder
	if data[0] == 'I' && data[1] == 'I' {
		order = binary.LittleEndian
	} else if data[0] == 'M' && data[1] == 'M' {
		order = binary.BigEndian
	} else {
		return nil, errors.New("invalid TIFF byte order marker")
	}

	// Verify TIFF magic number (42)
	magic := order.Uint16(data[2:4])
	if magic != 42 {
		return nil, errors.New("invalid TIFF magic number")
	}

	// Get offset to first IFD
	ifdOffset := order.Uint32(data[4:8])

	// Parse all IFDs to find JPEG-compressed image data
	// DNG files often have multiple IFDs, we want the largest JPEG
	var candidates [][]byte
	parseTIFFIFDChain(data, order, uint64(ifdOffset), &candidates)

	if len(candidates) == 0 {
		// No JPEG found - try to extract uncompressed thumbnail from IFD#0
		// This handles DNG files with compression=1 (uncompressed)
		return extractUncompressedThumbnail(data, order, uint64(ifdOffset))
	}

	// Return the largest JPEG by byte size
	largestIdx := 0
	largestSize := len(candidates[0])
	for i, candidate := range candidates {
		if len(candidate) > largestSize {
			largestSize = len(candidate)
			largestIdx = i
		}
	}

	return candidates[largestIdx], nil
}

// Extract uncompressed thumbnail from TIFF (fallback for DNG with compression=1)
func extractUncompressedThumbnail(data []byte, order binary.ByteOrder, ifdOffset uint64) ([]byte, error) {
	if ifdOffset >= uint64(len(data))-2 {
		return nil, errors.New("IFD offset out of bounds")
	}

	// Read IFD entries to find width, height, strip offset, strip byte count
	numEntries := order.Uint16(data[ifdOffset : ifdOffset+2])
	entryOffset := ifdOffset + 2

	var width, height uint32
	var stripOffset, stripByteCount uint64
	var compression, photometric uint16

	for i := 0; i < int(numEntries); i++ {
		if entryOffset+12 > uint64(len(data)) {
			break
		}

		tag := order.Uint16(data[entryOffset : entryOffset+2])
		fieldType := order.Uint16(data[entryOffset+2 : entryOffset+4])
		valueOffset := entryOffset + 8

		switch tag {
		case 0x0100: // ImageWidth
			width = readIFDValue(data, order, fieldType, valueOffset)
		case 0x0101: // ImageLength
			height = readIFDValue(data, order, fieldType, valueOffset)
		case 0x0103: // Compression
			compression = uint16(readIFDValue(data, order, fieldType, valueOffset))
		case 0x0106: // PhotometricInterpretation
			photometric = uint16(readIFDValue(data, order, fieldType, valueOffset))
		case 0x0111: // StripOffsets
			stripOffset = uint64(readIFDValue(data, order, fieldType, valueOffset))
		case 0x0117: // StripByteCounts
			stripByteCount = uint64(readIFDValue(data, order, fieldType, valueOffset))
		}

		entryOffset += 12
	}

	// Validate we have the necessary data
	if width == 0 || height == 0 || stripOffset == 0 || stripByteCount == 0 {
		return nil, errors.New("incomplete TIFF metadata for uncompressed thumbnail")
	}

	// Only handle uncompressed RGB (compression=1, photometric=2)
	if compression != 1 || photometric != 2 {
		return nil, errors.New("unsupported compression or photometric interpretation")
	}

	// Extract the RGB strip data
	if stripOffset+stripByteCount > uint64(len(data)) {
		return nil, errors.New("strip data extends beyond file")
	}

	stripData := data[stripOffset : stripOffset+stripByteCount]

	// Decode RGB strip to image.Image
	img := image.NewRGBA(image.Rect(0, 0, int(width), int(height)))
	expectedSize := int(width * height * 3)
	if len(stripData) < expectedSize {
		return nil, errors.New("strip data smaller than expected")
	}

	// Copy RGB data to RGBA image
	for y := 0; y < int(height); y++ {
		for x := 0; x < int(width); x++ {
			srcIdx := (y*int(width) + x) * 3
			dstIdx := (y*int(width) + x) * 4
			img.Pix[dstIdx] = stripData[srcIdx]     // R
			img.Pix[dstIdx+1] = stripData[srcIdx+1] // G
			img.Pix[dstIdx+2] = stripData[srcIdx+2] // B
			img.Pix[dstIdx+3] = 255                 // A
		}
	}

	// Encode as JPEG
	var buf bytes.Buffer
	err := jpeg.Encode(&buf, img, &jpeg.Options{Quality: 90})
	if err != nil {
		return nil, errors.New("failed to encode uncompressed thumbnail as JPEG: " + err.Error())
	}

	return buf.Bytes(), nil
}

// Parse TIFF IFD chain recursively to find all JPEG data
// DNG files have multiple IFDs linked together and SubIFDs
func parseTIFFIFDChain(data []byte, order binary.ByteOrder, ifdOffset uint64, candidates *[][]byte) {
	if ifdOffset == 0 || ifdOffset >= uint64(len(data))-2 {
		return
	}

	// Read number of directory entries
	numEntries := order.Uint16(data[ifdOffset : ifdOffset+2])
	entryOffset := ifdOffset + 2

	var stripOffsets []uint64
	var stripByteCounts []uint64
	var compression uint16
	var subIFDOffsets []uint64

	// Read IFD entries
	for i := 0; i < int(numEntries); i++ {
		if entryOffset+12 > uint64(len(data)) {
			break
		}

		tag := order.Uint16(data[entryOffset : entryOffset+2])
		fieldType := order.Uint16(data[entryOffset+2 : entryOffset+4])
		count := order.Uint32(data[entryOffset+4 : entryOffset+8])
		valueOffset := entryOffset + 8

		switch tag {
		case 0x002E: // Tag 46 - Direct JPEG thumbnail (dcraw approach)
			// Check if data at this offset starts with JPEG marker (0xFF 0xD8)
			// Count is the length of the JPEG data
			if count > 4 && count < uint32(len(data)) {
				// If count > 4, the value offset points to the actual data
				var jpegOffset uint64
				if count*getSizeForType(fieldType) > 4 {
					jpegOffset = uint64(order.Uint32(data[valueOffset : valueOffset+4]))
				} else {
					jpegOffset = valueOffset
				}

				if jpegOffset+uint64(count) <= uint64(len(data)) {
					// Verify JPEG marker
					if data[jpegOffset] == 0xFF && data[jpegOffset+1] == 0xD8 {
						jpegData := data[jpegOffset : jpegOffset+uint64(count)]
						*candidates = append(*candidates, jpegData)
					}
				}
			}
		case 0x0103: // Compression
			compression = uint16(readIFDValue(data, order, fieldType, valueOffset))
		case 0x0111: // StripOffsets
			stripOffsets = readIFDArray(data, order, fieldType, count, valueOffset)
		case 0x0117: // StripByteCounts
			stripByteCounts = readIFDArray(data, order, fieldType, count, valueOffset)
		case 0x014A: // SubIFD tag - points to child IFDs
			subIFDOffsets = readIFDArray(data, order, fieldType, count, valueOffset)
		case 0x0201: // JPEGInterchangeFormat - direct JPEG offset
			jpegOffset := uint64(readIFDValue(data, order, fieldType, valueOffset))
			// Also get JPEGInterchangeFormatLength (tag 0x0202)
			// We'll handle this in the next iteration if present
			if jpegOffset > 0 && jpegOffset < uint64(len(data)) {
				// Look for the length in remaining entries
				for j := i + 1; j < int(numEntries); j++ {
					nextEntryOffset := ifdOffset + 2 + uint64(j*12)
					if nextEntryOffset+12 > uint64(len(data)) {
						break
					}
					nextTag := order.Uint16(data[nextEntryOffset : nextEntryOffset+2])
					if nextTag == 0x0202 { // JPEGInterchangeFormatLength
						nextFieldType := order.Uint16(data[nextEntryOffset+2 : nextEntryOffset+4])
						nextValueOffset := nextEntryOffset + 8
						jpegLength := uint64(readIFDValue(data, order, nextFieldType, nextValueOffset))
						if jpegOffset+jpegLength <= uint64(len(data)) {
							jpegData := data[jpegOffset : jpegOffset+jpegLength]
							*candidates = append(*candidates, jpegData)
						}
						break
					}
				}
			}
		}

		entryOffset += 12
	}

	// If this IFD has JPEG-compressed strips, extract them
	if compression == 6 || compression == 7 {
		if len(stripOffsets) > 0 && len(stripByteCounts) > 0 {
			var jpegData bytes.Buffer
			for i := 0; i < len(stripOffsets) && i < len(stripByteCounts); i++ {
				offset := stripOffsets[i]
				length := stripByteCounts[i]
				if offset+length <= uint64(len(data)) {
					jpegData.Write(data[offset : offset+length])
				}
			}
			if jpegData.Len() > 0 {
				// Validate JPEG data
				jpegBytes := jpegData.Bytes()
				if len(jpegBytes) >= 2 && jpegBytes[0] == 0xFF && jpegBytes[1] == 0xD8 {
					*candidates = append(*candidates, jpegBytes)
				}
			}
		}
	}

	// Process SubIFDs (child IFDs)
	for _, subOffset := range subIFDOffsets {
		parseTIFFIFDChain(data, order, subOffset, candidates)
	}

	// Get next IFD in chain (offset is after all entries)
	nextIFDOffset := entryOffset
	if nextIFDOffset+4 <= uint64(len(data)) {
		nextIFD := order.Uint32(data[nextIFDOffset : nextIFDOffset+4])
		if nextIFD > 0 {
			parseTIFFIFDChain(data, order, uint64(nextIFD), candidates)
		}
	}
}

// Read a single IFD value
func readIFDValue(data []byte, order binary.ByteOrder, fieldType uint16, offset uint64) uint32 {
	if offset+4 > uint64(len(data)) {
		return 0
	}

	switch fieldType {
	case 3: // SHORT
		return uint32(order.Uint16(data[offset : offset+2]))
	case 4: // LONG
		return order.Uint32(data[offset : offset+4])
	default:
		return order.Uint32(data[offset : offset+4])
	}
}

// Read an array of IFD values
func readIFDArray(data []byte, order binary.ByteOrder, fieldType uint16, count uint32, valueOffset uint64) []uint64 {
	var result []uint64

	// If count * size <= 4, values are stored inline
	// Otherwise, valueOffset contains pointer to actual data
	var dataOffset uint64
	valueSize := uint32(4)
	if fieldType == 3 {
		valueSize = 2
	}

	if count*valueSize <= 4 {
		dataOffset = valueOffset
	} else {
		if valueOffset+4 > uint64(len(data)) {
			return result
		}
		dataOffset = uint64(order.Uint32(data[valueOffset : valueOffset+4]))
	}

	for i := uint32(0); i < count; i++ {
		offset := dataOffset + uint64(i*valueSize)
		if offset+uint64(valueSize) > uint64(len(data)) {
			break
		}

		var value uint64
		if fieldType == 3 { // SHORT
			value = uint64(order.Uint16(data[offset : offset+2]))
		} else { // LONG
			value = uint64(order.Uint32(data[offset : offset+4]))
		}
		result = append(result, value)
	}

	return result
}

// Get size in bytes for TIFF field type
// Based on TIFF spec and dcraw.c logic
func getSizeForType(fieldType uint16) uint32 {
	// Type sizes: BYTE=1, ASCII=1, SHORT=2, LONG=4, RATIONAL=8, etc.
	// dcraw uses: "11124811248484"[type]-'0'
	typeSizes := []uint32{0, 1, 1, 2, 4, 8, 1, 1, 2, 4, 8, 4, 8, 4}
	if fieldType < uint16(len(typeSizes)) {
		return typeSizes[fieldType]
	}
	return 1
}

// Render full-size RAW image as JPEG for media serving
func RenderRAWImage(fsh *filesystem.FileSystemHandler, file string) ([]byte, error) {
	if fsh.RequireBuffer {
		return nil, errors.New("RAW image rendering not supported for buffered file systems")
	}

	fshAbs := fsh.FileSystemAbstraction

	// Check file size - skip files larger than 100MB to prevent memory issues
	fileSize := fshAbs.GetFileSize(file)
	if fileSize > (100 << 20) {
		return nil, errors.New("RAW file too large (>100MB)")
	}

	// Read the RAW file
	rawData, err := fshAbs.ReadFile(file)
	if err != nil {
		return nil, errors.New("failed to read RAW file: " + err.Error())
	}

	ext := filepath.Ext(file)
	if strings.ToLower(ext) == ".dng" {
		// For DNG files, try both marker scanning and TIFF IFD parsing
		// Then use the largest JPEG found
		jpegFromMarkers, err1 := extractLargestJPEG(rawData)
		jpegFromTIFF, err2 := extractJPEGFromTIFF(rawData)

		// Use whichever is largest
		var jpegData []byte
		if err1 == nil && err2 == nil {
			if len(jpegFromMarkers) > len(jpegFromTIFF) {
				jpegData = jpegFromMarkers
			} else {
				jpegData = jpegFromTIFF
			}
		} else if err1 == nil {
			jpegData = jpegFromMarkers
		} else if err2 == nil {
			jpegData = jpegFromTIFF
		} else {
			return nil, errors.New("failed to extract any JPEG from DNG file: " + err1.Error() + "; " + err2.Error())
		}

		return jpegData, nil
	}

	// For other RAW formats (ARW, CR2, NEF, RAF, ORF), use marker scanning
	jpegData, err := extractLargestJPEG(rawData)
	if err != nil {
		return nil, errors.New("failed to extract image from RAW file: " + err.Error())
	}

	// Return the JPEG data directly without re-encoding
	// This preserves the original JPEG quality and is much faster
	return jpegData, nil
}
