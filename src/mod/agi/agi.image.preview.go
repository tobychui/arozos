package agi

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"image/png"
	"path/filepath"
	"strings"

	"github.com/disintegration/imaging"
	"github.com/gen2brain/h265/heic"
	"github.com/robertkrimen/otto"

	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/filesystem"
	metadata "imuslab.com/arozos/mod/filesystem/metadata"
)

/*
	imagelib.renderPreview

	Draws a photo upright and scaled down to fit a box, keeping its shape.
	The file manager thumbnails are square crops, so a gallery that shows
	photos in their own shape (the Photo app's waterfall layout) needs this
	instead. Unlike resizeImage it also reads RAW photos (their embedded
	JPEG) and HEIC / HEIF, applies the EXIF orientation (and the HEIC
	rotation), never enlarges, and refuses pictures too large to decode.
*/

const (
	//Largest non RAW source read into memory (RAW files are limited by
	//metadata.RenderRAWImage, which only keeps their embedded JPEG)
	previewMaxFileSize = 80 << 20
	//Largest picture decoded, in pixels (a 108 MP phone photo still fits)
	previewMaxPixels   = 120_000_000
	previewJPEGQuality = 82
)

// previewSourceConfig reports the size of an encoded picture without
// decoding it, so oversized ones are refused before they are decoded
func previewSourceConfig(data []byte) (image.Config, error) {
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	return cfg, err
}

// decodePreviewSource decodes the bytes of a picture upright. ext is the
// extension of the source file (with the dot), which picks the decoder.
func decodePreviewSource(data []byte, ext string) (image.Image, error) {
	cfg, err := previewSourceConfig(data)
	if err != nil {
		return nil, err
	}
	if cfg.Width <= 0 || cfg.Height <= 0 {
		return nil, errors.New("picture has no size")
	}
	if int64(cfg.Width)*int64(cfg.Height) > previewMaxPixels {
		return nil, errors.New("picture too large to preview")
	}
	if metadata.IsHEICImageFile("preview" + strings.ToLower(ext)) {
		//irot / imir / clap of the container, like the media server applies
		return heic.Decode(bytes.NewReader(data), heic.Options{AutoRotate: true})
	}
	return imaging.Decode(bytes.NewReader(data), imaging.AutoOrientation(true))
}

// fitPreview scales img down to fit maxWidth x maxHeight, keeping its shape.
// A limit of 0 or less leaves that side free; smaller pictures are kept.
func fitPreview(img image.Image, maxWidth int, maxHeight int) image.Image {
	b := img.Bounds()
	if maxWidth <= 0 {
		maxWidth = b.Dx()
	}
	if maxHeight <= 0 {
		maxHeight = b.Dy()
	}
	if b.Dx() <= maxWidth && b.Dy() <= maxHeight {
		return img
	}
	return imaging.Fit(img, maxWidth, maxHeight, imaging.Linear)
}

