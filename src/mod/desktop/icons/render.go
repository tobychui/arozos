package icons

import (
	"image"
	"image/color"
	"image/draw"
	_ "image/gif"
	_ "image/jpeg"
	"math"

	"github.com/disintegration/imaging"
)

/*
	render.go

	Composition of the desktop icon: an antialiased squircle backplate with the
	module icon scaled down and centered on top of it.
*/

// Render composites a module icon onto a padded squircle backplate and returns
// the resulting desktop icon image.
func (g *Generator) Render(moduleIcon image.Image) image.Image {
	iconSize := g.options.IconSize
	canvas := image.NewNRGBA(image.Rect(0, 0, iconSize, iconSize))

	//Paint the antialiased squircle backplate
	backplateColor := PickBackplateColor(moduleIcon, g.options.LumaThreshold)
	exponent := SquircleExponent(g.options.SquircleFactor)
	center := float64(iconSize) / 2
	radius := float64(iconSize) * g.options.BackplateRatio / 2
	for y := 0; y < iconSize; y++ {
		for x := 0; x < iconSize; x++ {
			coverage := SquircleCoverage(float64(x), float64(y), center, radius, exponent, g.options.SampleSteps)
			if coverage <= 0 {
				continue
			}
			pixelColor := backplateColor
			pixelColor.A = uint8(math.Round(float64(backplateColor.A) * coverage))
			canvas.SetNRGBA(x, y, pixelColor)
		}
	}

	//Scale the module icon into the padded content box and center it
	contentBox := int(math.Round(float64(iconSize) * g.options.BackplateRatio * g.options.ContentRatio))
	scaledIcon := ScaleToBox(moduleIcon, contentBox)
	if scaledIcon != nil {
		offset := image.Pt((iconSize-scaledIcon.Bounds().Dx())/2, (iconSize-scaledIcon.Bounds().Dy())/2)
		draw.Draw(canvas, scaledIcon.Bounds().Add(offset), scaledIcon, scaledIcon.Bounds().Min, draw.Over)
	}

	return canvas
}

// ScaleToBox resizes an icon so its longest side matches boxSize while keeping
// its aspect ratio. Returns nil for degenerate source images.
func ScaleToBox(moduleIcon image.Image, boxSize int) image.Image {
	sourceWidth := moduleIcon.Bounds().Dx()
	sourceHeight := moduleIcon.Bounds().Dy()
	if sourceWidth <= 0 || sourceHeight <= 0 || boxSize <= 0 {
		return nil
	}

	scale := math.Min(float64(boxSize)/float64(sourceWidth), float64(boxSize)/float64(sourceHeight))
	scaledWidth := int(math.Round(float64(sourceWidth) * scale))
	scaledHeight := int(math.Round(float64(sourceHeight) * scale))
	if scaledWidth < 1 {
		scaledWidth = 1
	}
	if scaledHeight < 1 {
		scaledHeight = 1
	}

	return imaging.Resize(moduleIcon, scaledWidth, scaledHeight, imaging.Lanczos)
}

// SquircleExponent converts the squircle "squareness" factor f into the
// superellipse exponent n = 2 / (1 - f).
func SquircleExponent(squircleFactor float64) float64 {
	if squircleFactor < 0 {
		squircleFactor = 0
	} else if squircleFactor > 0.99 {
		//Keep the exponent finite so the math below stays well behaved
		squircleFactor = 0.99
	}
	return 2 / (1 - squircleFactor)
}

// SquircleCoverage returns how much (0 - 1) of the pixel at the given top-left
// coordinates falls inside the squircle, supersampled on a sampleSteps x
// sampleSteps grid for antialiasing.
func SquircleCoverage(pixelX float64, pixelY float64, center float64, radius float64, exponent float64, sampleSteps int) float64 {
	if radius <= 0 || sampleSteps <= 0 {
		return 0
	}

	sampleStep := 1.0 / float64(sampleSteps)
	samplesInside := 0
	for sampleY := 0; sampleY < sampleSteps; sampleY++ {
		for sampleX := 0; sampleX < sampleSteps; sampleX++ {
			offsetX := math.Abs(pixelX+(float64(sampleX)+0.5)*sampleStep-center) / radius
			offsetY := math.Abs(pixelY+(float64(sampleY)+0.5)*sampleStep-center) / radius
			if math.Pow(offsetX, exponent)+math.Pow(offsetY, exponent) <= 1 {
				samplesInside++
			}
		}
	}

	return float64(samplesInside) / float64(sampleSteps*sampleSteps)
}

// PickBackplateColor samples the theme color of a module icon and picks the
// backplate that keeps the icon readable: black behind a bright icon, white
// behind a dark one.
func PickBackplateColor(moduleIcon image.Image, lumaThreshold float64) color.NRGBA {
	white := color.NRGBA{R: 255, G: 255, B: 255, A: 255}
	black := color.NRGBA{R: 0, G: 0, B: 0, A: 255}

	bounds := moduleIcon.Bounds()
	lumaSum := 0.0
	weightSum := 0.0
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, a := moduleIcon.At(x, y).RGBA()
			if a == 0 {
				//Fully transparent pixels carry no theme color
				continue
			}

			//RGBA() is alpha-premultiplied, so divide by alpha to get the real
			//channel values and weight the sample by how opaque the pixel is
			luma := (0.2126*float64(r) + 0.7152*float64(g) + 0.0722*float64(b)) / float64(a)
			alpha := float64(a) / 65535
			lumaSum += luma * alpha
			weightSum += alpha
		}
	}

	if weightSum == 0 {
		//Blank icon, fall back to the light backplate
		return white
	}

	if lumaSum/weightSum > lumaThreshold {
		return black
	}
	return white
}
