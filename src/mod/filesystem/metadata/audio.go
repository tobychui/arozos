package metadata

import (
	"bytes"
	"image"
	"image/jpeg"
	"path/filepath"

	"github.com/dhowden/tag"
	"github.com/nfnt/resize"
	"github.com/oliamb/cutter"
	"imuslab.com/arozos/mod/filesystem"
)

func generateThumbnailForAudio(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (string, error) {
	if fsh.RequireBuffer {
		return "", nil
	}
	fshAbs := fsh.FileSystemAbstraction
	//This extension is supported by id4. Call to library
	f, err := fshAbs.Open(file)
	if err != nil {
		return "", err
	}
	defer f.Close()
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
		out, err := fshAbs.Create(cacheFolder + filepath.Base(file) + ".jpg")
		if err != nil {
			return "", err
		}
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
		croppedImg, _ := cutter.Crop(m, cutter.Config{
			Width:  480,
			Height: 480,
			Mode:   cutter.Centered,
		})

		//Write the cache image to disk

		jpeg.Encode(out, croppedImg, nil)

		if !generateOnly {
			//return the image as well
			ctx, err := getImageAsBase64(fsh, cacheFolder+filepath.Base(file)+".jpg")
			return ctx, err
		}

	}
	return "", nil
}
