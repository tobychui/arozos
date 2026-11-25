package billyconv

/*
	Billy Filesystem Converter

	This module converts an arozfs file system into a Billy Filesystem
	used by many other projects for providing a vfs interface
*/
import (
	"errors"
	"io/fs"
	"os"
	"path/filepath"

	"github.com/go-git/go-billy/v5"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
)

//This script adapts the required billy.FileSystem to arozos abstraction

type ArozFsToBillyFileSytemAdapter struct {
	fsh *filesystem.FileSystemHandler
}

func NewArozFsToBillyFsAdapter(targetFsh *filesystem.FileSystemHandler) (out0 billy.Filesystem) {
	defer logger.Out1(logger.In1("storage/billyconv", "NewArozFsToBillyFsAdapter", "targetFsh", targetFsh), &out0)
	return &ArozFsToBillyFileSytemAdapter{
		fsh: targetFsh,
	}
}

func (adp *ArozFsToBillyFileSytemAdapter) Create(filename string) (out0 billy.File, out1 error) {
	defer logger.Out2(logger.In2("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Create", "adp", adp, "filename", filename), &out0, &out1)
	filename = adp.CleanAndFilterFilename(filename)
	file, err := adp.fsh.FileSystemAbstraction.Create(filename)
	if err != nil {
		logger.DebugErr("storage/billyconv", err)
		return nil, err
	}
	return ArozfsFileToBillyFile(file), nil
}

func (adp *ArozFsToBillyFileSytemAdapter) Open(filename string) (out0 billy.File, out1 error) {
	defer logger.Out2(logger.In2("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Open", "adp", adp, "filename", filename), &out0, &out1)
	filename = adp.CleanAndFilterFilename(filename)
	file, err := adp.fsh.FileSystemAbstraction.Open(filename)
	if err != nil {
		logger.DebugErr("storage/billyconv", err)
		return nil, err
	}
	return ArozfsFileToBillyFile(file), nil
}

func (adp *ArozFsToBillyFileSytemAdapter) OpenFile(filename string, flag int, perm os.FileMode) (out0 billy.File, out1 error) {
	defer logger.Out2(logger.In4("storage/billyconv", "ArozFsToBillyFileSytemAdapter.OpenFile", "adp", adp, "filename", filename, "flag", flag, "&perm", &perm), &out0, &out1)
	filename = adp.CleanAndFilterFilename(filename)
	file, err := adp.fsh.FileSystemAbstraction.OpenFile(filename, flag, perm)
	if err != nil {
		logger.DebugErr("storage/billyconv", err)
		return nil, err
	}
	return ArozfsFileToBillyFile(file), nil
}

func (adp *ArozFsToBillyFileSytemAdapter) Stat(filename string) (out0 os.FileInfo, out1 error) {
	defer logger.Out2(logger.In2("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Stat", "adp", adp, "filename", filename), &out0, &out1)
	filename = adp.CleanAndFilterFilename(filename)
	fileInfo, err := adp.fsh.FileSystemAbstraction.Stat(filename)
	if err != nil {
		logger.DebugErr("storage/billyconv", err)
		return nil, err
	}
	return ConvertToOsFileInfo(fileInfo), err
}

func (adp *ArozFsToBillyFileSytemAdapter) Rename(oldpath, newpath string) (out0 error) {
	defer logger.Out1(logger.In3("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Rename", "adp", adp, "oldpath", oldpath, "newpath", newpath), &out0)
	oldpath = adp.CleanAndFilterFilename(oldpath)
	newpath = adp.CleanAndFilterFilename(newpath)
	return adp.Rename(oldpath, newpath)
}

func (adp *ArozFsToBillyFileSytemAdapter) Remove(filename string) (out0 error) {
	defer logger.Out1(logger.In2("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Remove", "adp", adp, "filename", filename), &out0)
	filename = adp.CleanAndFilterFilename(filename)
	return adp.fsh.FileSystemAbstraction.Remove(filename)
}

func (adp *ArozFsToBillyFileSytemAdapter) Join(elem ...string) (out0 string) {
	defer logger.Out1(logger.In2("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Join", "adp", adp, "elem", elem), &out0)
	return filepath.Join(elem...)
}

func (adp *ArozFsToBillyFileSytemAdapter) TempFile(dir, prefix string) (out0 billy.File, out1 error) {
	defer logger.Out2(logger.In3("storage/billyconv", "ArozFsToBillyFileSytemAdapter.TempFile", "adp", adp, "dir", dir, "prefix", prefix), &out0, &out1)
	return nil, errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) ReadDir(path string) (out0 []os.FileInfo, out1 error) {
	defer logger.Out2(logger.In2("storage/billyconv", "ArozFsToBillyFileSytemAdapter.ReadDir", "adp", adp, "path", path), &out0, &out1)
	path = adp.CleanAndFilterFilename(path)
	dirEntry, err := adp.fsh.FileSystemAbstraction.ReadDir(path)
	if err != nil {
		logger.DebugErr("storage/billyconv", err)
		return []os.FileInfo{}, err
	}

	fileInfo, err := ConvertDirEntriesToFileInfos(dirEntry)
	if err != nil {
		logger.DebugErr("storage/billyconv", err)
		return []os.FileInfo{}, err
	}

	return fileInfo, nil
}

