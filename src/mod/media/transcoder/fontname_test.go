package transcoder

import (
	"encoding/binary"
	"strings"
	"testing"
	"unicode/utf16"
)

// buildFont assembles a minimal sfnt carrying just a name table, which is all
// FontFamilyName needs. Records are given as (platformID, nameID, value).
type nameRec struct {
	platformID uint16
	nameID     uint16
	value      string
}

func buildFont(tag string, records []nameRec) []byte {
	// Encode the string storage and the record array
	var storage []byte
	recs := make([]byte, 0, len(records)*nameRecordSize)
	for _, r := range records {
		var encoded []byte
		if r.platformID == platformIDMicrosoft {
			units := utf16.Encode([]rune(r.value))
			encoded = make([]byte, len(units)*2)
			for i, u := range units {
				binary.BigEndian.PutUint16(encoded[i*2:], u)
			}
		} else {
			encoded = []byte(r.value)
		}
		rec := make([]byte, nameRecordSize)
		binary.BigEndian.PutUint16(rec[0:2], r.platformID)
		binary.BigEndian.PutUint16(rec[2:4], 0)
		binary.BigEndian.PutUint16(rec[4:6], 0)
		binary.BigEndian.PutUint16(rec[6:8], r.nameID)
		binary.BigEndian.PutUint16(rec[8:10], uint16(len(encoded)))
		binary.BigEndian.PutUint16(rec[10:12], uint16(len(storage)))
		recs = append(recs, rec...)
		storage = append(storage, encoded...)
	}

	stringOffset := nameTableHeaderSize + len(recs)
	nameTable := make([]byte, 0, stringOffset+len(storage))
	header := make([]byte, nameTableHeaderSize)
	binary.BigEndian.PutUint16(header[0:2], 0)
	binary.BigEndian.PutUint16(header[2:4], uint16(len(records)))
	binary.BigEndian.PutUint16(header[4:6], uint16(stringOffset))
	nameTable = append(nameTable, header...)
	nameTable = append(nameTable, recs...)
	nameTable = append(nameTable, storage...)

	// One-table sfnt: 12-byte header, one 16-byte record, then the table
	tableOffset := sfntTableDirOffset + sfntTableRecordSize
	font := make([]byte, tableOffset)
	copy(font[0:4], []byte{0x00, 0x01, 0x00, 0x00}) // TrueType version
	binary.BigEndian.PutUint16(font[sfntNumTablesOffset:], 1)
	copy(font[sfntTableDirOffset:], []byte(tag))
	binary.BigEndian.PutUint32(font[sfntTableDirOffset+8:], uint32(tableOffset))
	binary.BigEndian.PutUint32(font[sfntTableDirOffset+12:], uint32(len(nameTable)))
	return append(font, nameTable...)
}

// TestFontFamilyName_Microsoft covers the common case: a Windows platform
// record holding a UTF-16BE family name.
func TestFontFamilyName_Microsoft(t *testing.T) {
	font := buildFont("name", []nameRec{
		{platformIDMicrosoft, nameIDFontFamily, "UUZHUQHH"},
	})
	got, err := FontFamilyName(font)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "UUZHUQHH" {
		t.Errorf("expected UUZHUQHH, got %q", got)
	}
}

// TestFontFamilyName_NonASCII verifies CJK family names survive the UTF-16
// decode, since those are exactly what fansub releases attach.
func TestFontFamilyName_NonASCII(t *testing.T) {
	font := buildFont("name", []nameRec{
		{platformIDMicrosoft, nameIDFontFamily, "方正准雅宋_GBK"},
	})
	got, err := FontFamilyName(font)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "方正准雅宋_GBK" {
		t.Errorf("expected the CJK family name, got %q", got)
	}
}

// TestFontFamilyName_PrefersMicrosoft verifies the Windows record wins when a
// font carries both, since that is the one matching what ASS scripts reference.
func TestFontFamilyName_PrefersMicrosoft(t *testing.T) {
	font := buildFont("name", []nameRec{
		{platformIDMacintosh, nameIDFontFamily, "MacName"},
		{platformIDMicrosoft, nameIDFontFamily, "WindowsName"},
	})
	got, err := FontFamilyName(font)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "WindowsName" {
		t.Errorf("expected WindowsName, got %q", got)
	}
}

