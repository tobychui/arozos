package xls

/*
	biff.go - the BIFF record stream and its strings.

	A workbook stream is a flat list of records: a 16-bit type, a 16-bit
	length and the payload. A payload longer than 8224 bytes is split into
	CONTINUE records, and readers must stitch them back together - with a
	twist for strings: when a string's characters run into a CONTINUE, the
	continuation starts with a fresh flags byte saying whether the rest is
	stored 8-bit ("compressed", Latin-1) or 16-bit (UTF-16LE). So each
	stitched record remembers where its CONTINUE parts begin, and the
	string reader re-reads the flags at those boundaries.
*/

import (
	"encoding/binary"
	"errors"
	"math"
	"unicode/utf16"

	"imuslab.com/arozos/mod/office/internal/codepage"
)

// record types
const (
	rtFormula       = 0x0006
	rtEOF           = 0x000A
	rtCalcCount     = 0x000C
	rtCalcMode      = 0x000D
	rtPrecision     = 0x000E
	rtRefMode       = 0x000F
	rtDelta         = 0x0010
	rtIteration     = 0x0011
	rtProtect       = 0x0012
	rtPassword      = 0x0013
	rtHeader        = 0x0014
	rtFooter        = 0x0015
	rtExternSheet   = 0x0017
	rtName          = 0x0018
	rtWindowProtect = 0x0019
	rtNote          = 0x001C
	rtDateMode      = 0x0022
	rtExternName    = 0x0023
	rtFilePass      = 0x002F
	rtFont          = 0x0031
	rtContinue      = 0x003C
	rtWindow1       = 0x003D
	rtPane          = 0x0041
	rtCodePage      = 0x0042
	rtDefColWidth   = 0x0055
	rtObj           = 0x005D
	rtColInfo       = 0x007D
	rtBoundSheet    = 0x0085
	rtPalette       = 0x0092
	rtStandardWidth = 0x0099
	rtMulRk         = 0x00BD
	rtMulBlank      = 0x00BE
	rtRString       = 0x00D6
	rtXF            = 0x00E0
	rtMergeCells    = 0x00E5
	rtMsoDrawingGrp = 0x00EB
	rtMsoDrawing    = 0x00EC
	rtSST           = 0x00FC
	rtLabelSST      = 0x00FD
	rtSupBook       = 0x01AE
	rtCondFmt       = 0x01B0
	rtCF            = 0x01B1
	rtHLink         = 0x01B8
	rtTxo           = 0x01B6
	rtDimensions    = 0x0200
	rtBlank         = 0x0201
	rtNumber        = 0x0203
	rtLabel         = 0x0204
	rtBoolErr       = 0x0205
	rtString        = 0x0207
	rtRow           = 0x0208
	rtArray         = 0x0221
	rtDefaultRowHgt = 0x0225
	rtTable         = 0x0236
	rtWindow2       = 0x023E
	rtRK            = 0x027E
	rtStyle         = 0x0293
	rtFormat        = 0x041E
	rtShrFmla       = 0x04BC
	rtBOF           = 0x0809
	rtSheetExt      = 0x0862
	rtXFExt         = 0x087D
	rtBOF2          = 0x0009 // BIFF2
	rtBOF3          = 0x0209 // BIFF3
	rtBOF4          = 0x0409 // BIFF4
	rtFormula4      = 0x0406 // BIFF4 FORMULA
	rtLabel2        = 0x0004 // BIFF2 LABEL
	rtFormat4       = 0x001E // BIFF4/5 FORMAT
)

// maxRecords bounds the records read from one stream
const maxRecords = 8 << 20

var errTruncated = errors.New("truncated record")

// record is one record with its CONTINUE parts appended
type record struct {
	typ  uint16
	data []byte
	// conts are the offsets in data where a CONTINUE part begins
	conts []int
	// pos is the offset of the record header in the stream
	pos int
}

// readRecords splits a workbook stream into records, folding CONTINUE
// records into the record before them
func readRecords(stream []byte) ([]*record, error) {
	var out []*record
	pos := 0
	for pos+4 <= len(stream) {
		typ := binary.LittleEndian.Uint16(stream[pos:])
		size := int(binary.LittleEndian.Uint16(stream[pos+2:]))
		start := pos + 4
		end := start + size
		if end > len(stream) {
			end = len(stream)
		}
		payload := stream[start:end]
		if typ == rtContinue && len(out) > 0 {
			last := out[len(out)-1]
			last.conts = append(last.conts, len(last.data))
			last.data = append(last.data, payload...)
		} else {
			// copy so appending a CONTINUE never writes into the stream
			out = append(out, &record{typ: typ, data: append([]byte(nil), payload...), pos: pos})
		}
		if len(out) > maxRecords {
			return nil, errors.New("too many records")
		}
		pos = end
	}
	return out, nil
}

