package smbserver

import (
	"strings"

	"imuslab.com/arozos/mod/storage/smbserver/wire"
)

/*
	streams.go

	Named streams: data beside a file under a name of its own, written as
	file:name in a path. Windows keeps where a download came from in
	Zone.Identifier, and macOS stores extended attributes, Finder info and
	resource forks this way instead of the ._ files it writes everywhere
	else. Where a stream is kept is the backend's business.

	A stream is passed to the Share as its file's path, StreamSeparator and
	the stream name. The separator is a NUL, which no file name can hold,
	because a colon can: Windows sends one for a Linux name in the private
	range, and macOS one inside an attribute name.
*/

// StreamSeparator joins a file's path and a stream name in a share path.
const StreamSeparator = "\x00"

// StreamShare is a Share that keeps named streams.
type StreamShare interface {
	//Streams lists the named streams of a file or folder, by name
	Streams(p string) []FileInfo
}

func streamPath(base, stream string) string { return base + StreamSeparator + stream }

// splitStreamPath is the inverse of streamPath. ok is false for a path
// without a stream.
func splitStreamPath(p string) (base, stream string, ok bool) {
	i := strings.Index(p, StreamSeparator)
	if i < 0 {
		return p, "", false
	}
	return p[:i], p[i+1:], true
}

func isStreamPath(p string) bool { return strings.Contains(p, StreamSeparator) }

// streamInfo is FILE_STREAM_INFORMATION: the file's own data first, then
// every named stream, each entry on 8 bytes.
func streamInfo(share Share, base string, info FileInfo) []byte {
	type entry struct {
		name string
		size int64
	}
	entries := []entry{}
	if !info.IsDir {
		entries = append(entries, entry{"::$DATA", info.Size})
	}
	if ss, ok := share.(StreamShare); ok {
		for _, s := range ss.Streams(base) {
			entries = append(entries, entry{":" + toWireName(s.Name) + ":$DATA", s.Size})
		}
	}
	w := wire.NewWriter(64 * len(entries))
	for i, e := range entries {
		start := w.Len()
		name := wire.EncodeUTF16(e.name)
		w.U32(0)
		w.U32(uint32(len(name)))
		w.U64(uint64(e.size))
		w.U64(allocationOf(e.size))
		w.Bytes(name)
		if i < len(entries)-1 {
			w.Align(8)
			next := w.Len() - start
			w.B[start] = byte(next)
			w.B[start+1] = byte(next >> 8)
			w.B[start+2] = byte(next >> 16)
			w.B[start+3] = byte(next >> 24)
		}
	}
	return w.B
}
