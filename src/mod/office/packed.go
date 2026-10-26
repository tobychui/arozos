package office

/*
	packed.go - zip container for the Office suite's native file formats
	(.doca / .xlsa / .ppta).

	Instead of storing media as base64 data URLs (bloated) or as links into
	the host's virtual filesystem (breaks when the file moves to another
	machine), native files are packed as a zip:

	    document.json    the JSON envelope; every media value is replaced
	                     by an "asset://<name>" reference
	    assets/<name>    binary media, deduplicated by content hash

	PackEnvelope also resolves legacy "media?file=<vpath>" links through the
	supplied reader so older documents become portable on their next save.
	UnpackEnvelope transparently passes through legacy plain-JSON files, so
	old documents keep opening without migration.
*/

import (
	"archive/zip"
	"bytes"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"path"
	"strings"
)

const packedDocName = "document.json"

var mimeToExt = map[string]string{
	"image/png": "png", "image/jpeg": "jpeg", "image/jpg": "jpeg",
	"image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp",
	"image/svg+xml": "svg", "image/x-icon": "ico",
	"video/mp4": "mp4", "video/webm": "webm", "video/ogg": "ogv",
	"audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/wav": "wav",
	"audio/ogg": "ogg", "audio/flac": "flac", "audio/aac": "aac",
}

var extToMime = func() map[string]string {
	m := map[string]string{}
	for k, v := range mimeToExt {
		if _, ok := m[v]; !ok {
			m[v] = k
		}
	}
	m["jpg"] = "image/jpeg"
	m["bin"] = "application/octet-stream"
	return m
}()

// parseAnyDataURL decodes any base64 data URL (images, video, audio, ...)
func parseAnyDataURL(s string) ([]byte, string, bool) {
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
	ext, ok := mimeToExt[strings.ToLower(mime)]
	if !ok {
		ext = "bin"
	}
	raw, err := base64.StdEncoding.DecodeString(s[comma+1:])
	if err != nil {
		return nil, "", false
	}
	return raw, ext, true
}

func dataURLOf(data []byte, ext string) string {
	mime, ok := extToMime[strings.ToLower(ext)]
	if !ok {
		mime = "application/octet-stream"
	}
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
}

