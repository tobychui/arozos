package metadata

import (
	"errors"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"

	"github.com/nfnt/resize"
	"github.com/oliamb/cutter"
	_ "github.com/oov/psd"
)

func generateThumbnailForPSD(cacheFolder string, file string, generateOnly bool) (string, error) {
	if !fileExists(file) {
		//The user removed this file before the thumbnail is finished
		return "", errors.New("Source not exists")
	}

	outputFile := cacheFolder + filepath.Base(file) + ".jpg"

	f, err := os.Open(file)
	if err != nil {
		return "", err
	}

	//Decode the image content with PSD decoder
	img, _, err := image.Decode(f)
	if err != nil {
		return "", err
	}

	f.Close()

	//Check boundary to decide resize mode
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

	outf, err := os.Create(outputFile)
	if err != nil {
		return "", err
	}
	opt := jpeg.Options{
		Quality: 90,
	}
	err = jpeg.Encode(outf, croppedImg, &opt)
	if err != nil {
		return "", err
	}
	outf.Close()

	if !generateOnly && fileExists(outputFile) {
		//return the image as well
		ctx, err := getImageAsBase64(outputFile)
		return ctx, err
	} else if !fileExists(outputFile) {
		return "", errors.New("Image generation failed")
	}
	return "", nil

}
