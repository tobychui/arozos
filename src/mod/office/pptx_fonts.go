package office

/*
	pptx_fonts.go - fonts a deck carries with it.

	A presentation may embed the font files it was designed in, so that it
	looks the same on a machine that does not have them installed. The
	Slides editor can use those directly: each face becomes an @font-face
	rule built from a data URL, and the CSS font stacks the reader writes
	then resolve to the real thing instead of falling back.

	The payload behind <p:embeddedFont> is a .fntdata part, which is an
	Embedded OpenType (EOT) wrapper around a font file. Two of the three
	shapes it comes in can be unwrapped here:

	  - a bare sfnt (TrueType / OpenType / WOFF) written straight into the
	    part, which some producers do
	  - an uncompressed EOT, where the font file is simply the tail of the
	    part - this is what PowerPoint writes

	The third is an EOT whose payload is MicroType Express compressed
	(the TTEMBED_TTCOMPRESSED flag) - Google Slides writes these. Undoing
	that needs a full MTX decompressor, which is a large piece of code for
	a format nothing else in ArozOS reads, so those faces are skipped and
	the text falls back to the CSS stack. Skipping is safe: the deck still
	renders, just in a substitute face.
*/

import (
	"encoding/base64"
	"encoding/binary"
	"strings"
)

// Size limits on embedded fonts. They ride in the document body, which is
// posted whole on every save, so a deck that embeds a full CJK face (those
// run to several megabytes) would make itself painful to edit. The cap
// keeps the common case - a Latin family, tens of kilobytes per face -
// while letting anything extravagant fall back to a substitute font.
const (
	maxEmbeddedFontBytes      = 1500 * 1024
	maxEmbeddedFontTotalBytes = 4000 * 1024
)

// eotCompressed is TTEMBED_TTCOMPRESSED - the payload is MicroType Express
const eotCompressed = 0x00000004

// sfntMagic reports the mime type of a bare font file, "" when data is not one
func sfntMagic(data []byte) string {
	if len(data) < 4 {
		return ""
	}
	switch string(data[:4]) {
	case "OTTO":
		return "font/otf"
	case "wOFF":
		return "font/woff"
	case "wOF2":
		return "font/woff2"
	case "true", "ttcf":
		return "font/ttf"
	}
	if data[0] == 0 && data[1] == 1 && data[2] == 0 && data[3] == 0 {
		return "font/ttf"
	}
	return ""
}

// decodeEmbeddedFont unwraps a .fntdata part into a font file a browser can
// load. ok is false when the part is compressed or otherwise unreadable.
func decodeEmbeddedFont(data []byte) (out []byte, mime string, ok bool) {
	if m := sfntMagic(data); m != "" {
		return data, m, true
	}
	if len(data) < 82 {
		return nil, "", false
	}
	eotSize := binary.LittleEndian.Uint32(data[0:4])
	fontDataSize := binary.LittleEndian.Uint32(data[4:8])
	flags := binary.LittleEndian.Uint32(data[12:16])
	// the magic number sits at a fixed offset and pins that this really is
	// an EOT rather than some other container
	if binary.LittleEndian.Uint16(data[34:36]) != 0x504C {
		return nil, "", false
	}
	if flags&eotCompressed != 0 {
		return nil, "", false
	}
	if int(eotSize) != len(data) || fontDataSize == 0 || int(fontDataSize) > len(data) {
		return nil, "", false
	}
	payload := data[len(data)-int(fontDataSize):]
	m := sfntMagic(payload)
	if m == "" {
		return nil, "", false
	}
	return payload, m, true
}

// embeddedFontFaces reads <p:embeddedFontLst> and returns the faces of the
// families in "used", smallest first so the cap spends its budget on the
// faces most likely to matter
func (d *pptxDoc) embeddedFontFaces(used map[string]bool) []*EmbeddedFont {
	lst := d.pres.first("embeddedFontLst")
	if lst == nil {
		return nil
	}
	type candidate struct {
		face *EmbeddedFont
		size int
	}
	var cands []candidate
	for _, ef := range lst.all("embeddedFont") {
		family := ef.path("font")
		if family == nil {
			continue
		}
		name := family.attr("typeface")
		if name == "" || !used[strings.ToLower(name)] {
			continue
		}
		for _, variant := range []struct {
			el     string
			weight int
			style  string
		}{
			{"regular", 400, ""},
			{"bold", 700, ""},
			{"italic", 400, "italic"},
			{"boldItalic", 700, "italic"},
		} {
			ref := ef.first(variant.el)
			if ref == nil {
				continue
			}
			rid := ref.attrNS("relationships", "id")
			if rid == "" {
				rid = ref.attr("id")
			}
			target, okRel := d.presRels[rid]
			if !okRel {
				continue
			}
			raw, okFile := d.files[resolvePartPath("ppt", target)]
			if !okFile || len(raw) > maxEmbeddedFontBytes {
				continue
			}
			font, mime, okFont := decodeEmbeddedFont(raw)
			if !okFont || len(font) > maxEmbeddedFontBytes {
				continue
			}
			cands = append(cands, candidate{
				face: &EmbeddedFont{
					Family: name,
					Weight: variant.weight,
					Style:  variant.style,
					Src: "data:" + mime + ";base64," +
						base64.StdEncoding.EncodeToString(font),
				},
				size: len(font),
			})
		}
	}
	// smallest first, then fill up to the whole-deck budget
	for i := 1; i < len(cands); i++ {
		for j := i; j > 0 && cands[j].size < cands[j-1].size; j-- {
			cands[j], cands[j-1] = cands[j-1], cands[j]
		}
	}
	var out []*EmbeddedFont
	total := 0
	for _, c := range cands {
		if total+c.size > maxEmbeddedFontTotalBytes {
			break
		}
		total += c.size
		out = append(out, c.face)
	}
	return out
}
