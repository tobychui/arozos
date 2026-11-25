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

func NewEmptyFileSystemAbstraction() EmptyFileSystemAbstraction {
	logger.DebugTrace("filesystem/abstractions/emptyfs", "NewEmptyFileSystemAbstraction")
	return EmptyFileSystemAbstraction{}
}

func (l EmptyFileSystemAbstraction) Chmod(filename string, mode os.FileMode) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Chmod: filename=%.120q", filename)
	}
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Chown(filename string, uid int, gid int) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Chown: filename=%.120q uid=%d gid=%d", filename, uid, gid)
	}
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Chtimes(filename string, atime time.Time, mtime time.Time) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Chtimes: filename=%.120q", filename)
	}
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Create(filename string) (arozfs.File, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Create: filename=%.120q", filename)
	}
	return nil, arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Mkdir(filename string, mode os.FileMode) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Mkdir: filename=%.120q", filename)
	}
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) MkdirAll(filename string, mode os.FileMode) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.MkdirAll: filename=%.120q", filename)
	}
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Name() string {
	logger.DebugTrace("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Name")
	return ""
}
func (l EmptyFileSystemAbstraction) Open(filename string) (arozfs.File, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Open: filename=%.120q", filename)
	}
	return nil, arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) OpenFile(filename string, flag int, perm os.FileMode) (arozfs.File, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.OpenFile: filename=%.120q flag=%d", filename, flag)
	}
	return nil, arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Remove(filename string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Remove: filename=%.120q", filename)
	}
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) RemoveAll(path string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.RemoveAll: path=%.120q", path)
	}
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Rename(oldname, newname string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Rename: oldname=%.120q newname=%.120q", oldname, newname)
	}
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Stat(filename string) (os.FileInfo, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Stat: filename=%.120q", filename)
	}
	return nil, arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) Close() error {
	logger.DebugTrace("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Close")
	return nil
}

/*
	Abstraction Utilities
*/

func (l EmptyFileSystemAbstraction) VirtualPathToRealPath(subpath string, username string) (string, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.VirtualPathToRealPath: subpath=%.120q username=%.120q", subpath, username)
	}
	return "", arozfs.ErrVpathResolveFailed
}

func (l EmptyFileSystemAbstraction) RealPathToVirtualPath(fullpath string, username string) (string, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.RealPathToVirtualPath: fullpath=%.120q username=%.120q", fullpath, username)
	}
	return "", arozfs.ErrRpathResolveFailed
}

func (l EmptyFileSystemAbstraction) FileExists(realpath string) bool {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.FileExists: realpath=%.120q", realpath)
	}
	return false
}

func (l EmptyFileSystemAbstraction) IsDir(realpath string) bool {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.IsDir: realpath=%.120q", realpath)
	}
	return false
}

func (l EmptyFileSystemAbstraction) Glob(realpathWildcard string) ([]string, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Glob: realpathWildcard=%.120q", realpathWildcard)
	}
	return []string{}, arozfs.ErrNullOperation
}

func (l EmptyFileSystemAbstraction) GetFileSize(realpath string) int64 {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.GetFileSize: realpath=%.120q", realpath)
	}
	return 0
}

func (l EmptyFileSystemAbstraction) GetModTime(realpath string) (int64, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.GetModTime: realpath=%.120q", realpath)
	}
	return 0, arozfs.ErrOperationNotSupported
}

func (l EmptyFileSystemAbstraction) WriteFile(filename string, content []byte, mode os.FileMode) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.WriteFile: filename=%.120q", filename)
	}
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) ReadFile(filename string) ([]byte, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.ReadFile: filename=%.120q", filename)
	}
	return []byte(""), arozfs.ErrOperationNotSupported
}
func (l EmptyFileSystemAbstraction) ReadDir(filename string) ([]fs.DirEntry, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.ReadDir: filename=%.120q", filename)
	}
	return []fs.DirEntry{}, arozfs.ErrOperationNotSupported
}
func (l EmptyFileSystemAbstraction) WriteStream(filename string, stream io.Reader, mode os.FileMode) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.WriteStream: filename=%.120q", filename)
	}
	return arozfs.ErrNullOperation
}
func (l EmptyFileSystemAbstraction) ReadStream(filename string) (io.ReadCloser, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.ReadStream: filename=%.120q", filename)
	}
	return nil, arozfs.ErrOperationNotSupported
}

func (l EmptyFileSystemAbstraction) Walk(root string, walkFn filepath.WalkFunc) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Walk: root=%.120q", root)
	}
	return arozfs.ErrOperationNotSupported
}

func (l EmptyFileSystemAbstraction) Heartbeat() error {
	logger.DebugTrace("filesystem/abstractions/emptyfs", "EmptyFileSystemAbstraction.Heartbeat")
	return nil
}
