package icons

import (
	"bytes"
	"math"
	"testing"

	"github.com/srwiley/oksvg"
)

var strokedTestSVG = []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
	<path d="M32 8 V56" stroke="#ffffff" stroke-width="4" fill="none"/>
</svg>`)

func TestScaleSVGStrokes(t *testing.T) {
	referenceIcon, err := oksvg.ReadIconStream(bytes.NewReader(strokedTestSVG))
	if err != nil {
		t.Fatalf("unable to parse test SVG: %v", err)
	}
	if len(referenceIcon.SVGPaths) == 0 {
		t.Fatal("test SVG parsed into zero paths")
	}

	originalWidth := referenceIcon.SVGPaths[0].LineWidth
	if originalWidth <= 0 {
		t.Fatalf("test SVG stroke width = %v, want a positive width", originalWidth)
	}

	tests := []struct {
		name  string
		scale float64
		want  float64
	}{
		{"scaled up", 8, originalWidth * 8},
		{"scaled down", 0.5, originalWidth * 0.5},
		{"identity is a no-op", 1, originalWidth},
		{"zero scale is ignored", 0, originalWidth},
		{"negative scale is ignored", -2, originalWidth},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			parsedIcon, err := oksvg.ReadIconStream(bytes.NewReader(strokedTestSVG))
			if err != nil {
				t.Fatalf("unable to parse test SVG: %v", err)
			}
			ScaleSVGStrokes(parsedIcon, tt.scale)
			if got := parsedIcon.SVGPaths[0].LineWidth; math.Abs(got-tt.want) > 1e-9 {
				t.Errorf("LineWidth after scaling by %v = %v, want %v", tt.scale, got, tt.want)
			}
		})
	}
}

func TestRasterizeSVGKeepsStrokeWeight(t *testing.T) {
	//A 64 unit wide viewBox with a 4 unit stroke rendered at 512px should draw
	//a 32px wide line. Without stroke scaling oksvg would draw it 4px wide.
	const renderSize = 512
	rasterized, err := RasterizeSVG(strokedTestSVG, renderSize)
	if err != nil {
		t.Fatalf("RasterizeSVG() returned error: %v", err)
	}

	if rasterized.Bounds().Dx() != renderSize || rasterized.Bounds().Dy() != renderSize {
		t.Fatalf("rasterized size = %dx%d, want %dx%d",
			rasterized.Bounds().Dx(), rasterized.Bounds().Dy(), renderSize, renderSize)
	}

	drawnWidth := 0
	for x := 0; x < renderSize; x++ {
		if _, _, _, a := rasterized.At(x, renderSize/2).RGBA(); a > 0x7fff {
			drawnWidth++
		}
	}

	expectedWidth := 4.0 / 64.0 * renderSize
	if math.Abs(float64(drawnWidth)-expectedWidth) > 2 {
		t.Errorf("rasterized stroke width = %dpx, want about %.0fpx", drawnWidth, expectedWidth)
	}
}

func TestRasterizeSVGPreservesAspectRatio(t *testing.T) {
	//A 2:1 viewBox must render letterboxed rather than stretched to the square
	wideSVG := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32" width="64" height="32">
		<rect x="0" y="0" width="64" height="32" fill="#ffffff"/>
	</svg>`)

	const renderSize = 128
	rasterized, err := RasterizeSVG(wideSVG, renderSize)
	if err != nil {
		t.Fatalf("RasterizeSVG() returned error: %v", err)
	}

	drawnHeight := 0
	for y := 0; y < renderSize; y++ {
		if _, _, _, a := rasterized.At(renderSize/2, y).RGBA(); a > 0x7fff {
			drawnHeight++
		}
	}

	if math.Abs(float64(drawnHeight)-renderSize/2) > 2 {
		t.Errorf("drawn height = %dpx, want about %dpx for a 2:1 viewBox", drawnHeight, renderSize/2)
	}
}

func TestRasterizeSVGRejectsUndrawableInput(t *testing.T) {
	tests := []struct {
		name  string
		input []byte
	}{
		{"plain text", []byte("this is not an svg")},
		{"empty input", []byte("")},
		{"svg with nothing to draw", []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"></svg>`)},
		{"malformed markup", []byte(`<svg><rect`)},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, err := RasterizeSVG(tt.input, 64); err == nil {
				t.Error("RasterizeSVG() = nil error, want an error rather than a blank icon")
			}
		})
	}
}
