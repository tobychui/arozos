package metadata

import (
	"bytes"
	"image"
	"image/jpeg"
	"io/ioutil"
	"os"
	"path/filepath"

	"github.com/nfnt/resize"
	"github.com/oliamb/cutter"
)

func generateThumbnailForImage(cacheFolder string, file string, generateOnly bool) (string, error) {
	imageBytes, err := ioutil.ReadFile(file)
	if err != nil {
		return "", err
	}
	//Resize to desiered width
	img, _, err := image.Decode(bytes.NewReader(imageBytes))

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

	//Create the thumbnail
	out, err := os.Create(cacheFolder + filepath.Base(file) + ".jpg")
	if err != nil {
		return "", err
	}

	// write new image to file
	jpeg.Encode(out, croppedImg, nil)
	out.Close()

	if !generateOnly {
		//return the image as well
		ctx, err := getImageAsBase64(cacheFolder + filepath.Base(file) + ".jpg")
		return ctx, err
	} else {
		return "", nil
	}
}
