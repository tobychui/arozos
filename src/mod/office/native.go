package office

/*
	native.go - the Office suite's own files are .docx / .xlsx / .pptx.

	Docs, Sheets and Slides save straight into the OOXML formats: what their
	writers produce is what Word, Excel and PowerPoint open. OOXML cannot
	hold everything the editors can (a Slides chart that stays a live chart,
	video, animations, some conditional formats, ...), so every file the
	suite writes also carries the editor's own document inside the package:

	    arozos/document.json            the envelope {type, app, version,
	                                    meta, body}; media replaced by
	                                    "asset://<name>" references
	    arozos/manifest.json            {version, app, fingerprint, parts}
	    arozos/assets/<name>            media the OOXML parts do not hold
	    arozos/_rels/document.json.rels ties the two parts above to the
	                                    document, so the package stays a
	                                    well-formed OPC package

	Media the OOXML already holds (a picture's word/media/image3.png) is not
	stored twice: manifest.parts points the asset at that part instead.

	An office application ignores a relationship type it does not know, so
	the file opens there as the plain document it also is. When one of them
	saves it, the OOXML parts are rewritten and the fingerprint - a hash over
	every part but our own and the two package indexes - no longer matches.
	The next open in the suite then imports the OOXML the usual way rather
	than trusting an embedded copy that is out of date. The same happens for
	a file that never had an embedded copy: one made by Word, Excel or
	PowerPoint.
*/

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"path"
	"sort"
	"strconv"
	"strings"
)

// The three document kinds, as the envelope's "app" field names them
const (
	AppDocument     = "document"
	AppSpreadsheet  = "spreadsheet"
	AppPresentation = "presentation"
)

const (
	envelopeType = "arozos/office"

	nativeDir          = "arozos/"
	nativeDocPart      = "arozos/document.json"
	nativeManifestPart = "arozos/manifest.json"
	nativeAssetDir     = "arozos/assets/"
	nativeDocRels      = "arozos/_rels/document.json.rels"
	nativeVersion      = 1

	nativeRelNS       = "http://schemas.imuslab.com/arozos/office/2026/relationships/"
	nativeRelDocument = nativeRelNS + "document"
	nativeRelManifest = nativeRelNS + "manifest"
	nativeRelAsset    = nativeRelNS + "asset"
	// unique within _rels/.rels: every writer here numbers its own rId1..n
	nativeRootRelID = "rIdArozOSDocument"
)

// AppForExt maps a file extension (".docx", case-insensitive) to the app
// that lives in it, or "" for a format that is not one of the three
func AppForExt(ext string) string {
	switch strings.ToLower(ext) {
	case ".docx":
		return AppDocument
	case ".xlsx":
		return AppSpreadsheet
	case ".pptx":
		return AppPresentation
	}
	return ""
}

// ExtForApp is the extension the app's documents are saved under
func ExtForApp(app string) string {
	switch app {
	case AppDocument:
		return ".docx"
	case AppSpreadsheet:
		return ".xlsx"
	case AppPresentation:
		return ".pptx"
	}
	return ""
}

type nativeManifest struct {
	Version     int    `json:"version"`
	App         string `json:"app"`
	Fingerprint string `json:"fingerprint"`
	// asset name -> the OOXML part holding the same bytes
	Parts map[string]string `json:"parts,omitempty"`
}

/* ---------------- writing ---------------- */

