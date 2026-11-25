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

func newSftpFsFile(wrappingFile *sftp.File, isDir bool, dirEntries []fs.DirEntry) (out0 *sftpFsFile) {
	defer logger.Out1(logger.In3("filesystem/abstractions/sftpfs", "newSftpFsFile", "wrappingFile", wrappingFile, "isDir", isDir, "dirEntries", dirEntries), &out0)
	return &sftpFsFile{
		file:       wrappingFile,
		isDir:      isDir,
		dirEntries: dirEntries,
	}
}

func (f *sftpFsFile) Chdir() (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/sftpfs", "sftpFsFile.Chdir", "f", f), &out0)
	return arozfs.ErrOperationNotSupported
}
func (f *sftpFsFile) Chmod(mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In2("filesystem/abstractions/sftpfs", "sftpFsFile.Chmod", "f", f, "&mode", &mode), &out0)
	return arozfs.ErrOperationNotSupported
}
func (f *sftpFsFile) Chown(uid, gid int) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/sftpfs", "sftpFsFile.Chown", "f", f, "uid", uid, "gid", gid), &out0)
	return arozfs.ErrOperationNotSupported
}
func (f *sftpFsFile) Close() (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/sftpfs", "sftpFsFile.Close", "f", f), &out0)
	return f.file.Close()
}
func (f *sftpFsFile) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/sftpfs", "sftpFsFile.Name", "f", f), &out0)
	return f.file.Name()
}
func (f *sftpFsFile) Read(b []byte) (n int, err error) {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "sftpFsFile.Read")
	return f.file.Read(b)
}
func (f *sftpFsFile) ReadAt(b []byte, off int64) (n int, err error) {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "sftpFsFile.ReadAt")
	return f.file.ReadAt(b, off)
}

func (f *sftpFsFile) Readdirnames(n int) (names []string, err error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/sftpfs", "sftpFsFile.Readdirnames", "f", f, "n", n), &names, &err)
	results := []string{}
	for _, entry := range f.dirEntries {
		results = append(results, entry.Name())
	}
	return results, nil
}

func (f *sftpFsFile) ReadDir(n int) (out0 []fs.DirEntry, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/sftpfs", "sftpFsFile.ReadDir", "f", f, "n", n), &out0, &out1)
	if f.isDir {
		return f.dirEntries, nil
	}
	return []fs.DirEntry{}, nil
}

func (f *sftpFsFile) ReadFrom(r io.Reader) (n int64, err error) {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "sftpFsFile.ReadFrom")
	return f.file.ReadFrom(r)
}
func (f *sftpFsFile) Readdir(n int) (out0 []fs.FileInfo, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/sftpfs", "sftpFsFile.Readdir", "f", f, "n", n), &out0, &out1)
	return []fs.FileInfo{}, nil
}
func (f *sftpFsFile) Seek(offset int64, whence int) (ret int64, err error) {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "sftpFsFile.Seek")
	return f.file.Seek(offset, whence)
}
func (f *sftpFsFile) Stat() (out0 fs.FileInfo, out1 error) {
	defer logger.Out2(logger.In1("filesystem/abstractions/sftpfs", "sftpFsFile.Stat", "f", f), &out0, &out1)
	return f.file.Stat()
}
func (f *sftpFsFile) Sync() (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/sftpfs", "sftpFsFile.Sync", "f", f), &out0)
	return f.file.Sync()
}
func (f *sftpFsFile) Truncate(size int64) (out0 error) {
	defer logger.Out1(logger.In2("filesystem/abstractions/sftpfs", "sftpFsFile.Truncate", "f", f, "size", size), &out0)
	return f.file.Truncate(size)
}
func (f *sftpFsFile) Write(b []byte) (n int, err error) {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "sftpFsFile.Write")
	return f.file.Write(b)
}
func (f *sftpFsFile) WriteAt(b []byte, off int64) (n int, err error) {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "sftpFsFile.WriteAt")
	return f.file.WriteAt(b, off)
}
func (f *sftpFsFile) WriteString(s string) (n int, err error) {
	logger.DebugTrace("filesystem/abstractions/sftpfs", "sftpFsFile.WriteString")
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

func newDirEntryFromFileInfo(targetFileInfo fs.FileInfo) (out0 *SftpDirEntry) {
	defer logger.Out1(logger.In1("filesystem/abstractions/sftpfs", "newDirEntryFromFileInfo", "targetFileInfo", targetFileInfo), &out0)
	return &SftpDirEntry{
		finfo: targetFileInfo,
	}
}

func (de SftpDirEntry) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/sftpfs", "SftpDirEntry.Name", "&de", &de), &out0)
	return de.finfo.Name()
}

func (de SftpDirEntry) IsDir() (out0 bool) {
	defer logger.Out1(logger.In1("filesystem/abstractions/sftpfs", "SftpDirEntry.IsDir", "&de", &de), &out0)
	return de.finfo.IsDir()
}

func (de SftpDirEntry) Type() (out0 fs.FileMode) {
	defer logger.Out1(logger.In1("filesystem/abstractions/sftpfs", "SftpDirEntry.Type", "&de", &de), &out0)
	return de.finfo.Mode()
}

func (de SftpDirEntry) Info() (out0 fs.FileInfo, out1 error) {
	defer logger.Out2(logger.In1("filesystem/abstractions/sftpfs", "SftpDirEntry.Info", "&de", &de), &out0, &out1)
	return de.finfo, nil
}
