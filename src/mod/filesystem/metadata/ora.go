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
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

// OpenRaster (.ora) is a zip holding stack.xml, one PNG per layer, the
// flattened mergedimage.png and a small Thumbnails/thumbnail.png. Pixel
// Studio writes it as its second layered format.

// oraPreview returns the best preview image inside an OpenRaster file: the
// flattened image when it is there (sharper), else the bundled thumbnail.
func oraPreview(data []byte) (out0 image.Image, out1 error) {
	defer logger.Out2(logger.In1("filesystem/metadata", "oraPreview", "data", data), &out0, &out1)
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
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
			logger.DebugErr("filesystem/metadata", err)
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

func generateThumbnailForORA(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (out0 string, out1 error) {
	defer logger.Out2(logger.In4("filesystem/metadata", "generateThumbnailForORA", "fsh", fsh, "cacheFolder", cacheFolder, "file", file, "generateOnly", generateOnly), &out0, &out1)
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
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}
	img, err := oraPreview(data)
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}

	outputFile := cacheFolder + filepath.Base(file) + ".jpg"
	if err := writeCroppedThumbnail(fsh, img, outputFile); err != nil {
		logger.DebugErr("filesystem/metadata", err)
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
func writeCroppedThumbnail(fsh *filesystem.FileSystemHandler, img image.Image, outputFile string) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/metadata", "writeCroppedThumbnail", "fsh", fsh, "&img", &img, "outputFile", outputFile), &out0)
	b := img.Bounds()
	img = flattenOnWhite(img)
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
		logger.DebugErr("filesystem/metadata", err)
		return err
	}
	//Encoded in memory and written with WriteFile, which works on every
	//file system type, the buffered ones (S3, FTP, WebDAV) included
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, cropped, &jpeg.Options{Quality: 90}); err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return err
	}
	return fsh.FileSystemAbstraction.WriteFile(outputFile, buf.Bytes(), 0644)
}

// flattenOnWhite draws img over a white background, for JPEG output (which
// has no alpha)
func flattenOnWhite(img image.Image) (out0 image.Image) {
	defer logger.Out1(logger.In1("filesystem/metadata", "flattenOnWhite", "&img", &img), &out0)
	b := img.Bounds()
	flat := image.NewRGBA(b)
	draw.Draw(flat, b, &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(flat, b, img, b.Min, draw.Over)
	return flat
}
