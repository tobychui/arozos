package emptyfs

import (
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
)

/*
	filesystemAbstraction.go

	This file contains all the abstraction funtion of a local file system.

*/

type EmptyFileSystemAbstraction struct {
}

func NewEmptyFileSystemAbstraction() (out0 EmptyFileSystemAbstraction) {
	defer logger.Out1(logger.In0("filesystem/abstractions/emptyfs", "NewEmptyFileSystemAbstraction"), &out0)
	return EmptyFileSystemAbstraction{}
}

func (l EmptyFileSystemAbstraction) Chmod(filename string, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Chmod", "&l", &l, "filename", filename, "&mode", &mode), &out0)
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Chown(filename string, uid int, gid int) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Chown", "&l", &l, "filename", filename, "uid", uid, "gid", gid), &out0)
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Chtimes(filename string, atime time.Time, mtime time.Time) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Chtimes", "&l", &l, "filename", filename, "&atime", &atime, "&mtime", &mtime), &out0)
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Create(filename string) (out0 arozfs.File, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Create", "&l", &l, "filename", filename), &out0, &out1)
	return nil, arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Mkdir(filename string, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Mkdir", "&l", &l, "filename", filename, "&mode", &mode), &out0)
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) MkdirAll(filename string, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.MkdirAll", "&l", &l, "filename", filename, "&mode", &mode), &out0)
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Name", "&l", &l), &out0)
	return ""
}
func (l EmptyFileSystemAbstraction) Open(filename string) (out0 arozfs.File, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Open", "&l", &l, "filename", filename), &out0, &out1)
	return nil, arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) OpenFile(filename string, flag int, perm os.FileMode) (out0 arozfs.File, out1 error) {
	defer logger.Out2(logger.In4("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.OpenFile", "&l", &l, "filename", filename, "flag", flag, "&perm", &perm), &out0, &out1)
	return nil, arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Remove(filename string) (out0 error) {
	defer logger.Out1(logger.In2("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Remove", "&l", &l, "filename", filename), &out0)
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) RemoveAll(path string) (out0 error) {
	defer logger.Out1(logger.In2("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.RemoveAll", "&l", &l, "path", path), &out0)
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Rename(oldname, newname string) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Rename", "&l", &l, "oldname", oldname, "newname", newname), &out0)
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Stat(filename string) (out0 os.FileInfo, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Stat", "&l", &l, "filename", filename), &out0, &out1)
	return nil, arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Close() (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Close", "&l", &l), &out0)
	return nil
}

/*
	Abstraction Utilities
*/

func (l EmptyFileSystemAbstraction) VirtualPathToRealPath(subpath string, username string) (out0 string, out1 error) {
	defer logger.Out2(logger.In3("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.VirtualPathToRealPath", "&l", &l, "subpath", subpath, "username", username), &out0, &out1)
	return "", arozfs.ErrVpathResolveFailed
}

func (l EmptyFileSystemAbstraction) RealPathToVirtualPath(fullpath string, username string) (out0 string, out1 error) {
	defer logger.Out2(logger.In3("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.RealPathToVirtualPath", "&l", &l, "fullpath", fullpath, "username", username), &out0, &out1)
	return "", arozfs.ErrRpathResolveFailed
}

func (l EmptyFileSystemAbstraction) FileExists(realpath string) (out0 bool) {
	defer logger.Out1(logger.In2("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.FileExists", "&l", &l, "realpath", realpath), &out0)
	return false
}

func (l EmptyFileSystemAbstraction) IsDir(realpath string) (out0 bool) {
	defer logger.Out1(logger.In2("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.IsDir", "&l", &l, "realpath", realpath), &out0)
	return false
}

func (l EmptyFileSystemAbstraction) Glob(realpathWildcard string) (out0 []string, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Glob", "&l", &l, "realpathWildcard", realpathWildcard), &out0, &out1)
	return []string{}, arozfs.ErrNullOperation
}

func (l EmptyFileSystemAbstraction) GetFileSize(realpath string) (out0 int64) {
	defer logger.Out1(logger.In2("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.GetFileSize", "&l", &l, "realpath", realpath), &out0)
	return 0
}

func (l EmptyFileSystemAbstraction) GetModTime(realpath string) (out0 int64, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.GetModTime", "&l", &l, "realpath", realpath), &out0, &out1)
	return 0, arozfs.ErrOperationNotSupported
}

func (l EmptyFileSystemAbstraction) WriteFile(filename string, content []byte, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.WriteFile", "&l", &l, "filename", filename, "content", content, "&mode", &mode), &out0)
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) ReadFile(filename string) (out0 []byte, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.ReadFile", "&l", &l, "filename", filename), &out0, &out1)
	return []byte(""), arozfs.ErrOperationNotSupported
}
func (l EmptyFileSystemAbstraction) ReadDir(filename string) (out0 []fs.DirEntry, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.ReadDir", "&l", &l, "filename", filename), &out0, &out1)
	return []fs.DirEntry{}, arozfs.ErrOperationNotSupported
}
func (l EmptyFileSystemAbstraction) WriteStream(filename string, stream io.Reader, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.WriteStream", "&l", &l, "filename", filename, "stream", stream, "&mode", &mode), &out0)
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) ReadStream(filename string) (out0 io.ReadCloser, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.ReadStream", "&l", &l, "filename", filename), &out0, &out1)
	return nil, arozfs.ErrOperationNotSupported
}

func (l EmptyFileSystemAbstraction) Walk(root string, walkFn filepath.WalkFunc) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Walk", "&l", &l, "root", root, "&walkFn", &walkFn), &out0)
	return arozfs.ErrOperationNotSupported
}

func (l EmptyFileSystemAbstraction) Heartbeat() (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Heartbeat", "&l", &l), &out0)
	return nil
}