// reader walks a record's payload; it knows where CONTINUE parts begin so
// strings can be read across them
type reader struct {
	b     []byte
	conts []int
	pos   int
	err   error
}

func newReader(r *record) *reader { return &reader{b: r.data, conts: r.conts} }

func (r *reader) left() int { return len(r.b) - r.pos }

func (r *reader) fail() {
	if r.err == nil {
		r.err = errTruncated
	}
	r.pos = len(r.b)
}

func (r *reader) u8() uint8 {
	if r.pos+1 > len(r.b) {
		r.fail()
		return 0
	}
	v := r.b[r.pos]
	r.pos++
	return v
}

func (r *reader) u16() uint16 {
	if r.pos+2 > len(r.b) {
		r.fail()
		return 0
	}
	v := binary.LittleEndian.Uint16(r.b[r.pos:])
	r.pos += 2
	return v
}

func (r *reader) u32() uint32 {
	if r.pos+4 > len(r.b) {
		r.fail()
		return 0
	}
	v := binary.LittleEndian.Uint32(r.b[r.pos:])
	r.pos += 4
	return v
}

func (r *reader) f64() float64 {
	if r.pos+8 > len(r.b) {
		r.fail()
		return 0
	}
	v := math.Float64frombits(binary.LittleEndian.Uint64(r.b[r.pos:]))
	r.pos += 8
	return v
}

func (r *reader) bytes(n int) []byte {
	// against the bytes left: r.pos+n can overflow a 32-bit int
	if n < 0 || n > len(r.b)-r.pos {
		r.fail()
		return nil
	}
	v := r.b[r.pos : r.pos+n]
	r.pos += n
	return v
}

func (r *reader) skip(n int) { r.bytes(n) }

// nextCont is the next CONTINUE boundary after the current position
func (r *reader) nextCont() int {
	for _, c := range r.conts {
		if c > r.pos {
			return c
		}
	}
	return len(r.b)
}

// atCont reports whether the reader sits exactly on a CONTINUE boundary
func (r *reader) atCont() bool {
	for _, c := range r.conts {
		if c == r.pos {
			return true
		}
		if c > r.pos {
			break
		}
	}
	return false
}

// chars reads cch characters that start in the given width; at a
// CONTINUE boundary the width is re-read from a new flags byte
func (r *reader) chars(cch int, high bool) string {
	if cch <= 0 {
		return ""
	}
	// a character takes at least a byte: never reserve more than is left
	u := make([]uint16, 0, min(cch, max(len(r.b)-r.pos, 0)))
	for len(u) < cch && r.pos < len(r.b) {
		// characters running into a CONTINUE part: it starts with a new
		// flags byte (also when only the string's header fitted before it)
		if r.atCont() {
			high = r.u8()&1 != 0
			continue
		}
		limit := r.nextCont()
		if high {
			for len(u) < cch && r.pos+2 <= limit {
				u = append(u, binary.LittleEndian.Uint16(r.b[r.pos:]))
				r.pos += 2
			}
			if len(u) < cch && r.pos < limit {
				r.pos = limit // an odd byte before the boundary
			}
		} else {
			for len(u) < cch && r.pos < limit {
				u = append(u, uint16(r.b[r.pos]))
				r.pos++
			}
		}
		if len(u) < cch && r.pos >= len(r.b) {
			r.fail()
		}
	}
	return string(utf16.Decode(u))
}

// xlString reads an XLUnicodeString (16-bit count) - BIFF8
func (r *reader) xlString() string {
	cch := int(r.u16())
	flags := r.u8()
	return r.chars(cch, flags&1 != 0)
}

// shortString reads a ShortXLUnicodeString (8-bit count) - BIFF8
func (r *reader) shortString() string {
	cch := int(r.u8())
	flags := r.u8()
	return r.chars(cch, flags&1 != 0)
}

// noCchString reads an XLUnicodeStringNoCch of known length - BIFF8
func (r *reader) noCchString(cch int) string {
	flags := r.u8()
	return r.chars(cch, flags&1 != 0)
}

// richString reads an XLUnicodeRichExtendedString (the SST entries):
// formatting runs and phonetic data are skipped
func (r *reader) richString() string {
	cch := int(r.u16())
	flags := r.u8()
	runs, ext := 0, 0
	if flags&0x08 != 0 {
		runs = int(r.u16())
	}
	if flags&0x04 != 0 {
		ext = int(int32(r.u32()))
	}
	s := r.chars(cch, flags&1 != 0)
	r.skip(4 * runs)
	if ext > 0 {
		r.skip(ext)
	}
	return s
}

// byteString reads 8-bit characters in the workbook's code page (BIFF5)
func (r *reader) byteString(n int, cp codepage.Decoder) string {
	return cp.Decode(r.bytes(n))
}
