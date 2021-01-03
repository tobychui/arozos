package metadata

import (
	"bytes"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"

	"github.com/dhowden/tag"
	"github.com/nfnt/resize"
	"github.com/oliamb/cutter"
)

func generateThumbnailForAudio(cacheFolder string, file string, generateOnly bool) (string, error) {

	//This extension is supported by id4. Call to library
	f, err := os.Open(file)
	defer f.Close()
	if err != nil {
		return "", err
	}
	m, err := tag.ReadFrom(f)
	if err != nil {
		return "", err
	}

	if m.Picture() != nil {
		//Convert the picture bytecode to image object
		img, _, err := image.Decode(bytes.NewReader(m.Picture().Data))
		if err != nil {
			//Fail to convert this image. Continue next one
			return "", err
		}

		//Create an empty file
		out, _ := os.Create(cacheFolder + filepath.Base(file) + ".jpg")
		defer out.Close()

		b := img.Bounds()
		imgWidth := b.Max.X
		imgHeight := b.Max.Y

		//Resize the albumn image
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

		//Write the cache image to disk
		jpeg.Encode(out, croppedImg, nil)

		if !generateOnly {
			//return the image as well
			ctx, err := getImageAsBase64(cacheFolder + filepath.Base(file) + ".jpg")
			return ctx, err
		}

	}
	return "", nil
}
