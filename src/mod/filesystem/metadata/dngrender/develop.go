package dngrender

import (
	"errors"
	"image"
	"runtime"
	"sync"
)

/*
	Development pipeline

	1. Unpack the mosaic and scale it to 0..1 between black and white level,
	   apply the lens shading gains and the white balance
	2. Demosaic: Malvar-He-Cutler at full resolution, or the average of each
	   block of 2x2 cells for a smaller picture
	3. Colour matrix, exposure, tone curve and orientation
	4. At full resolution, smooth the colour noise (noise.go)
*/

// Develop renders the raw data of a DNG as it is shown, upright.
//
// With minShortSide 0 the picture has the full resolution. Otherwise it is
// scaled down by an even factor, as far as its shorter side stays at least
// minShortSide pixels, which is much faster. A picture too small to be halved
// keeps its full resolution.
func Develop(data []byte, minShortSide int) (image.Image, error) {
	r, err := parse(data)
	if err != nil {
		return nil, err
	}
	plane, err := r.loadPlane()
	if err != nil {
		return nil, err
	}

	//Number of Bayer cells averaged along each side of an output pixel
	cells := 0
	if minShortSide > 0 {
		cells = min(r.crop.width, r.crop.height) / 2 / minShortSide
	}
	if cells == 0 {
		return smoothChroma(r.render(r.demosaicRows(plane), r.crop.width, r.crop.height)), nil
	}
	width, height := r.crop.width/(2*cells), r.crop.height/(2*cells)
	return r.render(r.binnedRows(plane, cells, width), width, height), nil
}

// parallelRows splits the rows 0..height between the processors
func parallelRows(height int, work func(from, to int)) {
	workers := min(runtime.GOMAXPROCS(0), height)
	var wg sync.WaitGroup
	for i := 0; i < workers; i++ {
		wg.Add(1)
		go func(from, to int) {
			defer wg.Done()
			work(from, to)
		}(i*height/workers, (i+1)*height/workers)
	}
	wg.Wait()
}

// planeScale is the value of a white pixel in the plane. White balance gains
// push values past white, they are clipped there.
const planeScale = 1<<16 - 1

// loadPlane unpacks the active area of the mosaic into white balanced values
// between 0 and planeScale
func (r *rawImage) loadPlane() ([]uint16, error) {
	data := r.file.data

	//Check every tile before allocating anything
	rowBytes := (int64(r.tileWidth)*int64(r.bits) + 7) / 8
	across := (r.width + r.tileWidth - 1) / r.tileWidth
	for i := range r.offsets {
		rows := min(r.tileHeight, r.height-(i/across)*r.tileHeight)
		need := rowBytes * int64(rows)
		if r.counts[i] < need || need > int64(len(data)) || r.offsets[i] > int64(len(data))-need {
			return nil, errors.New("DNG raw data is truncated")
		}
	}

	width, height := r.active.width, r.active.height
	plane := make([]uint16, width*height)
	parallelRows(height, func(from, to int) {
		stored := make([]uint16, r.width)
		row := make([]float32, width)
		for y := from; y < to; y++ {
			r.readStoredRow(r.active.top+y, stored)

			for x := range row {
				value := float64(stored[r.active.left+x])
				if n := len(r.linearization); n > 0 {
					value = r.linearization[min(int(value), n-1)]
				}
				black := r.black[(y%r.blackRows)*r.blackCols+x%r.blackCols]
				row[x] = float32(max(0, (value-black)/(r.white-black)))
			}
			for i := range r.gainMaps {
				r.gainMaps[i].applyRow(row, y, width, height)
			}

			out := plane[y*width : (y+1)*width]
			for x, v := range row {
				v *= float32(r.colour.multipliers[r.cfa[(y&1)*2+x&1]])
				out[x] = uint16(max(0, min(1, v))*planeScale + 0.5)
			}
		}
	})
	return plane, nil
}

// readStoredRow unpacks row y of the stored mosaic. loadPlane has checked that
// every tile holds its rows.
func (r *rawImage) readStoredRow(y int, out []uint16) {
	data := r.file.data
	across := (r.width + r.tileWidth - 1) / r.tileWidth
	rowBytes := (r.tileWidth*r.bits + 7) / 8
	for column := 0; column < across; column++ {
		tile := (y/r.tileHeight)*across + column
		start := int(r.offsets[tile]) + (y%r.tileHeight)*rowBytes
		src := data[start : start+rowBytes]

		x := column * r.tileWidth
		dst := out[x:min(x+r.tileWidth, r.width)]
		switch r.bits {
		case 16:
			for i := range dst {
				dst[i] = r.file.order.Uint16(src[i*2:])
			}
		case 8:
			for i := range dst {
				dst[i] = uint16(src[i])
			}
		default:
			//Packed samples, most significant bit first
			var buffer uint32
			bits, next := 0, 0
			for i := range dst {
				for bits < r.bits {
					buffer = buffer<<8 | uint32(src[next])
					next++
					bits += 8
				}
				bits -= r.bits
				dst[i] = uint16(buffer>>bits) & (1<<r.bits - 1)
			}
		}
	}
}

// rowSource fills rgb (3 values a pixel, 0 to planeScale) with row y of the
// picture before orientation
type rowSource func(y int, rgb []float32)

