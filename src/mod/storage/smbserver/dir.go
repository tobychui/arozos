package smbserver

import (
	"encoding/binary"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

// dirEntry is one row of a listing. A handle lists from a snapshot taken at
// the first query, so paging never skips or repeats a file.
type dirEntry struct {
	name string //As the client sees it
	path string
	info FileInfo
}

// entrySize returns the fixed size of a directory information class. Any
// other class, such as the class 81 Windows 11 tries first, is refused with
// STATUS_INVALID_INFO_CLASS, and the client then falls back to class 37.
func entrySize(class uint8) int {
	switch class {
	case wire.FileDirectoryInformation:
		return 64
	case wire.FileFullDirectoryInformation:
		return 68
	case wire.FileBothDirectoryInformation:
		return 94
	case wire.FileNamesInformation:
		return 12
	case wire.FileIdBothDirectoryInformation:
		return 104
	case wire.FileIdFullDirectoryInformation:
		return 80
	}
	return 0
}

func encodeEntry(class uint8, e *dirEntry, s Share) []byte {
	name := wire.EncodeUTF16(e.name)
	fixed := entrySize(class)
	w := wire.NewWriter(fixed + len(name))
	w.U32(0) //Next entry, filled in by the caller
	w.U32(0) //File index
	if class == wire.FileNamesInformation {
		w.U32(uint32(len(name)))
		w.Bytes(name)
		return w.B
	}

	w.U64(wire.Filetime(birthOf(e.info)))
	w.U64(wire.Filetime(e.info.ModTime))
	w.U64(wire.Filetime(e.info.ModTime))
	w.U64(wire.Filetime(e.info.ModTime))
	if e.info.IsDir {
		w.U64(0)
		w.U64(0)
	} else {
		w.U64(uint64(e.info.Size))
		w.U64(allocationOf(e.info.Size))
	}
	w.U32(attributesOf(FileInfo{Name: e.name, IsDir: e.info.IsDir}))
	w.U32(uint32(len(name)))

	switch class {
	case wire.FileFullDirectoryInformation:
		w.U32(0)
	case wire.FileBothDirectoryInformation:
		w.U32(0)
		w.Zero(2 + 24) //Short name length, reserved, short name
	case wire.FileIdBothDirectoryInformation:
		w.U32(0)
		w.Zero(2 + 24 + 2)
		w.U64(fileNumber(s, e.path, e.info))
	case wire.FileIdFullDirectoryInformation:
		w.U32(0)
		w.U32(0)
		w.U64(fileNumber(s, e.path, e.info))
	}
	w.Bytes(name)
	return w.B
}

// loadDirectory takes the snapshot of a folder. A name without wildcards is
// answered with one lookup, which keeps Explorer's constant checks for
// desktop.ini cheap in a large folder.
func (o *open) loadDirectory(names *nameCache, pattern string) uint32 {
	share := o.tree.share
	dir := o.getPath()

	if pattern != "" && !hasWildcard(pattern) {
		o.dirEntries = nil
		if rel, st := parsePath(pattern); st == wire.StatusOK && rel != "" {
			res, err := resolve(share, names, joinPath(dir, rel))
			if err == nil && res.exists {
				o.dirEntries = []dirEntry{{name: toWireName(baseName(res.path)), path: res.path, info: res.info}}
			}
		}
		return wire.StatusOK
	}

	self, err := share.Stat(dir)
	if err != nil {
		return statusOf(err)
	}
	list, err := share.ReadDir(dir)
	if err != nil {
		return statusOf(err)
	}

	entries := make([]dirEntry, 0, len(list)+2)
	entries = append(entries, dirEntry{name: ".", path: dir, info: self}, dirEntry{name: "..", path: dirName(dir), info: self})
	for _, info := range list {
		entries = append(entries, dirEntry{name: toWireName(info.Name), path: joinPath(dir, info.Name), info: info})
	}
	o.dirEntries = entries
	return wire.StatusOK
}

func (c *conn) handleQueryDirectory(r *request) *response {
	q, err := wire.ParseQueryDirectory(r.raw)
	if err != nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	if !r.checkCharge(uint64(q.MaxOutput)) {
		return errorResponse(wire.StatusInvalidParameter)
	}
	o, status := r.open(q.FileID)
	if status != wire.StatusOK {
		return errorResponse(status)
	}
	if !o.isDir || o.pipe != nil {
		return errorResponse(wire.StatusInvalidParameter)
	}
	fixed := entrySize(q.Class)
	if fixed == 0 {
		return errorResponse(wire.StatusInvalidInfoClass)
	}
	if o.access&wire.FileReadData == 0 {
		return errorResponse(wire.StatusAccessDenied)
	}
	if !o.tree.share.CanRead(o.getPath()) {
		return errorResponse(wire.StatusAccessDenied)
	}

	o.dirMu.Lock()
	defer o.dirMu.Unlock()

	if !o.dirLoaded || q.Flags&(wire.RestartScans|wire.Reopen) != 0 {
		if q.Pattern != "" {
			o.dirPattern = q.Pattern
		}
		if st := o.loadDirectory(c.srv.names, o.dirPattern); st != wire.StatusOK {
			return errorResponse(st)
		}
		o.dirLoaded = true
		o.dirPos = 0
		o.dirSent = false
	}

	share := o.tree.share
	out := wire.NewWriter(4096)
	last := -1
	for o.dirPos < len(o.dirEntries) {
		e := &o.dirEntries[o.dirPos]
		if !matchPattern(o.dirPattern, e.name) {
			o.dirPos++
			continue
		}
		encoded := encodeEntry(q.Class, e, share)
		start := (out.Len() + 7) &^ 7
		if start+len(encoded) > int(q.MaxOutput) {
			break
		}
		out.Align(8)
		if last >= 0 {
			binary.LittleEndian.PutUint32(out.B[last:], uint32(start-last))
		}
		out.Bytes(encoded)
		last = start
		o.dirPos++
		if q.Flags&wire.ReturnSingleEntry != 0 {
			break
		}
	}

	if out.Len() == 0 {
		switch {
		case o.dirPos < len(o.dirEntries):
			if int(q.MaxOutput) < fixed {
				return errorResponse(wire.StatusInfoLengthMismatch)
			}
			return errorResponse(wire.StatusBufferOverflow)
		case !o.dirSent:
			return errorResponse(wire.StatusNoSuchFile)
		}
		return &response{status: wire.StatusNoMoreFiles}
	}
	o.dirSent = true

	w := wire.NewWriter(8 + out.Len())
	w.U16(9)
	w.U16(wire.HeaderSize + 8)
	w.U32(uint32(out.Len()))
	w.Bytes(out.B)
	return &response{body: w.B}
}