// encodePreview encodes img as "jpeg" (transparent parts turn white) or "png"
func encodePreview(img image.Image, format string) ([]byte, error) {
	var buf bytes.Buffer
	switch format {
	case "png":
		if err := png.Encode(&buf, img); err != nil {
			return nil, err
		}
	case "jpeg":
		b := img.Bounds()
		flat := image.NewRGBA(image.Rect(0, 0, b.Dx(), b.Dy()))
		draw.Draw(flat, flat.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
		draw.Draw(flat, flat.Bounds(), img, b.Min, draw.Over)
		if err := jpeg.Encode(&buf, flat, &jpeg.Options{Quality: previewJPEGQuality}); err != nil {
			return nil, err
		}
	default:
		return nil, errors.New("unsupported preview format " + format)
	}
	return buf.Bytes(), nil
}

// previewFormatOf names the encoding a preview written to dest gets
func previewFormatOf(dest string) (string, error) {
	switch strings.ToLower(filepath.Ext(dest)) {
	case ".jpg", ".jpeg":
		return "jpeg", nil
	case ".png":
		return "png", nil
	}
	return "", errors.New("preview must be saved as .jpg or .png")
}

// renderPreview reads the photo at rpath and returns it upright, scaled to
// fit maxWidth x maxHeight and encoded in format, with its new size
func renderPreview(fsh *filesystem.FileSystemHandler, rpath string, maxWidth int, maxHeight int, format string) ([]byte, int, int, error) {
	fshAbs := fsh.FileSystemAbstraction
	if !fshAbs.FileExists(rpath) || fshAbs.IsDir(rpath) {
		return nil, 0, 0, errors.New("source not exists")
	}

	var data []byte
	ext := strings.ToLower(filepath.Ext(rpath))
	if metadata.IsRawImageFile(rpath) {
		//The embedded full size JPEG, as the viewer shows it
		jpegData, err := metadata.RenderRAWImage(fsh, rpath)
		if err != nil {
			return nil, 0, 0, err
		}
		data = jpegData
		ext = ".jpg"
	} else {
		if fshAbs.GetFileSize(rpath) > previewMaxFileSize {
			return nil, 0, 0, errors.New("image file too large to preview")
		}
		fileData, err := fshAbs.ReadFile(rpath)
		if err != nil {
			return nil, 0, 0, err
		}
		data = fileData
	}

	img, err := decodePreviewSource(data, ext)
	if err != nil {
		return nil, 0, 0, err
	}
	img = fitPreview(img, maxWidth, maxHeight)
	encoded, err := encodePreview(img, format)
	if err != nil {
		return nil, 0, 0, err
	}
	b := img.Bounds()
	return encoded, b.Dx(), b.Dy(), nil
}

// injectImagePreviewFunction adds imagelib.renderPreview to the VM; it is
// called from injectImageLibFunctions before the imagelib object is built
func (g *Gateway) injectImagePreviewFunction(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User

	//Render a photo upright and fitted, require (src, dest, maxWidth, maxHeight).
	//dest "" returns the preview as a JPEG data URL instead of writing it.
	vm.Set("_imagelib_renderPreview", func(call otto.FunctionCall) otto.Value {
		vsrc, err := call.Argument(0).ToString()
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}
		vdest := ""
		if !call.Argument(1).IsUndefined() && !call.Argument(1).IsNull() {
			vdest, _ = call.Argument(1).ToString()
		}
		maxWidth, _ := call.Argument(2).ToInteger()
		maxHeight, _ := call.Argument(3).ToInteger()

		if !u.CanRead(vsrc) {
			g.RaiseError(errors.New("Permission Denied"))
			return otto.FalseValue()
		}
		srcfsh, rsrc, err := static.VirtualPathToRealPath(vsrc, u)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		format := "jpeg"
		var destfsh *filesystem.FileSystemHandler
		rdest := ""
		if vdest != "" {
			format, err = previewFormatOf(vdest)
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}
			if !u.CanWrite(vdest) {
				g.RaiseError(errors.New("Permission Denied"))
				return otto.FalseValue()
			}
			destfsh, rdest, err = static.VirtualPathToRealPath(vdest, u)
			if err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}
		}

		encoded, width, height, err := renderPreview(srcfsh, rsrc, int(maxWidth), int(maxHeight), format)
		if err != nil {
			g.RaiseError(err)
			return otto.FalseValue()
		}

		result := map[string]interface{}{
			"width":  width,
			"height": height,
		}
		if destfsh == nil {
			result["dataURL"] = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(encoded)
		} else {
			destfsh.FileSystemAbstraction.MkdirAll(filepath.Dir(rdest), 0755)
			if err := destfsh.FileSystemAbstraction.WriteFile(rdest, encoded, 0775); err != nil {
				g.RaiseError(err)
				return otto.FalseValue()
			}
		}
		value, _ := vm.ToValue(result)
		return value
	})
}
