package icons

import (
	"image"
	"image/color"
	"math"
	"testing"
)

// solidIcon creates a solid square icon of the given size and color
func solidIcon(size int, fill color.NRGBA) image.Image {
	icon := image.NewNRGBA(image.Rect(0, 0, size, size))
	for y := 0; y < size; y++ {
		for x := 0; x < size; x++ {
			icon.SetNRGBA(x, y, fill)
		}
	}
	return icon
}

func TestSquircleExponent(t *testing.T) {
	tests := []struct {
		name string
		f    float64
		want float64
	}{
		{"circle", 0, 2},
		{"classic squircle", 0.5, 4},
		{"default factor", DefaultSquircleFactor, 8},
		{"negative clamped to circle", -1, 2},
		{"above one clamped", 5, 200},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SquircleExponent(tt.f)
			if math.Abs(got-tt.want) > 1e-9 {
				t.Errorf("SquircleExponent(%v) = %v, want %v", tt.f, got, tt.want)
			}
		})
	}
}

func TestSquircleCoverage(t *testing.T) {
	exponent := SquircleExponent(DefaultSquircleFactor)
	center := 50.0
	radius := 40.0

	tests := []struct {
		name string
		x, y float64
		want float64
	}{
		{"center is fully covered", center, center, 1},
		{"far outside is empty", 0, 0, 0},
		{"just inside the right edge", center + radius - 2, center, 1},
		{"just outside the right edge", center + radius + 1, center, 0},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := SquircleCoverage(tt.x, tt.y, center, radius, exponent, DefaultSampleSteps)
			if got != tt.want {
				t.Errorf("SquircleCoverage(%v, %v) = %v, want %v", tt.x, tt.y, got, tt.want)
			}
		})
	}

	//A pixel sitting exactly on the boundary must be partially covered so the
	//edge of the squircle ends up antialiased instead of hard cut
	edgeCoverage := SquircleCoverage(center+radius-0.5, center, center, radius, exponent, DefaultSampleSteps)
	if edgeCoverage <= 0 || edgeCoverage >= 1 {
		t.Errorf("boundary pixel coverage = %v, want a value between 0 and 1", edgeCoverage)
	}

	if got := SquircleCoverage(center, center, center, 0, exponent, DefaultSampleSteps); got != 0 {
		t.Errorf("SquircleCoverage with zero radius = %v, want 0", got)
	}
	if got := SquircleCoverage(center, center, center, radius, exponent, 0); got != 0 {
		t.Errorf("SquircleCoverage with zero sample steps = %v, want 0", got)
	}
}

