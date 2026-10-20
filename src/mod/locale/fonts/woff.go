package fonts

/*
	woff.go

	WOFF 1.0 decoding, WOFF2 decoding (enough to read the font's names and
	character map) and WOFF2 encoding.

	The encoder stores every table untransformed (the "null transform" WOFF2
	allows for glyf and loca too) and compresses the lot with Brotli. That is
	all the browser needs, and it keeps the encoder small: a font that comes
	out of here is read by the browser exactly as it went in.

	The WOFF2 decoder does not rebuild a transformed glyf / loca / hmtx: those
	tables are only marked in Font.Transformed. A WOFF2 upload is therefore
	served as it is, never cut into slices.
*/

import (
	"bytes"
	"compress/zlib"
	"encoding/binary"
	"errors"
	"fmt"
	"io"

	"github.com/andybalholm/brotli"
)

// maxDecodedSize bounds what a compressed font may expand to
const maxDecodedSize = 256 << 20

/* ── WOFF 1.0 ── */

func decodeWOFF(data []byte) (*Font, error) {
	if len(data) < 44 {
		return nil, errTruncated
	}
	flavor := binary.BigEndian.Uint32(data[4:])
	if flavor == tagCollection {
		return nil, errCollection
	}
	if flavor != flavorTrueType && flavor != flavorTrue && flavor != flavorCFF {
		return nil, fmt.Errorf("unknown WOFF flavor %08x", flavor)
	}
	numTables := int(binary.BigEndian.Uint16(data[12:]))
	if numTables == 0 || numTables > maxTables {
		return nil, fmt.Errorf("the font lists %d tables", numTables)
	}
	if 44+20*numTables > len(data) {
		return nil, errTruncated
	}

	font := &Font{Flavor: flavor, Tables: map[string][]byte{}}
	total := 0
	for i := 0; i < numTables; i++ {
		rec := data[44+20*i : 44+20*i+20]
		tag, err := tagString(rec)
		if err != nil {
			return nil, err
		}
		if _, dup := font.Tables[tag]; dup {
			return nil, fmt.Errorf("the font has two %q tables", tag)
		}
		offset := binary.BigEndian.Uint32(rec[4:])
		compLength := binary.BigEndian.Uint32(rec[8:])
		origLength := binary.BigEndian.Uint32(rec[12:])
		stored, err := sub(data, int64(offset), int64(compLength))
		if err != nil {
			return nil, fmt.Errorf("table %q: %w", tag, err)
		}
		if int64(origLength) > maxDecodedSize-int64(total) {
			return nil, errors.New("the font expands to more than 256 MB")
		}
		total += int(origLength)

		switch {
		case compLength == origLength:
			font.Tables[tag] = stored
		case compLength < origLength:
			table, err := inflate(stored, int(origLength))
			if err != nil {
				return nil, fmt.Errorf("table %q: %w", tag, err)
			}
			font.Tables[tag] = table
		default:
			return nil, fmt.Errorf("table %q is larger compressed than uncompressed", tag)
		}
	}
	return font, nil
}

// inflate decompresses one zlib stream that must expand to exactly size bytes
func inflate(stored []byte, size int) ([]byte, error) {
	r, err := zlib.NewReader(bytes.NewReader(stored))
	if err != nil {
		return nil, err
	}
	defer r.Close()
	out := make([]byte, size)
	if _, err := io.ReadFull(r, out); err != nil {
		return nil, errors.New("the compressed table is shorter than it claims")
	}
	if n, _ := r.Read(make([]byte, 1)); n != 0 {
		return nil, errors.New("the compressed table is longer than it claims")
	}
	return out, nil
}

/* ── WOFF2 ── */

// woff2KnownTags is the WOFF2 table of known tags, by index
var woff2KnownTags = []string{
	"cmap", "head", "hhea", "hmtx", "maxp", "name", "OS/2", "post", "cvt ", "fpgm", "glyf", "loca", "prep",
	"CFF ", "VORG", "EBDT", "EBLC", "gasp", "hdmx", "kern", "LTSH", "PCLT", "VDMX", "vhea", "vmtx", "BASE",
	"GDEF", "GPOS", "GSUB", "EBSC", "JSTF", "MATH", "CBDT", "CBLC", "COLR", "CPAL", "SVG ", "sbix", "acnt",
	"avar", "bdat", "bloc", "bsln", "cvar", "fdsc", "feat", "fmtx", "fvar", "gvar", "hsty", "just", "lcar",
	"mort", "morx", "opbd", "prop", "trak", "Zapf", "Silf", "Glat", "Gloc", "Feat", "Sill",
}

// readBase128 reads a WOFF2 UIntBase128 value
func readBase128(b []byte, off *int) (uint32, error) {
	var v uint32
	for i := 0; i < 5; i++ {
		if *off >= len(b) {
			return 0, errTruncated
		}
		c := b[*off]
		*off++
		if i == 0 && c == 0x80 {
			return 0, errors.New("invalid UIntBase128 (leading zero)")
		}
		if v&0xFE000000 != 0 {
			return 0, errors.New("invalid UIntBase128 (overflow)")
		}
		v = v<<7 | uint32(c&0x7F)
		if c&0x80 == 0 {
			return v, nil
		}
	}
	return 0, errors.New("invalid UIntBase128 (too long)")
}

