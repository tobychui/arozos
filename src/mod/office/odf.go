package office

/*
	odf.go - shared plumbing for the OpenDocument (ODF) converters:
	odt (text, docx counterpart), ods (spreadsheet, xlsx counterpart) and
	odp (presentation, pptx counterpart).

	An ODF file is a zip whose FIRST entry must be an uncompressed
	"mimetype" file (that is how readers sniff the format), plus
	META-INF/manifest.xml listing every part. Content lives in content.xml,
	page geometry / headers / footers in styles.xml, embedded pictures
	under Pictures/.
*/

import (
	"archive/zip"
	"bytes"
	"encoding/xml"
	"errors"
	"fmt"
	"image"
	"io"
	"path"
	"strings"
)

// page sizes in millimetres (portrait) shared by the ODF writers
var pageSizesMM = map[string][2]float64{
	"A4":     {210, 297},
	"Letter": {215.9, 279.4},
	"Legal":  {215.9, 355.6},
}

// imageConfigOf probes image bytes for their natural pixel size (decoders
// are registered by the docx writer's blank imports)
func imageConfigOf(data []byte) (image.Config, string, error) {
	return image.DecodeConfig(bytes.NewReader(data))
}

/* ---------- order-preserving XML tree ----------
   The xnode helper (encoding/xml struct unmarshal) merges an element's
   character data into one string, losing its position among child
   elements. ODF text content is mixed ("Some <span>bold</span> rest"),
   so the ODF readers use this token-built tree that keeps text runs and
   child elements interleaved in document order. */

type onode struct {
	name     string
	attrs    map[string]string
	children []onodeChild
}

// exactly one of el / text is set
type onodeChild struct {
	el   *onode
	text string
}

func parseOdfXML(data []byte) (*onode, error) {
	dec := xml.NewDecoder(bytes.NewReader(data))
	root := &onode{name: "#root", attrs: map[string]string{}}
	stack := []*onode{root}
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		switch t := tok.(type) {
		case xml.StartElement:
			el := &onode{name: t.Name.Local, attrs: map[string]string{}}
			for _, a := range t.Attr {
				el.attrs[a.Name.Local] = a.Value
			}
			cur := stack[len(stack)-1]
			cur.children = append(cur.children, onodeChild{el: el})
			stack = append(stack, el)
		case xml.EndElement:
			if len(stack) > 1 {
				stack = stack[:len(stack)-1]
			}
		case xml.CharData:
			if s := string(t); s != "" {
				cur := stack[len(stack)-1]
				cur.children = append(cur.children, onodeChild{text: s})
			}
		}
	}
	return root, nil
}

func (n *onode) attr(name string) string { return n.attrs[name] }

func (n *onode) first(name string) *onode {
	for _, c := range n.children {
		if c.el != nil && c.el.name == name {
			return c.el
		}
	}
	return nil
}

func (n *onode) all(name string) []*onode {
	var out []*onode
	for _, c := range n.children {
		if c.el != nil && c.el.name == name {
			out = append(out, c.el)
		}
	}
	return out
}

func (n *onode) path(names ...string) *onode {
	cur := n
	for _, nm := range names {
		cur = cur.first(nm)
		if cur == nil {
			return nil
		}
	}
	return cur
}

// allText concatenates every text run under n in document order
func (n *onode) allText() string {
	var sb strings.Builder
	var walk func(x *onode)
	walk = func(x *onode) {
		for _, c := range x.children {
			if c.el != nil {
				walk(c.el)
			} else {
				sb.WriteString(c.text)
			}
		}
	}
	walk(n)
	return sb.String()
}

const (
	odtMime = "application/vnd.oasis.opendocument.text"
	odsMime = "application/vnd.oasis.opendocument.spreadsheet"
	odpMime = "application/vnd.oasis.opendocument.presentation"
)

// the office: namespaces shared by content.xml and styles.xml roots
const odfNs = `xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
	`xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" ` +
	`xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ` +
	`xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ` +
	`xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" ` +
	`xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" ` +
	`xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" ` +
	`xmlns:xlink="http://www.w3.org/1999/xlink" ` +
	`xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" ` +
	`office:version="1.2"`

