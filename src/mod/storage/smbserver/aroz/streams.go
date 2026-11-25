package aroz

import (
	"fmt"
	"os"
	"path"
	"strings"

	"github.com/tobychui/smbsrv"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	streams.go

	Named streams kept as files beside the file they belong to:

		docs/report.docx:Zone.Identifier -> docs/.metadata/.streams/report.docx/Zone.Identifier
		docs:AFP_AfpInfo                 -> .metadata/.streams/docs/AFP_AfpInfo
		(the drive root):AFP_AfpInfo     -> .metadata/.rootstreams/AFP_AfpInfo

	so they work on every drive type, need no extended attributes from the
	file system, and live in the folder ArozOS keeps its own data in. Stream
	names are escaped for the disk, as they may hold characters a file name
	cannot. A file renamed or deleted over SMB takes its streams along;
	changes made through the File Manager leave them behind.

	The root has a folder of its own beside .streams, not a name inside it:
	every name in .streams may be a real file's, so any name chosen for the
	root there would be shared with a file of that name.
*/

const (
	streamFolder = ".metadata/.streams"
	rootStreams  = ".metadata/.rootstreams"
)

// streamDir is where the streams of a file or folder are kept.
func streamDir(base string) (out0 string) {
	defer logger.Out1(logger.In1("storage/smbserver/aroz", "streamDir", "base", base), &out0)
	if base == "" {
		return rootStreams
	}
	dir, name := path.Split(base)
	return joinShare(dir, streamFolder, name)
}

// encodeStream keeps letters, digits and . _ - as they are and escapes the
// rest as %XX, so any stream name becomes one safe file name.
func encodeStream(name string) (out0 string) {
	defer logger.Out1(logger.In1("storage/smbserver/aroz", "encodeStream", "name", name), &out0)
	var b strings.Builder
	for i := 0; i < len(name); i++ {
		c := name[i]
		safe := c >= 'a' && c <= 'z' || c >= 'A' && c <= 'Z' || c >= '0' && c <= '9' || c == '_' || c == '-' || c == '.'
		if safe && !(c == '.' && i == 0) {
			b.WriteByte(c)
		} else {
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}

func decodeStream(enc string) (out0 string, out1 bool) {
	defer logger.Out2(logger.In1("storage/smbserver/aroz", "decodeStream", "enc", enc), &out0, &out1)
	var b strings.Builder
	for i := 0; i < len(enc); i++ {
		if enc[i] != '%' {
			b.WriteByte(enc[i])
			continue
		}
		if i+2 >= len(enc) {
			return "", false
		}
		var c byte
		if _, err := fmt.Sscanf(enc[i+1:i+3], "%02X", &c); err != nil {
			logger.DebugErr("storage/smbserver/aroz", err)
			return "", false
		}
		b.WriteByte(c)
		i += 2
	}
	return b.String(), true
}

// sharePath turns a stream path into the share path of its sidecar file.
func sharePath(p string) (out0 string) {
	defer logger.Out1(logger.In1("storage/smbserver/aroz", "sharePath", "p", p), &out0)
	base, stream, ok := strings.Cut(p, smbsrv.StreamSeparator)
	if !ok {
		return p
	}
	return joinShare(streamDir(base), encodeStream(stream))
}

// basePath strips the stream, for questions about the file it belongs to.
func basePath(p string) (out0 string) {
	defer logger.Out1(logger.In1("storage/smbserver/aroz", "basePath", "p", p), &out0)
	base, _, _ := strings.Cut(p, smbsrv.StreamSeparator)
	return base
}

// Streams lists the streams of a file or folder.
func (s *share) Streams(p string) (out0 []smbsrv.FileInfo) {
	defer logger.Out1(logger.In2("storage/smbserver/aroz", "share.Streams", "s", s, "p", p), &out0)
	entries, err := s.ReadDir(streamDir(basePath(p)))
	if err != nil {
		logger.DebugErr("storage/smbserver/aroz", err)
		return nil
	}
	out := []smbsrv.FileInfo{}
	for _, e := range entries {
		if e.IsDir {
			continue
		}
		name, ok := decodeStream(e.Name)
		if !ok || name == "" {
			continue
		}
		e.Name = name
		out = append(out, e)
	}
	return out
}

// makeStreamDir creates the folder a new stream goes in.
func (s *share) makeStreamDir(p string) (out0 error) {
	defer logger.Out1(logger.In2("storage/smbserver/aroz", "share.makeStreamDir", "s", s, "p", p), &out0)
	rdir, err := s.real(path.Dir(sharePath(p)))
	if err != nil {
		logger.DebugErr("storage/smbserver/aroz", err)
		return err
	}
	return s.fsh.FileSystemAbstraction.MkdirAll(rdir, 0775)
}

// dropStreams deletes what a deleted file or folder kept beside it.
func (s *share) dropStreams(p string) {
	defer logger.Out0(logger.In2("storage/smbserver/aroz", "share.dropStreams", "s", s, "p", p))
	rdir, err := s.real(streamDir(p))
	if err != nil {
		logger.DebugErr("storage/smbserver/aroz", err)
		return
	}
	fsa := s.fsh.FileSystemAbstraction
	if fsa.FileExists(rdir) {
		fsa.RemoveAll(rdir)
	}
}

// moveStreams takes a renamed file's streams to its new name. Whatever was
// kept for the new name goes first, even when the file brings none: they
// belong to the file the rename replaced, or to one deleted outside SMB.
func (s *share) moveStreams(oldPath, newPath string) {
	defer logger.Out0(logger.In3("storage/smbserver/aroz", "share.moveStreams", "s", s, "oldPath", oldPath, "newPath", newPath))
	from, err := s.real(streamDir(oldPath))
	if err != nil {
		logger.DebugErr("storage/smbserver/aroz", err)
		return
	}
	to, err := s.real(streamDir(newPath))
	if err != nil {
		logger.DebugErr("storage/smbserver/aroz", err)
		return
	}
	fsa := s.fsh.FileSystemAbstraction
	if fsa.FileExists(to) {
		fsa.RemoveAll(to)
	}
	if !fsa.FileExists(from) {
		return
	}
	if parent, err := s.real(path.Dir(streamDir(newPath))); err == nil {
		fsa.MkdirAll(parent, 0775)
	}
	if err := fsa.Rename(from, to); err != nil && !os.IsNotExist(err) {
		//The streams stay behind; the file itself moved
		return
	}
}