/*
BuildNativeFile writes an editor envelope ({type, app, version, meta,
body}) as the app's Office file: the body rendered to OOXML, plus the
envelope itself embedded so the suite reopens exactly what it saved.

readVpath resolves the media?file= links the body carries (nil where there
are none - the browser build keeps its media as data URLs). A picture is
read once and shared by the OOXML part and the embedded copy.
*/
func BuildNativeFile(app, envelope string, readVpath func(string) ([]byte, error)) ([]byte, error) {
	var env struct {
		Type string          `json:"type"`
		App  string          `json:"app"`
		Body json.RawMessage `json:"body"`
	}
	if err := json.Unmarshal([]byte(envelope), &env); err != nil {
		return nil, errors.New("invalid document JSON: " + err.Error())
	}
	if env.Type != envelopeType {
		return nil, errors.New("not an ArozOS Office document")
	}
	if env.App != app {
		return nil, errors.New("a " + env.App + " cannot be saved as " + ExtForApp(app))
	}
	if len(env.Body) == 0 || string(env.Body) == "null" {
		return nil, errors.New("the document has no body")
	}

	// each linked file is read once, whoever asks first
	cache := map[string][]byte{}
	read := readVpath
	if readVpath != nil {
		read = func(vp string) ([]byte, error) {
			if b, ok := cache[vp]; ok {
				return b, nil
			}
			b, err := readVpath(vp)
			if err == nil {
				cache[vp] = b
			}
			return b, err
		}
	}

	pkg, err := buildOOXML(app, string(env.Body), read)
	if err != nil {
		return nil, err
	}
	return embedEnvelope(pkg, app, envelope, read)
}

// buildOOXML renders a body into the app's Office format
func buildOOXML(app, body string, readVpath func(string) ([]byte, error)) ([]byte, error) {
	switch app {
	case AppDocument:
		doc, err := ParseDocumentJSON(body)
		if err != nil {
			return nil, err
		}
		return BuildDocxMedia(doc, readVpath)
	case AppSpreadsheet:
		wb, err := ParseWorkbookJSON(body)
		if err != nil {
			return nil, err
		}
		return BuildXlsx(wb)
	case AppPresentation:
		p, err := ParsePresentationJSON(body)
		if err != nil {
			return nil, err
		}
		// no sidecar: video and audio travel inside the embedded copy
		return buildPptx(p, readVpath, false)
	}
	return nil, errors.New("unknown document kind: " + app)
}

