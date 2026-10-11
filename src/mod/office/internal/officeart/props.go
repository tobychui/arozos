package officeart

/*
	props.go - shape property tables (OfficeArtFOPT and the secondary /
	tertiary tables) and colours.

	A property is a 14-bit id with a 32-bit value. A "complex" property
	(a string, an array of vertices, a hyperlink) keeps only its byte
	length in the value; the bytes follow the table, in property order.
	Boolean properties come packed sixteen to a property: the low 16 bits
	are the values, the high 16 bits say which of them are set at all.
*/

import (
	"encoding/binary"
	"strings"
	"unicode/utf16"
)

// Property ids used by the importers
const (
	PropRotation           = 0x0004
	PropLTxid              = 0x0080
	PropDxTextLeft         = 0x0081
	PropDyTextTop          = 0x0082
	PropDxTextRight        = 0x0083
	PropDyTextBottom       = 0x0084
	PropWrapText           = 0x0085
	PropAnchorText         = 0x0087
	PropTxflTextFlow       = 0x0088
	PropTextBooleans       = 0x00BF
	PropGtextUNICODE       = 0x00C0
	PropGtextSize          = 0x00C3
	PropGtextFont          = 0x00C5
	PropGtextBooleans      = 0x00FF
	PropCropFromTop        = 0x0100
	PropCropFromBottom     = 0x0101
	PropCropFromLeft       = 0x0102
	PropCropFromRight      = 0x0103
	PropPib                = 0x0104
	PropPibName            = 0x0105
	PropPibFlags           = 0x0106
	PropPictureTransparent = 0x0107
	PropPictureContrast    = 0x0108
	PropPictureBrightness  = 0x0109
	PropBlipBooleans       = 0x013F
	PropGeoLeft            = 0x0140
	PropGeoTop             = 0x0141
	PropGeoRight           = 0x0142
	PropGeoBottom          = 0x0143
	PropShapePath          = 0x0144
	PropVertices           = 0x0145
	PropSegmentInfo        = 0x0146
	PropAdjustValue        = 0x0147 // .. 0x0150 for adjust10
	PropGeometryBooleans   = 0x017F
	PropFillType           = 0x0180
	PropFillColor          = 0x0181
	PropFillOpacity        = 0x0182
	PropFillBackColor      = 0x0183
	PropFillBackOpacity    = 0x0184
	PropFillBlip           = 0x0186
	PropFillAngle          = 0x018B
	PropFillFocus          = 0x018C
	PropFillShadeColors    = 0x0197
	PropFillBooleans       = 0x01BF
	PropLineColor          = 0x01C0
	PropLineOpacity        = 0x01C1
	PropLineBackColor      = 0x01C2
	PropLineWidth          = 0x01CB
	PropLineStyle          = 0x01CD
	PropLineDashing        = 0x01CE
	PropLineStartArrow     = 0x01D0
	PropLineEndArrow       = 0x01D1
	PropLineBooleans       = 0x01FF
	PropShadowColor        = 0x0201
	PropShadowBooleans     = 0x023F
	PropShapeBooleans      = 0x033F
	PropWzName             = 0x0380
	PropWzDescription      = 0x0381
	PropPihlShape          = 0x0382
	PropPosH               = 0x038F
	PropPosRelH            = 0x0390
	PropPosV               = 0x0391
	PropPosRelV            = 0x0392
	PropTableProperties    = 0x039F
	PropTableRowProps      = 0x03A0
	PropGroupBooleans      = 0x03BF
)

// Bits of the boolean property sets (the value bit; its "is set" bit is
// 16 places higher)
const (
	FillFilled         = 4 // PropFillBooleans
	LineLine           = 3 // PropLineBooleans
	ShadowShadow       = 1 // PropShadowBooleans
	GroupHidden        = 1 // PropGroupBooleans
	GroupBehindDoc     = 5 // PropGroupBooleans
	TextFitToShape     = 1 // PropTextBooleans: fFitShapeToText
	TextAutoTextMargin = 3
)

// Props is a decoded property table
type Props struct {
	vals    map[uint16]uint32
	complex map[uint16][]byte
	blip    map[uint16]bool
}

// ParseProps decodes an FOPT, SecondaryFOPT or TertiaryFOPT record (nil
// gives an empty table)
func ParseProps(r *Record) Props {
	p := Props{vals: map[uint16]uint32{}, complex: map[uint16][]byte{}, blip: map[uint16]bool{}}
	if r == nil {
		return p
	}
	n := int(r.Instance)
	b := r.Data
	if n*6 > len(b) {
		n = len(b) / 6
	}
	type pending struct {
		id  uint16
		len int
	}
	var cx []pending
	for i := 0; i < n; i++ {
		opid := binary.LittleEndian.Uint16(b[i*6:])
		op := binary.LittleEndian.Uint32(b[i*6+2:])
		id := opid & 0x3FFF
		p.vals[id] = op
		if opid&0x4000 != 0 {
			p.blip[id] = true
		}
		if opid&0x8000 != 0 {
			cx = append(cx, pending{id, int(op)})
		}
	}
	pos := n * 6
	for _, c := range cx {
		if c.len < 0 || pos >= len(b) {
			break
		}
		end := len(b)
		if c.len < end-pos { // not pos+c.len: it can overflow a 32-bit int
			end = pos + c.len
		}
		p.complex[c.id] = b[pos:end]
		pos = end
	}
	return p
}

