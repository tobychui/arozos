package smbfs

import (
	"io"
	"io/fs"
	"os"

	"github.com/hirochachacha/go-smb2"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
)

type smbfsFile struct {
	file *smb2.File
}

func NewSmbFsFile(wrappingFile *smb2.File) *smbfsFile {
	logger.DebugTrace("filesystem/abstractions/smbfs", "NewSmbFsFile")
	return &smbfsFile{
		file: wrappingFile,
	}
}

func (f *smbfsFile) Chdir() error {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbfsFile.Chdir")
	return arozfs.ErrOperationNotSupported
}
func (f *smbfsFile) Chmod(mode os.FileMode) error {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbfsFile.Chmod")
	return arozfs.ErrOperationNotSupported
}
func (f *smbfsFile) Chown(uid, gid int) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/smbfs", "smbfsFile.Chown: uid=%d gid=%d", uid, gid)
	}
	return arozfs.ErrOperationNotSupported
}
func (f *smbfsFile) Close() error {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbfsFile.Close")
	return f.file.Close()
}
func (f *smbfsFile) Name() string {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbfsFile.Name")
	return f.file.Name()
}
func (f *smbfsFile) Read(b []byte) (n int, err error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/smbfs", "smbfsFile.Read: len(b)=%d", len(b))
	}
	return f.file.Read(b)
}
func (f *smbfsFile) ReadAt(b []byte, off int64) (n int, err error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/smbfs", "smbfsFile.ReadAt: len(b)=%d off=%d", len(b), off)
	}
	return f.file.ReadAt(b, off)
}
func (f *smbfsFile) ReadDir(n int) ([]fs.DirEntry, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/smbfs", "smbfsFile.ReadDir: n=%d", n)
	}
	return []fs.DirEntry{}, arozfs.ErrOperationNotSupported
}
func (f *smbfsFile) Readdirnames(n int) (names []string, err error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/smbfs", "smbfsFile.Readdirnames: n=%d", n)
	}
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
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbfsFile.ReadFrom")
	return f.file.ReadFrom(r)
}
func (f *smbfsFile) Readdir(n int) ([]fs.FileInfo, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/smbfs", "smbfsFile.Readdir: n=%d", n)
	}
	return f.file.Readdir(n)
}
func (f *smbfsFile) Seek(offset int64, whence int) (ret int64, err error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/smbfs", "smbfsFile.Seek: offset=%d whence=%d", offset, whence)
	}
	return f.file.Seek(offset, whence)
}
func (f *smbfsFile) Stat() (fs.FileInfo, error) {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbfsFile.Stat")
	return f.file.Stat()
}
func (f *smbfsFile) Sync() error {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbfsFile.Sync")
	return f.file.Sync()
}
func (f *smbfsFile) Truncate(size int64) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/smbfs", "smbfsFile.Truncate: size=%d", size)
	}
	return f.file.Truncate(size)
}
func (f *smbfsFile) Write(b []byte) (n int, err error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/smbfs", "smbfsFile.Write: len(b)=%d", len(b))
	}
	return f.file.Write(b)
}
func (f *smbfsFile) WriteAt(b []byte, off int64) (n int, err error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/smbfs", "smbfsFile.WriteAt: len(b)=%d off=%d", len(b), off)
	}
	return f.file.WriteAt(b, off)
}
func (f *smbfsFile) WriteString(s string) (n int, err error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/smbfs", "smbfsFile.WriteString: s=%.120q", s)
	}
	return f.file.WriteString(s)
}

type smbDirEntry struct {
	finfo fs.FileInfo
}

func newDirEntryFromFileInfo(targetFileInfo fs.FileInfo) *smbDirEntry {
	logger.DebugTrace("filesystem/abstractions/smbfs", "newDirEntryFromFileInfo")
	return &smbDirEntry{
		finfo: targetFileInfo,
	}
}

func (de smbDirEntry) Name() string {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbDirEntry.Name")
	return de.finfo.Name()
}

func (de smbDirEntry) IsDir() bool {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbDirEntry.IsDir")
	return de.finfo.IsDir()
}

func (de smbDirEntry) Type() fs.FileMode {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbDirEntry.Type")
	return de.finfo.Mode()
}

func (de smbDirEntry) Info() (fs.FileInfo, error) {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbDirEntry.Info")
	return de.finfo, nil
}
