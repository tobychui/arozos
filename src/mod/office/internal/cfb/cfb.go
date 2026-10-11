/*
Package cfb reads Compound File Binary files ([MS-CFB], also called OLE2
structured storage): the container the Office 97-2003 formats live in. A
.doc keeps its text in a "WordDocument" stream next to a "1Table" stream,
an .xls keeps everything in "Workbook", a .ppt in "PowerPoint Document" -
all of them inside one compound file.

A compound file is a little FAT file system packed into one file: fixed
size sectors chained through a File Allocation Table, a directory of
128-byte entries arranged as red-black trees (one per storage), and a
"mini stream" with its own 64-byte sector FAT for streams smaller than the
cutoff (4096 bytes). Only reading is implemented. Every chain walk is
bounded and every offset checked, since the input is untrusted.
*/
package cfb

import (
	"encoding/binary"
	"errors"
	"sort"
	"strings"
	"unicode/utf16"
)

// Signature is the first eight bytes of every compound file
var Signature = []byte{0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1}

// special sector numbers
const (
	maxRegSect = 0xFFFFFFFA
	difSect    = 0xFFFFFFFC
	fatSect    = 0xFFFFFFFD
	endOfChain = 0xFFFFFFFE
	freeSect   = 0xFFFFFFFF
	noStream   = 0xFFFFFFFF
)

// directory entry object types
const (
	typeUnknown = 0
	typeStorage = 1
	typeStream  = 2
	typeRoot    = 5
)

// ErrNotCompound is returned for data that is not a compound file
var ErrNotCompound = errors.New("not an OLE2 compound file")

var errCorrupt = errors.New("corrupted compound file")

// Entry is one storage or stream of the file
type Entry struct {
	// Path is the slash separated location below the root, e.g.
	// "WordDocument" or "ObjectPool/_1234/\x01Ole". Names are compared
	// case-insensitively, as the format specifies.
	Path     string
	Name     string
	IsStream bool
	Size     int64

	start uint32
}

// File is an opened compound file
type File struct {
	data       []byte
	sectorSize int
	miniSize   int
	cutoff     int64
	fat        []uint32
	miniFat    []uint32
	ministream []byte
	entries    []*Entry
	byPath     map[string]*Entry
}

// IsCompound reports whether data starts with the compound file signature
func IsCompound(data []byte) bool {
	if len(data) < 512 {
		return false
	}
	for i, b := range Signature {
		if data[i] != b {
			return false
		}
	}
	return true
}

// Open parses the header, FAT, mini FAT and directory of a compound file
func Open(data []byte) (*File, error) {
	if !IsCompound(data) {
		return nil, ErrNotCompound
	}
	le := binary.LittleEndian
	if le.Uint16(data[28:]) != 0xFFFE {
		return nil, errCorrupt
	}
	shift := le.Uint16(data[30:])
	miniShift := le.Uint16(data[32:])
	if shift != 9 && shift != 12 {
		return nil, errCorrupt
	}
	if miniShift != 6 {
		return nil, errCorrupt
	}
	f := &File{
		data:       data,
		sectorSize: 1 << shift,
		miniSize:   1 << miniShift,
		cutoff:     int64(le.Uint32(data[56:])),
		byPath:     map[string]*Entry{},
	}
	if f.cutoff == 0 {
		f.cutoff = 4096
	}
	numFat := le.Uint32(data[44:])
	firstDir := le.Uint32(data[48:])
	firstMiniFat := le.Uint32(data[60:])
	numMiniFat := le.Uint32(data[64:])
	firstDifat := le.Uint32(data[68:])
	numDifat := le.Uint32(data[72:])

	// the sectors holding the FAT: 109 listed in the header, the rest in
	// a chain of DIFAT sectors
	maxSectors := uint32(len(data) / f.sectorSize)
	if numFat > maxSectors {
		return nil, errCorrupt
	}
	var fatSectors []uint32
	for i := 0; i < 109 && uint32(len(fatSectors)) < numFat; i++ {
		fatSectors = append(fatSectors, le.Uint32(data[76+4*i:]))
	}
	next := firstDifat
	per := f.sectorSize/4 - 1
	for d := uint32(0); d < numDifat && uint32(len(fatSectors)) < numFat; d++ {
		sec, ok := f.sector(next)
		if !ok {
			return nil, errCorrupt
		}
		for i := 0; i < per && uint32(len(fatSectors)) < numFat; i++ {
			fatSectors = append(fatSectors, le.Uint32(sec[4*i:]))
		}
		next = le.Uint32(sec[4*per:])
	}
	for _, s := range fatSectors {
		sec, ok := f.sector(s)
		if !ok {
			return nil, errCorrupt
		}
		for i := 0; i < f.sectorSize; i += 4 {
			f.fat = append(f.fat, le.Uint32(sec[i:]))
		}
	}

	// directory
	dir, err := f.chain(firstDir, -1)
	if err != nil {
		return nil, err
	}
	type rawEntry struct {
		name               string
		typ                byte
		left, right, child uint32
		start              uint32
		size               int64
	}
	var raws []rawEntry
	for off := 0; off+128 <= len(dir); off += 128 {
		e := dir[off : off+128]
		nameLen := int(le.Uint16(e[64:]))
		if nameLen > 64 {
			nameLen = 64
		}
		u := make([]uint16, 0, 32)
		for i := 0; i+1 < nameLen; i += 2 {
			c := le.Uint16(e[i:])
			if c == 0 {
				break
			}
			u = append(u, c)
		}
		size := int64(le.Uint64(e[120:]))
		if f.sectorSize == 512 {
			// version 3 files only define the low 32 bits
			size = int64(le.Uint32(e[120:]))
		}
		raws = append(raws, rawEntry{
			name:  string(utf16.Decode(u)),
			typ:   e[66],
			left:  le.Uint32(e[68:]),
			right: le.Uint32(e[72:]),
			child: le.Uint32(e[76:]),
			start: le.Uint32(e[116:]),
			size:  size,
		})
	}
	if len(raws) == 0 || raws[0].typ != typeRoot {
		return nil, errCorrupt
	}

	// the mini stream lives in the root entry's chain
	if raws[0].start != endOfChain && raws[0].size > 0 {
		ms, err := f.chain(raws[0].start, raws[0].size)
		if err != nil {
			return nil, err
		}
		f.ministream = ms
	}
	if numMiniFat > 0 && firstMiniFat != endOfChain {
		mf, err := f.chain(firstMiniFat, -1)
		if err != nil {
			return nil, err
		}
		for i := 0; i+4 <= len(mf); i += 4 {
			f.miniFat = append(f.miniFat, le.Uint32(mf[i:]))
		}
	}

	// walk the trees: every storage's child is the root of a binary tree
	// of its members, linked through left / right siblings
	visited := make([]bool, len(raws))
	var walk func(idx uint32, prefix string, depth int) error
	walk = func(idx uint32, prefix string, depth int) error {
		if idx == noStream {
			return nil
		}
		// int64: int(idx) of a large id is negative on 32-bit targets
		if int64(idx) >= int64(len(raws)) || visited[idx] || depth > 64 {
			return errCorrupt
		}
		visited[idx] = true
		r := raws[idx]
		if err := walk(r.left, prefix, depth+1); err != nil {
			return err
		}
		if r.typ == typeStream || r.typ == typeStorage {
			p := r.name
			if prefix != "" {
				p = prefix + "/" + r.name
			}
			ent := &Entry{Path: p, Name: r.name, IsStream: r.typ == typeStream, Size: r.size, start: r.start}
			f.entries = append(f.entries, ent)
			f.byPath[strings.ToLower(p)] = ent
			if r.typ == typeStorage {
				if err := walk(r.child, p, depth+1); err != nil {
					return err
				}
			}
		}
		return walk(r.right, prefix, depth+1)
	}
	visited[0] = true
	if err := walk(raws[0].child, "", 0); err != nil {
		return nil, err
	}
	sort.Slice(f.entries, func(i, j int) bool { return f.entries[i].Path < f.entries[j].Path })
	return f, nil
}