// buildOdfZip assembles a valid ODF package: stored mimetype first, then
// the parts and pictures, with a generated manifest
func buildOdfZip(mime string, parts map[string]string, pictures []mediaEntry) ([]byte, error) {
	buf := new(bytes.Buffer)
	zw := zip.NewWriter(buf)

	// mimetype: MUST be first and MUST be stored (uncompressed)
	mw, err := zw.CreateHeader(&zip.FileHeader{Name: "mimetype", Method: zip.Store})
	if err != nil {
		return nil, err
	}
	if _, err = mw.Write([]byte(mime)); err != nil {
		return nil, err
	}

	var manifest strings.Builder
	manifest.WriteString(`<?xml version="1.0" encoding="UTF-8"?>` + "\n" +
		`<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.2">` +
		`<manifest:file-entry manifest:full-path="/" manifest:media-type="` + mime + `"/>`)

	addPart := func(name, content string) error {
		w, err := zw.Create(name)
		if err != nil {
			return err
		}
		_, err = w.Write([]byte(content))
		if err != nil {
			return err
		}
		manifest.WriteString(`<manifest:file-entry manifest:full-path="` + name +
			`" manifest:media-type="text/xml"/>`)
		return nil
	}
	for _, name := range []string{"content.xml", "styles.xml", "meta.xml"} {
		if c, ok := parts[name]; ok {
			if err := addPart(name, c); err != nil {
				return nil, err
			}
		}
	}
	for _, m := range pictures {
		name := fmt.Sprintf("Pictures/image%d.%s", m.index, m.ext)
		w, err := zw.Create(name)
		if err != nil {
			return nil, err
		}
		if _, err = w.Write(m.data); err != nil {
			return nil, err
		}
		manifest.WriteString(`<manifest:file-entry manifest:full-path="` + name +
			`" manifest:media-type="image/` + m.ext + `"/>`)
	}
	manifest.WriteString(`</manifest:manifest>`)
	w, err := zw.Create("META-INF/manifest.xml")
	if err != nil {
		return nil, err
	}
	if _, err = w.Write([]byte(manifest.String())); err != nil {
		return nil, err
	}
	if err := zw.Close(); err != nil {
		return nil, err
	}
	return buf.Bytes(), nil
}

// readOdfZip loads an ODF package into a filename -> bytes map and returns
// its declared mimetype ("" when absent)
func readOdfZip(data []byte) (map[string][]byte, string, error) {
	zr, err := zip.NewReader(bytes.NewReader(data), int64(len(data)))
	if err != nil {
		return nil, "", errors.New("not a valid OpenDocument (zip) file")
	}
	files := map[string][]byte{}
	mime := ""
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
		files[name] = b
		if name == "mimetype" {
			mime = strings.TrimSpace(string(b))
		}
	}
	return files, mime, nil
}

// odfMeta renders a minimal meta.xml
func odfMeta() string {
	return `<?xml version="1.0" encoding="UTF-8"?>` + "\n" +
		`<office:document-meta xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ` +
		`xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" office:version="1.2">` +
		`<office:meta><meta:generator>ArozOS Office/1.0</meta:generator></office:meta>` +
		`</office:document-meta>`
}

/* ---------- unit helpers ---------- */

// px -> "N.NNNcm" (ODF wants absolute lengths; 96 px per inch)
func pxToCm(px float64) string {
	return fmt.Sprintf("%.3fcm", px*2.54/96.0)
}

// "N.NNcm" / "Nmm" / "Nin" / "Npt" -> px (0 when unparseable)
func odfLenToPx(s string) float64 {
	s = strings.TrimSpace(s)
	var v float64
	var unit string
	if n, err := fmt.Sscanf(s, "%f%s", &v, &unit); n < 1 || err != nil {
		return 0
	}
	switch unit {
	case "cm":
		return v * 96.0 / 2.54
	case "mm":
		return v * 96.0 / 25.4
	case "in":
		return v * 96.0
	case "pt":
		return v * 96.0 / 72.0
	case "px":
		return v
	}
	return 0
}

// mm -> "N.NNNcm" for page geometry
func mmToCm(mm float64) string {
	return fmt.Sprintf("%.3fcm", mm/10.0)
}

// odfPicture registers picture bytes decoded from a data URL; returns the
// package path ("" when the src is not an embeddable data URL)
func odfPicture(src string, media *[]mediaEntry) string {
	data, ext, ok := decodeDataURL(src)
	if !ok {
		return ""
	}
	idx := len(*media) + 1
	*media = append(*media, mediaEntry{index: idx, ext: ext, data: data})
	return fmt.Sprintf("Pictures/image%d.%s", idx, ext)
}
