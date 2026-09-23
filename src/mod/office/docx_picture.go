package office

/*
	docx_picture.go - turning and mirroring a picture's bitmap

	A DrawingML picture may be rotated by quarter turns or flipped. The
	editor has no notion of a turned picture (a CSS transform would not move
	the text around it), so the import bakes the turn into the bitmap and
	swaps the frame: the picture then lays out, prints and saves as it looks.
*/

import (
	"bytes"
	"image"
	"image/draw"
	_ "image/gif" // decoding of GIF pictures
	"image/jpeg"
	"image/png"
	"math"
)

// pictureTurns reads a DrawingML rotation (60000ths of a degree, clockwise)
// as a count of quarter turns; ok is false for any other angle
func pictureTurns(rot float64) (int, bool) {
	deg := rot / 60000
	q := math.Round(deg / 90)
	if math.Abs(deg-q*90) > 1 {
		return 0, false
	}
	return ((int(q) % 4) + 4) % 4, true
}

// orientPixels mirrors (first) and then turns an image clockwise
func orientPixels(src image.Image, turns int, flipH, flipV bool) *image.NRGBA {
	b := src.Bounds()
	w, h := b.Dx(), b.Dy()
	in := image.NewNRGBA(image.Rect(0, 0, w, h))
	draw.Draw(in, in.Bounds(), src, b.Min, draw.Src)
	ow, oh := w, h
	if turns%2 == 1 {
		ow, oh = h, w
	}
	out := image.NewNRGBA(image.Rect(0, 0, ow, oh))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			sx, sy := x, y
			if flipH {
				sx = w - 1 - x
			}
			if flipV {
				sy = h - 1 - y
			}
			dx, dy := x, y
			switch turns {
			case 1:
				dx, dy = h-1-y, x
			case 2:
				dx, dy = w-1-x, h-1-y
			case 3:
				dx, dy = y, w-1-x
			}
			si := in.PixOffset(sx, sy)
			di := out.PixOffset(dx, dy)
			copy(out.Pix[di:di+4], in.Pix[si:si+4])
		}
	}
	return out
}

// orientPicture re-encodes a picture turned and mirrored as DrawingML asks;
// ok is false when the format cannot be decoded (the picture stays as is)
func orientPicture(data []byte, ext string, turns int, flipH, flipV bool) ([]byte, string, bool) {
	if turns == 0 && !flipH && !flipV {
		return data, ext, true
	}
	img, format, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return data, ext, false
	}
	out := orientPixels(img, turns, flipH, flipV)
	var buf bytes.Buffer
	if format == "jpeg" {
		if err := jpeg.Encode(&buf, out, &jpeg.Options{Quality: 92}); err != nil {
			return data, ext, false
		}
		return buf.Bytes(), "jpeg", true
	}
	if err := png.Encode(&buf, out); err != nil {
		return data, ext, false
	}
	return buf.Bytes(), "png", true
}

// orientInsets moves a crop (top, right, bottom, left) with the bitmap
func orientInsets(in [4]float64, turns int, flipH, flipV bool) [4]float64 {
	t, r, b, l := in[0], in[1], in[2], in[3]
	if flipH {
		l, r = r, l
	}
	if flipV {
		t, b = b, t
	}
	for i := 0; i < turns; i++ {
		// a clockwise turn: the left edge becomes the top
		t, r, b, l = l, t, r, b
	}
	return [4]float64{t, r, b, l}
}
