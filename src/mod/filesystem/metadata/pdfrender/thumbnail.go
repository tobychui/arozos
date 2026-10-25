package pdfrender

import (
	"image"
	"image/color"
	"image/draw"
	"io"
	"time"
)

// thumbBackground surrounds a landscape page in a square thumbnail
var thumbBackground = color.RGBA{0xe6, 0xe6, 0xe6, 0xff}

// Thumbnail renders the first page of a PDF into a side x side square.
//
// A portrait page is scaled so its width fills the square and is shown
// from the top: the title end is what makes a document recognisable. A
// landscape page (slides, drawings) is shown whole, centred on a light grey
// background, since cropping it to a square would cut most of it away.
//
// A render that ran out of time still returns what it drew, together with
// ErrTimeout.
func Thumbnail(r io.ReaderAt, size int64, side int, timeout time.Duration) (*image.RGBA, error) {
	doc, err := Open(r, size)
	if err != nil {
		return nil, err
	}
	pg, err := doc.Page(0)
	if err != nil {
		return nil, err
	}
	pw, ph := pg.Size()
	if pw <= ph*1.05 {
		scale := float64(side) / pw
		return doc.Render(0, Options{
			Scale:   scale,
			Region:  image.Rect(0, 0, side, side),
			Timeout: timeout,
		})
	}

	scale := float64(side) / pw
	page, err := doc.Render(0, Options{Scale: scale, Timeout: timeout})
	if page == nil {
		return nil, err
	}
	out := image.NewRGBA(image.Rect(0, 0, side, side))
	draw.Draw(out, out.Bounds(), &image.Uniform{C: thumbBackground}, image.Point{}, draw.Src)
	h := page.Bounds().Dy()
	if h > side {
		h = side
	}
	top := (side - h) / 2
	draw.Draw(out, image.Rect(0, top, side, top+h), page, image.Point{}, draw.Src)
	//A hairline keeps a white page apart from the background
	edge := color.RGBA{0xc8, 0xc8, 0xc8, 0xff}
	for x := 0; x < side; x++ {
		if top > 0 {
			out.SetRGBA(x, top-1, edge)
		}
		if top+h < side {
			out.SetRGBA(x, top+h, edge)
		}
	}
	return out, err
}
