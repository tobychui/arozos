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
)

//This script adapts the required billy.FileSystem to arozos abstraction

type ArozFsToBillyFileSytemAdapter struct {
	fsh *filesystem.FileSystemHandler
}

func NewArozFsToBillyFsAdapter(targetFsh *filesystem.FileSystemHandler) billy.Filesystem {
	return &ArozFsToBillyFileSytemAdapter{
		fsh: targetFsh,
	}
}

func (adp *ArozFsToBillyFileSytemAdapter) Create(filename string) (billy.File, error) {
	filename = adp.CleanAndFilterFilename(filename)
	file, err := adp.fsh.FileSystemAbstraction.Create(filename)
	if err != nil {
		return nil, err
	}
	return ArozfsFileToBillyFile(file), nil
}

func (adp *ArozFsToBillyFileSytemAdapter) Open(filename string) (billy.File, error) {
	filename = adp.CleanAndFilterFilename(filename)
	file, err := adp.fsh.FileSystemAbstraction.Open(filename)
	if err != nil {
		return nil, err
	}
	return ArozfsFileToBillyFile(file), nil
}

func (adp *ArozFsToBillyFileSytemAdapter) OpenFile(filename string, flag int, perm os.FileMode) (billy.File, error) {
	filename = adp.CleanAndFilterFilename(filename)
	file, err := adp.fsh.FileSystemAbstraction.OpenFile(filename, flag, perm)
	if err != nil {
		return nil, err
	}
	return ArozfsFileToBillyFile(file), nil
}

func (adp *ArozFsToBillyFileSytemAdapter) Stat(filename string) (os.FileInfo, error) {
	filename = adp.CleanAndFilterFilename(filename)
	fileInfo, err := adp.fsh.FileSystemAbstraction.Stat(filename)
	if err != nil {
		return nil, err
	}
	return ConvertToOsFileInfo(fileInfo), err
}

func (adp *ArozFsToBillyFileSytemAdapter) Rename(oldpath, newpath string) error {
	oldpath = adp.CleanAndFilterFilename(oldpath)
	newpath = adp.CleanAndFilterFilename(newpath)
	return adp.Rename(oldpath, newpath)
}

func (adp *ArozFsToBillyFileSytemAdapter) Remove(filename string) error {
	filename = adp.CleanAndFilterFilename(filename)
	return adp.fsh.FileSystemAbstraction.Remove(filename)
}

func (adp *ArozFsToBillyFileSytemAdapter) Join(elem ...string) string {
	return filepath.Join(elem...)
}

func (adp *ArozFsToBillyFileSytemAdapter) TempFile(dir, prefix string) (billy.File, error) {
	return nil, errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) ReadDir(path string) ([]os.FileInfo, error) {
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
	filename = adp.CleanAndFilterFilename(filename)
	return adp.fsh.FileSystemAbstraction.MkdirAll(filename, perm)
}

func (adp *ArozFsToBillyFileSytemAdapter) Lstat(filename string) (os.FileInfo, error) {
	return nil, errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) Symlink(target, link string) error {
	return errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) Readlink(link string) (string, error) {
	return "", errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) Chroot(path string) (billy.Filesystem, error) {
	return nil, errors.New("operation not supported")
}

func (adp *ArozFsToBillyFileSytemAdapter) Root() string {
	return "/"
}

/* Utilities */
func (adp *ArozFsToBillyFileSytemAdapter) CleanAndFilterFilename(filename string) string {
	return filename
}

/*
arozfs.File to Billy.File converter
*/
type ArozFSFileAdapter struct {
	file arozfs.File
}

func ArozfsFileToBillyFile(file arozfs.File) billy.File {
	return &ArozFSFileAdapter{
		file: file,
	}
}

func (afa *ArozFSFileAdapter) Name() string {
	return afa.file.Name()
}

func (afa *ArozFSFileAdapter) Read(b []byte) (int, error) {
	return afa.file.Read(b)
}

func (afa *ArozFSFileAdapter) ReadAt(b []byte, off int64) (int, error) {
	return afa.file.ReadAt(b, off)
}

func (afa *ArozFSFileAdapter) Seek(offset int64, whence int) (int64, error) {
	return afa.file.Seek(offset, whence)
}

func (afa *ArozFSFileAdapter) Write(b []byte) (int, error) {
	return afa.file.Write(b)
}

func (afa *ArozFSFileAdapter) Lock() error {
	return nil
}

func (afa *ArozFSFileAdapter) Unlock() error {
	return nil
}

func (afa *ArozFSFileAdapter) Truncate(size int64) error {
	return errors.New("operation not supported")
}

func (afa *ArozFSFileAdapter) Close() error {
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
	return nil
}

// Convert fs.FileInfo to os.FileInfo
func ConvertToOsFileInfo(fi fs.FileInfo) os.FileInfo {
	return fileInfoWrapper{fi}
}

// Convert []fs.DirEntry to []os.FileInfo
func ConvertDirEntriesToFileInfos(entries []fs.DirEntry) ([]os.FileInfo, error) {
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
