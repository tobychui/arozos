package fonts

/*
	sfnt.go

	Reads the table directory of an OpenType / TrueType font (an "sfnt") and
	writes one back. Fonts reach this package from users, so every offset is
	checked against the data before it is used: nothing here trusts a length
	field, and nothing panics on a short or hostile file.
*/

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
	"sort"
)

const (
	flavorTrueType = 0x00010000
	flavorTrue     = 0x74727565 // 'true', old Apple TrueType
	flavorCFF      = 0x4F54544F // 'OTTO', CFF outlines
	tagCollection  = 0x74746366 // 'ttcf'
	sigWOFF        = 0x774F4646 // 'wOFF'
	sigWOFF2       = 0x774F4632 // 'wOF2'

	maxTables = 256

	// headMagic is the magicNumber field of every valid head table
	headMagic = 0x5F0F3CF5
)

var (
	errTruncated   = errors.New("the font data is truncated or an offset points outside it")
	errCollection  = errors.New("font collections (.ttc) are not supported, upload the single fonts instead")
	errNotFont     = errors.New("this is not a TrueType, OpenType, WOFF or WOFF2 font")
	errNoOutline   = errors.New("the font has no glyph outlines (glyf, CFF or CFF2 table)")
	errMissingName = errors.New("the font does not name its family")
)

// Font is a parsed sfnt: its flavor and its tables by tag.
type Font struct {
	Flavor uint32
	Tables map[string][]byte

	// Transformed lists tables a WOFF2 file stores transformed: the font has
	// them, but their bytes are not available here.
	Transformed map[string]bool
}

// Table returns the bytes of a table, nil when the font has no such table
func (f *Font) Table(tag string) []byte {
	return f.Tables[tag]
}

// Has reports whether the font has a table, transformed or not
func (f *Font) Has(tag string) bool {
	_, ok := f.Tables[tag]
	return ok || f.Transformed[tag]
}

// IsCFF reports whether the outlines are PostScript (CFF / CFF2) ones
func (f *Font) IsCFF() bool {
	return f.Flavor == flavorCFF || f.Has("CFF ") || f.Has("CFF2")
}

/* ── Bounds checked readers ── */

func u16(b []byte, off int) (uint16, error) {
	if off < 0 || off > len(b)-2 {
		return 0, errTruncated
	}
	return binary.BigEndian.Uint16(b[off:]), nil
}

func u32(b []byte, off int) (uint32, error) {
	if off < 0 || off > len(b)-4 {
		return 0, errTruncated
	}
	return binary.BigEndian.Uint32(b[off:]), nil
}

// sub returns b[off:off+n] when the whole range lies inside b
func sub(b []byte, off int64, n int64) ([]byte, error) {
	if off < 0 || n < 0 || off > int64(len(b)) || n > int64(len(b))-off {
		return nil, errTruncated
	}
	return b[off : off+n], nil
}

// tagString turns a 4 byte tag into its string, refusing unprintable bytes
func tagString(b []byte) (string, error) {
	if len(b) < 4 {
		return "", errTruncated
	}
	for _, c := range b[:4] {
		if c < 0x20 || c > 0x7E {
			return "", fmt.Errorf("invalid table tag %q", b[:4])
		}
	}
	return string(b[:4]), nil
}

// sniff returns the signature of a font file: an sfnt flavor or a WOFF one
func sniff(data []byte) (uint32, error) {
	sig, err := u32(data, 0)
	if err != nil {
		return 0, errNotFont
	}
	switch sig {
	case flavorTrueType, flavorTrue, flavorCFF, sigWOFF, sigWOFF2:
		return sig, nil
	case tagCollection:
		return 0, errCollection
	}
	return 0, errNotFont
}

