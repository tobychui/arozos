package metadata

import (
	"bytes"
	"image"
	"image/jpeg"
	"path/filepath"

	"github.com/nfnt/resize"
	"github.com/oliamb/cutter"
	"imuslab.com/arozos/mod/filesystem"
)

func generateThumbnailForImage(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (string, error) {
	if fsh.RequireBuffer {
		return "", nil
	}
	fshAbs := fsh.FileSystemAbstraction
	imageBytes, err := fshAbs.ReadFile(file)
	if err != nil {
		return "", err
	}
	//Resize to desiered width
	img, _, err := image.Decode(bytes.NewReader(imageBytes))
	if err != nil {
		return "", err
	}

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
	out, err := fshAbs.Create(cacheFolder + filepath.Base(file) + ".jpg")
	if err != nil {
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
