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

// Largest HEIC file that is decoded on a host with 4 GB of memory or less
// (largeimage.go). An iPhone photo is 1 to 5 MB; the decoded picture costs
// 4 bytes a pixel on top of the file.
const maxHEICFileSize = 64 << 20

// Thumbnails short side, in pixels
const heicThumbnailSize = 480

// IsHEICImageFile checks if the given file path is a HEIC / HEIF image
func IsHEICImageFile(filePath string) bool {
	ext := strings.ToLower(filepath.Ext(filePath))
	return utils.StringInArray(HeicImageFormats, ext)
}

// readHEIC reads a HEIC file of any file system, refusing oversized ones.
// Without an error, release must be called once the picture is done with.
func readHEIC(fsh *filesystem.FileSystemHandler, file string) (data []byte, release func(), err error) {
	fshAbs := fsh.FileSystemAbstraction
	if !fshAbs.FileExists(file) {
		return nil, nil, errors.New("source not exists")
	}
	release, ok := admitImageSize(fshAbs.GetFileSize(file), maxHEICFileSize)
	if !ok {
		return nil, nil, errors.New("HEIC file too large")
	}
	data, err = fshAbs.ReadFile(file)
	if err != nil {
		release()
		return nil, nil, err
	}
	return data, release, nil
}

// decodeHEIC decodes the primary picture upright: the rotation (irot),
// mirror (imir) and clean aperture (clap) of the file are applied.
func decodeHEIC(data []byte) (image.Image, error) {
	return heic.Decode(bytes.NewReader(data), heic.Options{AutoRotate: true})
}

// decodeHEICPreview decodes the picture used for a thumbnail. The embedded
// thumbnail is used when it is large enough (it saves decoding a 12 MP
// grid), else the full picture.
func decodeHEICPreview(data []byte) (image.Image, error) {
	if cfg, err := heic.DecodeThumbnailConfig(bytes.NewReader(data)); err == nil &&
		min(cfg.Width, cfg.Height) >= heicThumbnailSize {
		if img, err := heic.DecodeThumbnail(bytes.NewReader(data), heic.Options{AutoRotate: true}); err == nil {
			return img, nil
		}
	}
	return decodeHEIC(data)
}

// Generate thumbnail for HEIC images
func generateThumbnailForHEIC(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (string, error) {
	data, release, err := readHEIC(fsh, file)
	if err != nil {
		return "", err
	}
	defer release()
	img, err := decodeHEICPreview(data)
	if err != nil {
		return "", errors.New("failed to decode HEIC image: " + err.Error())
	}

	outputFile := cacheFolder + filepath.Base(file) + ".jpg"
	if err := writeCroppedThumbnail(fsh, img, outputFile); err != nil {
		return "", err
	}
	if generateOnly {
		return "", nil
	}
	return getImageAsBase64(fsh, outputFile)
}

// RenderHEICImage decodes a HEIC photo and returns it as a full size JPEG
// for browsers that cannot show HEIC
func RenderHEICImage(fsh *filesystem.FileSystemHandler, file string) ([]byte, error) {
	data, release, err := readHEIC(fsh, file)
	if err != nil {
		return nil, err
	}
	defer release()
	img, err := decodeHEIC(data)
	if err != nil {
		return nil, errors.New("failed to decode HEIC image: " + err.Error())
	}
	return encodeHEICAsJPEG(img)
}

// encodeHEICAsJPEG writes a decoded picture as a JPEG; transparent areas
// (HEIC may carry alpha) turn white
func encodeHEICAsJPEG(img image.Image) ([]byte, error) {
	var buf bytes.Buffer
	if err := jpeg.Encode(&buf, flattenOnWhite(img), &jpeg.Options{Quality: 92}); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}
