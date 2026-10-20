package fonts

/*
	cmap.go

	Reads the character map of a font (Unicode codepoint to glyph id) and
	writes a new one for a slice. Reading accepts formats 0, 4, 6, 12 and 13
	from the Unicode subtables; writing produces a format 4 subtable for the
	Basic Multilingual Plane and a format 12 one for everything.
*/

import (
	"encoding/binary"
	"errors"
	"sort"
)

// maxCmapWork bounds the codepoints a cmap may make us walk, so a subtable
// with huge or overlapping ranges cannot keep the server busy
const maxCmapWork = 4 << 20

const maxCodepoint = 0x10FFFF

// Mapping pairs a codepoint with its glyph
type Mapping struct {
	Codepoint uint32
	Glyph     uint16
}

// cmapRank orders the Unicode subtables, best first; 0 means unusable
func cmapRank(platform, encoding uint16) int {
	switch {
	case platform == 3 && encoding == 10:
		return 6
	case platform == 0 && (encoding == 4 || encoding == 6):
		return 5
	case platform == 3 && encoding == 1:
		return 4
	case platform == 0 && encoding <= 3:
		return 3
	case platform == 3 && encoding == 0:
		return 2
	case platform == 1 && encoding == 0:
		return 1
	}
	return 0
}

// ParseCmap returns the codepoint to glyph map of the font's best Unicode
// subtable. Glyph ids at or beyond numGlyphs are dropped.
func ParseCmap(table []byte, numGlyphs int) (map[uint32]uint16, error) {
	count, err := u16(table, 2)
	if err != nil {
		return nil, err
	}
	bestRank, bestOffset := 0, int64(-1)
	for i := 0; i < int(count); i++ {
		platform, err1 := u16(table, 4+8*i)
		encoding, err2 := u16(table, 6+8*i)
		offset, err3 := u32(table, 8+8*i)
		if err1 != nil || err2 != nil || err3 != nil {
			return nil, errTruncated
		}
		format, err := u16(table, int(min(int64(offset), int64(len(table)))))
		if err != nil {
			continue
		}
		if format == 14 {
			continue // variation sequences, not a character map
		}
		if rank := cmapRank(platform, encoding); rank > bestRank {
			bestRank, bestOffset = rank, int64(offset)
		}
	}
	if bestOffset < 0 {
		return nil, errors.New("the font has no Unicode character map")
	}

	m := map[uint32]uint16{}
	work := 0
	add := func(cp uint32, gid uint16) error {
		work++
		if work > maxCmapWork {
			return errors.New("the character map is too large")
		}
		if gid != 0 && int(gid) < numGlyphs && cp <= maxCodepoint {
			if _, exists := m[cp]; !exists {
				m[cp] = gid
			}
		}
		return nil
	}

	st := table[bestOffset:]
	format, _ := u16(st, 0)
	switch format {
	case 0:
		glyphs, err := sub(st, 6, 256)
		if err != nil {
			return nil, err
		}
		for c, g := range glyphs {
			add(uint32(c), uint16(g))
		}
	case 4:
		segX2, err := u16(st, 6)
		if err != nil {
			return nil, err
		}
		segs := int(segX2 / 2)
		endOff, startOff, deltaOff, rangeOff := 14, 16+2*segs, 16+4*segs, 16+6*segs
		if _, err := sub(st, int64(rangeOff), int64(2*segs)); err != nil {
			return nil, err
		}
		for s := 0; s < segs; s++ {
			end, _ := u16(st, endOff+2*s)
			start, _ := u16(st, startOff+2*s)
			delta, _ := u16(st, deltaOff+2*s)
			ro, _ := u16(st, rangeOff+2*s)
			if start > end {
				continue
			}
			for c := uint32(start); c <= uint32(end); c++ {
				if c == 0xFFFF {
					break
				}
				var gid uint16
				if ro == 0 {
					gid = uint16(c) + delta
				} else {
					at := rangeOff + 2*s + int(ro) + 2*int(c-uint32(start))
					raw, err := u16(st, at)
					if err != nil {
						continue // points past the table; treat as unmapped
					}
					if raw != 0 {
						gid = raw + delta
					}
				}
				if err := add(c, gid); err != nil {
					return nil, err
				}
			}
		}
	case 6:
		first, err1 := u16(st, 6)
		count, err2 := u16(st, 8)
		if err1 != nil || err2 != nil {
			return nil, errTruncated
		}
		for i := 0; i < int(count); i++ {
			gid, err := u16(st, 10+2*i)
			if err != nil {
				return nil, err
			}
			add(uint32(first)+uint32(i), gid)
		}
	case 12, 13:
		groups, err := u32(st, 12)
		if err != nil {
			return nil, err
		}
		if _, err := sub(st, 16, int64(groups)*12); err != nil {
			return nil, err
		}
		for i := 0; i < int(groups); i++ {
			rec := st[16+12*i:]
			start := binary.BigEndian.Uint32(rec)
			end := binary.BigEndian.Uint32(rec[4:])
			gid := binary.BigEndian.Uint32(rec[8:])
			if start > end || end > maxCodepoint {
				continue
			}
			for c := start; c <= end; c++ {
				g := gid
				if format == 12 {
					g = gid + (c - start)
				}
				if g > 0xFFFF {
					break
				}
				if err := add(c, uint16(g)); err != nil {
					return nil, err
				}
			}
		}
	default:
		return nil, errors.New("unsupported character map format")
	}
	if len(m) == 0 {
		return nil, errors.New("the character map is empty")
	}
	return m, nil
}

