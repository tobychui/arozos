package smbfs

import (
	"io"
	"io/fs"
	"os"

	"github.com/hirochachacha/go-smb2"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

type smbfsFile struct {
	file *smb2.File
}

func NewSmbFsFile(wrappingFile *smb2.File) *smbfsFile {
	return &smbfsFile{
		file: wrappingFile,
	}
}

func (f *smbfsFile) Chdir() error {
	return arozfs.ErrOperationNotSupported
}
func (f *smbfsFile) Chmod(mode os.FileMode) error {
	return arozfs.ErrOperationNotSupported
}
func (f *smbfsFile) Chown(uid, gid int) error {
	return arozfs.ErrOperationNotSupported
}
func (f *smbfsFile) Close() error {
	return f.file.Close()
}
func (f *smbfsFile) Name() string {
	return f.file.Name()
}
func (f *smbfsFile) Read(b []byte) (n int, err error) {
	return f.file.Read(b)
}
func (f *smbfsFile) ReadAt(b []byte, off int64) (n int, err error) {
	return f.file.ReadAt(b, off)
}
func (f *smbfsFile) ReadDir(n int) ([]fs.DirEntry, error) {
	return []fs.DirEntry{}, arozfs.ErrOperationNotSupported
}
func (f *smbfsFile) Readdirnames(n int) (names []string, err error) {
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
func (f *smbfsFile) ReadFrom(r io.Reader) (n int64, err error) {
	return f.file.ReadFrom(r)
}
func (f *smbfsFile) Readdir(n int) ([]fs.FileInfo, error) {
	return f.file.Readdir(n)
}
func (f *smbfsFile) Seek(offset int64, whence int) (ret int64, err error) {
	return f.file.Seek(offset, whence)
}
func (f *smbfsFile) Stat() (fs.FileInfo, error) {
	return f.file.Stat()
}
func (f *smbfsFile) Sync() error {
	return f.file.Sync()
}
func (f *smbfsFile) Truncate(size int64) error {
	return f.file.Truncate(size)
}
func (f *smbfsFile) Write(b []byte) (n int, err error) {
	return f.file.Write(b)
}
func (f *smbfsFile) WriteAt(b []byte, off int64) (n int, err error) {
	return f.file.WriteAt(b, off)
}
func (f *smbfsFile) WriteString(s string) (n int, err error) {
	return f.file.WriteString(s)
}

type smbDirEntry struct {
	finfo fs.FileInfo
}

func newDirEntryFromFileInfo(targetFileInfo fs.FileInfo) *smbDirEntry {
	return &smbDirEntry{
		finfo: targetFileInfo,
	}
}

func (de smbDirEntry) Name() string {
	return de.finfo.Name()
}

func (de smbDirEntry) IsDir() bool {
	return de.finfo.IsDir()
}

func (de smbDirEntry) Type() fs.FileMode {
	return de.finfo.Mode()
}

func (de smbDirEntry) Info() (fs.FileInfo, error) {
	return de.finfo, nil
}
