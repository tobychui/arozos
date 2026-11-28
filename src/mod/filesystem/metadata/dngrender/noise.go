package dngrender

import (
	"image"
	"image/color"
)

/*
	Colour noise

	A single raw frame of a small sensor is covered in coloured speckles at
	full resolution, which the camera app removes from its own JPEG. The eye
	takes its detail from brightness, so smoothing only the two colour
	channels removes the speckles without softening the picture. Smaller
	renderings average many sensor pixels and need none of this.
*/

// Reach of the colour smoothing, in pixels of the half size colour channels
const chromaRadius = 3

// smoothChroma converts a picture to YCbCr 4:2:0 and smooths its colour
// channels
func smoothChroma(src *image.RGBA) *image.YCbCr {
	width, height := src.Rect.Dx(), src.Rect.Dy()
	out := image.NewYCbCr(src.Rect, image.YCbCrSubsampleRatio420)
	chromaWidth, chromaHeight := (width+1)/2, (height+1)/2

	parallelRows(chromaHeight, func(from, to int) {
		for cy := from; cy < to; cy++ {
			for cx := 0; cx < chromaWidth; cx++ {
				var cbSum, crSum, n int
				for y := cy * 2; y < min(cy*2+2, height); y++ {
					for x := cx * 2; x < min(cx*2+2, width); x++ {
						p := src.Pix[y*src.Stride+x*4:]
						luma, cb, cr := color.RGBToYCbCr(p[0], p[1], p[2])
						out.Y[y*out.YStride+x] = luma
						cbSum += int(cb)
						crSum += int(cr)
						n++
					}
				}
				out.Cb[cy*out.CStride+cx] = uint8((cbSum + n/2) / n)
				out.Cr[cy*out.CStride+cx] = uint8((crSum + n/2) / n)
			}
		}
	})

	scratch := make([]uint8, len(out.Cb))
	for _, plane := range [][]uint8{out.Cb, out.Cr} {
		//Two box blurs in each direction come close to a Gaussian blur
		for pass := 0; pass < 2; pass++ {
			boxBlur(scratch, plane, chromaHeight, chromaWidth, out.CStride, 1)
			boxBlur(plane, scratch, chromaWidth, chromaHeight, 1, out.CStride)
		}
	}
	return out
}

// boxBlur averages each value with its chromaRadius neighbours on both sides
// along lines of the plane: lines of length values, step apart, the lines
// themselves next apart. Values past an end repeat the end.
func boxBlur(dst, src []uint8, lines, length, next, step int) {
	const window = 2*chromaRadius + 1
	parallelRows(lines, func(from, to int) {
		for line := from; line < to; line++ {
			start := line * next
			at := func(i int) int {
				return int(src[start+max(0, min(length-1, i))*step])
			}
			sum := 0
			for i := -chromaRadius; i <= chromaRadius; i++ {
				sum += at(i)
			}
			for i := 0; i < length; i++ {
				dst[start+i*step] = uint8((sum + window/2) / window)
				sum += at(i+chromaRadius+1) - at(i-chromaRadius)
			}
		}
	})
}
