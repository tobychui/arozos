package metadata

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"path/filepath"

	"github.com/nfnt/resize"
	"github.com/oliamb/cutter"
	"github.com/srwiley/oksvg"
	"github.com/srwiley/rasterx"
	"imuslab.com/arozos/mod/filesystem"
)

func generateThumbnailForSVG(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (string, error) {
	if fsh.RequireBuffer {
		return "", nil
	}
	fshAbs := fsh.FileSystemAbstraction
	if !fshAbs.FileExists(file) {
		return "", errors.New("Source not exists")
	}

	//Read the SVG content
	content, err := fshAbs.ReadFile(file)
	if err != nil {
		return "", err
	}

	//Parse SVG
	icon, err := oksvg.ReadIconStream(bytes.NewReader(content))
	if err != nil {
		return "", err
	}

	//Set target size for rendering
	icon.SetTarget(0, 0, 480, 480)

	//Create RGBA image
	img := image.NewRGBA(image.Rect(0, 0, 480, 480))

	//Create scanner and rasterizer
	scanner := rasterx.NewScannerGV(480, 480, img, img.Bounds())
	raster := rasterx.NewDasher(480, 480, scanner)

	//Draw the SVG
	icon.Draw(raster, 1.0)

	//Resize to desired width (similar to other generators)
	b := img.Bounds()
	imgWidth := b.Max.X
	imgHeight := b.Max.Y

	var m image.Image
	if imgWidth > imgHeight {
		m = resize.Resize(0, 480, img, resize.Lanczos3)
	} else {
		m = resize.Resize(480, 0, img, resize.Lanczos3)
	}

	//Crop out the center
	croppedImg, err := cutter.Crop(m, cutter.Config{
		Width:  480,
		Height: 480,
		Mode:   cutter.Centered,
	})
	if err != nil {
		return "", err
	}

	//Create the thumbnail
	outputFile := cacheFolder + filepath.Base(file) + ".jpg"
	out, err := fshAbs.Create(outputFile)
	if err != nil {
		return "", err
	}

	//Write new image to file
	jpeg.Encode(out, croppedImg, nil)
	out.Close()

	if !generateOnly {
		//Return the image as well
		ctx, err := getImageAsBase64(fsh, outputFile)
		return ctx, err
	} else {
		return "", nil
	}
}