func appendBase128(out []byte, v uint32) []byte {
	var buf [5]byte
	n := 0
	for {
		buf[4-n] = byte(v & 0x7F)
		v >>= 7
		n++
		if v == 0 {
			break
		}
	}
	for i := 5 - n; i < 4; i++ {
		buf[i] |= 0x80
	}
	return append(out, buf[5-n:]...)
}

type woff2Entry struct {
	tag         string
	origLength  uint32
	length      uint32 // bytes in the decompressed stream
	transformed bool
}

func decodeWOFF2(data []byte) (*Font, error) {
	if len(data) < 48 {
		return nil, errTruncated
	}
	flavor := binary.BigEndian.Uint32(data[4:])
	if flavor == tagCollection {
		return nil, errCollection
	}
	if flavor != flavorTrueType && flavor != flavorTrue && flavor != flavorCFF {
		return nil, fmt.Errorf("unknown WOFF2 flavor %08x", flavor)
	}
	if int64(binary.BigEndian.Uint32(data[8:])) != int64(len(data)) {
		return nil, errors.New("the WOFF2 header length does not match the file")
	}
	numTables := int(binary.BigEndian.Uint16(data[12:]))
	if numTables == 0 || numTables > maxTables {
		return nil, fmt.Errorf("the font lists %d tables", numTables)
	}
	compressedSize := binary.BigEndian.Uint32(data[20:])

	off := 48
	entries := make([]woff2Entry, 0, numTables)
	var streamSize int64
	seen := map[string]bool{}
	for i := 0; i < numTables; i++ {
		if off >= len(data) {
			return nil, errTruncated
		}
		flags := data[off]
		off++
		var tag string
		if flags&0x3F == 0x3F {
			t, err := tagString(data[min(off, len(data)):])
			if err != nil {
				return nil, err
			}
			tag = t
			off += 4
		} else if int(flags&0x3F) < len(woff2KnownTags) {
			tag = woff2KnownTags[flags&0x3F]
		} else {
			return nil, errors.New("invalid WOFF2 table tag index")
		}
		if seen[tag] {
			return nil, fmt.Errorf("the font has two %q tables", tag)
		}
		seen[tag] = true

		version := flags >> 6
		transformed := version != 0
		if tag == "glyf" || tag == "loca" {
			transformed = version != 3
		}
		origLength, err := readBase128(data, &off)
		if err != nil {
			return nil, err
		}
		length := origLength
		if transformed {
			if length, err = readBase128(data, &off); err != nil {
				return nil, err
			}
		}
		streamSize += int64(length)
		if streamSize > maxDecodedSize {
			return nil, errors.New("the font expands to more than 256 MB")
		}
		entries = append(entries, woff2Entry{tag: tag, origLength: origLength, length: length, transformed: transformed})
	}

	stored, err := sub(data, int64(off), int64(compressedSize))
	if err != nil {
		return nil, err
	}
	stream := make([]byte, streamSize)
	r := brotli.NewReader(bytes.NewReader(stored))
	if _, err := io.ReadFull(r, stream); err != nil {
		return nil, errors.New("the WOFF2 data is shorter than its tables")
	}

	font := &Font{Flavor: flavor, Tables: map[string][]byte{}, Transformed: map[string]bool{}}
	pos := int64(0)
	for _, e := range entries {
		table := stream[pos : pos+int64(e.length)]
		pos += int64(e.length)
		if e.transformed {
			font.Transformed[e.tag] = true
			continue
		}
		font.Tables[e.tag] = table
	}
	return font, nil
}

// EncodeWOFF2 packs sfnt tables into a WOFF2 file, every table untransformed
func EncodeWOFF2(flavor uint32, tables map[string][]byte, quality int) ([]byte, error) {
	if len(tables) == 0 || len(tables) > maxTables {
		return nil, fmt.Errorf("cannot write a font with %d tables", len(tables))
	}
	tags := sortedTags(tables)

	var dir []byte
	var stream bytes.Buffer
	w := brotli.NewWriterOptions(&stream, brotli.WriterOptions{Quality: quality, LGWin: 22})
	for _, tag := range tags {
		index := -1
		for i, known := range woff2KnownTags {
			if known == tag {
				index = i
				break
			}
		}
		flags := byte(0x3F)
		if index >= 0 {
			flags = byte(index)
		}
		if tag == "glyf" || tag == "loca" {
			flags |= 3 << 6 // null transform
		}
		dir = append(dir, flags)
		if index < 0 {
			dir = append(dir, tag...)
		}
		dir = appendBase128(dir, uint32(len(tables[tag])))
		if _, err := w.Write(tables[tag]); err != nil {
			return nil, err
		}
	}
	if err := w.Close(); err != nil {
		return nil, err
	}

	// the file ends on a 4 byte boundary after the compressed stream
	total := pad4(48 + len(dir) + stream.Len())
	out := make([]byte, 48, total)
	binary.BigEndian.PutUint32(out[0:], sigWOFF2)
	binary.BigEndian.PutUint32(out[4:], flavor)
	binary.BigEndian.PutUint32(out[8:], uint32(total))
	binary.BigEndian.PutUint16(out[12:], uint16(len(tags)))
	binary.BigEndian.PutUint32(out[16:], uint32(sfntSize(tables)))
	binary.BigEndian.PutUint32(out[20:], uint32(stream.Len()))
	binary.BigEndian.PutUint16(out[24:], 1)
	out = append(out, dir...)
	out = append(out, stream.Bytes()...)
	out = append(out, make([]byte, total-len(out))...)
	return out, nil
}
