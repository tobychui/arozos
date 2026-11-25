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

func NewSmbFsFile(wrappingFile *smb2.File) (out0 *smbfsFile) {
	defer logger.Out1(logger.In1("filesystem/abstractions/smbfs", "NewSmbFsFile", "wrappingFile", wrappingFile), &out0)
	return &smbfsFile{
		file: wrappingFile,
	}
}

func (f *smbfsFile) Chdir() (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/smbfs", "smbfsFile.Chdir", "f", f), &out0)
	return arozfs.ErrOperationNotSupported
}
func (f *smbfsFile) Chmod(mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In2("filesystem/abstractions/smbfs", "smbfsFile.Chmod", "f", f, "&mode", &mode), &out0)
	return arozfs.ErrOperationNotSupported
}
func (f *smbfsFile) Chown(uid, gid int) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/smbfs", "smbfsFile.Chown", "f", f, "uid", uid, "gid", gid), &out0)
	return arozfs.ErrOperationNotSupported
}
func (f *smbfsFile) Close() (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/smbfs", "smbfsFile.Close", "f", f), &out0)
	return f.file.Close()
}
func (f *smbfsFile) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/smbfs", "smbfsFile.Name", "f", f), &out0)
	return f.file.Name()
}
func (f *smbfsFile) Read(b []byte) (n int, err error) {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbfsFile.Read")
	return f.file.Read(b)
}
func (f *smbfsFile) ReadAt(b []byte, off int64) (n int, err error) {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbfsFile.ReadAt")
	return f.file.ReadAt(b, off)
}
func (f *smbfsFile) ReadDir(n int) (out0 []fs.DirEntry, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/smbfs", "smbfsFile.ReadDir", "f", f, "n", n), &out0, &out1)
	return []fs.DirEntry{}, arozfs.ErrOperationNotSupported
}
func (f *smbfsFile) Readdirnames(n int) (names []string, err error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/smbfs", "smbfsFile.Readdirnames", "f", f, "n", n), &names, &err)
	fi, err := f.file.Readdir(n)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
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
func (f *smbfsFile) Readdir(n int) (out0 []fs.FileInfo, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/smbfs", "smbfsFile.Readdir", "f", f, "n", n), &out0, &out1)
	return f.file.Readdir(n)
}
func (f *smbfsFile) Seek(offset int64, whence int) (ret int64, err error) {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbfsFile.Seek")
	return f.file.Seek(offset, whence)
}
func (f *smbfsFile) Stat() (out0 fs.FileInfo, out1 error) {
	defer logger.Out2(logger.In1("filesystem/abstractions/smbfs", "smbfsFile.Stat", "f", f), &out0, &out1)
	return f.file.Stat()
}
func (f *smbfsFile) Sync() (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/smbfs", "smbfsFile.Sync", "f", f), &out0)
	return f.file.Sync()
}
func (f *smbfsFile) Truncate(size int64) (out0 error) {
	defer logger.Out1(logger.In2("filesystem/abstractions/smbfs", "smbfsFile.Truncate", "f", f, "size", size), &out0)
	return f.file.Truncate(size)
}
func (f *smbfsFile) Write(b []byte) (n int, err error) {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbfsFile.Write")
	return f.file.Write(b)
}
func (f *smbfsFile) WriteAt(b []byte, off int64) (n int, err error) {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbfsFile.WriteAt")
	return f.file.WriteAt(b, off)
}
func (f *smbfsFile) WriteString(s string) (n int, err error) {
	logger.DebugTrace("filesystem/abstractions/smbfs", "smbfsFile.WriteString")
	return f.file.WriteString(s)
}

type smbDirEntry struct {
	finfo fs.FileInfo
}

func newDirEntryFromFileInfo(targetFileInfo fs.FileInfo) (out0 *smbDirEntry) {
	defer logger.Out1(logger.In1("filesystem/abstractions/smbfs", "newDirEntryFromFileInfo", "targetFileInfo", targetFileInfo), &out0)
	return &smbDirEntry{
		finfo: targetFileInfo,
	}
}

func (de smbDirEntry) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/smbfs", "smbDirEntry.Name", "&de", &de), &out0)
	return de.finfo.Name()
}

func (de smbDirEntry) IsDir() (out0 bool) {
	defer logger.Out1(logger.In1("filesystem/abstractions/smbfs", "smbDirEntry.IsDir", "&de", &de), &out0)
	return de.finfo.IsDir()
}

func (de smbDirEntry) Type() (out0 fs.FileMode) {
	defer logger.Out1(logger.In1("filesystem/abstractions/smbfs", "smbDirEntry.Type", "&de", &de), &out0)
	return de.finfo.Mode()
}

func (de smbDirEntry) Info() (out0 fs.FileInfo, out1 error) {
	defer logger.Out2(logger.In1("filesystem/abstractions/smbfs", "smbDirEntry.Info", "&de", &de), &out0, &out1)
	return de.finfo, nil
}