// TestFontFamilyName_MacintoshFallback verifies a font with only a Macintosh
// record still resolves.
func TestFontFamilyName_MacintoshFallback(t *testing.T) {
	font := buildFont("name", []nameRec{
		{platformIDMacintosh, nameIDFontFamily, "OnlyMac"},
	})
	got, err := FontFamilyName(font)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "OnlyMac" {
		t.Errorf("expected OnlyMac, got %q", got)
	}
}

// TestFontFamilyName_IgnoresOtherNameIDs verifies only the family record (ID 1)
// is used, not the style or full-name records.
func TestFontFamilyName_IgnoresOtherNameIDs(t *testing.T) {
	font := buildFont("name", []nameRec{
		{platformIDMicrosoft, 2, "Bold"},
		{platformIDMicrosoft, 4, "Family Bold"},
		{platformIDMicrosoft, nameIDFontFamily, "Family"},
	})
	got, err := FontFamilyName(font)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "Family" {
		t.Errorf("expected Family, got %q", got)
	}
}

// TestFontFamilyName_Rejects covers the malformed inputs the parser must not
// panic on, since attachment bytes come straight from an untrusted container.
func TestFontFamilyName_Rejects(t *testing.T) {
	cases := []struct {
		name string
		data []byte
	}{
		{"empty", []byte{}},
		{"too short for a header", []byte{0, 1, 0, 0, 0}},
		{"no name table", buildFont("glyf", []nameRec{{platformIDMicrosoft, nameIDFontFamily, "X"}})},
		{"no family record", buildFont("name", []nameRec{{platformIDMicrosoft, 4, "Full Name Only"}})},
		{"font collection", append([]byte("ttcf"), make([]byte, 32)...)},
		{"random bytes", []byte("this is definitely not a font at all")},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if _, err := FontFamilyName(tc.data); err == nil {
				t.Error("expected an error, got nil")
			}
		})
	}
}

// TestFontFamilyName_TruncatedTableOffset verifies a table directory pointing
// past the end of the data is rejected rather than slicing out of range.
func TestFontFamilyName_TruncatedTableOffset(t *testing.T) {
	font := buildFont("name", []nameRec{{platformIDMicrosoft, nameIDFontFamily, "X"}})
	// Point the name table beyond the buffer
	binary.BigEndian.PutUint32(font[sfntTableDirOffset+8:], uint32(len(font)+500))
	if _, err := FontFamilyName(font); err == nil {
		t.Error("expected an error for a truncated table, got nil")
	}
}

// TestDecodeUTF16BE checks the decoder handles an odd trailing byte instead of
// reading past the slice.
func TestDecodeUTF16BE(t *testing.T) {
	units := utf16.Encode([]rune("Hi"))
	raw := make([]byte, len(units)*2)
	for i, u := range units {
		binary.BigEndian.PutUint16(raw[i*2:], u)
	}
	if got := decodeUTF16BE(raw); got != "Hi" {
		t.Errorf("expected Hi, got %q", got)
	}
	if got := decodeUTF16BE(append(raw, 0x00)); got != "Hi" {
		t.Errorf("expected Hi from odd-length input, got %q", got)
	}
	if got := decodeUTF16BE(nil); got != "" {
		t.Errorf("expected empty string, got %q", got)
	}
}

// TestFontFamilyName_TrimsWhitespace verifies padded names are cleaned up, as
// some tools pad the record.
func TestFontFamilyName_TrimsWhitespace(t *testing.T) {
	font := buildFont("name", []nameRec{
		{platformIDMicrosoft, nameIDFontFamily, "  Padded Name  "},
	})
	got, err := FontFamilyName(font)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "Padded Name" || strings.HasPrefix(got, " ") {
		t.Errorf("expected trimmed name, got %q", got)
	}
}
