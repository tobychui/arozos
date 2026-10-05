package metadata

import (
	"archive/zip"
	"bytes"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	_ "image/png"
	"path/filepath"

	"github.com/nfnt/resize"
	"github.com/oliamb/cutter"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/utils"
)

// OpenRaster (.ora) is a zip holding stack.xml, one PNG per layer, the
// flattened mergedimage.png and a small Thumbnails/thumbnail.png. Pixel
// Studio writes it as its second layered format.

// oraPreview returns the best preview image inside an OpenRaster file: the
// flattened image when it is there (sharper), else the bundled thumbnail.
func oraPreview(data []byte) (image.Image, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, err
	}
	var merged, thumb *zip.File
	for _, f := range zr.File {
		switch f.Name {
		case "mergedimage.png":
			merged = f
		case "Thumbnails/thumbnail.png":
			thumb = f
		}
	}
	for _, f := range []*zip.File{merged, thumb} {
		if f == nil {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		img, _, err := image.Decode(rc)
		rc.Close()
		if err == nil {
			return img, nil
		}
	}
	return nil, errors.New("no preview image in OpenRaster file")
}

func generateThumbnailForORA(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (string, error) {
	if fsh.RequireBuffer {
		return "", nil
	}
	fshAbs := fsh.FileSystemAbstraction
	if !fshAbs.FileExists(file) {
		//The user removed this file before the thumbnail is finished
		return "", errors.New("Source not exists")
	}

	data, err := fshAbs.ReadFile(file)
	if err != nil {
		return "", err
	}
	img, err := oraPreview(data)
	if err != nil {
		return "", err
	}

	outputFile := cacheFolder + filepath.Base(file) + ".jpg"
	if err := writeCroppedThumbnail(fsh, img, outputFile); err != nil {
		return "", err
	}

	if !generateOnly && fshAbs.FileExists(outputFile) {
		return getImageAsBase64(fsh, outputFile)
	} else if !utils.FileExists(outputFile) {
		return "", errors.New("Image generation failed")
	}
	return "", nil
}

// writeCroppedThumbnail scales img so its short side is 480 px, crops the
// centre square and writes it as a JPEG cache file. Transparent areas turn
// white (JPEG has no alpha).
func writeCroppedThumbnail(fsh *filesystem.FileSystemHandler, img image.Image, outputFile string) error {
	b := img.Bounds()
	flat := image.NewRGBA(b)
	draw.Draw(flat, b, &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(flat, b, img, b.Min, draw.Over)
	img = flat
	var m image.Image
	if b.Dx() > b.Dy() {
		m = resize.Resize(0, 480, img, resize.Lanczos3)
	} else {
		m = resize.Resize(480, 0, img, resize.Lanczos3)
	}
	cropped, err := cutter.Crop(m, cutter.Config{
		Width:  480,
		Height: 480,
		Mode:   cutter.Centered,
	})
	if err != nil {
		return err
	}
	outf, err := fsh.FileSystemAbstraction.Create(outputFile)
	if err != nil {
		return err
	}
	defer outf.Close()
	return jpeg.Encode(outf, cropped, &jpeg.Options{Quality: 90})
}
