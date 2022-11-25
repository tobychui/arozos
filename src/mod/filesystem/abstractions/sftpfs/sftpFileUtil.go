package sftpfs

import (
	"io"
	"io/fs"
	"os"

	"github.com/pkg/sftp"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

/*
	SFTP File

	Converting the *sftp.File into arozos.File compatible types
*/

type sftpFsFile struct {
	file       *sftp.File
	isDir      bool
	dirEntries []fs.DirEntry
}

func newSftpFsFile(wrappingFile *sftp.File, isDir bool, dirEntries []fs.DirEntry) *sftpFsFile {
	return &sftpFsFile{
		file:       wrappingFile,
		isDir:      isDir,
		dirEntries: dirEntries,
	}
}

func (f *sftpFsFile) Chdir() error {
	return arozfs.ErrOperationNotSupported
}
func (f *sftpFsFile) Chmod(mode os.FileMode) error {
	return arozfs.ErrOperationNotSupported
}
func (f *sftpFsFile) Chown(uid, gid int) error {
	return arozfs.ErrOperationNotSupported
}
func (f *sftpFsFile) Close() error {
	return f.file.Close()
}
func (f *sftpFsFile) Name() string {
	return f.file.Name()
}
func (f *sftpFsFile) Read(b []byte) (n int, err error) {
	return f.file.Read(b)
}
func (f *sftpFsFile) ReadAt(b []byte, off int64) (n int, err error) {
	return f.file.ReadAt(b, off)
}

func (f *sftpFsFile) Readdirnames(n int) (names []string, err error) {
	results := []string{}
	for _, entry := range f.dirEntries {
		results = append(results, entry.Name())
	}
	return results, nil
}

func (f *sftpFsFile) ReadDir(n int) ([]fs.DirEntry, error) {
	if f.isDir {
		return f.dirEntries, nil
	}
	return []fs.DirEntry{}, nil
}

func (f *sftpFsFile) ReadFrom(r io.Reader) (n int64, err error) {
	return f.file.ReadFrom(r)
}
func (f *sftpFsFile) Readdir(n int) ([]fs.FileInfo, error) {
	return []fs.FileInfo{}, nil
}
func (f *sftpFsFile) Seek(offset int64, whence int) (ret int64, err error) {
	return f.file.Seek(offset, whence)
}
func (f *sftpFsFile) Stat() (fs.FileInfo, error) {
	return f.file.Stat()
}
func (f *sftpFsFile) Sync() error {
	return f.file.Sync()
}
func (f *sftpFsFile) Truncate(size int64) error {
	return f.file.Truncate(size)
}
func (f *sftpFsFile) Write(b []byte) (n int, err error) {
	return f.file.Write(b)
}
func (f *sftpFsFile) WriteAt(b []byte, off int64) (n int, err error) {
	return f.file.WriteAt(b, off)
}
func (f *sftpFsFile) WriteString(s string) (n int, err error) {
	return f.file.Write([]byte(s))
}

/*
	SFTP DirEntry

	Converting the legacy os.FileInfo into arozos required
	fs.DirEntry for sftp client readDir returned values
*/
type SftpDirEntry struct {
	finfo fs.FileInfo
}

func newDirEntryFromFileInfo(targetFileInfo fs.FileInfo) *SftpDirEntry {
	return &SftpDirEntry{
		finfo: targetFileInfo,
	}
}

func (de SftpDirEntry) Name() string {
	return de.finfo.Name()
}

func (de SftpDirEntry) IsDir() bool {
	return de.finfo.IsDir()
}

func (de SftpDirEntry) Type() fs.FileMode {
	return de.finfo.Mode()
}

func (de SftpDirEntry) Info() (fs.FileInfo, error) {
	return de.finfo, nil
}
