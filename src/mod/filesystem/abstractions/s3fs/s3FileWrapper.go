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

func NewS3FileInfo(name string, size int64, isDir bool, modTime time.Time) (out0 *S3FileInfo) {
	defer logger.Out1(logger.In4("filesystem/abstractions/s3fs", "NewS3FileInfo", "name", name, "size", size, "isDir", isDir, "&modTime", &modTime), &out0)
	return &S3FileInfo{
		name:    name,
		size:    size,
		isDir:   isDir,
		modTime: modTime,
	}
}

func (fi *S3FileInfo) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/s3fs", "S3FileInfo.Name", "fi", fi), &out0)
	return fi.name
}
func (fi *S3FileInfo) Size() (out0 int64) {
	defer logger.Out1(logger.In1("filesystem/abstractions/s3fs", "S3FileInfo.Size", "fi", fi), &out0)
	return fi.size
}
func (fi *S3FileInfo) Mode() (out0 fs.FileMode) {
	defer logger.Out1(logger.In1("filesystem/abstractions/s3fs", "S3FileInfo.Mode", "fi", fi), &out0)
	if fi.isDir {
		return fs.ModeDir | 0755
	}
	return 0664
}
func (fi *S3FileInfo) ModTime() (out0 time.Time) {
	defer logger.Out1(logger.In1("filesystem/abstractions/s3fs", "S3FileInfo.ModTime", "fi", fi), &out0)
	return fi.modTime
}
func (fi *S3FileInfo) IsDir() (out0 bool) {
	defer logger.Out1(logger.In1("filesystem/abstractions/s3fs", "S3FileInfo.IsDir", "fi", fi), &out0)
	return fi.isDir
}
func (fi *S3FileInfo) Sys() (out0 interface{}) {
	defer logger.Out1(logger.In1("filesystem/abstractions/s3fs", "S3FileInfo.Sys", "fi", fi), &out0)
	return nil
}

// S3DirEntry implements fs.DirEntry for S3 objects.
type S3DirEntry struct {
	name    string
	size    int64
	isDir   bool
	modTime time.Time
}

func NewS3DirEntry(name string, size int64, isDir bool, modTime time.Time) (out0 *S3DirEntry) {
	defer logger.Out1(logger.In4("filesystem/abstractions/s3fs", "NewS3DirEntry", "name", name, "size", size, "isDir", isDir, "&modTime", &modTime), &out0)
	return &S3DirEntry{
		name:    name,
		size:    size,
		isDir:   isDir,
		modTime: modTime,
	}
}

func (de *S3DirEntry) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/s3fs", "S3DirEntry.Name", "de", de), &out0)
	return de.name
}
func (de *S3DirEntry) IsDir() (out0 bool) {
	defer logger.Out1(logger.In1("filesystem/abstractions/s3fs", "S3DirEntry.IsDir", "de", de), &out0)
	return de.isDir
}
func (de *S3DirEntry) Type() (out0 fs.FileMode) {
	defer logger.Out1(logger.In1("filesystem/abstractions/s3fs", "S3DirEntry.Type", "de", de), &out0)
	if de.isDir {
		return fs.ModeDir
	}
	return 0
}
func (de *S3DirEntry) Info() (out0 fs.FileInfo, out1 error) {
	defer logger.Out2(logger.In1("filesystem/abstractions/s3fs", "S3DirEntry.Info", "de", de), &out0, &out1)
	return NewS3FileInfo(de.name, de.size, de.isDir, de.modTime), nil
}
