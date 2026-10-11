package media

import (
	"encoding/base64"
	"net/url"
	"strings"
)

// dataURL decodes a data:image/...;base64,... URL. Returns bytes, file
// extension (png/jpeg/gif) and ok.
func DecodeDataURL(durl string) ([]byte, string, bool) {
	if !strings.HasPrefix(durl, "data:image/") {
		return nil, "", false
	}
	comma := strings.Index(durl, ",")
	if comma < 0 {
		return nil, "", false
	}
	header := durl[:comma]
	if !strings.Contains(header, ";base64") {
		return nil, "", false
	}
	ext := "png"
	if strings.HasPrefix(header, "data:image/jpeg") || strings.HasPrefix(header, "data:image/jpg") {
		ext = "jpeg"
	} else if strings.HasPrefix(header, "data:image/gif") {
		ext = "gif"
	} else if !strings.HasPrefix(header, "data:image/png") {
		return nil, "", false
	}
	raw, err := base64.StdEncoding.DecodeString(durl[comma+1:])
	if err != nil {
		return nil, "", false
	}
	return raw, ext, true
}

/*
ImageSrcBytes resolves a picture source for an OOXML writer: an inline
data URL, or a media?file= link read through readVpath (the editors keep
pictures from the user's storage as links, and the server reads them here
rather than the browser downloading and re-uploading every one). Only the
formats Word and PowerPoint embed as they are qualify - the editors turn
anything else (SVG charts, WebP, BMP) into PNG before saving.
*/
func ImageSrcBytes(src string, readVpath func(string) ([]byte, error)) ([]byte, string, bool) {
	if data, ext, ok := DecodeDataURL(src); ok {
		return data, ext, true
	}
	if readVpath == nil {
		return nil, "", false
	}
	vp := LinkVpath(src)
	if vp == "" {
		return nil, "", false
	}
	data, err := readVpath(vp)
	if err != nil || len(data) == 0 {
		return nil, "", false
	}
	ext := SniffImageExt(data)
	if ext == "" {
		return nil, "", false
	}
	return data, ext, true
}

// SniffImageExt names png / jpeg / gif content by its signature ("" for
// anything else)
func SniffImageExt(data []byte) string {
	switch {
	case len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n":
		return "png"
	case len(data) >= 3 && data[0] == 0xFF && data[1] == 0xD8 && data[2] == 0xFF:
		return "jpeg"
	case len(data) >= 6 && (string(data[:6]) == "GIF87a" || string(data[:6]) == "GIF89a"):
		return "gif"
	}
	return ""
}

// EncodeDataURL builds a data URL from raw image bytes
func EncodeDataURL(data []byte, ext string) string {
	mime := "image/png"
	switch strings.ToLower(ext) {
	case "jpg", "jpeg":
		mime = "image/jpeg"
	case "gif":
		mime = "image/gif"
	case "bmp":
		mime = "image/bmp"
	case "svg":
		mime = "image/svg+xml"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}

var MimeToExt = map[string]string{
	"image/png": "png", "image/jpeg": "jpeg", "image/jpg": "jpeg",
	"image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp",
	"image/svg+xml": "svg", "image/x-icon": "ico",
	"video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv",
	"audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav",
	"audio/ogg": "ogg", "audio/flac": "flac", "audio/aac": "aac",
}

var ExtToMime = func() map[string]string {
	m := map[string]string{}
	for k, v := range MimeToExt {
		if _, ok := m[v]; !ok {
			m[v] = k
		}
	}
	m["jpg"] = "image/jpeg"
	m["bin"] = "application/octet-stream"
	return m
}()

// ParseAnyDataURL decodes any base64 data URL (images, video, audio, ...)
func ParseAnyDataURL(s string) ([]byte, string, bool) {
	if !strings.HasPrefix(s, "data:") {
		return nil, "", false
	}
	comma := strings.Index(s, ",")
	if comma < 0 || comma > 256 {
		return nil, "", false
	}
	header := s[5:comma]
	if !strings.Contains(header, ";base64") {
		return nil, "", false
	}
	mime := strings.SplitN(header, ";", 2)[0]
	ext, ok := MimeToExt[strings.ToLower(mime)]
	if !ok {
		ext = "bin"
	}
	raw, err := base64.StdEncoding.DecodeString(s[comma+1:])
	if err != nil {
		return nil, "", false
	}
	return raw, ext, true
}

func DataURLOf(data []byte, ext string) string {
	mime, ok := ExtToMime[strings.ToLower(ext)]
	if !ok {
		mime = "application/octet-stream"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// LinkVpath extracts the virtual path from an in-app media link such
// as "../media?file=user:/Photo/cat.png" (any number of leading ../ or ./)
func LinkVpath(s string) string {
	t := s
	for strings.HasPrefix(t, "../") || strings.HasPrefix(t, "./") {
		t = strings.TrimPrefix(strings.TrimPrefix(t, "../"), "./")
	}
	t = strings.TrimPrefix(t, "/")
	var q string
	if strings.HasPrefix(t, "media?") {
		q = t[len("media?"):]
	} else if strings.HasPrefix(t, "media/download/?") {
		q = t[len("media/download/?"):]
	} else {
		return ""
	}
	vals, err := url.ParseQuery(q)
	if err != nil {
		return ""
	}
	return vals.Get("file")
}