// BuildCmap writes a cmap table holding the given mappings
func BuildCmap(mappings []Mapping) []byte {
	sorted := append([]Mapping(nil), mappings...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i].Codepoint < sorted[j].Codepoint })

	var bmp []Mapping
	for _, m := range sorted {
		if m.Codepoint < 0xFFFF {
			bmp = append(bmp, m)
		}
	}
	f4 := buildFormat4(bmp)
	f12 := buildFormat12(sorted)

	var out []byte
	if f4 != nil {
		out = make([]byte, 4+16)
		binary.BigEndian.PutUint16(out[2:], 2)
		binary.BigEndian.PutUint16(out[4:], 3)
		binary.BigEndian.PutUint16(out[6:], 1)
		binary.BigEndian.PutUint32(out[8:], 20)
		binary.BigEndian.PutUint16(out[12:], 3)
		binary.BigEndian.PutUint16(out[14:], 10)
		binary.BigEndian.PutUint32(out[16:], uint32(20+len(f4)))
		out = append(out, f4...)
	} else {
		out = make([]byte, 4+8)
		binary.BigEndian.PutUint16(out[2:], 1)
		binary.BigEndian.PutUint16(out[4:], 3)
		binary.BigEndian.PutUint16(out[6:], 10)
		binary.BigEndian.PutUint32(out[8:], 12)
	}
	return append(out, f12...)
}

// buildFormat4 maps runs of consecutive codepoints through a glyph id array.
// It returns nil when the subtable would not fit format 4's 16 bit length.
func buildFormat4(bmp []Mapping) []byte {
	type segment struct{ start, end, first int } // first: index into bmp
	var segs []segment
	for i, m := range bmp {
		if n := len(segs); n > 0 && int(m.Codepoint) == segs[n-1].end+1 {
			segs[n-1].end++
			continue
		}
		segs = append(segs, segment{int(m.Codepoint), int(m.Codepoint), i})
	}
	segs = append(segs, segment{0xFFFF, 0xFFFF, -1})

	n := len(segs)
	glyphArray := 0
	for _, s := range segs[:n-1] {
		glyphArray += s.end - s.start + 1
	}
	length := 16 + 8*n + 2*glyphArray
	if length > 0xFFFF {
		return nil
	}

	out := make([]byte, length)
	binary.BigEndian.PutUint16(out[0:], 4)
	binary.BigEndian.PutUint16(out[2:], uint16(length))
	binary.BigEndian.PutUint16(out[6:], uint16(2*n))
	sel := 0
	for (2 << sel) <= n {
		sel++
	}
	searchRange := 2 * (1 << sel)
	binary.BigEndian.PutUint16(out[8:], uint16(searchRange))
	binary.BigEndian.PutUint16(out[10:], uint16(sel))
	binary.BigEndian.PutUint16(out[12:], uint16(2*n-searchRange))

	endOff, startOff, deltaOff, rangeOff, arrayOff := 14, 16+2*n, 16+4*n, 16+6*n, 16+8*n
	arrayIndex := 0
	for i, s := range segs {
		binary.BigEndian.PutUint16(out[endOff+2*i:], uint16(s.end))
		binary.BigEndian.PutUint16(out[startOff+2*i:], uint16(s.start))
		if s.first < 0 {
			binary.BigEndian.PutUint16(out[deltaOff+2*i:], 1) // 0xFFFF + 1 = glyph 0
			continue
		}
		// distance in bytes from this idRangeOffset entry to its first glyph
		binary.BigEndian.PutUint16(out[rangeOff+2*i:], uint16(2*(n-i)+2*arrayIndex))
		for k := 0; k <= s.end-s.start; k++ {
			binary.BigEndian.PutUint16(out[arrayOff+2*arrayIndex:], bmp[s.first+k].Glyph)
			arrayIndex++
		}
	}
	return out
}

// buildFormat12 groups runs where both codepoints and glyph ids are consecutive
func buildFormat12(sorted []Mapping) []byte {
	type group struct{ start, end, glyph uint32 }
	var groups []group
	for _, m := range sorted {
		if n := len(groups); n > 0 {
			g := &groups[n-1]
			if m.Codepoint == g.end+1 && uint32(m.Glyph) == g.glyph+(m.Codepoint-g.start) {
				g.end++
				continue
			}
		}
		groups = append(groups, group{m.Codepoint, m.Codepoint, uint32(m.Glyph)})
	}
	out := make([]byte, 16+12*len(groups))
	binary.BigEndian.PutUint16(out[0:], 12)
	binary.BigEndian.PutUint32(out[4:], uint32(len(out)))
	binary.BigEndian.PutUint32(out[12:], uint32(len(groups)))
	for i, g := range groups {
		rec := out[16+12*i:]
		binary.BigEndian.PutUint32(rec, g.start)
		binary.BigEndian.PutUint32(rec[4:], g.end)
		binary.BigEndian.PutUint32(rec[8:], g.glyph)
	}
	return out
}
