package metadata

import (
	"errors"
	"image/jpeg"
	"path/filepath"
	"time"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/metadata/pdfrender"
	"imuslab.com/arozos/mod/info/logger"
)

// pdfThumbnailTimeout bounds the render of one PDF thumbnail; a page that
// takes longer is saved as far as it got
const pdfThumbnailTimeout = 15 * time.Second

// generateThumbnailForPDF draws the first page of a PDF with the built-in
// renderer (metadata/pdfrender), so no external tool is needed on the host
func generateThumbnailForPDF(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (out0 string, out1 error) {
	defer logger.Out2(logger.In4("filesystem/metadata", "generateThumbnailForPDF", "fsh", fsh, "cacheFolder", cacheFolder, "file", file, "generateOnly", generateOnly), &out0, &out1)
	if fsh.RequireBuffer {
		return "", nil
	}
	fshAbs := fsh.FileSystemAbstraction
	if !fshAbs.FileExists(file) {
		//The user removed this file before the thumbnail is finished
		return "", errors.New("Source not exists")
	}

	f, err := fshAbs.Open(file)
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}
	info, err := f.Stat()
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		f.Close()
		return "", err
	}
	//A partial render (ErrTimeout) still makes a usable thumbnail
	img, err := pdfrender.Thumbnail(f, info.Size(), 480, pdfThumbnailTimeout)
	f.Close()
	if img == nil {
		if err == nil {
			err = errors.New("pdf render failed")
		}
		return "", err
	}

	outputFile := cacheFolder + filepath.Base(file) + ".jpg"
	out, err := fshAbs.Create(outputFile)
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}
	err = jpeg.Encode(out, img, &jpeg.Options{Quality: 90})
	out.Close()
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}

	if !generateOnly {
		return getImageAsBase64(fsh, outputFile)
	}
	return "", nil
}
