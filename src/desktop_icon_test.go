package main

import (
	"bytes"
	"image"
	"image/color"
	"math"
	"testing"

	"github.com/srwiley/oksvg"
)

func TestDesktopResolveWebAssetPath(t *testing.T) {
	tests := []struct {
		name      string
		input     string
		want      string
		expectErr bool
	}{
		{"plain path", "Photo/img/module_icon.png", "Photo/img/module_icon.png", false},
		{"windows separator", "Photo\\img\\module_icon.png", "Photo/img/module_icon.png", false},
		{"redundant segments", "Photo/./img//module_icon.png", "Photo/img/module_icon.png", false},
		{"leading traversal", "../../etc/passwd", "etc/passwd", false},
		{"embedded traversal", "Photo/img/../../Music/img/icon.png", "Music/img/icon.png", false},
		{"leading slash", "/Photo/img/icon.png", "Photo/img/icon.png", false},
		{"empty", "", "", true},
		{"whitespace only", "   ", "", true},
		{"root only", "/", "", true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := desktop_resolveWebAssetPath(tt.input)
			if tt.expectErr {
				if err == nil {
					t.Fatalf("desktop_resolveWebAssetPath(%q) = %q, want error", tt.input, got)
				}
				return
			}
			if err != nil {
				t.Fatalf("desktop_resolveWebAssetPath(%q) returned unexpected error: %v", tt.input, err)
			}
			if got != tt.want {
				t.Errorf("desktop_resolveWebAssetPath(%q) = %q, want %q", tt.input, got, tt.want)
			}
		})
	}
}

func TestDesktopSquircleExponent(t *testing.T) {
	tests := []struct {
		name string
		f    float64
		want float64
	}{
		{"circle", 0, 2},
		{"classic squircle", 0.5, 4},
		{"default factor", desktopIconSquircleFactor, 8},
		{"negative clamped to circle", -1, 2},
		{"above one clamped", 5, 200},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := desktop_squircleExponent(tt.f)
			if math.Abs(got-tt.want) > 1e-9 {
				t.Errorf("desktop_squircleExponent(%v) = %v, want %v", tt.f, got, tt.want)
			}
		})
	}
}

func TestDesktopSquircleCoverage(t *testing.T) {
	exponent := desktop_squircleExponent(desktopIconSquircleFactor)
	center := 50.0
	radius := 40.0

	tests := []struct {
		name   string
		x, y   float64
		want   float64
		strict bool
	}{
		{"center is fully covered", center, center, 1, true},
		{"far outside is empty", 0, 0, 0, true},
		{"just inside the right edge", center + radius - 2, center, 1, true},
		{"just outside the right edge", center + radius + 1, center, 0, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := desktop_squircleCoverage(tt.x, tt.y, center, radius, exponent)
			if got != tt.want {
				t.Errorf("desktop_squircleCoverage(%v, %v) = %v, want %v", tt.x, tt.y, got, tt.want)
			}
		})
	}

	//A pixel sitting exactly on the boundary must be partially covered so the
	//edge of the squircle ends up antialiased instead of hard cut
	edgeCoverage := desktop_squircleCoverage(center+radius-0.5, center, center, radius, exponent)
	if edgeCoverage <= 0 || edgeCoverage >= 1 {
		t.Errorf("boundary pixel coverage = %v, want a value between 0 and 1", edgeCoverage)
	}

	if got := desktop_squircleCoverage(center, center, center, 0, exponent); got != 0 {
		t.Errorf("desktop_squircleCoverage with zero radius = %v, want 0", got)
	}
}

// buildTestIcon creates a solid square icon of the given size and color
func buildTestIcon(size int, fill color.NRGBA) image.Image {
	icon := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			icon.SetNRGBA(x, y, fill)
		}
	}
	return icon
}

