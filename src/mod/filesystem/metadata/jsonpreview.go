package metadata

import (
	"bufio"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"io"
	"net/http"
	"path/filepath"
	"strings"

	"golang.org/x/image/webp"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
)

/*
	Previews carried inside JSON documents

	A JSON document whose top level is an object may carry its own preview
	image in a string field named "_ao_preview": a base64 encoded JPEG, PNG
	or WebP picture, either bare or as a data URL

		{"_ao_preview": "data:image/jpeg;base64,/9j/4AAQ...", "format": "aopart", ...}

	The apps that write such files (the 3D Modeler for its parts, assemblies
	and drawings) put the field first, so it is found without reading the
	rest of the document. The field may still appear anywhere at the top
	level: the other values are skipped token by token, never held in memory
	as a whole, and reading stops after jsonPreviewScanLimit bytes.

	Only the extensions in jsonPreviewFormats are looked at. A file of one of
	them without the field simply has no thumbnail.

	Security: the field is written by whoever wrote the file, so it is
	untrusted, and the thumbnail is shown to every user who can see the
	file. It therefore never reaches a browser as it is:
	  - only JPEG, PNG and WebP are accepted, by the data URL's media type
	    and again by the bytes themselves (no SVG, HTML or any other text
	    format, and none of the other decoders this binary carries)
	  - the picture is decoded to pixels and a new JPEG is encoded from
	    them, so nothing appended to or hidden in the original survives
	  - its size is checked before it is decoded
	The thumbnail endpoints send what is cached only as an image
	(SafeThumbnailContentType).
*/

// JSONPreviewKey is the top level field holding the preview of a JSON document
const JSONPreviewKey = "_ao_preview"

// JSON based formats that may carry a preview in JSONPreviewKey
var jsonPreviewFormats = []string{".json", ".aopart", ".aoasm", ".aodrw"}

const (
	//How far into a file the field is looked for
	jsonPreviewScanLimit = 16 << 20
	//The longest preview string accepted (base64 of a ~6 MB picture)
	jsonPreviewMaxChars = 8 << 20
	//The largest picture decoded, by side and by pixel count
	jsonPreviewMaxSide   = 8192
	jsonPreviewMaxPixels = 32 << 20
	//Thumbnail side, as for the other renderers
	jsonPreviewThumbnailSide = 480
)

// extractJSONPreview finds the JSONPreviewKey string at the top level of a
// JSON object and returns the picture it holds, still encoded (JPEG, PNG,
// ...). Nested objects are not searched.
func extractJSONPreview(r io.Reader) (out0 []byte, out1 error) {
	defer logger.Out2(logger.In1("filesystem/metadata", "extractJSONPreview", "r", r), &out0, &out1)
	br := bufio.NewReader(io.LimitReader(r, jsonPreviewScanLimit))

	//Anything that does not start as an object is not looked at further
	for {
		b, err := br.ReadByte()
		if err != nil {
			logger.DebugErr("filesystem/metadata", err)
			return nil, errors.New("not a json object")
		}
		if b == ' ' || b == '\t' || b == '\r' || b == '\n' {
			continue
		}
		if b == 0xEF {
			//UTF-8 byte order mark
			if rest, err := br.Peek(2); err == nil && rest[0] == 0xBB && rest[1] == 0xBF {
				br.Discard(2)
				continue
			}
		}
		if b != '{' {
			return nil, errors.New("not a json object")
		}
		br.UnreadByte()
		break
	}

	dec := json.NewDecoder(br)
	if _, err := dec.Token(); err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return nil, err
	}
	for dec.More() {
		keyToken, err := dec.Token()
		if err != nil {
			logger.DebugErr("filesystem/metadata", err)
			return nil, err
		}
		key, _ := keyToken.(string)
		if key != JSONPreviewKey {
			if err := skipJSONValue(dec); err != nil {
				logger.DebugErr("filesystem/metadata", err)
				return nil, err
			}
			continue
		}

		valueToken, err := dec.Token()
		if err != nil {
			logger.DebugErr("filesystem/metadata", err)
			return nil, err
		}
		payload, ok := valueToken.(string)
		if !ok {
			return nil, errors.New(JSONPreviewKey + " is not a string")
		}
		return decodePreviewPayload(payload)
	}
	return nil, errors.New("no " + JSONPreviewKey + " field in this json file")
}

// skipJSONValue reads past the next value of dec, however deeply nested.
func skipJSONValue(dec *json.Decoder) (out0 error) {
	defer logger.Out1(logger.In1("filesystem/metadata", "skipJSONValue", "dec", dec), &out0)
	depth := 0
	for {
		token, err := dec.Token()
		if err != nil {
			logger.DebugErr("filesystem/metadata", err)
			return err
		}
		if delim, ok := token.(json.Delim); ok {
			if delim == '{' || delim == '[' {
				depth++
			} else {
				depth--
			}
		}
		if depth == 0 {
			return nil
		}
	}
}

