package fonts

/*
	meta.go

	Checks that a decoded font is complete and reads what the font library
	shows about it: names, weight range, style, glyph count, the codepoints it
	covers and which writing systems those make up.
*/

import (
	"encoding/binary"
	"errors"
	"fmt"
	"sort"
	"strings"
	"unicode"
	"unicode/utf16"
)

// Info describes one font file
type Info struct {
	Family     string   `json:"family"`
	Style      string   `json:"style"`
	FullName   string   `json:"fullName"`
	Version    string   `json:"version"`
	Designer   string   `json:"designer"`
	License    string   `json:"license"`
	LicenseURL string   `json:"licenseURL"`
	WeightMin  int      `json:"weightMin"`
	WeightMax  int      `json:"weightMax"`
	Italic     bool     `json:"italic"`
	Variable   bool     `json:"variable"`
	Outline    string   `json:"outline"` // "truetype" or "cff"
	NoEmbed    bool     `json:"noEmbed"` // the licence forbids embedding it in a document (OS/2 fsType)
	Glyphs     int      `json:"glyphs"`
	Codepoints int      `json:"codepoints"`
	Scripts    []string `json:"scripts"`
}

// Inspect validates a decoded font and reads its description and character
// map. It fails for fonts a browser could not use.
func Inspect(font *Font) (Info, map[uint32]uint16, error) {
	var info Info
	for _, tag := range []string{"cmap", "head", "hhea", "maxp", "name"} {
		if font.Table(tag) == nil {
			return info, nil, fmt.Errorf("the font has no %q table", tag)
		}
	}
	if !font.Has("hmtx") {
		return info, nil, errors.New(`the font has no "hmtx" table`)
	}

	head := font.Table("head")
	if len(head) < 54 || binary.BigEndian.Uint32(head[12:]) != headMagic {
		return info, nil, errors.New("the head table is damaged")
	}
	if upem := binary.BigEndian.Uint16(head[18:]); upem < 16 || upem > 16384 {
		return info, nil, fmt.Errorf("the font has an invalid unitsPerEm (%d)", upem)
	}
	numGlyphs, err := u16(font.Table("maxp"), 4)
	if err != nil || numGlyphs == 0 {
		return info, nil, errors.New("the maxp table is damaged")
	}
	info.Glyphs = int(numGlyphs)

	switch {
	case font.Has("glyf") && font.Has("loca"):
		info.Outline = "truetype"
		if !font.Transformed["glyf"] {
			if _, err := glyphOffsets(font, info.Glyphs); err != nil {
				return info, nil, err
			}
		}
	case font.Has("CFF ") || font.Has("CFF2"):
		info.Outline = "cff"
	default:
		return info, nil, errNoOutline
	}

	if !font.Transformed["hmtx"] {
		hhea := font.Table("hhea")
		if len(hhea) < 36 {
			return info, nil, errors.New("the hhea table is damaged")
		}
		numH := int(binary.BigEndian.Uint16(hhea[34:]))
		if numH == 0 || numH > info.Glyphs || len(font.Table("hmtx")) < 4*numH+2*(info.Glyphs-numH) {
			return info, nil, errors.New("the hmtx table does not match the glyph count")
		}
	}

	names, err := readNames(font.Table("name"))
	if err != nil {
		return info, nil, err
	}
	info.Family = firstOf(names[16], names[1])
	info.Style = firstOf(names[17], names[2], "Regular")
	info.FullName = firstOf(names[4], strings.TrimSpace(info.Family+" "+info.Style))
	info.Version = strings.TrimSpace(strings.TrimPrefix(names[5], "Version"))
	info.Designer = firstOf(names[9], names[8])
	info.License = clip(names[13], 600)
	info.LicenseURL = names[14]
	if info.Family == "" {
		return info, nil, errMissingName
	}

	info.WeightMin, info.WeightMax = 400, 400
	if os2 := font.Table("OS/2"); len(os2) >= 64 {
		w := int(binary.BigEndian.Uint16(os2[4:]))
		if w >= 1 && w <= 9 {
			w *= 100 // some old fonts use the 1-9 scale
		}
		if w >= 1 && w <= 1000 {
			info.WeightMin, info.WeightMax = w, w
		}
		info.Italic = binary.BigEndian.Uint16(os2[62:])&1 != 0
	}
	if binary.BigEndian.Uint16(head[44:])&2 != 0 {
		info.Italic = true
	}
	if os2 := font.Table("OS/2"); len(os2) >= 10 {
		info.NoEmbed = noEmbed(binary.BigEndian.Uint16(os2[8:]))
	}
	if fvar := font.Table("fvar"); fvar != nil {
		info.Variable = true
		if lo, hi, ok := weightAxis(fvar); ok {
			info.WeightMin, info.WeightMax = lo, hi
			// the names describe the default instance ("ExtraLight"), not the font
			info.Style = "Regular"
			if info.Italic {
				info.Style = "Italic"
			}
		}
	}

	cmap, err := ParseCmap(font.Table("cmap"), info.Glyphs)
	if err != nil {
		return info, nil, err
	}
	info.Codepoints = len(cmap)
	info.Scripts = scriptsOf(cmap)
	return info, cmap, nil
}

