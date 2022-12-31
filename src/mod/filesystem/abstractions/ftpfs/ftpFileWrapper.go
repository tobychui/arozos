package ftpfs

import (
	"io/fs"
	"time"

	"github.com/jlaffaye/ftp"
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
	return &DirEntry{
		finfo: targetEntry,
		conn:  conn,
	}
}

func (de DirEntry) Name() string {
	return de.finfo.Name
}

func (de DirEntry) IsDir() bool {
	return de.finfo.Type == ftp.EntryTypeFolder
}

func (de DirEntry) Type() fs.FileMode {
	return 0777
}

func (de DirEntry) Info() (fs.FileInfo, error) {
	e := NewFileInfoFromEntry(de.finfo, de.conn, de.path)
	return e, nil
}

type FileInfo struct {
	entry *ftp.Entry
	conn  *ftp.ServerConn
	path  string
}

func NewFileInfoFromEntry(e *ftp.Entry, c *ftp.ServerConn, originalPath string) FileInfo {
	return FileInfo{
		entry: e,
		conn:  c,
		path:  originalPath,
	}
}

func (fi FileInfo) Name() string {
	return fi.entry.Name
}
func (fi FileInfo) Size() int64 {
	return int64(fi.entry.Size)
}
func (fi FileInfo) Mode() fs.FileMode {
	return 664
}
func (fi FileInfo) ModTime() time.Time {
	return fi.entry.Time
}
func (fi FileInfo) IsDir() bool {
	return fi.entry.Type == ftp.EntryTypeFolder
}
func (fi FileInfo) Sys() interface{} {
	return nil
}