// embedEnvelope adds the arozos/ parts to a freshly written OOXML package
func embedEnvelope(pkg []byte, app, envelope string, readVpath func(string) ([]byte, error)) ([]byte, error) {
	zr, err := zip.NewReader(bytes.NewReader(pkg), int64(len(pkg)))
	if err != nil {
		return nil, err
	}
	parts, err := readParts(zr)
	if err != nil {
		return nil, err
	}

	doc, assets, err := collectAssets(envelope, readVpath)
	if err != nil {
		return nil, err
	}

	// media parts by content, so an asset the OOXML already carries is not
	// written a second time
	byHash := map[[32]byte]string{}
	for _, name := range sortedPartNames(parts) {
		if isMediaPart(name) {
			h := sha256.Sum256(parts[name])
			if _, ok := byHash[h]; !ok {
				byHash[h] = name
			}
		}
	}
	man := nativeManifest{
		Version:     nativeVersion,
		App:         app,
		Fingerprint: packageFingerprint(parts),
		Parts:       map[string]string{},
	}
	own := map[string][]byte{}
	for name, data := range assets {
		if part, ok := byHash[sha256.Sum256(data)]; ok {
			man.Parts[name] = part
		} else {
			own[name] = data
		}
	}
	manJSON, err := json.Marshal(man)
	if err != nil {
		return nil, err
	}

	// relationships from the document part to the manifest and its assets
	var rels strings.Builder
	rels.WriteString(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n" +
		`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
		`<Relationship Id="rId1" Type="` + nativeRelManifest + `" Target="manifest.json"/>`)
	ownNames := sortedKeys(own)
	for i, name := range ownNames {
		rels.WriteString(`<Relationship Id="rId` + strconv.Itoa(i+2) + `" Type="` + nativeRelAsset +
			`" Target="assets/` + xmlEscape(name) + `"/>`)
	}
	rels.WriteString(`</Relationships>`)

	var ct strings.Builder
	ct.WriteString(`<Override PartName="/` + nativeDocPart + `" ContentType="application/json"/>`)
	ct.WriteString(`<Override PartName="/` + nativeManifestPart + `" ContentType="application/json"/>`)
	for _, name := range ownNames {
		mime, ok := extToMime[strings.TrimPrefix(path.Ext(name), ".")]
		if !ok {
			mime = "application/octet-stream"
		}
		ct.WriteString(`<Override PartName="/` + nativeAssetDir + xmlEscape(name) + `" ContentType="` + mime + `"/>`)
	}
	rootRel := `<Relationship Id="` + nativeRootRelID + `" Type="` + nativeRelDocument + `" Target="` + nativeDocPart + `"/>`

	out := new(bytes.Buffer)
	zw := zip.NewWriter(out)
	sawCT, sawRels := false, false
	for _, f := range zr.File {
		switch f.Name {
		case "[Content_Types].xml":
			sawCT = true
			if err := writeDeflated(zw, f.Name, insertBefore(parts[f.Name], "</Types>", ct.String())); err != nil {
				return nil, err
			}
		case "_rels/.rels":
			sawRels = true
			if err := writeDeflated(zw, f.Name, insertBefore(parts[f.Name], "</Relationships>", rootRel)); err != nil {
				return nil, err
			}
		default:
			// untouched parts are copied as they were compressed
			if err := zw.Copy(f); err != nil {
				return nil, err
			}
		}
	}
	if !sawCT || !sawRels {
		return nil, errors.New("the Office writer produced an incomplete package")
	}
	if err := writeDeflated(zw, nativeDocPart, doc); err != nil {
		return nil, err
	}
	if err := writeDeflated(zw, nativeManifestPart, manJSON); err != nil {
		return nil, err
	}
	if err := writeDeflated(zw, nativeDocRels, []byte(rels.String())); err != nil {
		return nil, err
	}
	for _, name := range ownNames {
		// media is compressed already
		w, err := zw.CreateHeader(&zip.FileHeader{Name: nativeAssetDir + name, Method: zip.Store})
		if err != nil {
			return nil, err
		}
		if _, err := w.Write(own[name]); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return out.Bytes(), nil
}

func writeDeflated(zw *zip.Writer, name string, data []byte) error {
	w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: zip.Deflate})
	if err != nil {
		return err
	}
	_, err = w.Write(data)
	return err
}

// insertBefore puts s in front of the last occurrence of closing tag in xml
func insertBefore(xml []byte, closing, s string) []byte {
	i := bytes.LastIndex(xml, []byte(closing))
	if i < 0 {
		return xml
	}
	out := make([]byte, 0, len(xml)+len(s))
	out = append(out, xml[:i]...)
	out = append(out, s...)
	return append(out, xml[i:]...)
}

/* ---------------- reading ---------------- */

/*
AssetSink decides what a media asset becomes in the envelope ReadNativeFile
returns: ArozOS writes it into a working directory and hands back a
media?file= link (so megabytes of pictures never ride the JSON to the
browser); the browser build passes nil and gets data URLs.
*/
type AssetSink func(name string, data []byte) (string, error)

/*
ReadNativeFile opens one of the app's Office files as an editor envelope.
A file the suite wrote itself, and nobody has changed since, gives back the
embedded document exactly; anything else - a file from Word, Excel or
PowerPoint, or one of ours they have edited - is imported from its OOXML.
*/
func ReadNativeFile(app string, data []byte, sink AssetSink) (string, error) {
	if ExtForApp(app) == "" {
		return "", errors.New("unknown document kind: " + app)
	}
	if len(data) < 4 || data[0] != 'P' || data[1] != 'K' {
		return "", errors.New("not a valid " + ExtForApp(app) + " file")
	}
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return "", errors.New("not a valid " + ExtForApp(app) + " file")
	}
	parts, err := readParts(zr)
	if err != nil {
		return "", err
	}
	if env, ok := embeddedEnvelope(app, parts, sink); ok {
		return env, nil
	}

	body, err := importOOXML(app, data)
	if err != nil {
		return "", err
	}
	if sink != nil {
		if body, err = externalizeDataURLs(body, sink); err != nil {
			return "", err
		}
	}
	return `{"type":"` + envelopeType + `","app":"` + app + `","version":1,"meta":{},"body":` + body + `}`, nil
}