// decodePreviewPayload turns the field's text, bare base64 or a data URL of
// an image, into the picture's bytes.
func decodePreviewPayload(payload string) (out0 []byte, out1 error) {
	defer logger.Out2(logger.In1("filesystem/metadata", "decodePreviewPayload", "payload", payload), &out0, &out1)
	if len(payload) == 0 {
		return nil, errors.New(JSONPreviewKey + " is empty")
	}
	if len(payload) > jsonPreviewMaxChars {
		return nil, errors.New(JSONPreviewKey + " is too large")
	}

	if strings.HasPrefix(payload, "data:") {
		comma := strings.IndexByte(payload, ',')
		if comma < 0 {
			return nil, errors.New("malformed data url in " + JSONPreviewKey)
		}
		header := strings.ToLower(payload[len("data:"):comma])
		switch header {
		case "image/jpeg;base64", "image/jpg;base64", "image/png;base64", "image/webp;base64":
		default:
			return nil, errors.New(JSONPreviewKey + " is not a base64 encoded JPEG, PNG or WebP picture")
		}
		payload = payload[comma+1:]
	}

	//Line breaks are allowed inside the base64 text
	payload = strings.Map(func(r rune) rune {
		if r == '\r' || r == '\n' || r == ' ' || r == '\t' {
			return -1
		}
		return r
	}, payload)

	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		data, err = base64.RawStdEncoding.DecodeString(payload)
	}
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return nil, errors.New(JSONPreviewKey + " is not valid base64")
	}
	if len(data) == 0 {
		return nil, errors.New(JSONPreviewKey + " is empty")
	}
	return data, nil
}

// decodePreviewImage decodes the picture of a preview field: JPEG, PNG or
// WebP only, refusing ones whose size would take too much memory to decode.
func decodePreviewImage(data []byte) (out0 image.Image, out1 error) {
	defer logger.Out2(logger.In1("filesystem/metadata", "decodePreviewImage", "data", data), &out0, &out1)
	config, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return nil, err
	}
	var decode func(io.Reader) (image.Image, error)
	switch format {
	case "jpeg":
		decode = jpeg.Decode
	case "png":
		decode = png.Decode
	case "webp":
		decode = webp.Decode
	default:
		return nil, errors.New("preview image is not a JPEG, PNG or WebP picture")
	}
	if config.Width <= 0 || config.Height <= 0 {
		return nil, errors.New("preview image has no size")
	}
	if config.Width > jsonPreviewMaxSide || config.Height > jsonPreviewMaxSide ||
		int64(config.Width)*int64(config.Height) > jsonPreviewMaxPixels {
		return nil, errors.New("preview image is too large")
	}
	img, err := decode(bytes.NewReader(data))
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return nil, err
	}
	return img, nil
}

// SafeThumbnailContentType returns the media type to send a cached
// thumbnail with, and false when its bytes are not a picture. Thumbnails are
// always pictures the renderers wrote, but a .metadata/.cache folder sits on
// the user's own drive, where a file can be put by hand: sending its type as
// sniffed could serve HTML from this site to whoever opens the thumbnail.
func SafeThumbnailContentType(data []byte) (out0 string, out1 bool) {
	defer logger.Out2(logger.In1("filesystem/metadata", "SafeThumbnailContentType", "data", data), &out0, &out1)
	contentType := http.DetectContentType(data)
	switch contentType {
	case "image/jpeg", "image/png", "image/gif", "image/webp":
		return contentType, true
	}
	return "", false
}

func generateThumbnailForJSONPreview(fsh *filesystem.FileSystemHandler, cacheFolder string, file string, generateOnly bool) (out0 string, out1 error) {
	defer logger.Out2(logger.In4("filesystem/metadata", "generateThumbnailForJSONPreview", "fsh", fsh, "cacheFolder", cacheFolder, "file", file, "generateOnly", generateOnly), &out0, &out1)
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
	data, err := extractJSONPreview(f)
	f.Close()
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}

	img, err := decodePreviewImage(data)
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}

	//Letterboxed rather than cropped, so a wide drawing sheet stays whole
	thumbnail := fitOnCanvas(img, jsonPreviewThumbnailSide, color.White)

	outputFile := cacheFolder + filepath.Base(file) + ".jpg"
	outf, err := fshAbs.Create(outputFile)
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}
	err = jpeg.Encode(outf, thumbnail, &jpeg.Options{Quality: 90})
	outf.Close()
	if err != nil {
		logger.DebugErr("filesystem/metadata", err)
		return "", err
	}

	if !generateOnly && fshAbs.FileExists(outputFile) {
		//return the image as well
		return getImageAsBase64(fsh, outputFile)
	} else if !fshAbs.FileExists(outputFile) {
		return "", errors.New("Image generation failed")
	}
	return "", nil
}
