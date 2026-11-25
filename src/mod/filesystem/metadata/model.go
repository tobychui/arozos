package metadata

import (
	"errors"
	"image/jpeg"
	"path/filepath"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/renderer"
	"imuslab.com/arozos/mod/info/logger"
)

func generateThumbnailForModel(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (out0 string, out1 error) {
	defer logger.Out2(logger.In4("filesystem/metadata", "generateThumbnailForModel", "fsh", fsh, "cacheFolder", cacheFolder, "file", file, "generateOnly", generateOnly), &out0, &out1)
	if fsh.RequireBuffer {
		return "", nil
	}
	fshAbs := fsh.FileSystemAbstraction

	if !fshAbs.FileExists(file) {
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
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}

	opt := jpeg.Options{
		Quality: 90,
	}

	f, err := fshAbs.Create(outputFile)
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}

	err = jpeg.Encode(f, img, &opt)
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}
	f.Close()

	if !generateOnly && fshAbs.FileExists(outputFile) {
		//return the image as well
		ctx, err := getImageAsBase64(fsh, outputFile)
		return ctx, err
	} else if !fshAbs.FileExists(outputFile) {
		return "", errors.New("Image generation failed")
	}
	return "", nil

}
