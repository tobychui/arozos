package icons

import (
	"bytes"
	"errors"
	"image"
	"math"

	"github.com/srwiley/oksvg"
	"github.com/srwiley/rasterx"
)

/*
	svg.go

	Rasterization of SVG module icons, working around oksvg only transforming
	path geometry and not the stroke styling that goes with it.
*/

// RasterizeSVG renders an SVG into a square RGBA image of the given size,
// preserving the aspect ratio of the source viewBox.
func RasterizeSVG(svgContent []byte, renderSize int) (image.Image, error) {
	parsedIcon, err := oksvg.ReadIconStream(bytes.NewReader(svgContent))
	if err != nil {
		return nil, err
	}

	if len(parsedIcon.SVGPaths) == 0 {
		//oksvg happily parses content that is not an SVG at all and hands back
		//an icon with nothing to draw. Refuse it rather than writing out a blank
		//desktop icon, which would then permanently shadow the module icon.
		return nil, errors.New("svg contains no drawable path")
	}

	viewWidth := parsedIcon.ViewBox.W
	viewHeight := parsedIcon.ViewBox.H
	if viewWidth <= 0 || viewHeight <= 0 {
		viewWidth, viewHeight = float64(renderSize), float64(renderSize)
	}

	scale := math.Min(float64(renderSize)/viewWidth, float64(renderSize)/viewHeight)
	targetWidth := viewWidth * scale
	targetHeight := viewHeight * scale
	parsedIcon.SetTarget((float64(renderSize)-targetWidth)/2, (float64(renderSize)-targetHeight)/2, targetWidth, targetHeight)
	ScaleSVGStrokes(parsedIcon, scale)

	renderedIcon := image.NewRGBA(image.Rect(0, 0, renderSize, renderSize))
	scanner := rasterx.NewScannerGV(renderSize, renderSize, renderedIcon, renderedIcon.Bounds())
	parsedIcon.Draw(rasterx.NewDasher(renderSize, renderSize, scanner), 1.0)
	return renderedIcon, nil
}

// ScaleSVGStrokes multiplies the stroke widths of an SVG icon by the given
// scale factor.
//
// oksvg only applies the SetTarget transform to the path geometry: the stroke
// width handed to the rasterizer is the raw value in viewBox units. Rendering a
// 64x64 viewBox at 512px therefore leaves every stroke 8 times too thin, which
// makes line art module icons come out as hairlines. Pre-scaling the stroke
// styling to match the transform restores the intended thickness.
func ScaleSVGStrokes(parsedIcon *oksvg.SvgIcon, scale float64) {
	if scale <= 0 || scale == 1 {
		return
	}

	for i := range parsedIcon.SVGPaths {
		svgPath := &parsedIcon.SVGPaths[i]
		svgPath.LineWidth *= scale
		svgPath.DashOffset *= scale
		for j := range svgPath.Dash {
			svgPath.Dash[j] *= scale
		}
	}
}
