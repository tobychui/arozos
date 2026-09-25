package office

/*
	packed.go - the asset store behind the Office suite's documents.

	The editors keep media out of their JSON body as media?file= links into
	the host's file system (or, for small pieces, as data URLs). Anything
	that has to hold a document by itself - a session snapshot, or the
	editor copy embedded in every .docx / .xlsx / .pptx the suite writes
	(native.go) - takes those out into binary assets:

	    document.json    the JSON envelope; every media value is replaced
	                     by an "asset://<name>" reference
	    assets/<name>    binary media, deduplicated by content hash

	A link is taken out wherever it sits: a whole JSON value (a Slides /
	Sheets image src) or inside an HTML string (a Docs body's <img src="...">
	or <video poster="...">), where the attribute value becomes the asset
	ref. The unpackers resolve "asset://<name>" in both positions the same
	way.

	PackEnvelope / UnpackEnvelope(ToLinks) write and read that pair as a zip
	of its own, which is what the "Restore from previous session" snapshots
	(user:/.appdata/Office/session/<app>.osession) are.
*/

import (
	"archive/zip"
	"bytes"
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"html"
	"io"
	"net/url"
	"path"
	"regexp"
	"sort"
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

// htmlMediaAttrRe matches a src or poster attribute in an HTML fragment -
// the places a Docs body keeps its pictures. href is deliberately left out:
// a hyperlink to a file is a link, not content to copy into the document.
var htmlMediaAttrRe = regexp.MustCompile(`(?i)(\s(?:src|poster)\s*=\s*)("[^"]*"|'[^']*')`)

// embedHTMLMediaLinks rewrites every media?file= link held in a src/poster
// attribute of an HTML string through embed, which returns the asset name
// (and false to leave that link as it is).
func embedHTMLMediaLinks(s string, embed func(vpath string) (string, bool)) string {
	if !strings.Contains(s, "media") {
		return s
	}
	return htmlMediaAttrRe.ReplaceAllStringFunc(s, func(m string) string {
		sub := htmlMediaAttrRe.FindStringSubmatch(m)
		quoted := sub[2]
		quote := quoted[:1]
		vp := mediaLinkVpath(html.UnescapeString(quoted[1 : len(quoted)-1]))
		if vp == "" {
			return m
		}
		name, ok := embed(vp)
		if !ok {
			return m
		}
		return sub[1] + quote + "asset://" + name + quote
	})
}

/*
InlineMediaLinks turns the picture links in a body (media?file=, as a
whole value or in an <img src>) into data URLs, read through readVpath.
The OpenDocument writers only take inline pictures; doing this on the
server is what spares the browser downloading every picture and sending it
back as base64. Links that are not a png / jpeg / gif, or cannot be read,
stay as they are.
*/
func InlineMediaLinks(body string, readVpath func(string) ([]byte, error)) (string, error) {
	if readVpath == nil || !strings.Contains(body, "media") {
		return body, nil
	}
	var root interface{}
	if err := json.Unmarshal([]byte(body), &root); err != nil {
		return "", errors.New("invalid document JSON: " + err.Error())
	}
	done := map[string]string{}
	inline := func(vp string) (string, bool) {
		if d, ok := done[vp]; ok {
			return d, d != ""
		}
		data, err := readVpath(vp)
		ext := ""
		if err == nil {
			ext = sniffImageExt(data)
		}
		if ext == "" {
			done[vp] = ""
			return "", false
		}
		d := encodeDataURL(data, ext)
		done[vp] = d
		return d, true
	}
	root = transformStrings(root, func(s string) string {
		if vp := mediaLinkVpath(s); vp != "" {
			if d, ok := inline(vp); ok {
				return d
			}
			return s
		}
		if !strings.Contains(s, "media") {
			return s
		}
		return htmlMediaAttrRe.ReplaceAllStringFunc(s, func(m string) string {
			sub := htmlMediaAttrRe.FindStringSubmatch(m)
			quoted := sub[2]
			vp := mediaLinkVpath(html.UnescapeString(quoted[1 : len(quoted)-1]))
			if vp == "" {
				return m
			}
			d, ok := inline(vp)
			if !ok {
				return m
			}
			return sub[1] + quoted[:1] + d + quoted[:1]
		})
	})
	out, err := marshalNoEscape(root)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

// assetRefRe matches an asset reference inside a larger string. Asset names
// are written by the packers as <hash>.<ext>, so this character set covers
// every name either of them produces.
var assetRefRe = regexp.MustCompile(`asset://([A-Za-z0-9._-]+)`)

// resolveAssetRefs replaces asset references in s through resolve: the
// whole string when it is one reference (the original form, which accepts
// any name), and every reference embedded in it otherwise.
func resolveAssetRefs(s string, resolve func(name string) (string, bool)) string {
	if !strings.Contains(s, "asset://") {
		return s
	}
	if strings.HasPrefix(s, "asset://") {
		if out, ok := resolve(strings.TrimPrefix(s, "asset://")); ok {
			return out
		}
	}
	return assetRefRe.ReplaceAllStringFunc(s, func(m string) string {
		if out, ok := resolve(strings.TrimPrefix(m, "asset://")); ok {
			return out
		}
		return m
	})
}

// assetExt is the extension an embedded file is stored under: the source
// path's own, lower-cased, when it is a plain one, and "bin" otherwise.
func assetExt(vpath string) string {
	ext := strings.TrimPrefix(strings.ToLower(path.Ext(vpath)), ".")
	if ext == "" || len(ext) > 10 {
		return "bin"
	}
	for _, r := range ext {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') {
			return "bin"
		}
	}
	return ext
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
// readVpath (optional) resolves media?file= links to file bytes.
func PackEnvelope(envelope string, readVpath func(vpath string) ([]byte, error)) ([]byte, error) {
	doc, assets, err := collectAssets(envelope, readVpath)
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
	for _, name := range sortedKeys(assets) {
		// media is usually pre-compressed - store without recompression
		hw, err := zw.CreateHeader(&zip.FileHeader{Name: "assets/" + name, Method: zip.Store})
		if err != nil {
			return nil, err
		}
		if _, err = hw.Write(assets[name]); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// sortedKeys keeps the zip entry order stable, so packing the same
// document twice produces the same bytes
func sortedKeys(m map[string][]byte) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

/*
collectAssets takes the media out of an envelope: every data URL and every
media?file= link (resolved through readVpath) becomes an "asset://<name>"
reference, and the bytes come back beside the rewritten JSON, deduplicated
by content hash. Shared by the session container above and by the asset
store inside the suite's .docx / .xlsx / .pptx files (native.go).
*/
func collectAssets(envelope string, readVpath func(vpath string) ([]byte, error)) ([]byte, map[string][]byte, error) {
	var root interface{}
	if err := json.Unmarshal([]byte(envelope), &root); err != nil {
		return nil, nil, errors.New("invalid envelope JSON: " + err.Error())
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

	// a linked file, read through the caller; each vpath is read once
	embedded := map[string]string{}
	embedVpath := func(vp string) (string, bool) {
		if readVpath == nil {
			return "", false
		}
		if name, ok := embedded[vp]; ok {
			return name, true
		}
		data, err := readVpath(vp)
		if err != nil || len(data) == 0 {
			return "", false
		}
		name := add(data, assetExt(vp))
		embedded[vp] = name
		return name, true
	}

	root = transformStrings(root, func(s string) string {
		if data, ext, ok := parseAnyDataURL(s); ok {
			return "asset://" + add(data, ext)
		}
		if vp := mediaLinkVpath(s); vp != "" {
			if name, ok := embedVpath(vp); ok {
				return "asset://" + name
			}
			return s
		}
		return embedHTMLMediaLinks(s, embedVpath)
	})

	doc, err := marshalNoEscape(root)
	if err != nil {
		return nil, nil, err
	}
	return doc, assets, nil
}

// marshalNoEscape is json.Marshal without the HTML escaping: a Docs body is
// mostly markup, and < for every "<" makes it a third bigger for nothing
func marshalNoEscape(v interface{}) ([]byte, error) {
	var buf bytes.Buffer
	enc := json.NewEncoder(&buf)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(v); err != nil {
		return nil, err
	}
	return bytes.TrimRight(buf.Bytes(), "\n"), nil
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
		return resolveAssetRefs(s, func(name string) (string, bool) {
			if !written[name] {
				return "", false
			}
			return linkFor(name), true
		})
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
		return resolveAssetRefs(s, func(name string) (string, bool) {
			data, ok := assets[name]
			if !ok {
				return "", false
			}
			return dataURLOf(data, strings.TrimPrefix(path.Ext(name), ".")), true
		})
	})
	out, err := json.Marshal(root)
	if err != nil {
		return "", err
	}
	return string(out), nil
}