// sector returns the bytes of a regular sector (sector 0 follows the
// 512-byte header; a 4096-byte sector file pads the header to a sector)
func (f *File) sector(n uint32) ([]byte, bool) {
	if n > maxRegSect {
		return nil, false
	}
	off := int64(n+1) * int64(f.sectorSize)
	end := off + int64(f.sectorSize)
	if end > int64(len(f.data)) {
		// a truncated last sector: tolerate what is there
		if off >= int64(len(f.data)) {
			return nil, false
		}
		buf := make([]byte, f.sectorSize)
		copy(buf, f.data[off:])
		return buf, true
	}
	return f.data[off:end], true
}

// chain reads a chain of regular sectors, stopping at size bytes (size < 0
// reads the whole chain)
func (f *File) chain(start uint32, size int64) ([]byte, error) {
	var out []byte
	if size > 0 {
		if size > int64(len(f.data)) {
			return nil, errCorrupt
		}
		out = make([]byte, 0, size)
	}
	seen := 0
	limit := len(f.fat) + 1
	for s := start; s != endOfChain; {
		if int64(s) >= int64(len(f.fat)) || seen > limit {
			return nil, errCorrupt
		}
		sec, ok := f.sector(s)
		if !ok {
			return nil, errCorrupt
		}
		out = append(out, sec...)
		seen++
		if size >= 0 && int64(len(out)) >= size {
			break
		}
		s = f.fat[s]
	}
	if size >= 0 {
		if int64(len(out)) < size {
			return nil, errCorrupt
		}
		out = out[:size]
	}
	return out, nil
}

// miniChain reads a stream stored in the mini stream
func (f *File) miniChain(start uint32, size int64) ([]byte, error) {
	out := make([]byte, 0, size)
	seen := 0
	for s := start; s != endOfChain && int64(len(out)) < size; {
		if int64(s) >= int64(len(f.miniFat)) || seen > len(f.miniFat) {
			return nil, errCorrupt
		}
		if int64(s)*int64(f.miniSize) >= int64(len(f.ministream)) {
			return nil, errCorrupt
		}
		off := int(s) * f.miniSize
		end := off + f.miniSize
		if end > len(f.ministream) {
			end = len(f.ministream) // a short last mini sector
		}
		out = append(out, f.ministream[off:end]...)
		seen++
		s = f.miniFat[s]
	}
	if int64(len(out)) < size {
		return nil, errCorrupt
	}
	return out[:size], nil
}

// Entries lists every storage and stream, sorted by path
func (f *File) Entries() []Entry {
	out := make([]Entry, len(f.entries))
	for i, e := range f.entries {
		out[i] = *e
	}
	return out
}

// Has reports whether a stream of that path exists
func (f *File) Has(path string) bool {
	e, ok := f.byPath[strings.ToLower(path)]
	return ok && e.IsStream
}

// Stream returns the content of the stream at path
func (f *File) Stream(path string) ([]byte, error) {
	e, ok := f.byPath[strings.ToLower(path)]
	if !ok || !e.IsStream {
		return nil, errors.New("stream not found: " + path)
	}
	if e.Size == 0 {
		return []byte{}, nil
	}
	if e.Size > int64(len(f.data)) {
		return nil, errCorrupt
	}
	if e.Size < f.cutoff {
		return f.miniChain(e.start, e.Size)
	}
	return f.chain(e.start, e.Size)
}
