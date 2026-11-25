package ftpfs

import (
	"io/fs"
	"time"

	"github.com/jlaffaye/ftp"

	"imuslab.com/arozos/mod/info/logger"
)

type File struct {
	entry ftp.Entry
}

type DirEntry struct {
	finfo *ftp.Entry
	conn  *ftp.ServerConn
	path  string
}

func newDirEntryFromFTPEntry(targetEntry *ftp.Entry, conn *ftp.ServerConn, originalPath string) *DirEntry {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/ftpfs", "newDirEntryFromFTPEntry: originalPath=%.120q", originalPath)
	}
	return &DirEntry{
		finfo: targetEntry,
		conn:  conn,
	}
}

func (de DirEntry) Name() string {
	logger.DebugTrace("filesystem/abstractions/ftpfs", "DirEntry.Name")
	return de.finfo.Name
}

func (de DirEntry) IsDir() bool {
	logger.DebugTrace("filesystem/abstractions/ftpfs", "DirEntry.IsDir")
	return de.finfo.Type == ftp.EntryTypeFolder
}

func (de DirEntry) Type() fs.FileMode {
	logger.DebugTrace("filesystem/abstractions/ftpfs", "DirEntry.Type")
	return 0777
}

func (de DirEntry) Info() (fs.FileInfo, error) {
	logger.DebugTrace("filesystem/abstractions/ftpfs", "DirEntry.Info")
	e := NewFileInfoFromEntry(de.finfo, de.conn, de.path)
	return e, nil
}

type FileInfo struct {
	entry *ftp.Entry
	conn  *ftp.ServerConn
	path  string
}

func NewFileInfoFromEntry(e *ftp.Entry, c *ftp.ServerConn, originalPath string) FileInfo {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/ftpfs", "NewFileInfoFromEntry: originalPath=%.120q", originalPath)
	}
	return FileInfo{
		entry: e,
		conn:  c,
		path:  originalPath,
	}
}

func (fi FileInfo) Name() string {
	logger.DebugTrace("filesystem/abstractions/ftpfs", "FileInfo.Name")
	return fi.entry.Name
}
func (fi FileInfo) Size() int64 {
	logger.DebugTrace("filesystem/abstractions/ftpfs", "FileInfo.Size")
	return int64(fi.entry.Size)
}
func (fi FileInfo) Mode() fs.FileMode {
	logger.DebugTrace("filesystem/abstractions/ftpfs", "FileInfo.Mode")
	return 664
}
func (fi FileInfo) ModTime() time.Time {
	logger.DebugTrace("filesystem/abstractions/ftpfs", "FileInfo.ModTime")
	return fi.entry.Time
}
func (fi FileInfo) IsDir() bool {
	logger.DebugTrace("filesystem/abstractions/ftpfs", "FileInfo.IsDir")
	return fi.entry.Type == ftp.EntryTypeFolder
}
func (fi FileInfo) Sys() interface{} {
	logger.DebugTrace("filesystem/abstractions/ftpfs", "FileInfo.Sys")
	return nil
}