// noEmbed reads the OS/2 fsType embedding permissions: a font with only the
// Restricted License bit of the usage bits set, or one that allows bitmaps
// alone, must not be embedded in a document. Old fonts may set several
// usage bits; the least restrictive one applies.
func noEmbed(fsType uint16) bool {
	return fsType&0x000F == 0x0002 || fsType&0x0200 != 0
}

// glyphOffsets reads loca: glyph i occupies glyf[offsets[i]:offsets[i+1]]
func glyphOffsets(font *Font, numGlyphs int) ([]uint32, error) {
	head, loca, glyf := font.Table("head"), font.Table("loca"), font.Table("glyf")
	long := len(head) >= 52 && binary.BigEndian.Uint16(head[50:]) == 1
	size := 2
	if long {
		size = 4
	}
	if len(loca) < (numGlyphs+1)*size {
		return nil, errors.New("the loca table is shorter than the glyph count")
	}
	offsets := make([]uint32, numGlyphs+1)
	for i := range offsets {
		if long {
			offsets[i] = binary.BigEndian.Uint32(loca[4*i:])
		} else {
			offsets[i] = uint32(binary.BigEndian.Uint16(loca[2*i:])) * 2
		}
		if i > 0 && offsets[i] < offsets[i-1] {
			return nil, errors.New("the loca table is out of order")
		}
	}
	if int64(offsets[numGlyphs]) > int64(len(glyf)) {
		return nil, errors.New("the loca table points past the glyf table")
	}
	return offsets, nil
}

func weightAxis(fvar []byte) (int, int, bool) {
	axesOffset, err1 := u16(fvar, 4)
	count, err2 := u16(fvar, 8)
	size, err3 := u16(fvar, 10)
	if err1 != nil || err2 != nil || err3 != nil || size < 20 {
		return 0, 0, false
	}
	for i := 0; i < int(count); i++ {
		rec, err := sub(fvar, int64(axesOffset)+int64(i)*int64(size), 20)
		if err != nil {
			return 0, 0, false
		}
		if string(rec[:4]) != "wght" {
			continue
		}
		lo := int(int32(binary.BigEndian.Uint32(rec[4:])) >> 16)
		hi := int(int32(binary.BigEndian.Uint32(rec[12:])) >> 16)
		if lo < 1 || hi > 1000 || lo > hi {
			return 0, 0, false
		}
		return lo, hi, true
	}
	return 0, 0, false
}

