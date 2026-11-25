package metadata

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"os"
	"path/filepath"

	"github.com/nfnt/resize"
	"github.com/oliamb/cutter"
	"golang.org/x/image/webp"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
)

// Generate thumbnail for image. Require real filepath
func generateThumbnailForImage(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (out0 string, out1 error) {
	defer logger.Out2(logger.In4("filesystem/metadata", "generateThumbnailForImage", "fsh", fsh, "cacheFolder", cacheFolder, "file", file, "generateOnly", generateOnly), &out0, &out1)
	if fsh.RequireBuffer {
		return "", nil
	}
	fshAbs := fsh.FileSystemAbstraction
	var img image.Image
	var err error

	if fshAbs.GetFileSize(file) > (25 << 20) {
		//Maxmium image size to be converted is 25MB, on 500MB (~250MB usable) Linux System
		//This file is too large to convert
		return "", errors.New("image file too large")
	}

	if filepath.Ext(file) == ".webp" {
		//Webp image format
		imageBytes, err := fshAbs.ReadFile(file)
		if err != nil {
			logger.DebugErr("filesystem/metadata", err)
			return "", err
		}
		img, err = handleWebpDecoding(imageBytes)
		if err != nil {
			logger.DebugErr("filesystem/metadata", err)
			return "", err
		}
	} else {
		//Other image formats
		if fsh.RequireBuffer {
			//This fsh is remote. Buffer to RAM
			imageBytes, err := fshAbs.ReadFile(file)
			if err != nil {
				logger.DebugErr("filesystem/metadata", err)
				return "", err
			}

			img, _, err = image.Decode(bytes.NewReader(imageBytes))

			if err != nil {
				logger.DebugErr("filesystem/metadata", err)
				return "", err
			}
		} else {
			srcImage, err := fshAbs.OpenFile(file, os.O_RDONLY, 0775)
			if err != nil {
				logger.DebugErr("filesystem/metadata", err)
				return "", err
			}
			defer srcImage.Close()
			img, _, err = image.Decode(srcImage)
			if err != nil {
				logger.DebugErr("filesystem/metadata", err)
				return "", err
			}
		}
	}

	//Resize to desiered width
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

	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}

	//Create the thumbnail
	out, err := fshAbs.Create(cacheFolder + filepath.Base(file) + ".jpg")
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}

	// write new image to file
	jpeg.Encode(out, croppedImg, nil)
	out.Close()

	if !generateOnly {
		//return the image as well
		ctx, err := getImageAsBase64(fsh, cacheFolder+filepath.Base(file)+".jpg")
		return ctx, err
	} else {
		return "", nil
	}
}

func handleWebpDecoding(fileContent []byte) (out0 image.Image, out1 error) {
	defer logger.Out2(logger.In1("filesystem/metadata", "handleWebpDecoding", "fileContent", fileContent), &out0, &out1)
	img, err := webp.Decode(bytes.NewReader(fileContent))
	return img, err
}
