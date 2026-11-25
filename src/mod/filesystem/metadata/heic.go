package metadata

import (
	"bytes"
	"errors"
	"image"
	"image/jpeg"
	"path/filepath"
	"strings"

	"github.com/gen2brain/h265/heic"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

/*
	HEIC / HEIF photos (the iPhone camera format)

	Decoded by github.com/gen2brain/h265, a pure Go HEVC decoder (MIT,
	no CGo), so it works on every build target. Importing it also registers
	"heic" with image.Decode, which lets imagelib read these files too.

	Browsers other than Safari cannot show HEIC, so the media server sends
	RenderHEICImage's JPEG for display, as it does for RAW photos.
*/

// HEIC image format extensions supported by the system
var HeicImageFormats = []string{".heic", ".heif", ".hif"}

// Largest HEIC file that is decoded. An iPhone photo is 1 to 5 MB; the
// decoded picture costs 4 bytes a pixel on top of the file.
const maxHEICFileSize = 64 << 20

// Thumbnails short side, in pixels
const heicThumbnailSize = 480

// IsHEICImageFile checks if the given file path is a HEIC / HEIF image
func IsHEICImageFile(filePath string) (out0 bool) {
	defer logger.Out1(logger.In1("filesystem/metadata", "IsHEICImageFile", "filePath", filePath), &out0)
	ext := strings.ToLower(filepath.Ext(filePath))
	return utils.StringInArray(HeicImageFormats, ext)
}

// readHEIC reads a HEIC file of any file system, refusing oversized ones
func readHEIC(fsh *filesystem.FileSystemHandler, file string) (out0 []byte, out1 error) {
	defer logger.Out2(logger.In2("filesystem/metadata", "readHEIC", "fsh", fsh, "file", file), &out0, &out1)
	fshAbs := fsh.FileSystemAbstraction
	if !fshAbs.FileExists(file) {
		return nil, errors.New("source not exists")
	}
	if fshAbs.GetFileSize(file) > maxHEICFileSize {
		return nil, errors.New("HEIC file too large")
	}
	return fshAbs.ReadFile(file)
}

// decodeHEIC decodes the primary picture upright: the rotation (irot),
// mirror (imir) and clean aperture (clap) of the file are applied.
func decodeHEIC(data []byte) (out0 image.Image, out1 error) {
	defer logger.Out2(logger.In1("filesystem/metadata", "decodeHEIC", "data", data), &out0, &out1)
	return heic.Decode(bytes.NewReader(data), heic.Options{AutoRotate: true})
}

// decodeHEICPreview decodes the picture used for a thumbnail. The embedded
// thumbnail is used when it is large enough (it saves decoding a 12 MP
// grid), else the full picture.
func decodeHEICPreview(data []byte) (out0 image.Image, out1 error) {
	defer logger.Out2(logger.In1("filesystem/metadata", "decodeHEICPreview", "data", data), &out0, &out1)
	if cfg, err := heic.DecodeThumbnailConfig(bytes.NewReader(data)); err == nil &&
		min(cfg.Width, cfg.Height) >= heicThumbnailSize {
		if img, err := heic.DecodeThumbnail(bytes.NewReader(data), heic.Options{AutoRotate: true}); err == nil {
			return img, nil
		}
	}
	return decodeHEIC(data)
}

// Generate thumbnail for HEIC images
func generateThumbnailForHEIC(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (out0 string, out1 error) {
	defer logger.Out2(logger.In4("filesystem/metadata", "generateThumbnailForHEIC", "fsh", fsh, "cacheFolder", cacheFolder, "file", file, "generateOnly", generateOnly), &out0, &out1)
	data, err := readHEIC(fsh, file)
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}
	img, err := decodeHEICPreview(data)
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", errors.New("failed to decode HEIC image: " + err.Error())
	}

	outputFile := cacheFolder + filepath.Base(file) + ".jpg"
	if err := writeCroppedThumbnail(fsh, img, outputFile); err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}
	if generateOnly {
		return "", nil
	}
	return getImageAsBase64(fsh, outputFile)
}

// RenderHEICImage decodes a HEIC photo and returns it as a full size JPEG
// for browsers that cannot show HEIC
func RenderHEICImage(fsh *filesystem.FileSystemHandler, file string) (out0 []byte, out1 error) {
	defer logger.Out2(logger.In2("filesystem/metadata", "RenderHEICImage", "fsh", fsh, "file", file), &out0, &out1)
	data, err := readHEIC(fsh, file)
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return nil, err
	}
	img, err := decodeHEIC(data)
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return nil, errors.New("failed to decode HEIC image: " + err.Error())
	}
	return encodeHEICAsJPEG(img)
}

// encodeHEICAsJPEG writes a decoded picture as a JPEG; transparent areas
// (HEIC may carry alpha) turn white
func encodeHEICAsJPEG(img image.Image) (out0 []byte, out1 error) {
	defer logger.Out2(logger.In1("filesystem/metadata", "encodeHEICAsJPEG", "&img", &img), &out0, &out1)
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, flattenOnWhite(img), &jpeg.Options{Quality: 92}); err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return nil, err
	}
	return buf.Bytes(), nil
}
