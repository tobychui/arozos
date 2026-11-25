package metadata

import (
	"errors"
	"image"
	"path/filepath"

	_ "github.com/oov/psd"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

func generateThumbnailForPSD(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (out0 string, out1 error) {
	defer logger.Out2(logger.In4("filesystem/metadata", "generateThumbnailForPSD", "fsh", fsh, "cacheFolder", cacheFolder, "file", file, "generateOnly", generateOnly), &out0, &out1)
	if fsh.RequireBuffer {
		return "", nil
	}
	fshAbs := fsh.FileSystemAbstraction
	if !fshAbs.FileExists(file) {
		//The user removed this file before the thumbnail is finished
		return "", errors.New("Source not exists")
	}

	outputFile := cacheFolder + filepath.Base(file) + ".jpg"

	f, err := fshAbs.Open(file)
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}

	//Decode the merged (composite) image with the PSD decoder
	img, _, err := image.Decode(f)
	f.Close()
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}

	//Scale, crop the centre and flatten transparency onto white
	if err := writeCroppedThumbnail(fsh, img, outputFile); err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}

	if !generateOnly && fshAbs.FileExists(outputFile) {
		//return the image as well
		ctx, err := getImageAsBase64(fsh, outputFile)
		return ctx, err
	} else if !utils.FileExists(outputFile) {
		return "", errors.New("Image generation failed")
	}
	return "", nil

}
