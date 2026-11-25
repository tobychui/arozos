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

func newDirEntryFromFTPEntry(targetEntry *ftp.Entry, conn *ftp.ServerConn, originalPath string) (out0 *DirEntry) {
	defer logger.Out1(logger.In3("filesystem/abstractions/ftpfs", "newDirEntryFromFTPEntry", "targetEntry", targetEntry, "conn", conn, "originalPath", originalPath), &out0)
	return &DirEntry{
		finfo: targetEntry,
		conn:  conn,
	}
}

func (de DirEntry) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/ftpfs", "DirEntry.Name", "&de", &de), &out0)
	return de.finfo.Name
}

func (de DirEntry) IsDir() (out0 bool) {
	defer logger.Out1(logger.In1("filesystem/abstractions/ftpfs", "DirEntry.IsDir", "&de", &de), &out0)
	return de.finfo.Type == ftp.EntryTypeFolder
}

func (de DirEntry) Type() (out0 fs.FileMode) {
	defer logger.Out1(logger.In1("filesystem/abstractions/ftpfs", "DirEntry.Type", "&de", &de), &out0)
	return 0777
}

func (de DirEntry) Info() (out0 fs.FileInfo, out1 error) {
	defer logger.Out2(logger.In1("filesystem/abstractions/ftpfs", "DirEntry.Info", "&de", &de), &out0, &out1)
	e := NewFileInfoFromEntry(de.finfo, de.conn, de.path)
	return e, nil
}

type FileInfo struct {
	entry *ftp.Entry
	conn  *ftp.ServerConn
	path  string
}

func NewFileInfoFromEntry(e *ftp.Entry, c *ftp.ServerConn, originalPath string) (out0 FileInfo) {
	defer logger.Out1(logger.In3("filesystem/abstractions/ftpfs", "NewFileInfoFromEntry", "e", e, "c", c, "originalPath", originalPath), &out0)
	return FileInfo{
		entry: e,
		conn:  c,
		path:  originalPath,
	}
}

func (fi FileInfo) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/ftpfs", "FileInfo.Name", "&fi", &fi), &out0)
	return fi.entry.Name
}
func (fi FileInfo) Size() (out0 int64) {
	defer logger.Out1(logger.In1("filesystem/abstractions/ftpfs", "FileInfo.Size", "&fi", &fi), &out0)
	return int64(fi.entry.Size)
}
func (fi FileInfo) Mode() (out0 fs.FileMode) {
	defer logger.Out1(logger.In1("filesystem/abstractions/ftpfs", "FileInfo.Mode", "&fi", &fi), &out0)
	return 664
}
func (fi FileInfo) ModTime() (out0 time.Time) {
	defer logger.Out1(logger.In1("filesystem/abstractions/ftpfs", "FileInfo.ModTime", "&fi", &fi), &out0)
	return fi.entry.Time
}
func (fi FileInfo) IsDir() (out0 bool) {
	defer logger.Out1(logger.In1("filesystem/abstractions/ftpfs", "FileInfo.IsDir", "&fi", &fi), &out0)
	return fi.entry.Type == ftp.EntryTypeFolder
}
func (fi FileInfo) Sys() (out0 interface{}) {
	defer logger.Out1(logger.In1("filesystem/abstractions/ftpfs", "FileInfo.Sys", "&fi", &fi), &out0)
	return nil
}