// ParseSFNT reads the table directory of an uncompressed font. The returned
// tables share data with the given slice.
func ParseSFNT(data []byte) (*Font, error) {
	flavor, err := sniff(data)
	if err != nil {
		return nil, err
	}
	if flavor == sigWOFF || flavor == sigWOFF2 {
		return nil, errors.New("expected an uncompressed font, got WOFF")
	}
	numTables, err := u16(data, 4)
	if err != nil {
		return nil, err
	}
	if numTables == 0 || numTables > maxTables {
		return nil, fmt.Errorf("the font lists %d tables", numTables)
	}
	if 12+16*int(numTables) > len(data) {
		return nil, errTruncated
	}

	font := &Font{Flavor: flavor, Tables: map[string][]byte{}}
	for i := 0; i < int(numTables); i++ {
		rec := data[12+16*i : 12+16*i+16]
		tag, err := tagString(rec)
		if err != nil {
			return nil, err
		}
		if _, dup := font.Tables[tag]; dup {
			return nil, fmt.Errorf("the font has two %q tables", tag)
		}
		offset := binary.BigEndian.Uint32(rec[8:])
		length := binary.BigEndian.Uint32(rec[12:])
		table, err := sub(data, int64(offset), int64(length))
		if err != nil {
			return nil, fmt.Errorf("table %q: %w", tag, err)
		}
		font.Tables[tag] = table
	}
	return font, nil
}

// Decode reads any supported font file (TTF, OTF, WOFF, WOFF2). It returns
// the parsed font and the container it came in: "sfnt", "woff" or "woff2".
func Decode(data []byte) (*Font, string, error) {
	sig, err := sniff(data)
	if err != nil {
		return nil, "", err
	}
	switch sig {
	case sigWOFF:
		font, err := decodeWOFF(data)
		return font, "woff", err
	case sigWOFF2:
		font, err := decodeWOFF2(data)
		return font, "woff2", err
	}
	font, err := ParseSFNT(data)
	return font, "sfnt", err
}

/* ── Writing ── */

func checksum(b []byte) uint32 {
	var sum uint32
	for i := 0; i < len(b); i += 4 {
		var word [4]byte
		copy(word[:], b[i:])
		sum += binary.BigEndian.Uint32(word[:])
	}
	return sum
}

func pad4(n int) int {
	return (n + 3) &^ 3
}

// sortedTags returns the table tags in the order an sfnt stores them
func sortedTags(tables map[string][]byte) []string {
	tags := make([]string, 0, len(tables))
	for tag := range tables {
		tags = append(tags, tag)
	}
	sort.Strings(tags)
	return tags
}

// sfntSize is the size of the sfnt AssembleSFNT builds from these tables
func sfntSize(tables map[string][]byte) int {
	size := 12 + 16*len(tables)
	for _, t := range tables {
		size += pad4(len(t))
	}
	return size
}

// AssembleSFNT writes a font file from its tables and fills in the checksums,
// including the head table's checkSumAdjustment. The tables map is updated
// with the head table carrying that adjustment.
func AssembleSFNT(flavor uint32, tables map[string][]byte) ([]byte, error) {
	if len(tables) == 0 || len(tables) > maxTables {
		return nil, fmt.Errorf("cannot write a font with %d tables", len(tables))
	}
	if head, ok := tables["head"]; ok {
		if len(head) < 54 {
			return nil, errors.New("the head table is too short")
		}
		head = append([]byte(nil), head...)
		binary.BigEndian.PutUint32(head[8:], 0)
		tables["head"] = head
	}

	tags := sortedTags(tables)
	n := len(tags)
	out := make([]byte, 12+16*n, sfntSize(tables))
	binary.BigEndian.PutUint32(out[0:], flavor)
	binary.BigEndian.PutUint16(out[4:], uint16(n))
	entrySelector := uint16(math.Floor(math.Log2(float64(n))))
	searchRange := uint16(16 << entrySelector)
	binary.BigEndian.PutUint16(out[6:], searchRange)
	binary.BigEndian.PutUint16(out[8:], entrySelector)
	binary.BigEndian.PutUint16(out[10:], uint16(16*n)-searchRange)

	headOffset := -1
	for i, tag := range tags {
		t := tables[tag]
		rec := out[12+16*i:]
		copy(rec, tag)
		binary.BigEndian.PutUint32(rec[4:], checksum(t))
		binary.BigEndian.PutUint32(rec[8:], uint32(len(out)))
		binary.BigEndian.PutUint32(rec[12:], uint32(len(t)))
		if tag == "head" {
			headOffset = len(out)
		}
		out = append(out, t...)
		out = append(out, make([]byte, pad4(len(t))-len(t))...)
	}

	if headOffset >= 0 {
		binary.BigEndian.PutUint32(out[headOffset+8:], 0xB1B0AFBA-checksum(out))
		tables["head"] = out[headOffset : headOffset+len(tables["head"])]
	}
	return out, nil
}