// mediaLinkVpath extracts the virtual path from an in-app media link such
// as "../media?file=user:/Photo/cat.png" (any number of leading ../ or ./)
func mediaLinkVpath(s string) string {
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

// transformStrings walks every string value in decoded JSON
func transformStrings(v interface{}, fn func(string) string) interface{} {
	switch t := v.(type) {
	case map[string]interface{}:
		for k, vv := range t {
			t[k] = transformStrings(vv, fn)
		}
		return t
	case []interface{}:
		for i, vv := range t {
			t[i] = transformStrings(vv, fn)
		}
		return t
	case string:
		return fn(t)
	}
	return v
}

// PackEnvelope converts an envelope JSON string into the zip container.
// readVpath (optional) resolves legacy media?file= links to file bytes.
func PackEnvelope(envelope string, readVpath func(vpath string) ([]byte, error)) ([]byte, error) {
	var root interface{}
	if err := json.Unmarshal([]byte(envelope), &root); err != nil {
		return nil, errors.New("invalid envelope JSON: " + err.Error())
	}

	assets := map[string][]byte{} // name -> data
	byHash := map[string]string{} // content hash -> name
	add := func(data []byte, ext string) string {
		h := sha1.Sum(data)
		key := hex.EncodeToString(h[:])[:12]
		if name, ok := byHash[key]; ok {
			return name
		}
		name := key + "." + ext
		byHash[key] = name
		assets[name] = data
		return name
	}

	root = transformStrings(root, func(s string) string {
		if data, ext, ok := parseAnyDataURL(s); ok {
			return "asset://" + add(data, ext)
		}
		if vp := mediaLinkVpath(s); vp != "" && readVpath != nil {
			if data, err := readVpath(vp); err == nil && len(data) > 0 {
				ext := strings.TrimPrefix(strings.ToLower(path.Ext(vp)), ".")
				if ext == "" {
					ext = "bin"
				}
				return "asset://" + add(data, ext)
			}
		}
		return s
	})

	doc, err := json.Marshal(root)
	if err != nil {
		return nil, err
	}

	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)
	w, err := zw.Create(packedDocName) // deflate: JSON compresses well
	if err != nil {
		return nil, err
	}
	if _, err = w.Write(doc); err != nil {
		return nil, err
	}
	for name, data := range assets {
		// media is usually pre-compressed - store without recompression
		hw, err := zw.CreateHeader(&zip.FileHeader{Name: "assets/" + name, Method: zip.Store})
		if err != nil {
			return nil, err
		}
		if _, err = hw.Write(data); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// UnpackEnvelopeToLinks restores the envelope JSON from a zip container,
// writing every asset out through saveAsset and rewriting "asset://<name>"
// references with linkFor(name) (typically a media?file= URL into a working
// directory). This keeps the JSON small - the browser streams the media
// instead of carrying megabytes of base64. Legacy plain-JSON files pass
// through unchanged.
func UnpackEnvelopeToLinks(data []byte, saveAsset func(name string, content []byte) error, linkFor func(name string) string) (string, error) {
	if len(data) < 4 || data[0] != 'P' || data[1] != 'K' {
		return string(data), nil // legacy plain JSON document
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", errors.New("corrupted document container")
	}
	var doc []byte
	written := map[string]bool{}
	for _, f := range zr.File {
		name := path.Clean(f.Name)
		rc, err := f.Open()
		if err != nil {
			continue
		}
		b, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}
		if name == packedDocName {
			doc = b
		} else if strings.HasPrefix(name, "assets/") {
			an := strings.TrimPrefix(name, "assets/")
			if err := saveAsset(an, b); err == nil {
				written[an] = true
			}
		}
	}
	if doc == nil {
		return "", errors.New("document container is missing " + packedDocName)
	}

	var root interface{}
	if err := json.Unmarshal(doc, &root); err != nil {
		return "", errors.New("corrupted document.json: " + err.Error())
	}
	root = transformStrings(root, func(s string) string {
		if !strings.HasPrefix(s, "asset://") {
			return s
		}
		name := strings.TrimPrefix(s, "asset://")
		if !written[name] {
			return s
		}
		return linkFor(name)
	})
	out, err := json.Marshal(root)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// UnpackEnvelope restores the envelope JSON from a zip container. Legacy
// plain-JSON files pass through unchanged.
func UnpackEnvelope(data []byte) (string, error) {
	if len(data) < 4 || data[0] != 'P' || data[1] != 'K' {
		return string(data), nil // legacy plain JSON document
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", errors.New("corrupted document container")
	}
	var doc []byte
	assets := map[string][]byte{}
	for _, f := range zr.File {
		rc, err := f.Open()
		if err != nil {
			continue
		}
		b, err := io.ReadAll(rc)
		rc.Close()
		if err != nil {
			continue
		}
		name := path.Clean(f.Name)
		if name == packedDocName {
			doc = b
		} else if strings.HasPrefix(name, "assets/") {
			assets[strings.TrimPrefix(name, "assets/")] = b
		}
	}
	if doc == nil {
		return "", errors.New("document container is missing " + packedDocName)
	}

	var root interface{}
	if err := json.Unmarshal(doc, &root); err != nil {
		return "", errors.New("corrupted document.json: " + err.Error())
	}
	root = transformStrings(root, func(s string) string {
		if !strings.HasPrefix(s, "asset://") {
			return s
		}
		name := strings.TrimPrefix(s, "asset://")
		data, ok := assets[name]
		if !ok {
			return s
		}
		return dataURLOf(data, strings.TrimPrefix(path.Ext(name), "."))
	})
	out, err := json.Marshal(root)
	if err != nil {
		return "", err
	}
	return string(out), nil
}
