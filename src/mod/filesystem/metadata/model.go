package metadata

import (
	"errors"
	"image/jpeg"
	"os"
	"path/filepath"

	"imuslab.com/arozos/mod/filesystem/renderer"
)

func generateThumbnailForModel(cacheFolder string, file string, generateOnly bool) (string, error) {
	if !fileExists(file) {
		//The user removed this file before the thumbnail is finished
		return "", errors.New("Source not exists")
	}

	//Generate a render of the 3d model
	outputFile := cacheFolder + filepath.Base(file) + ".jpg"
	r := renderer.NewRenderer(renderer.RenderOption{
		Color:           "#f2f542",
		BackgroundColor: "#ffffff",
		Width:           480,
		Height:          480,
	})

	img, err := r.RenderModel(file)
	opt := jpeg.Options{
		Quality: 90,
	}

	f, err := os.Create(outputFile)
	if err != nil {
		return "", err
	}

	err = jpeg.Encode(f, img, &opt)
	f.Close()

	if !generateOnly && fileExists(outputFile) {
		//return the image as well
		ctx, err := getImageAsBase64(outputFile)
		return ctx, err
	} else if !fileExists(outputFile) {
		return "", errors.New("Image generation failed")
	}
	return "", nil

}
