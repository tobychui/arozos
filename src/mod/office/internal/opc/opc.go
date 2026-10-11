/*
Package opc writes Open Packaging Conventions packages - the zip container
of .docx, .xlsx and .pptx - for the legacy format converters: parts with
their content types, [Content_Types].xml and relationship parts.
*/
package opc

import (
	"archive/zip"
	"bytes"
	"path"
	"sort"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/office/internal/xmltree"
)

// XMLHeader starts every XML part
const XMLHeader = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` + "\n"

// Relationship types
const (
	RelOfficeDocument = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"
	RelCoreProps      = "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties"
	RelImage          = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image"
	RelHyperlink      = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
	RelStyles         = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"
	RelTheme          = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme"
)

// media content types by extension
var mediaTypes = map[string]string{
	"png":  "image/png",
	"jpeg": "image/jpeg",
	"jpg":  "image/jpeg",
	"gif":  "image/gif",
	"bmp":  "image/bmp",
	"tiff": "image/tiff",
	"tif":  "image/tiff",
	"emf":  "image/x-emf",
	"wmf":  "image/x-wmf",
	"pict": "image/pict",
	"rels": "application/vnd.openxmlformats-package.relationships+xml",
	"xml":  "application/xml",
	"vml":  "application/vnd.openxmlformats-officedocument.vmlDrawing",
}

type part struct {
	name string
	data []byte
}

// Package is a package being written
type Package struct {
	parts     []part
	overrides map[string]string
	defaults  map[string]string
}

// New starts an empty package
func New() *Package {
	return &Package{overrides: map[string]string{}, defaults: map[string]string{}}
}

// Add stores a part with an explicit content type ("" leaves it to the
// extension default, as for media)
func (p *Package) Add(name, contentType string, data []byte) {
	name = strings.TrimPrefix(name, "/")
	p.parts = append(p.parts, part{name, data})
	if contentType != "" {
		p.overrides["/"+name] = contentType
		return
	}
	ext := strings.ToLower(strings.TrimPrefix(path.Ext(name), "."))
	if ct, ok := mediaTypes[ext]; ok {
		p.defaults[ext] = ct
	} else {
		p.defaults[ext] = "application/octet-stream"
	}
}

// AddXML stores an XML part, prefixing the XML declaration
func (p *Package) AddXML(name, contentType, body string) {
	p.Add(name, contentType, []byte(XMLHeader+body))
}

// Bytes writes the package: [Content_Types].xml first, then the parts in
// the order they were added
func (p *Package) Bytes() ([]byte, error) {
	var ct strings.Builder
	ct.WriteString(XMLHeader + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`)
	p.defaults["rels"] = mediaTypes["rels"]
	p.defaults["xml"] = mediaTypes["xml"]
	var exts []string
	for e := range p.defaults {
		exts = append(exts, e)
	}
	sort.Strings(exts)
	for _, e := range exts {
		ct.WriteString(`<Default Extension="` + e + `" ContentType="` + p.defaults[e] + `"/>`)
	}
	var names []string
	for n := range p.overrides {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		ct.WriteString(`<Override PartName="` + xmltree.Escape(n) + `" ContentType="` + p.overrides[n] + `"/>`)
	}
	ct.WriteString(`</Types>`)

	var buf bytes.Buffer
	zw := zip.NewWriter(&buf)
	write := func(name string, data []byte, method uint16) error {
		w, err := zw.CreateHeader(&zip.FileHeader{Name: name, Method: method})
		if err != nil {
			return err
		}
		_, err = w.Write(data)
		return err
	}
	if err := write("[Content_Types].xml", []byte(ct.String()), zip.Deflate); err != nil {
		return nil, err
	}
	for _, pt := range p.parts {
		method := uint16(zip.Deflate)
		switch strings.ToLower(path.Ext(pt.name)) {
		case ".png", ".jpeg", ".jpg", ".gif":
			method = zip.Store // compressed already
		}
		if err := write(pt.name, pt.data, method); err != nil {
			return nil, err
		}
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// Rels collects the relationships of one part
type Rels struct {
	list []rel
}

type rel struct {
	id, typ, target string
	external        bool
}

// Add records a relationship and returns its id (rId1, rId2, ...)
func (r *Rels) Add(typ, target string, external bool) string {
	id := "rId" + strconv.Itoa(len(r.list)+1)
	r.list = append(r.list, rel{id, typ, target, external})
	return id
}

// Len is the number of relationships
func (r *Rels) Len() int { return len(r.list) }

// XML renders the relationship part
func (r *Rels) XML() string {
	var b strings.Builder
	b.WriteString(XMLHeader + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`)
	for _, l := range r.list {
		b.WriteString(`<Relationship Id="` + l.id + `" Type="` + l.typ + `" Target="` + xmltree.Escape(l.target) + `"`)
		if l.external {
			b.WriteString(` TargetMode="External"`)
		}
		b.WriteString(`/>`)
	}
	b.WriteString(`</Relationships>`)
	return b.String()
}

// RelsPath is the relationship part of a part: word/document.xml ->
// word/_rels/document.xml.rels
func RelsPath(partName string) string {
	dir, file := path.Split(strings.TrimPrefix(partName, "/"))
	return dir + "_rels/" + file + ".rels"
}
