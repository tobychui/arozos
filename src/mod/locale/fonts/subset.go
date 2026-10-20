package fonts

/*
	subset.go

	Cuts a TrueType font into a slice holding the glyphs of some codepoints.

	Glyph ids are kept as they are: the glyphs a slice does not need stay in
	the font but lose their outline (and their variation data), so GSUB, GPOS,
	GDEF, HVAR and the metrics tables still line up without being rewritten.
	Empty glyphs and the unchanged tables cost little once compressed.

	The kept set is closed over composite glyph components and over the GSUB
	substitutions of the default features (gsub.go), then the cmap is cut to
	the slice's own codepoints.
*/

import (
	"encoding/binary"
	"errors"
)

// sliceable reports whether a font can be cut by Slice: TrueType outlines
// and no per-glyph colour or bitmap tables that would need cutting too
func sliceable(font *Font) bool {
	if font.Table("glyf") == nil || font.Table("loca") == nil || len(font.Transformed) > 0 {
		return false
	}
	for _, tag := range []string{"CFF ", "CFF2", "COLR", "SVG ", "sbix", "CBDT", "EBDT"} {
		if font.Has(tag) {
			return false
		}
	}
	return true
}

// source is a font prepared for slicing: parsed once, cut many times
type source struct {
	font      *Font
	numGlyphs int
	cmap      map[uint32]uint16
	offsets   []uint32
	rules     *substRules
}

func newSource(font *Font) (*source, error) {
	if !sliceable(font) {
		return nil, errors.New("this font cannot be sliced")
	}
	info, cmap, err := Inspect(font)
	if err != nil {
		return nil, err
	}
	offsets, err := glyphOffsets(font, info.Glyphs)
	if err != nil {
		return nil, err
	}
	rules, err := parseGSUB(font.Table("GSUB"), info.Glyphs)
	if err != nil {
		rules = &substRules{} // unreadable GSUB: slice without it
	}
	return &source{font: font, numGlyphs: info.Glyphs, cmap: cmap, offsets: offsets, rules: rules}, nil
}

func (s *source) glyph(gid int) []byte {
	return s.font.Table("glyf")[s.offsets[gid]:s.offsets[gid+1]]
}

// components lists the glyphs a composite glyph is built from
func components(glyph []byte) []uint16 {
	if len(glyph) < 10 || int16(binary.BigEndian.Uint16(glyph)) >= 0 {
		return nil
	}
	var out []uint16
	pos := 10
	for n := 0; n < 1024; n++ {
		if pos+4 > len(glyph) {
			break
		}
		flags := binary.BigEndian.Uint16(glyph[pos:])
		out = append(out, binary.BigEndian.Uint16(glyph[pos+2:]))
		pos += 4
		if flags&0x0001 != 0 { // ARG_1_AND_2_ARE_WORDS
			pos += 4
		} else {
			pos += 2
		}
		switch {
		case flags&0x0008 != 0: // WE_HAVE_A_SCALE
			pos += 2
		case flags&0x0040 != 0: // WE_HAVE_AN_X_AND_Y_SCALE
			pos += 4
		case flags&0x0080 != 0: // WE_HAVE_A_TWO_BY_TWO
			pos += 8
		}
		if flags&0x0020 == 0 { // MORE_COMPONENTS
			break
		}
	}
	return out
}

// keepSet returns the glyphs a slice of these codepoints needs
func (s *source) keepSet(codepoints []uint32) ([]bool, []Mapping) {
	keep := make([]bool, s.numGlyphs)
	keep[0] = true
	var mappings []Mapping
	for _, cp := range codepoints {
		if gid, ok := s.cmap[cp]; ok {
			keep[gid] = true
			mappings = append(mappings, Mapping{cp, gid})
		}
	}
	for round := 0; round < 16; round++ {
		grew := false
		// composite components, walked with a work list
		var work []int
		for gid, k := range keep {
			if k {
				work = append(work, gid)
			}
		}
		for len(work) > 0 {
			gid := work[len(work)-1]
			work = work[:len(work)-1]
			for _, c := range components(s.glyph(gid)) {
				if int(c) < s.numGlyphs && !keep[c] {
					keep[c] = true
					work = append(work, int(c))
					grew = true
				}
			}
		}
		if s.rules.closure(keep) {
			grew = true
		}
		if !grew {
			break
		}
	}
	return keep, mappings
}

