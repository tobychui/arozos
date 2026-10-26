package transcoder

/*
	Fontname.go

	Reads the family name out of an sfnt font (TTF/OTF) by parsing its "name"
	table directly.

	This matters because ASS styles reference fonts by their *internal* family
	name, not by filename — and tools like assfonts deliberately rewrite that
	internal name to a random string when muxing subsets into a container. A
	release whose attachment is called "FOT-Pearl Std L[0]_GGORJFBL_0.ttf" may
	well identify itself as "ECZNFERB", which is what the styles will ask for.
	Without reading the table there is no way to connect the two.

	Implemented by hand rather than pulling in a font library: the name table is
	a simple structure and this avoids a new dependency for ~100 lines.
*/

import (
	"encoding/binary"
	"errors"
	"strings"
	"unicode/utf16"
)

const (
	// sfnt offsets
	sfntNumTablesOffset  = 4
	sfntTableDirOffset   = 12
	sfntTableRecordSize  = 16
	nameTableHeaderSize  = 6
	nameRecordSize       = 12
	nameIDFontFamily     = 1
	platformIDMacintosh  = 1
	platformIDMicrosoft  = 3
	maxReasonableNameLen = 512
)

// FontFamilyName extracts the family name from a TTF/OTF font.
//
// Microsoft platform records (UTF-16BE) are preferred because they are the ones
// Windows-oriented tooling writes; a Macintosh record is accepted as fallback.
func FontFamilyName(font []byte) (string, error) {
	nameTable, err := findSfntTable(font, "name")
	if err != nil {
		return "", err
	}
	if len(nameTable) < nameTableHeaderSize {
		return "", errors.New("name table too short")
	}

	count := int(binary.BigEndian.Uint16(nameTable[2:4]))
	stringOffset := int(binary.BigEndian.Uint16(nameTable[4:6]))

	var fallback string
	for i := 0; i < count; i++ {
		rec := nameTableHeaderSize + i*nameRecordSize
		if rec+nameRecordSize > len(nameTable) {
			break
		}
		platformID := binary.BigEndian.Uint16(nameTable[rec : rec+2])
		nameID := binary.BigEndian.Uint16(nameTable[rec+6 : rec+8])
		length := int(binary.BigEndian.Uint16(nameTable[rec+8 : rec+10]))
		offset := int(binary.BigEndian.Uint16(nameTable[rec+10 : rec+12]))

		if nameID != nameIDFontFamily || length == 0 || length > maxReasonableNameLen {
			continue
		}
		start := stringOffset + offset
		if start < 0 || start+length > len(nameTable) {
			continue
		}
		raw := nameTable[start : start+length]

		switch platformID {
		case platformIDMicrosoft:
			if name := strings.TrimSpace(decodeUTF16BE(raw)); name != "" {
				return name, nil
			}
		case platformIDMacintosh:
			if fallback == "" {
				fallback = strings.TrimSpace(string(raw))
			}
		}
	}

	if fallback != "" {
		return fallback, nil
	}
	return "", errors.New("no family name in font")
}

// findSfntTable locates a table by tag inside an sfnt container.
func findSfntTable(font []byte, wantTag string) ([]byte, error) {
	if len(font) < sfntTableDirOffset {
		return nil, errors.New("not a font file")
	}
	// TrueType collections start with a different header; the attachments we
	// care about are single fonts, so treat a collection as unsupported rather
	// than misreading its offsets.
	if string(font[0:4]) == "ttcf" {
		return nil, errors.New("font collections are not supported")
	}

	numTables := int(binary.BigEndian.Uint16(font[sfntNumTablesOffset : sfntNumTablesOffset+2]))
	for i := 0; i < numTables; i++ {
		rec := sfntTableDirOffset + i*sfntTableRecordSize
		if rec+sfntTableRecordSize > len(font) {
			break
		}
		tag := string(font[rec : rec+4])
		if tag != wantTag {
			continue
		}
		offset := int(binary.BigEndian.Uint32(font[rec+8 : rec+12]))
		length := int(binary.BigEndian.Uint32(font[rec+12 : rec+16]))
		if offset < 0 || length < 0 || offset+length > len(font) {
			return nil, errors.New("truncated font table")
		}
		return font[offset : offset+length], nil
	}
	return nil, errors.New("table not found: " + wantTag)
}

// decodeUTF16BE converts a big-endian UTF-16 name record to a Go string.
func decodeUTF16BE(raw []byte) string {
	if len(raw)%2 != 0 {
		raw = raw[:len(raw)-1]
	}
	units := make([]uint16, 0, len(raw)/2)
	for i := 0; i+1 < len(raw); i += 2 {
		units = append(units, binary.BigEndian.Uint16(raw[i:i+2]))
	}
	return string(utf16.Decode(units))
}