// HasEmbeddedDocument reports whether an Office file carries a current
// editor copy (what ReadNativeFile would use instead of importing)
func HasEmbeddedDocument(app string, data []byte) bool {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return false
	}
	parts, err := readParts(zr)
	if err != nil {
		return false
	}
	man, ok := validManifest(app, parts)
	return ok && man != nil
}

func importOOXML(app string, data []byte) (string, error) {
	switch app {
	case AppDocument:
		doc, err := ParseDocx(data)
		if err != nil {
			return "", err
		}
		return DocumentToJSON(doc)
	case AppSpreadsheet:
		wb, err := ParseXlsx(data)
		if err != nil {
			return "", err
		}
		return WorkbookToJSON(wb)
	case AppPresentation:
		p, err := ParsePptx(data)
		if err != nil {
			return "", err
		}
		return PresentationToJSON(p)
	}
	return "", errors.New("unknown document kind: " + app)
}

func validManifest(app string, parts map[string][]byte) (*nativeManifest, bool) {
	raw, ok := parts[nativeManifestPart]
	if !ok {
		return nil, false
	}
	var man nativeManifest
	if err := json.Unmarshal(raw, &man); err != nil {
		return nil, false
	}
	if man.Version != nativeVersion || man.App != app || man.Fingerprint == "" {
		return nil, false
	}
	if man.Fingerprint != packageFingerprint(parts) {
		return nil, false // the OOXML changed since we wrote it
	}
	return &man, true
}

// embeddedEnvelope returns the editor copy of a package the suite wrote,
// when there is one and it is still current
func embeddedEnvelope(app string, parts map[string][]byte, sink AssetSink) (string, bool) {
	man, ok := validManifest(app, parts)
	if !ok {
		return "", false
	}
	raw, ok := parts[nativeDocPart]
	if !ok {
		return "", false
	}
	var root interface{}
	if err := json.Unmarshal(raw, &root); err != nil {
		return "", false
	}
	obj, ok := root.(map[string]interface{})
	if !ok || obj["type"] != envelopeType || obj["app"] != app || obj["body"] == nil {
		return "", false
	}

	resolved := map[string]string{}
	failed := false
	resolve := func(name string) (string, bool) {
		if s, ok := resolved[name]; ok {
			return s, true
		}
		var data []byte
		if part, ok := man.Parts[name]; ok {
			data, ok = parts[part]
			if !ok {
				return "", false
			}
		} else if d, ok := parts[nativeAssetDir+name]; ok {
			data = d
		} else {
			return "", false
		}
		var s string
		if sink == nil {
			s = dataURLOf(data, strings.TrimPrefix(path.Ext(name), "."))
		} else {
			var err error
			if s, err = sink(name, data); err != nil {
				failed = true
				return "", false
			}
		}
		resolved[name] = s
		return s, true
	}
	root = transformStrings(root, func(s string) string {
		return resolveAssetRefs(s, resolve)
	})
	if failed {
		return "", false
	}
	out, err := marshalNoEscape(root)
	if err != nil {
		return "", false
	}
	return string(out), true
}

