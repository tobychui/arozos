package ftpfs

import (
	"io/fs"
	"time"

	"github.com/jlaffaye/ftp"
)

type File struct {
	entry ftp.Entry
}

/*
func NewFTPFsFile(wrappingFile *smb2.File) *File {
	return &smbfsFile{
		file: wrappingFile,
	}
}

func (f *File) Chdir() error {
	return arozfs.ErrOperationNotSupported
}
func (f *File) Chmod(mode os.FileMode) error {
	return arozfs.ErrOperationNotSupported
}
func (f *File) Chown(uid, gid int) error {
	return arozfs.ErrOperationNotSupported
}
func (f *File) Close() error {
	return f.file.Close()
}
func (f *File) Name() string {
	return f.file.Name()
}
func (f *File) Read(b []byte) (n int, err error) {
	return f.file.Read(b)
}
func (f *File) ReadAt(b []byte, off int64) (n int, err error) {
	return f.file.ReadAt(b, off)
}
func (f *File) ReadDir(n int) ([]fs.DirEntry, error) {
	return []fs.DirEntry{}, arozfs.ErrOperationNotSupported
}
func (f *File) Readdirnames(n int) (names []string, err error) {
	fi, err := f.file.Readdir(n)
	if err != nil {
		return []string{}, err
	}
	names = []string{}
	for _, i := range fi {
		names = append(names, i.Name())
	}
	return names, nil
}
func (f *File) ReadFrom(r io.Reader) (n int64, err error) {
	return f.file.ReadFrom(r)
}
func (f *File) Readdir(n int) ([]fs.FileInfo, error) {
	return f.file.Readdir(n)
}
func (f *File) Seek(offset int64, whence int) (ret int64, err error) {
	return f.file.Seek(offset, whence)
}
func (f *File) Stat() (fs.FileInfo, error) {
	return f.file.Stat()
}
func (f *File) Sync() error {
	return f.file.Sync()
}
func (f *File) Truncate(size int64) error {
	return f.file.Truncate(size)
}
func (f *File) Write(b []byte) (n int, err error) {
	return f.file.Write(b)
}
func (f *File) WriteAt(b []byte, off int64) (n int, err error) {
	return f.file.WriteAt(b, off)
}
func (f *File) WriteString(s string) (n int, err error) {
	return f.file.WriteString(s)
}
*/

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
