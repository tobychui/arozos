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

func NewArozFsToBillyFsAdapter(targetFsh *filesystem.FileSystemHandler) billy.Filesystem {
	logger.DebugTrace("storage/billyconv", "NewArozFsToBillyFsAdapter")
	return &ArozFsToBillyFileSytemAdapter{
		fsh: targetFsh,
	}
}

func (adp *ArozFsToBillyFileSytemAdapter) Create(filename string) (billy.File, error) {
	if logger.IsDebug() {
		logger.Debugf("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Create: filename=%.120q", filename)
	}
	filename = adp.CleanAndFilterFilename(filename)
	file, err := adp.fsh.FileSystemAbstraction.Create(filename)
	if err != nil {
		return nil, err
	}
	return ArozfsFileToBillyFile(file), nil
}

func (adp *ArozFsToBillyFileSytemAdapter) Open(filename string) (billy.File, error) {
	if logger.IsDebug() {
		logger.Debugf("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Open: filename=%.120q", filename)
	}
	filename = adp.CleanAndFilterFilename(filename)
	file, err := adp.fsh.FileSystemAbstraction.Open(filename)
	if err != nil {
		return nil, err
	}
	return ArozfsFileToBillyFile(file), nil
}

func (adp *ArozFsToBillyFileSytemAdapter) OpenFile(filename string, flag int, perm os.FileMode) (billy.File, error) {
	if logger.IsDebug() {
		logger.Debugf("storage/billyconv", "ArozFsToBillyFileSytemAdapter.OpenFile: filename=%.120q flag=%d", filename, flag)
	}
	filename = adp.CleanAndFilterFilename(filename)
	file, err := adp.fsh.FileSystemAbstraction.OpenFile(filename, flag, perm)
	if err != nil {
		return nil, err
	}
	return ArozfsFileToBillyFile(file), nil
}

func (adp *ArozFsToBillyFileSytemAdapter) Stat(filename string) (os.FileInfo, error) {
	if logger.IsDebug() {
		logger.Debugf("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Stat: filename=%.120q", filename)
	}
	filename = adp.CleanAndFilterFilename(filename)
	fileInfo, err := adp.fsh.FileSystemAbstraction.Stat(filename)
	if err != nil {
		return nil, err
	}
	return ConvertToOsFileInfo(fileInfo), err
}

func (adp *ArozFsToBillyFileSytemAdapter) Rename(oldpath, newpath string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Rename: oldpath=%.120q newpath=%.120q", oldpath, newpath)
	}
	oldpath = adp.CleanAndFilterFilename(oldpath)
	newpath = adp.CleanAndFilterFilename(newpath)
	return adp.Rename(oldpath, newpath)
}

func (adp *ArozFsToBillyFileSytemAdapter) Remove(filename string) error {
	if logger.IsDebug() {
		logger.Debugf("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Remove: filename=%.120q", filename)
	}
	filename = adp.CleanAndFilterFilename(filename)
	return adp.fsh.FileSystemAbstraction.Remove(filename)
}

func (adp *ArozFsToBillyFileSytemAdapter) Join(elem ...string) string {
	if logger.IsDebugTrace() {
		logger.DebugTracef("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Join: len(elem)=%d", len(elem))
	}
	return filepath.Join(elem...)
}

func (adp *ArozFsToBillyFileSytemAdapter) TempFile(dir, prefix string) (billy.File, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("storage/billyconv", "ArozFsToBillyFileSytemAdapter.TempFile: dir=%.120q prefix=%.120q", dir, prefix)
	}
	return nil, errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) ReadDir(path string) ([]os.FileInfo, error) {
	if logger.IsDebug() {
		logger.Debugf("storage/billyconv", "ArozFsToBillyFileSytemAdapter.ReadDir: path=%.120q", path)
	}
	path = adp.CleanAndFilterFilename(path)
	dirEntry, err := adp.fsh.FileSystemAbstraction.ReadDir(path)
	if err != nil {
		return []os.FileInfo{}, err
	}

	fileInfo, err := ConvertDirEntriesToFileInfos(dirEntry)
	if err != nil {
		return []os.FileInfo{}, err
	}

	return fileInfo, nil
}

