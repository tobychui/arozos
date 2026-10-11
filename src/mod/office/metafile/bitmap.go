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
)

// maxBitmapPixels bounds a decoded bitmap (width x height)
const maxBitmapPixels = 64 << 20

// DIBToPNG converts a packed DIB (BITMAPINFOHEADER or BITMAPCOREHEADER,
// palette, pixels) into PNG
func DIBToPNG(dib []byte) ([]byte, error) {
	img, _, err := decodePackedDIB(dib, 0)
	if err != nil {
		return nil, err
	}
	return encodePNG(img)
}

// TIFFToPNG converts a TIFF picture into PNG
func TIFFToPNG(data []byte) ([]byte, error) {
	cfg, err := tiff.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || int64(cfg.Width)*int64(cfg.Height) > maxBitmapPixels {
		return nil, errors.New("TIFF picture too large")
	}
	img, err := tiff.Decode(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	return encodePNG(img)
}

func encodePNG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	enc := png.Encoder{CompressionLevel: png.BestSpeed}
	if err := enc.Encode(&buf, img); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
