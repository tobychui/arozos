package s3fs

import (
	"io/fs"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	s3FileWrapper.go

	S3 FileInfo and DirEntry wrappers for the arozos filesystem abstraction layer.
*/

// S3FileInfo implements os.FileInfo for S3 objects.
type S3FileInfo struct {
	name    string
	size    int64
	isDir   bool
	modTime time.Time
}

func NewS3FileInfo(name string, size int64, isDir bool, modTime time.Time) *S3FileInfo {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/s3fs", "NewS3FileInfo: name=%.120q size=%d isDir=%t", name, size, isDir)
	}
	return &S3FileInfo{
		name:    name,
		size:    size,
		isDir:   isDir,
		modTime: modTime,
	}
}

func (fi *S3FileInfo) Name() string {
	logger.DebugTrace("filesystem/abstractions/s3fs", "S3FileInfo.Name")
	return fi.name
}
func (fi *S3FileInfo) Size() int64 {
	logger.DebugTrace("filesystem/abstractions/s3fs", "S3FileInfo.Size")
	return fi.size
}
func (fi *S3FileInfo) Mode() fs.FileMode {
	logger.DebugTrace("filesystem/abstractions/s3fs", "S3FileInfo.Mode")
	if fi.isDir {
		return fs.ModeDir | 0755
	}
	return 0664
}
func (fi *S3FileInfo) ModTime() time.Time {
	logger.DebugTrace("filesystem/abstractions/s3fs", "S3FileInfo.ModTime")
	return fi.modTime
}
func (fi *S3FileInfo) IsDir() bool {
	logger.DebugTrace("filesystem/abstractions/s3fs", "S3FileInfo.IsDir")
	return fi.isDir
}
func (fi *S3FileInfo) Sys() interface{} {
	logger.DebugTrace("filesystem/abstractions/s3fs", "S3FileInfo.Sys")
	return nil
}

// S3DirEntry implements fs.DirEntry for S3 objects.
type S3DirEntry struct {
	name    string
	size    int64
	isDir   bool
	modTime time.Time
}

func NewS3DirEntry(name string, size int64, isDir bool, modTime time.Time) *S3DirEntry {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/s3fs", "NewS3DirEntry: name=%.120q size=%d isDir=%t", name, size, isDir)
	}
	return &S3DirEntry{
		name:    name,
		size:    size,
		isDir:   isDir,
		modTime: modTime,
	}
}

func (de *S3DirEntry) Name() string {
	logger.DebugTrace("filesystem/abstractions/s3fs", "S3DirEntry.Name")
	return de.name
}
func (de *S3DirEntry) IsDir() bool {
	logger.DebugTrace("filesystem/abstractions/s3fs", "S3DirEntry.IsDir")
	return de.isDir
}
func (de *S3DirEntry) Type() fs.FileMode {
	logger.DebugTrace("filesystem/abstractions/s3fs", "S3DirEntry.Type")
	if de.isDir {
		return fs.ModeDir
	}
	return 0
}
func (de *S3DirEntry) Info() (fs.FileInfo, error) {
	logger.DebugTrace("filesystem/abstractions/s3fs", "S3DirEntry.Info")
	return NewS3FileInfo(de.name, de.size, de.isDir, de.modTime), nil
}
