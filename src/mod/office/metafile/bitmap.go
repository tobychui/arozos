package metafile

/*
	bitmap.go - bitmap formats a browser cannot draw.

	Office 97-2003 files store bitmaps as bare DIBs (a BITMAPINFO header
	and the pixels, no file header) and sometimes as TIFF. Neither shows
	in a browser, so the importers turn them into PNG here, reusing the
	DIB decoder the metafile player already has.
*/

import (
	"bytes"
	"errors"
	"image"
	"image/png"

	"golang.org/x/image/tiff"

	"imuslab.com/arozos/mod/info/logger"
)

// maxBitmapPixels bounds a decoded bitmap (width x height)
const maxBitmapPixels = 64 << 20

// DIBToPNG converts a packed DIB (BITMAPINFOHEADER or BITMAPCOREHEADER,
// palette, pixels) into PNG
func DIBToPNG(dib []byte) (out0 []byte, out1 error) {
	defer logger.Out2(logger.In1("office/metafile", "DIBToPNG", "dib", dib), &out0, &out1)
	img, _, err := decodePackedDIB(dib, 0)
	if err != nil {
		logger.DebugErr("office/metafile", err)
		return nil, err
	}
	return encodePNG(img)
}

// TIFFToPNG converts a TIFF picture into PNG
func TIFFToPNG(data []byte) (out0 []byte, out1 error) {
	defer logger.Out2(logger.In1("office/metafile", "TIFFToPNG", "data", data), &out0, &out1)
	cfg, err := tiff.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		logger.DebugErr("office/metafile", err)
		return nil, err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > maxBitmapPixels {
		return nil, errors.New("TIFF picture too large")
	}
	img, err := tiff.Decode(bytes.NewReader(data))
	if err != nil {
		logger.DebugErr("office/metafile", err)
		return nil, err
	}
	return encodePNG(img)
}

func encodePNG(img image.Image) ([]byte, error) {
	logger.DebugTrace("office/metafile", "encodePNG")
	var buf bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(&buf, img); err != nil {
		logger.DebugErr("office/metafile", err)
		return nil, err
	}
	return buf.Bytes(), nil
}