// Merge returns a table with o's properties laid over p's (a shape over
// its master, the tertiary table over the primary)
func (p Props) Merge(o Props) Props {
	out := Props{vals: map[uint16]uint32{}, complex: map[uint16][]byte{}, blip: map[uint16]bool{}}
	for _, src := range []Props{p, o} {
		for k, v := range src.vals {
			out.vals[k] = v
		}
		for k, v := range src.complex {
			out.complex[k] = v
		}
		for k, v := range src.blip {
			out.blip[k] = v
		}
	}
	// boolean sets merge bit by bit: only the bits o sets replace p's
	for id, ov := range o.vals {
		if id&0x3F != 0x3F {
			continue
		}
		pv, ok := p.vals[id]
		if !ok {
			continue
		}
		used := ov >> 16
		out.vals[id] = (pv &^ (used | used<<16)) | (ov & (used | used<<16))
	}
	return out
}

// Has reports whether the property is present
func (p Props) Has(id uint16) bool {
	_, ok := p.vals[id]
	return ok
}

// Get returns a property's value
func (p Props) Get(id uint16) (uint32, bool) {
	v, ok := p.vals[id]
	return v, ok
}

// Int returns a property as a signed integer, def when absent
func (p Props) Int(id uint16, def int32) int32 {
	if v, ok := p.vals[id]; ok {
		return int32(v)
	}
	return def
}

// Fixed returns a 16.16 fixed point property, def when absent
func (p Props) Fixed(id uint16, def float64) float64 {
	if v, ok := p.vals[id]; ok {
		return float64(int32(v)) / 65536
	}
	return def
}

// Complex returns the bytes of a complex property
func (p Props) Complex(id uint16) []byte { return p.complex[id] }

// String decodes a complex property holding a UTF-16 string
func (p Props) String(id uint16) string {
	b := p.complex[id]
	u := make([]uint16, 0, len(b)/2)
	for i := 0; i+1 < len(b); i += 2 {
		c := binary.LittleEndian.Uint16(b[i:])
		if c == 0 {
			break
		}
		u = append(u, c)
	}
	return strings.TrimSpace(string(utf16.Decode(u)))
}

// Bool reads one flag of a boolean property set: the value, and whether
// the table states it at all
func (p Props) Bool(id uint16, bit uint) (value, set bool) {
	v, ok := p.vals[id]
	if !ok {
		return false, false
	}
	if v&(1<<(bit+16)) == 0 {
		return false, false
	}
	return v&(1<<bit) != 0, true
}

// BoolDefault reads a flag, def when the table does not state it
func (p Props) BoolDefault(id uint16, bit uint, def bool) bool {
	if v, set := p.Bool(id, bit); set {
		return v
	}
	return def
}

// Array decodes an IMsoArray complex property (vertices, segments,
// shade colours) into its elements
func (p Props) Array(id uint16) [][]byte {
	b := p.complex[id]
	if len(b) < 6 {
		return nil
	}
	n := int(binary.LittleEndian.Uint16(b))
	size := int(binary.LittleEndian.Uint16(b[4:]))
	if size == 0xFFF0 {
		// "half size" vertices: two 16-bit coordinates
		size = 4
	}
	if size <= 0 {
		return nil
	}
	data := b[6:]
	var out [][]byte
	for i := 0; i < n && (i+1)*size <= len(data); i++ {
		out = append(out, data[i*size:(i+1)*size])
	}
	return out
}

// Color flags of an OfficeArtCOLORREF
const (
	ColorPaletteIndex = 0x01
	ColorPaletteRGB   = 0x02
	ColorSystemRGB    = 0x04
	ColorSchemeIndex  = 0x08
	ColorSysIndex     = 0x10
)

// ColorRef is a decoded OfficeArtCOLORREF
type ColorRef struct {
	R, G, B uint8
	Flags   uint8
}

// DecodeColor splits a colour property value
func DecodeColor(v uint32) ColorRef {
	return ColorRef{R: uint8(v), G: uint8(v >> 8), B: uint8(v >> 16), Flags: uint8(v >> 24)}
}

// IsScheme reports a colour that is an index into the host's colour
// scheme (PowerPoint) - the index is R
func (c ColorRef) IsScheme() bool { return c.Flags&ColorSchemeIndex != 0 }

// IsSystem reports a system colour - the index is R | G<<8
func (c ColorRef) IsSystem() bool { return c.Flags&ColorSysIndex != 0 }

// IsPalette reports a palette index (Excel) - the index is R | G<<8
func (c ColorRef) IsPalette() bool { return c.Flags&ColorPaletteIndex != 0 }

// Hex is the colour as "#rrggbb", for a plain RGB colour
func (c ColorRef) Hex() string {
	const hexd = "0123456789abcdef"
	return string([]byte{'#', hexd[c.R>>4], hexd[c.R&15], hexd[c.G>>4], hexd[c.G&15], hexd[c.B>>4], hexd[c.B&15]})
}