// binnedRows averages blocks of cells x cells Bayer cells into one pixel
func (r *rawImage) binnedRows(plane []uint16, cells, width int) rowSource {
	stride := r.active.width
	block := 2 * cells
	return func(y int, rgb []float32) {
		top := r.crop.top + y*block
		for x := 0; x < width; x++ {
			left := r.crop.left + x*block
			var sum [3]uint64
			var count [3]uint64
			for by := top; by < top+block; by++ {
				row := plane[by*stride+left : by*stride+left+block]
				for i, v := range row {
					c := r.cfa[(by&1)*2+(left+i)&1]
					sum[c] += uint64(v)
					count[c]++
				}
			}
			for c := range sum {
				rgb[x*3+c] = float32(sum[c]) / float32(count[c])
			}
		}
	}
}

// reflect keeps a coordinate inside 0..n-1 by mirroring at the edges, which
// preserves its colour in the mosaic
func reflect(i, n int) int {
	if i < 0 {
		return -i
	}
	if i >= n {
		return 2*n - 2 - i
	}
	return i
}

// demosaicRows rebuilds the two missing colours of every pixel with the
// gradient corrected filters of Malvar, He and Cutler
func (r *rawImage) demosaicRows(plane []uint16) rowSource {
	width, height := r.active.width, r.active.height
	return func(y int, rgb []float32) {
		py := r.crop.top + y
		var lines [5][]uint16
		for i := range lines {
			line := reflect(py+i-2, height)
			lines[i] = plane[line*width : (line+1)*width]
		}

		for x := 0; x < r.crop.width; x++ {
			px := r.crop.left + x
			xm2, xm1, xp1, xp2 := px-2, px-1, px+1, px+2
			if xm2 < 0 || xp2 >= width {
				xm2, xm1 = reflect(xm2, width), reflect(xm1, width)
				xp1, xp2 = reflect(xp1, width), reflect(xp2, width)
			}

			centre := float32(lines[2][px])
			horizontal := float32(lines[2][xm1]) + float32(lines[2][xp1])
			vertical := float32(lines[1][px]) + float32(lines[3][px])
			diagonal := float32(lines[1][xm1]) + float32(lines[1][xp1]) +
				float32(lines[3][xm1]) + float32(lines[3][xp1])
			farHorizontal := float32(lines[2][xm2]) + float32(lines[2][xp2])
			farVertical := float32(lines[0][px]) + float32(lines[4][px])

			colour := r.cfa[(py&1)*2+px&1]
			pixel := rgb[x*3 : x*3+3]
			if colour == 1 {
				//Green pixel: one other colour is left and right of it, the
				//other above and below
				beside := r.cfa[(py&1)*2+(px+1)&1]
				alongRow := (5*centre + 4*horizontal - diagonal - farHorizontal + 0.5*farVertical) / 8
				alongColumn := (5*centre + 4*vertical - diagonal - farVertical + 0.5*farHorizontal) / 8
				pixel[1] = centre
				pixel[beside] = alongRow
				pixel[2-beside] = alongColumn
			} else {
				pixel[colour] = centre
				pixel[1] = (4*centre + 2*(horizontal+vertical) - farHorizontal - farVertical) / 8
				pixel[2-colour] = (6*centre + 2*diagonal - 1.5*(farHorizontal+farVertical)) / 8
			}
			for c, v := range pixel {
				pixel[c] = max(0, min(planeScale, v))
			}
		}
	}
}

// orient returns where pixel (x, y) of a width x height picture goes, by the
// EXIF orientation of the file
func orient(orientation, x, y, width, height int) (int, int) {
	switch orientation {
	case 2:
		return width - 1 - x, y
	case 3:
		return width - 1 - x, height - 1 - y
	case 4:
		return x, height - 1 - y
	case 5:
		return y, x
	case 6:
		return height - 1 - y, x
	case 7:
		return height - 1 - y, width - 1 - x
	case 8:
		return y, width - 1 - x
	}
	return x, y
}

// render converts the camera values of rows into an upright sRGB picture
func (r *rawImage) render(rows rowSource, width, height int) *image.RGBA {
	var m [3][3]float32
	for i := range m {
		for j := range m[i] {
			m[i][j] = float32(r.colour.toSRGB[i][j] / planeScale * r.colour.exposure)
		}
	}
	convert := func(p []float32) (float32, float32, float32) {
		return m[0][0]*p[0] + m[0][1]*p[1] + m[0][2]*p[2],
			m[1][0]*p[0] + m[1][1]*p[1] + m[1][2]*p[2],
			m[2][0]*p[0] + m[2][1]*p[1] + m[2][2]*p[2]
	}

	//Measure the brightness on a sample of rows and pixels
	histogram := make([]int, 1024)
	sample := make([]float32, width*3)
	for y := 0; y < height; y += max(1, height/256) {
		rows(y, sample)
		for x := 0; x < width; x += max(1, width/256) {
			red, green, blue := convert(sample[x*3:])
			last := len(histogram) - 1
			histogram[tableIndex(max(red, green, blue)*float32(last), last)]++
		}
	}
	gain := autoExposure(histogram) * toneSteps
	table := toneCurve()

	outWidth, outHeight := width, height
	if r.orientation >= 5 {
		outWidth, outHeight = height, width
	}
	out := image.NewRGBA(image.Rect(0, 0, outWidth, outHeight))
	parallelRows(height, func(from, to int) {
		rgb := make([]float32, width*3)
		for y := from; y < to; y++ {
			rows(y, rgb)
			for x := 0; x < width; x++ {
				red, green, blue := convert(rgb[x*3:])
				ox, oy := orient(r.orientation, x, y, width, height)
				pixel := out.Pix[out.PixOffset(ox, oy):][:4]
				pixel[0] = table[tableIndex(red*gain, toneSteps)]
				pixel[1] = table[tableIndex(green*gain, toneSteps)]
				pixel[2] = table[tableIndex(blue*gain, toneSteps)]
				pixel[3] = 255
			}
		}
	})
	return out
}
