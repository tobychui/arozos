package s3fs

import (
	"io/fs"
	"time"
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
	return &S3FileInfo{
		name:    name,
		size:    size,
		isDir:   isDir,
		modTime: modTime,
	}
}

func (fi *S3FileInfo) Name() string { return fi.name }
func (fi *S3FileInfo) Size() int64  { return fi.size }
func (fi *S3FileInfo) Mode() fs.FileMode {
	if fi.isDir {
		return fs.ModeDir | 0755
	}
	return 0664
}
func (fi *S3FileInfo) ModTime() time.Time { return fi.modTime }
func (fi *S3FileInfo) IsDir() bool        { return fi.isDir }
func (fi *S3FileInfo) Sys() interface{}   { return nil }

// S3DirEntry implements fs.DirEntry for S3 objects.
type S3DirEntry struct {
	name    string
	size    int64
	isDir   bool
	modTime time.Time
}

func NewS3DirEntry(name string, size int64, isDir bool, modTime time.Time) *S3DirEntry {
	return &S3DirEntry{
		name:    name,
		size:    size,
		isDir:   isDir,
		modTime: modTime,
	}
}

func (de *S3DirEntry) Name() string { return de.name }
func (de *S3DirEntry) IsDir() bool  { return de.isDir }
func (de *S3DirEntry) Type() fs.FileMode {
	if de.isDir {
		return fs.ModeDir
	}
	return 0
}
func (de *S3DirEntry) Info() (fs.FileInfo, error) {
	return NewS3FileInfo(de.name, de.size, de.isDir, de.modTime), nil
}