// slice returns the tables of a font holding only the given codepoints
func (s *source) slice(codepoints []uint32) (map[string][]byte, error) {
	keep, mappings := s.keepSet(codepoints)
	tables := map[string][]byte{}
	for tag, t := range s.font.Tables {
		if tag != "DSIG" {
			tables[tag] = t
		}
	}

	// glyf + long loca
	var glyf []byte
	loca := make([]byte, 4*(s.numGlyphs+1))
	for gid := 0; gid < s.numGlyphs; gid++ {
		binary.BigEndian.PutUint32(loca[4*gid:], uint32(len(glyf)))
		if keep[gid] {
			g := s.glyph(gid)
			glyf = append(glyf, g...)
			glyf = append(glyf, make([]byte, pad4(len(g))-len(g))...)
		}
	}
	binary.BigEndian.PutUint32(loca[4*s.numGlyphs:], uint32(len(glyf)))
	if len(glyf) == 0 {
		glyf = []byte{0, 0, 0, 0} // an all-empty glyf table is still a table
	}
	tables["glyf"], tables["loca"] = glyf, loca

	head := append([]byte(nil), s.font.Table("head")...)
	binary.BigEndian.PutUint16(head[50:], 1)
	tables["head"] = head

	// side bearings of dropped glyphs do not matter: zero them so they compress
	if t, err := clearBearings(s.font.Table("hmtx"), s.font.Table("hhea"), keep); err == nil {
		tables["hmtx"] = t
	}
	if vmtx := s.font.Table("vmtx"); vmtx != nil {
		if t, err := clearBearings(vmtx, s.font.Table("vhea"), keep); err == nil {
			tables["vmtx"] = t
		}
	}

	if gvar := s.font.Table("gvar"); gvar != nil {
		t, err := sliceGvar(gvar, keep)
		if err != nil {
			delete(tables, "gvar") // outlines stay at the default instance
		} else {
			tables["gvar"] = t
		}
	}

	if post := s.font.Table("post"); len(post) >= 32 {
		if v := binary.BigEndian.Uint32(post); v == 0x00020000 || v == 0x00025000 {
			post = append([]byte(nil), post[:32]...)
			binary.BigEndian.PutUint32(post, 0x00030000) // no glyph names
			tables["post"] = post
		}
	}

	tables["cmap"] = BuildCmap(mappings)
	return tables, nil
}

// clearBearings copies an hmtx / vmtx table with the side bearing of every
// glyph not kept set to zero. The header gives the number of long metrics.
func clearBearings(mtx, header []byte, keep []bool) ([]byte, error) {
	if len(header) < 36 {
		return nil, errTruncated
	}
	long := int(binary.BigEndian.Uint16(header[34:]))
	n := len(keep)
	if long == 0 || long > n || len(mtx) < 4*long+2*(n-long) {
		return nil, errTruncated
	}
	out := append([]byte(nil), mtx...)
	for gid := 0; gid < n; gid++ {
		if keep[gid] {
			continue
		}
		if gid < long {
			binary.BigEndian.PutUint16(out[4*gid+2:], 0)
		} else {
			binary.BigEndian.PutUint16(out[4*long+2*(gid-long):], 0)
		}
	}
	return out, nil
}

// sliceGvar rebuilds a gvar table with variation data for kept glyphs only
func sliceGvar(gvar []byte, keep []bool) ([]byte, error) {
	if len(gvar) < 20 {
		return nil, errTruncated
	}
	axisCount := int(binary.BigEndian.Uint16(gvar[4:]))
	sharedCount := int(binary.BigEndian.Uint16(gvar[6:]))
	sharedOffset := int64(binary.BigEndian.Uint32(gvar[8:]))
	glyphCount := int(binary.BigEndian.Uint16(gvar[12:]))
	flags := binary.BigEndian.Uint16(gvar[14:])
	dataOffset := int64(binary.BigEndian.Uint32(gvar[16:]))
	if glyphCount != len(keep) {
		return nil, errors.New("gvar does not cover every glyph")
	}
	shared, err := sub(gvar, sharedOffset, int64(sharedCount)*int64(axisCount)*2)
	if err != nil {
		return nil, err
	}

	long := flags&1 != 0
	offsetAt := func(i int) (int64, error) {
		if long {
			v, err := u32(gvar, 20+4*i)
			return int64(v), err
		}
		v, err := u16(gvar, 20+2*i)
		return int64(v) * 2, err
	}

	headerSize := 20 + 4*(glyphCount+1)
	out := make([]byte, headerSize, headerSize+len(shared))
	copy(out, gvar[:20])
	binary.BigEndian.PutUint16(out[14:], flags|1)
	binary.BigEndian.PutUint32(out[8:], uint32(headerSize))
	out = append(out, shared...)
	for len(out)%4 != 0 {
		out = append(out, 0)
	}
	binary.BigEndian.PutUint32(out[16:], uint32(len(out)))
	base := len(out)

	start, err := offsetAt(0)
	if err != nil {
		return nil, err
	}
	for gid := 0; gid < glyphCount; gid++ {
		binary.BigEndian.PutUint32(out[20+4*gid:], uint32(len(out)-base))
		end, err := offsetAt(gid + 1)
		if err != nil {
			return nil, err
		}
		if end < start {
			return nil, errors.New("gvar offsets are out of order")
		}
		if keep[gid] && end > start {
			data, err := sub(gvar, dataOffset+start, end-start)
			if err != nil {
				return nil, err
			}
			out = append(out, data...)
		}
		start = end
	}
	binary.BigEndian.PutUint32(out[20+4*glyphCount:], uint32(len(out)-base))
	return out, nil
}