func TestDesktopPickBackplateColor(t *testing.T) {
	white := color.NRGBA{R: 255, G: 255, B: 255, A: 255}
	black := color.NRGBA{R: 0, G: 0, B: 0, A: 255}

	tests := []struct {
		name string
		icon image.Image
		want color.NRGBA
	}{
		{"bright icon gets black backplate", buildTestIcon(8, white), black},
		{"dark icon gets white backplate", buildTestIcon(8, black), white},
		{"fully transparent icon falls back to white", buildTestIcon(8, color.NRGBA{R: 255, G: 255, B: 255, A: 0}), white},
		{"translucent bright icon still reads as bright", buildTestIcon(8, color.NRGBA{R: 255, G: 255, B: 255, A: 40}), black},
		{"mid grey icon stays below threshold", buildTestIcon(8, color.NRGBA{R: 100, G: 100, B: 100, A: 255}), white},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := desktop_pickBackplateColor(tt.icon)
			if got != tt.want {
				t.Errorf("desktop_pickBackplateColor() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestDesktopScaleIconToBox(t *testing.T) {
	tests := []struct {
		name       string
		icon       image.Image
		boxSize    int
		wantW      int
		wantH      int
		wantNilOut bool
	}{
		{"square icon is scaled down", buildTestIcon(256, color.NRGBA{A: 255}), 64, 64, 64, false},
		{"small icon is scaled up", buildTestIcon(16, color.NRGBA{A: 255}), 64, 64, 64, false},
		{"wide icon keeps aspect ratio", image.NewNRGBA(image.Rect(0, 0, 200, 100)), 80, 80, 40, false},
		{"tall icon keeps aspect ratio", image.NewNRGBA(image.Rect(0, 0, 100, 200)), 80, 40, 80, false},
		{"empty icon returns nil", image.NewNRGBA(image.Rect(0, 0, 0, 0)), 64, 0, 0, true},
		{"zero box returns nil", buildTestIcon(32, color.NRGBA{A: 255}), 0, 0, 0, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := desktop_scaleIconToBox(tt.icon, tt.boxSize)
			if tt.wantNilOut {
				if got != nil {
					t.Fatalf("desktop_scaleIconToBox() = %v, want nil", got.Bounds())
				}
				return
			}
			if got == nil {
				t.Fatal("desktop_scaleIconToBox() = nil, want an image")
			}
			if got.Bounds().Dx() != tt.wantW || got.Bounds().Dy() != tt.wantH {
				t.Errorf("desktop_scaleIconToBox() size = %dx%d, want %dx%d",
					got.Bounds().Dx(), got.Bounds().Dy(), tt.wantW, tt.wantH)
			}
		})
	}
}

func TestDesktopRenderDesktopIcon(t *testing.T) {
	darkIcon := buildTestIcon(64, color.NRGBA{R: 20, G: 20, B: 20, A: 255})
	rendered := desktop_renderDesktopIcon(darkIcon)

	if rendered.Bounds().Dx() != desktopIconSize || rendered.Bounds().Dy() != desktopIconSize {
		t.Fatalf("rendered icon size = %dx%d, want %dx%d",
			rendered.Bounds().Dx(), rendered.Bounds().Dy(), desktopIconSize, desktopIconSize)
	}

	//The corners sit outside the squircle and must stay fully transparent
	corners := [][2]int{{0, 0}, {desktopIconSize - 1, 0}, {0, desktopIconSize - 1}, {desktopIconSize - 1, desktopIconSize - 1}}
	for _, corner := range corners {
		if _, _, _, a := rendered.At(corner[0], corner[1]).RGBA(); a != 0 {
			t.Errorf("corner (%d, %d) alpha = %d, want 0", corner[0], corner[1], a)
		}
	}

	//The center of a dark icon should be drawn on top of a white backplate
	if _, _, _, a := rendered.At(desktopIconSize/2, desktopIconSize/2).RGBA(); a == 0 {
		t.Error("center pixel is transparent, want the module icon drawn there")
	}

	//The padding ring between the icon and the backplate edge must show the
	//backplate color rather than the module icon
	contentRadius := float64(desktopIconSize) * desktopIconBackplateRatio * desktopIconContentRatio / 2
	backplateRadius := float64(desktopIconSize) * desktopIconBackplateRatio / 2
	paddingOffset := int(math.Round((contentRadius + backplateRadius) / 2))
	pr, pg, pb, pa := rendered.At(desktopIconSize/2+paddingOffset, desktopIconSize/2).RGBA()
	if pa != 0xffff || pr != 0xffff || pg != 0xffff || pb != 0xffff {
		t.Errorf("padding pixel = (%d, %d, %d, %d), want opaque white backplate", pr, pg, pb, pa)
	}

	//The generated icon must occupy roughly the same fraction of the canvas as
	//the hand drawn desktop icons shipped with the built-in web apps
	opaqueWidth := 0
	for x := 0; x < desktopIconSize; x++ {
		if _, _, _, a := rendered.At(x, desktopIconSize/2).RGBA(); a > 0 {
			opaqueWidth++
		}
	}
	occupancy := float64(opaqueWidth) / float64(desktopIconSize)
	if occupancy < 0.66 || occupancy > 0.74 {
		t.Errorf("icon occupancy = %.3f of canvas, want roughly 0.70 to match the bundled icons", occupancy)
	}
}

func TestDesktopScaleSVGStrokes(t *testing.T) {
	svgSource := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
		<path d="M22 16 V48" stroke="#ffffff" stroke-width="4" fill="none"/>
	</svg>`)

	parsedIcon, err := oksvg.ReadIconStream(bytes.NewReader(svgSource))
	if err != nil {
		t.Fatalf("unable to parse test SVG: %v", err)
	}
	if len(parsedIcon.SVGPaths) == 0 {
		t.Fatal("test SVG parsed into zero paths")
	}

	originalWidth := parsedIcon.SVGPaths[0].LineWidth
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
			icon, err := oksvg.ReadIconStream(bytes.NewReader(svgSource))
			if err != nil {
				t.Fatalf("unable to parse test SVG: %v", err)
			}
			desktop_scaleSVGStrokes(icon, tt.scale)
			if got := icon.SVGPaths[0].LineWidth; math.Abs(got-tt.want) > 1e-9 {
				t.Errorf("LineWidth after scaling by %v = %v, want %v", tt.scale, got, tt.want)
			}
		})
	}
}

func TestDesktopRasterizeSVGKeepsStrokeWeight(t *testing.T) {
	//A 64 unit wide viewBox with a 4 unit stroke rendered at 512px should draw
	//a 32px wide line. Without stroke scaling oksvg would draw it 4px wide.
	svgSource := []byte(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="64" height="64">
		<path d="M32 8 V56" stroke="#ffffff" stroke-width="4" fill="none"/>
	</svg>`)

	const renderSize = 512
	rasterized, err := desktop_rasterizeSVG(svgSource, renderSize)
	if err != nil {
		t.Fatalf("desktop_rasterizeSVG() returned error: %v", err)
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
