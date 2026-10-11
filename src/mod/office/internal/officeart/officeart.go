/*
Package officeart reads the Office Drawing binary format ([MS-ODRAW],
"Escher"): the shapes, pictures and their properties that Word, Excel and
PowerPoint 97-2003 all store in the same record language. Word keeps the
records in its table stream and the Data stream, Excel in MSODRAWING /
MSODRAWINGGROUP records, PowerPoint inside the PPDrawing and
PPDrawingGroup records of its document stream.

Every record starts with an 8-byte header (version, instance, type,
length); a version of 0xF marks a container whose payload is more records.
On top of that tree this package decodes what the importers share:

  - shape containers: type, id, flags, anchors, client data (Shape),
  - the property tables (Props), including the complex properties and
    boolean property sets,
  - colours (ColorRef),
  - the picture store and the BLIPs in it (Blip, DecodeBlip, BStore).

What a client anchor or client data record means is host specific and is
left to the doc, xls and ppt packages.
*/
package officeart

import (
	"encoding/binary"
	"errors"
)

// Record types
const (
	DggContainer    = 0xF000
	BStoreContainer = 0xF001
	DgContainer     = 0xF002
	SpgrContainer   = 0xF003
	SpContainer     = 0xF004
	SolverContainer = 0xF005
	FDGG            = 0xF006
	FBSE            = 0xF007
	FDG             = 0xF008
	FSPGR           = 0xF009
	FSP             = 0xF00A
	FOPT            = 0xF00B
	ClientTextbox   = 0xF00D
	ChildAnchor     = 0xF00F
	ClientAnchor    = 0xF010
	ClientData      = 0xF011
	FConnectorRule  = 0xF012
	SecondaryFOPT   = 0xF121
	TertiaryFOPT    = 0xF122
	BlipFirst       = 0xF018
	BlipLast        = 0xF117
	BlipEMF         = 0xF01A
	BlipWMF         = 0xF01B
	BlipPICT        = 0xF01C
	BlipJPEG        = 0xF01D
	BlipPNG         = 0xF01E
	BlipDIB         = 0xF01F
	BlipTIFF        = 0xF029
	BlipJPEGCMYK    = 0xF02A
	SplitMenuColors = 0xF11E
	FDGSL           = 0xF119
	ColorMRU        = 0xF11A
	FPSPL           = 0xF11D
)

// FSP flags
const (
	SpGroup      = 0x0001
	SpChild      = 0x0002
	SpPatriarch  = 0x0004
	SpDeleted    = 0x0008
	SpOleShape   = 0x0010
	SpHaveMaster = 0x0020
	SpFlipH      = 0x0040
	SpFlipV      = 0x0080
	SpConnector  = 0x0100
	SpHaveAnchor = 0x0200
	SpBackground = 0x0400
	SpHaveSpt    = 0x0800
)

// HeaderSize is the size of a record header
const HeaderSize = 8

var errShort = errors.New("truncated drawing record")

// Record is one record of the tree
type Record struct {
	Ver      uint8
	Instance uint16
	Type     uint16
	// Data is the payload; for a container it is the bytes its children
	// were parsed from
	Data     []byte
	Children []*Record
	// Offset is where the header starts in the buffer handed to Parse
	Offset int
}

// IsContainer reports a container record
func (r *Record) IsContainer() bool { return r != nil && r.Ver == 0xF }

// Child returns the first direct child of that type
func (r *Record) Child(typ uint16) *Record {
	if r == nil {
		return nil
	}
	for _, c := range r.Children {
		if c.Type == typ {
			return c
		}
	}
	return nil
}

// All returns the direct children of that type
func (r *Record) All(typ uint16) []*Record {
	if r == nil {
		return nil
	}
	var out []*Record
	for _, c := range r.Children {
		if c.Type == typ {
			out = append(out, c)
		}
	}
	return out
}

// Find collects every record of that type in the subtree, depth first
func (r *Record) Find(typ uint16) []*Record {
	var out []*Record
	var walk func(*Record)
	walk = func(n *Record) {
		for _, c := range n.Children {
			if c.Type == typ {
				out = append(out, c)
			}
			walk(c)
		}
	}
	if r != nil {
		walk(r)
	}
	return out
}

// ReadHeader decodes the record header at off
func ReadHeader(b []byte, off int) (ver uint8, inst uint16, typ uint16, length int, err error) {
	// off > len-HeaderSize, not off+HeaderSize > len: an offset read from
	// the file can sit near the int limit of a 32-bit target
	if off < 0 || off > len(b)-HeaderSize {
		return 0, 0, 0, 0, errShort
	}
	vi := binary.LittleEndian.Uint16(b[off:])
	ver = uint8(vi & 0xF)
	inst = vi >> 4
	typ = binary.LittleEndian.Uint16(b[off+2:])
	length = int(binary.LittleEndian.Uint32(b[off+4:]))
	return
}

// ParseOne reads the record at off and returns it with the offset just
// past it. A record claiming more bytes than there are is cut short, as
// Office itself tolerates.
func ParseOne(b []byte, off int) (*Record, int, error) {
	return parseOne(b, off, 0)
}

func parseOne(b []byte, off, depth int) (*Record, int, error) {
	ver, inst, typ, length, err := ReadHeader(b, off)
	if err != nil {
		return nil, len(b), err
	}
	start := off + HeaderSize
	end := start + length
	if length < 0 || end > len(b) || end < start {
		end = len(b)
	}
	r := &Record{Ver: ver, Instance: inst, Type: typ, Data: b[start:end], Offset: off}
	if ver == 0xF && depth < 64 {
		pos := start
		for pos+HeaderSize <= end {
			c, next, err := parseOne(b[:end], pos, depth+1)
			if err != nil || next <= pos {
				break
			}
			r.Children = append(r.Children, c)
			pos = next
		}
	}
	return r, end, nil
}

// Parse reads consecutive records from the start of b
func Parse(b []byte) []*Record {
	var out []*Record
	pos := 0
	for pos+HeaderSize <= len(b) {
		r, next, err := ParseOne(b, pos)
		if err != nil || next <= pos {
			break
		}
		out = append(out, r)
		pos = next
	}
	return out
}