func (adp *ArozFsToBillyFileSytemAdapter) MkdirAll(filename string, perm os.FileMode) error {
	if logger.IsDebug() {
		logger.Debugf("storage/billyconv", "ArozFsToBillyFileSytemAdapter.MkdirAll: filename=%.120q", filename)
	}
	filename = adp.CleanAndFilterFilename(filename)
	return adp.fsh.FileSystemAbstraction.MkdirAll(filename, perm)
}

func (adp *ArozFsToBillyFileSytemAdapter) Lstat(filename string) (os.FileInfo, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Lstat: filename=%.120q", filename)
	}
	return nil, errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) Symlink(target, link string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Symlink: target=%.120q link=%.120q", target, link)
	}
	return errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) Readlink(link string) (string, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Readlink: link=%.120q", link)
	}
	return "", errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) Chroot(path string) (billy.Filesystem, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Chroot: path=%.120q", path)
	}
	return nil, errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) Root() string {
	logger.DebugTrace("storage/billyconv", "ArozFsToBillyFileSytemAdapter.Root")
	return "/"
}

/* Utilities */
func (adp *ArozFsToBillyFileSytemAdapter) CleanAndFilterFilename(filename string) string {
	if logger.IsDebugTrace() {
		logger.DebugTracef("storage/billyconv", "ArozFsToBillyFileSytemAdapter.CleanAndFilterFilename: filename=%.120q", filename)
	}
	return filename
}

/*
arozfs.File to Billy.File converter
*/
type ArozFSFileAdapter struct {
	file arozfs.File
}

func ArozfsFileToBillyFile(file arozfs.File) billy.File {
	logger.DebugTrace("storage/billyconv", "ArozfsFileToBillyFile")
	return &ArozFSFileAdapter{
		file: file,
	}
}

func (afa *ArozFSFileAdapter) Name() string {
	logger.DebugTrace("storage/billyconv", "ArozFSFileAdapter.Name")
	return afa.file.Name()
}

func (afa *ArozFSFileAdapter) Read(b []byte) (int, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("storage/billyconv", "ArozFSFileAdapter.Read: len(b)=%d", len(b))
	}
	return afa.file.Read(b)
}

func (afa *ArozFSFileAdapter) ReadAt(b []byte, off int64) (int, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("storage/billyconv", "ArozFSFileAdapter.ReadAt: len(b)=%d off=%d", len(b), off)
	}
	return afa.file.ReadAt(b, off)
}

func (afa *ArozFSFileAdapter) Seek(offset int64, whence int) (int64, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("storage/billyconv", "ArozFSFileAdapter.Seek: offset=%d whence=%d", offset, whence)
	}
	return afa.file.Seek(offset, whence)
}

func (afa *ArozFSFileAdapter) Write(b []byte) (int, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("storage/billyconv", "ArozFSFileAdapter.Write: len(b)=%d", len(b))
	}
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

func (afa *ArozFSFileAdapter) Truncate(size int64) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("storage/billyconv", "ArozFSFileAdapter.Truncate: size=%d", size)
	}
	return errors.New("operation not supported")
}

func (afa *ArozFSFileAdapter) Close() error {
	logger.DebugTrace("storage/billyconv", "ArozFSFileAdapter.Close")
	return afa.file.Close()
}

/*

 */

// Define a type that wraps an fs.FileInfo and implements os.FileInfo
type fileInfoWrapper struct {
	fs.FileInfo
}

// Implement the Sys method to satisfy os.FileInfo
func (f fileInfoWrapper) Sys() interface{} {
	logger.DebugTrace("storage/billyconv", "fileInfoWrapper.Sys")
	return nil
}

// Convert fs.FileInfo to os.FileInfo
func ConvertToOsFileInfo(fi fs.FileInfo) os.FileInfo {
	logger.DebugTrace("storage/billyconv", "ConvertToOsFileInfo")
	return fileInfoWrapper{fi}
}

// Convert []fs.DirEntry to []os.FileInfo
func ConvertDirEntriesToFileInfos(entries []fs.DirEntry) ([]os.FileInfo, error) {
	if logger.IsDebug() {
		logger.Debugf("storage/billyconv", "ConvertDirEntriesToFileInfos: len(entries)=%d", len(entries))
	}
	var fileInfos []os.FileInfo
	for _, entry := range entries {
		info, err := entry.Info()
		if err != nil {
			return nil, err
		}
		fileInfos = append(fileInfos, ConvertToOsFileInfo(info))
	}
	return fileInfos, nil
}