func TestPickBackplateColor(t *testing.T) {
	white := color.NRGBA{R: 255, G: 255, B: 255, A: 255}
	black := color.NRGBA{R: 0, G: 0, B: 0, A: 255}

	tests := []struct {
		name string
		icon image.Image
		want color.NRGBA
	}{
		{"bright icon gets black backplate", solidIcon(8, white), black},
		{"dark icon gets white backplate", solidIcon(8, black), white},
		{"fully transparent icon falls back to white", solidIcon(8, color.NRGBA{R: 255, G: 255, B: 255, A: 0}), white},
		{"translucent bright icon still reads as bright", solidIcon(8, color.NRGBA{R: 255, G: 255, B: 255, A: 40}), black},
		{"mid grey icon stays below threshold", solidIcon(8, color.NRGBA{R: 100, G: 100, B: 100, A: 255}), white},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := PickBackplateColor(tt.icon, DefaultLumaThreshold)
			if got != tt.want {
				t.Errorf("PickBackplateColor() = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestScaleToBox(t *testing.T) {
	tests := []struct {
		name       string
		icon       image.Image
		boxSize    int
		wantW      int
		wantH      int
		wantNilOut bool
	}{
		{"square icon is scaled down", solidIcon(256, color.NRGBA{A: 255}), 64, 64, 64, false},
		{"small icon is scaled up", solidIcon(16, color.NRGBA{A: 255}), 64, 64, 64, false},
		{"wide icon keeps aspect ratio", image.NewNRGBA(image.Rect(0, 0, 200, 100)), 80, 80, 40, false},
		{"tall icon keeps aspect ratio", image.NewNRGBA(image.Rect(0, 0, 100, 200)), 80, 40, 80, false},
		{"empty icon returns nil", image.NewNRGBA(image.Rect(0, 0, 0, 0)), 64, 0, 0, true},
		{"zero box returns nil", solidIcon(32, color.NRGBA{A: 255}), 0, 0, 0, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ScaleToBox(tt.icon, tt.boxSize)
			if tt.wantNilOut {
				if got != nil {
					t.Fatalf("ScaleToBox() = %v, want nil", got.Bounds())
				}
				return
			}
			if got == nil {
				t.Fatal("ScaleToBox() = nil, want an image")
			}
			if got.Bounds().Dx() != tt.wantW || got.Bounds().Dy() != tt.wantH {
				t.Errorf("ScaleToBox() size = %dx%d, want %dx%d",
					got.Bounds().Dx(), got.Bounds().Dy(), tt.wantW, tt.wantH)
			}
		})
	}
}

func TestRender(t *testing.T) {
	generator := NewGenerator(t.TempDir())
	darkIcon := solidIcon(64, color.NRGBA{R: 20, G: 20, B: 20, A: 255})
	rendered := generator.Render(darkIcon)

	if rendered.Bounds().Dx() != DefaultIconSize || rendered.Bounds().Dy() != DefaultIconSize {
		t.Fatalf("rendered icon size = %dx%d, want %dx%d",
			rendered.Bounds().Dx(), rendered.Bounds().Dy(), DefaultIconSize, DefaultIconSize)
	}

	//The corners sit outside the squircle and must stay fully transparent
	corners := [][2]int{{0, 0}, {DefaultIconSize - 1, 0}, {0, DefaultIconSize - 1}, {DefaultIconSize - 1, DefaultIconSize - 1}}
	for _, corner := range corners {
		if _, _, _, a := rendered.At(corner[0], corner[1]).RGBA(); a != 0 {
			t.Errorf("corner (%d, %d) alpha = %d, want 0", corner[0], corner[1], a)
		}
	}

	//The center of a dark icon should be drawn on top of a white backplate
	if _, _, _, a := rendered.At(DefaultIconSize/2, DefaultIconSize/2).RGBA(); a == 0 {
		t.Error("center pixel is transparent, want the module icon drawn there")
	}

	//The padding ring between the icon and the backplate edge must show the
	//backplate color rather than the module icon
	contentRadius := float64(DefaultIconSize) * DefaultBackplateRatio * DefaultContentRatio / 2
	backplateRadius := float64(DefaultIconSize) * DefaultBackplateRatio / 2
	paddingOffset := int(math.Round((contentRadius + backplateRadius) / 2))
	pr, pg, pb, pa := rendered.At(DefaultIconSize/2+paddingOffset, DefaultIconSize/2).RGBA()
	if pa != 0xffff || pr != 0xffff || pg != 0xffff || pb != 0xffff {
		t.Errorf("padding pixel = (%d, %d, %d, %d), want opaque white backplate", pr, pg, pb, pa)
	}

	//The generated icon must occupy roughly the same fraction of the canvas as
	//the hand drawn desktop icons shipped with the built-in web apps
	opaqueWidth := 0
	for x := 0; x < DefaultIconSize; x++ {
		if _, _, _, a := rendered.At(x, DefaultIconSize/2).RGBA(); a > 0 {
			opaqueWidth++
		}
	}
	occupancy := float64(opaqueWidth) / float64(DefaultIconSize)
	if occupancy < 0.66 || occupancy > 0.74 {
		t.Errorf("icon occupancy = %.3f of canvas, want roughly 0.70 to match the bundled icons", occupancy)
	}
}

func TestRenderHonoursCustomOptions(t *testing.T) {
	generator := NewGeneratorWithOptions(t.TempDir(), Options{IconSize: 64})
	rendered := generator.Render(solidIcon(32, color.NRGBA{R: 20, G: 20, B: 20, A: 255}))

	if rendered.Bounds().Dx() != 64 || rendered.Bounds().Dy() != 64 {
		t.Errorf("rendered icon size = %dx%d, want 64x64", rendered.Bounds().Dx(), rendered.Bounds().Dy())
	}
}