/*
externalizeDataURLs takes the media an importer inlined (every picture of
a .docx arrives as a data URL) out of the body through sink, so the JSON
the browser receives carries links instead of megabytes of base64. Fonts
and anything else that is not a picture, video or audio stay inline: a
link would reach an @font-face without the type it needs.
*/
func externalizeDataURLs(body string, sink AssetSink) (string, error) {
	if !strings.Contains(body, "data:") {
		return body, nil
	}
	var root interface{}
	if err := json.Unmarshal([]byte(body), &root); err != nil {
		return "", errors.New("invalid document JSON: " + err.Error())
	}
	done := map[string]string{}
	var sinkErr error
	take := func(s string) (string, bool) {
		if l, ok := done[s]; ok {
			return l, true
		}
		data, ext, ok := parseAnyDataURL(s)
		if !ok || ext == "bin" {
			return "", false
		}
		h := sha256.Sum256(data)
		link, err := sink(hex.EncodeToString(h[:])[:16]+"."+ext, data)
		if err != nil {
			sinkErr = err
			return "", false
		}
		done[s] = link
		return link, true
	}
	root = transformStrings(root, func(s string) string {
		if strings.HasPrefix(s, "data:") {
			if l, ok := take(s); ok {
				return l
			}
			return s
		}
		if !strings.Contains(s, "data:") {
			return s
		}
		return htmlMediaAttrRe.ReplaceAllStringFunc(s, func(m string) string {
			sub := htmlMediaAttrRe.FindStringSubmatch(m)
			quoted := sub[2]
			val := quoted[1 : len(quoted)-1]
			if !strings.HasPrefix(val, "data:") {
				return m
			}
			l, ok := take(val)
			if !ok {
				return m
			}
			return sub[1] + quoted[:1] + htmlAttrEscape(l) + quoted[:1]
		})
	})
	if sinkErr != nil {
		return "", sinkErr
	}
	out, err := marshalNoEscape(root)
	if err != nil {
		return "", err
	}
	return string(out), nil
}

func htmlAttrEscape(s string) string {
	return strings.NewReplacer("&", "&amp;", `"`, "&quot;", "'", "&#39;", "<", "&lt;", ">", "&gt;").Replace(s)
}

/* ---------------- package helpers ---------------- */

// maxPartSize guards the reader against a zip bomb: no part of a real
// office document inflates past this
const maxPartSize = 512 << 20

func readParts(zr *zip.Reader) (map[string][]byte, error) {
	parts := map[string][]byte{}
	for _, f := range zr.File {
		if strings.HasSuffix(f.Name, "/") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return nil, errors.New("corrupted package part " + f.Name)
		}
		b, err := io.ReadAll(io.LimitReader(rc, maxPartSize+1))
		rc.Close()
		if err != nil {
			return nil, errors.New("corrupted package part " + f.Name)
		}
		if len(b) > maxPartSize {
			return nil, errors.New("package part " + f.Name + " is too large")
		}
		parts[f.Name] = b
	}
	return parts, nil
}

func sortedPartNames(parts map[string][]byte) []string {
	names := make([]string, 0, len(parts))
	for n := range parts {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// fingerprintedPart: the parts whose content decides whether the embedded
// copy still describes the file. The two package indexes are left out
// because the embedding itself edits them.
func fingerprintedPart(name string) bool {
	return name != "[Content_Types].xml" && name != "_rels/.rels" && !strings.HasPrefix(name, nativeDir)
}

// packageFingerprint hashes every OOXML part, names included, in a fixed
// order - so a part added, removed, renamed or changed all show
func packageFingerprint(parts map[string][]byte) string {
	h := sha256.New()
	var n [8]byte
	for _, name := range sortedPartNames(parts) {
		if !fingerprintedPart(name) {
			continue
		}
		binary.BigEndian.PutUint64(n[:], uint64(len(name)))
		h.Write(n[:])
		h.Write([]byte(name))
		binary.BigEndian.PutUint64(n[:], uint64(len(parts[name])))
		h.Write(n[:])
		h.Write(parts[name])
	}
	return hex.EncodeToString(h.Sum(nil))
}

// isMediaPart: a binary part an embedded asset may point at instead of
// being stored twice
func isMediaPart(name string) bool {
	if !fingerprintedPart(name) {
		return false
	}
	switch strings.ToLower(path.Ext(name)) {
	case ".xml", ".rels", ".vml", "":
		return false
	}
	return true
}