func (adp *ArozFsToBillyFileSytemAdapter) MkdirAll(filename string, perm os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("storage/billyconv", "ArozFsToBillyFileSytemAdapter.MkdirAll", "adp", adp, "filename", filename, "&perm", &perm), &out0)
	filename = adp.CleanAndFilterFilename(filename)
	return adp.fsh.FileSystemAbstraction.MkdirAll(filename, perm)
}

func (adp *ArozFsToBillyFileSytemAdapter) Lstat(filename string) (out0 os.FileInfo, out1 error) {
	defer logger.Out2(logger.In2("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Lstat", "adp", adp, "filename", filename), &out0, &out1)
	return nil, errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) Symlink(target, link string) (out0 error) {
	defer logger.Out1(logger.In3("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Symlink", "adp", adp, "target", target, "link", link), &out0)
	return errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) Readlink(link string) (out0 string, out1 error) {
	defer logger.Out2(logger.In2("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Readlink", "adp", adp, "link", link), &out0, &out1)
	return "", errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) Chroot(path string) (out0 billy.Filesystem, out1 error) {
	defer logger.Out2(logger.In2("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Chroot", "adp", adp, "path", path), &out0, &out1)
	return nil, errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) Root() (out0 string) {
	defer logger.Out1(logger.In1("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Root", "adp", adp), &out0)
	return "/"
}

/* Utilities */
func (adp *ArozFsToBillyFileSytemAdapter) CleanAndFilterFilename(filename string) (out0 string) {
	defer logger.Out1(logger.In2("storage/billyconv", "ArozFsToBillyFileSytemAdapter.CleanAndFilterFilename", "adp", adp, "filename", filename), &out0)
	return filename
}

/*
arozfs.File to Billy.File converter
*/
type ArozFSFileAdapter struct {
	file arozfs.File
}

func ArozfsFileToBillyFile(file arozfs.File) (out0 billy.File) {
	defer logger.Out1(logger.In1("storage/billyconv", "ArozfsFileToBillyFile", "file", file), &out0)
	return &ArozFSFileAdapter{
		file: file,
	}
}

func (afa *ArozFSFileAdapter) Name() (out0 string) {
	defer logger.Out1(logger.In1("storage/billyconv", "ArozFSFileAdapter.Name", "afa", afa), &out0)
	return afa.file.Name()
}

func (afa *ArozFSFileAdapter) Read(b []byte) (int, error) {
	logger.DebugTrace("storage/billyconv", "ArozFSFileAdapter.Read")
	return afa.file.Read(b)
}

func (afa *ArozFSFileAdapter) ReadAt(b []byte, off int64) (int, error) {
	logger.DebugTrace("storage/billyconv", "ArozFSFileAdapter.ReadAt")
	return afa.file.ReadAt(b, off)
}

func (afa *ArozFSFileAdapter) Seek(offset int64, whence int) (int64, error) {
	logger.DebugTrace("storage/billyconv", "ArozFSFileAdapter.Seek")
	return afa.file.Seek(offset, whence)
}

func (afa *ArozFSFileAdapter) Write(b []byte) (int, error) {
	logger.DebugTrace("storage/billyconv", "ArozFSFileAdapter.Write")
	return afa.file.Write(b)
}

func (afa *ArozFSFileAdapter) Lock() error {
	logger.DebugTrace("storage/billyconv", "ArozFSFileAdapter.Lock")
	return nil
}

func (afa *ArozFSFileAdapter) Unlock() error {
	logger.DebugTrace("storage/billyconv", "ArozFSFileAdapter.Unlock")
	return nil
}

func (afa *ArozFSFileAdapter) Truncate(size int64) (out0 error) {
	defer logger.Out1(logger.In2("storage/billyconv", "ArozFSFileAdapter.Truncate", "afa", afa, "size", size), &out0)
	return errors.New("operation not supported")
}

func (afa *ArozFSFileAdapter) Close() (out0 error) {
	defer logger.Out1(logger.In1("storage/billyconv", "ArozFSFileAdapter.Close", "afa", afa), &out0)
	return afa.file.Close()
}

/*

 */

// Define a type that wraps an fs.FileInfo and implements os.FileInfo
type fileInfoWrapper struct {
	fs.FileInfo
}

// Implement the Sys method to satisfy os.FileInfo
func (f fileInfoWrapper) Sys() (out0 interface{}) {
	defer logger.Out1(logger.In1("storage/billyconv", "fileInfoWrapper.Sys", "&f", &f), &out0)
	return nil
}

// Convert fs.FileInfo to os.FileInfo
func ConvertToOsFileInfo(fi fs.FileInfo) (out0 os.FileInfo) {
	defer logger.Out1(logger.In1("storage/billyconv", "ConvertToOsFileInfo", "fi", fi), &out0)
	return fileInfoWrapper{fi}
}

// Convert []fs.DirEntry to []os.FileInfo
func ConvertDirEntriesToFileInfos(entries []fs.DirEntry) (out0 []os.FileInfo, out1 error) {
	defer logger.Out2(logger.In1("storage/billyconv", "ConvertDirEntriesToFileInfos", "entries", entries), &out0, &out1)
	var fileInfos []os.FileInfo
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			logger.DebugErr("storage/billyconv", err)
			return nil, err
		}
		fileInfos = append(fileInfos, ConvertToOsFileInfo(info))
	}
	return fileInfos, nil
}