// readNames returns the best English (or first) string for each name id
func readNames(table []byte) (map[uint16]string, error) {
	count, err1 := u16(table, 2)
	strOffset, err2 := u16(table, 4)
	if err1 != nil || err2 != nil {
		return nil, errors.New("the name table is damaged")
	}
	type pick struct {
		rank int
		text string
	}
	best := map[uint16]pick{}
	for i := 0; i < int(count); i++ {
		rec, err := sub(table, 6+12*int64(i), 12)
		if err != nil {
			return nil, errors.New("the name table is damaged")
		}
		platform := binary.BigEndian.Uint16(rec)
		encoding := binary.BigEndian.Uint16(rec[2:])
		language := binary.BigEndian.Uint16(rec[4:])
		id := binary.BigEndian.Uint16(rec[6:])
		length := binary.BigEndian.Uint16(rec[8:])
		offset := binary.BigEndian.Uint16(rec[10:])
		raw, err := sub(table, int64(strOffset)+int64(offset), int64(length))
		if err != nil {
			continue
		}

		rank, text := 0, ""
		switch {
		case platform == 3 && (encoding == 1 || encoding == 10):
			rank, text = 3, decodeUTF16(raw)
			if language == 0x0409 {
				rank = 4
			}
		case platform == 0:
			rank, text = 2, decodeUTF16(raw)
		case platform == 1 && encoding == 0:
			rank, text = 1, latin1(raw)
			if language == 0 {
				rank = 2
			}
		}
		text = clean(text)
		if rank > 0 && text != "" && rank > best[id].rank {
			best[id] = pick{rank, text}
		}
	}
	names := map[uint16]string{}
	for id, p := range best {
		names[id] = p.text
	}
	return names, nil
}

func decodeUTF16(b []byte) string {
	units := make([]uint16, len(b)/2)
	for i := range units {
		units[i] = binary.BigEndian.Uint16(b[2*i:])
	}
	return string(utf16.Decode(units))
}

func latin1(b []byte) string {
	r := make([]rune, len(b))
	for i, c := range b {
		r[i] = rune(c)
	}
	return string(r)
}

// clean drops control characters and trims a name to a sane length
func clean(s string) string {
	s = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == unicode.ReplacementChar {
			return -1
		}
		return r
	}, s)
	return clip(strings.TrimSpace(s), 200)
}

func clip(s string, n int) string {
	r := []rune(s)
	if len(r) > n {
		return string(r[:n]) + "…"
	}
	return s
}

func firstOf(values ...string) string {
	for _, v := range values {
		if v != "" {
			return v
		}
	}
	return ""
}

// scriptRanges decides which writing systems a font covers: at least min
// codepoints of the range must be mapped
var scriptRanges = []struct {
	id     string
	lo, hi uint32
	min    int
}{
	{"latin", 0x41, 0x7A, 50},
	{"greek", 0x391, 0x3C9, 40},
	{"cyrillic", 0x410, 0x44F, 60},
	{"hebrew", 0x5D0, 0x5EA, 27},
	{"arabic", 0x600, 0x6FF, 100},
	{"devanagari", 0x900, 0x97F, 80},
	{"thai", 0xE01, 0xE5B, 70},
	{"kana", 0x3041, 0x30FA, 150},
	{"han", 0x4E00, 0x9FFF, 3000},
	{"hangul", 0xAC00, 0xD7A3, 2000},
}

func scriptsOf(cmap map[uint32]uint16) []string {
	counts := make([]int, len(scriptRanges))
	for cp := range cmap {
		for i, s := range scriptRanges {
			if cp >= s.lo && cp <= s.hi {
				counts[i]++
			}
		}
	}
	scripts := []string{}
	for i, s := range scriptRanges {
		if counts[i] >= s.min {
			scripts = append(scripts, s.id)
		}
	}
	return scripts
}

// sortedCodepoints returns the keys of a character map in ascending order
func sortedCodepoints(cmap map[uint32]uint16) []uint32 {
	cps := make([]uint32, 0, len(cmap))
	for cp := range cmap {
		cps = append(cps, cp)
	}
	sort.Slice(cps, func(i, j int) bool { return cps[i] < cps[j] })
	return cps
}
