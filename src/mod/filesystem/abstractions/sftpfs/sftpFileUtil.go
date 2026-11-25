package sftpfs

import (
	"io"
	"io/fs"
	"os"

	"github.com/pkg/sftp"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
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
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/sftpfs", "newSftpFsFile: isDir=%t len(dirEntries)=%d", isDir, len(dirEntries))
	}
	return &sftpFsFile{
		file:       wrappingFile,
		isDir:      isDir,
		dirEntries: dirEntries,
	}
}

func (f *sftpFsFile) Chdir() error {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "sftpFsFile.Chdir")
	return arozfs.ErrOperationNotSupported
}
func (f *sftpFsFile) Chmod(mode os.FileMode) error {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "sftpFsFile.Chmod")
	return arozfs.ErrOperationNotSupported
}
func (f *sftpFsFile) Chown(uid, gid int) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/sftpfs", "sftpFsFile.Chown: uid=%d gid=%d", uid, gid)
	}
	return arozfs.ErrOperationNotSupported
}
func (f *sftpFsFile) Close() error {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "sftpFsFile.Close")
	return f.file.Close()
}
func (f *sftpFsFile) Name() string {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "sftpFsFile.Name")
	return f.file.Name()
}
func (f *sftpFsFile) Read(b []byte) (n int, err error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/sftpfs", "sftpFsFile.Read: len(b)=%d", len(b))
	}
	return f.file.Read(b)
}
func (f *sftpFsFile) ReadAt(b []byte, off int64) (n int, err error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/sftpfs", "sftpFsFile.ReadAt: len(b)=%d off=%d", len(b), off)
	}
	return f.file.ReadAt(b, off)
}

func (f *sftpFsFile) Readdirnames(n int) (names []string, err error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/sftpfs", "sftpFsFile.Readdirnames: n=%d", n)
	}
	results := []string{}
	for _, entry := range f.dirEntries {
		results = append(results, entry.Name())
	}
	return results, nil
}

func (f *sftpFsFile) ReadDir(n int) ([]fs.DirEntry, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/sftpfs", "sftpFsFile.ReadDir: n=%d", n)
	}
	if f.isDir {
		return f.dirEntries, nil
	}
	return []fs.DirEntry{}, nil
}

func (f *sftpFsFile) ReadFrom(r io.Reader) (n int64, err error) {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "sftpFsFile.ReadFrom")
	return f.file.ReadFrom(r)
}
func (f *sftpFsFile) Readdir(n int) ([]fs.FileInfo, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/sftpfs", "sftpFsFile.Readdir: n=%d", n)
	}
	return []fs.FileInfo{}, nil
}
func (f *sftpFsFile) Seek(offset int64, whence int) (ret int64, err error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/sftpfs", "sftpFsFile.Seek: offset=%d whence=%d", offset, whence)
	}
	return f.file.Seek(offset, whence)
}
func (f *sftpFsFile) Stat() (fs.FileInfo, error) {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "sftpFsFile.Stat")
	return f.file.Stat()
}
func (f *sftpFsFile) Sync() error {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "sftpFsFile.Sync")
	return f.file.Sync()
}
func (f *sftpFsFile) Truncate(size int64) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/sftpfs", "sftpFsFile.Truncate: size=%d", size)
	}
	return f.file.Truncate(size)
}
func (f *sftpFsFile) Write(b []byte) (n int, err error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/sftpfs", "sftpFsFile.Write: len(b)=%d", len(b))
	}
	return f.file.Write(b)
}
func (f *sftpFsFile) WriteAt(b []byte, off int64) (n int, err error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/sftpfs", "sftpFsFile.WriteAt: len(b)=%d off=%d", len(b), off)
	}
	return f.file.WriteAt(b, off)
}
func (f *sftpFsFile) WriteString(s string) (n int, err error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/sftpfs", "sftpFsFile.WriteString: s=%.120q", s)
	}
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
	logger.DebugTrace("filesystem/abstractions/sftpfs", "newDirEntryFromFileInfo")
	return &SftpDirEntry{
		finfo: targetFileInfo,
	}
}

func (de SftpDirEntry) Name() string {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "SftpDirEntry.Name")
	return de.finfo.Name()
}

func (de SftpDirEntry) IsDir() bool {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "SftpDirEntry.IsDir")
	return de.finfo.IsDir()
}

func (de SftpDirEntry) Type() fs.FileMode {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "SftpDirEntry.Type")
	return de.finfo.Mode()
}

func (de SftpDirEntry) Info() (fs.FileInfo, error) {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "SftpDirEntry.Info")
	return de.finfo, nil
}
