package localfs

import (
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

/*
	filesystemAbstraction.go

	This file contains all the abstraction funtion of a local file system.

*/

type LocalFileSystemAbstraction struct {
	UUID      string
	Rootpath  string
	Hierarchy string
	ReadOnly  bool
}

func NewLocalFileSystemAbstraction(uuid, root, hierarchy string, readonly bool) LocalFileSystemAbstraction {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "NewLocalFileSystemAbstraction: uuid=%.120q root=%.120q hierarchy=%.120q readonly=%t", uuid, root, hierarchy, readonly)
	}
	return LocalFileSystemAbstraction{
		UUID:      uuid,
		Rootpath:  root,
		Hierarchy: hierarchy,
		ReadOnly:  readonly,
	}
}

func (l LocalFileSystemAbstraction) Chmod(filename string, mode os.FileMode) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.Chmod: filename=%.120q", filename)
	}
	return os.Chmod(filename, mode)
}
func (l LocalFileSystemAbstraction) Chown(filename string, uid int, gid int) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.Chown: filename=%.120q uid=%d gid=%d", filename, uid, gid)
	}
	return os.Chown(filename, uid, gid)
}
func (l LocalFileSystemAbstraction) Chtimes(filename string, atime time.Time, mtime time.Time) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.Chtimes: filename=%.120q", filename)
	}
	return os.Chtimes(filename, atime, mtime)
}
func (l LocalFileSystemAbstraction) Create(filename string) (arozfs.File, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.Create: filename=%.120q", filename)
	}
	return os.Create(filename)
}
func (l LocalFileSystemAbstraction) Mkdir(filename string, mode os.FileMode) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.Mkdir: filename=%.120q", filename)
	}
	return os.Mkdir(filename, mode)
}
func (l LocalFileSystemAbstraction) MkdirAll(filename string, mode os.FileMode) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.MkdirAll: filename=%.120q", filename)
	}
	return os.MkdirAll(filename, mode)
}
func (l LocalFileSystemAbstraction) Name() string {
	logger.DebugTrace("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.Name")
	return ""
}
func (l LocalFileSystemAbstraction) Open(filename string) (arozfs.File, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.Open: filename=%.120q", filename)
	}
	return os.Open(filename)
}
func (l LocalFileSystemAbstraction) OpenFile(filename string, flag int, perm os.FileMode) (arozfs.File, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.OpenFile: filename=%.120q flag=%d", filename, flag)
	}
	return os.OpenFile(filename, flag, perm)
}
func (l LocalFileSystemAbstraction) Remove(filename string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.Remove: filename=%.120q", filename)
	}
	return os.Remove(filename)
}
func (l LocalFileSystemAbstraction) RemoveAll(path string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.RemoveAll: path=%.120q", path)
	}
	return os.RemoveAll(path)
}
func (l LocalFileSystemAbstraction) Rename(oldname, newname string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.Rename: oldname=%.120q newname=%.120q", oldname, newname)
	}
	return os.Rename(oldname, newname)
}
func (l LocalFileSystemAbstraction) Stat(filename string) (os.FileInfo, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.Stat: filename=%.120q", filename)
	}
	return os.Stat(filename)
}
func (l LocalFileSystemAbstraction) Close() error {
	logger.DebugTrace("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.Close")
	return nil
}

/*
	Abstraction Utilities
*/

func (l LocalFileSystemAbstraction) VirtualPathToRealPath(subpath string, username string) (string, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.VirtualPathToRealPath: subpath=%.120q username=%.120q", subpath, username)
	}
	rpath, err := arozfs.GenericVirtualPathToRealPathTranslator(l.UUID, l.Hierarchy, subpath, username)
	if err != nil {
		return "", err
	}

	//Append the local root path to the translated path to allow read write from os package
	rpath = filepath.Join(l.Rootpath, rpath)

	//fmt.Println("VIRTUAL TO REAL", l.Rootpath, subpath, rpath)
	return rpath, nil
}

func (l LocalFileSystemAbstraction) RealPathToVirtualPath(fullpath string, username string) (string, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.RealPathToVirtualPath: fullpath=%.120q username=%.120q", fullpath, username)
	}
	//Trim the absolute / relative path before passing into generic translator
	fullpath = arozfs.ToSlash(fullpath)
	if strings.HasPrefix(fullpath, arozfs.ToSlash(filepath.Clean(l.Rootpath))) {
		fullpath = strings.TrimPrefix(fullpath, arozfs.ToSlash(filepath.Clean(l.Rootpath)))
	}

	vpath, err := arozfs.GenericRealPathToVirtualPathTranslator(l.UUID, l.Hierarchy, arozfs.ToSlash(fullpath), username)
	//fmt.Println("REAL TO VIRTUAL", arozfs.ToSlash(filepath.Clean(l.Rootpath)), fullpath, vpath)
	return vpath, err
}

func (l LocalFileSystemAbstraction) FileExists(realpath string) bool {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.FileExists: realpath=%.120q", realpath)
	}
	return utils.FileExists(realpath)
}

func (l LocalFileSystemAbstraction) IsDir(realpath string) bool {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.IsDir: realpath=%.120q", realpath)
	}
	if !l.FileExists(realpath) {
		return false
	}
	fi, err := l.Stat(realpath)
	if err != nil {
		return false
	}
	switch mode := fi.Mode(); {
	case mode.IsDir():
		return true
	case mode.IsRegular():
		return false
	}
	return false
}

func (l LocalFileSystemAbstraction) Glob(realpathWildcard string) ([]string, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.Glob: realpathWildcard=%.120q", realpathWildcard)
	}
	files, err := filepath.Glob(realpathWildcard)
	if err != nil {
		return files, err
	}

	// filepath.Glob treats [ and ] as character class syntax, so folder names containing
	// brackets (e.g. "[Hi-Res][FLAC]") return no results. Fall back to a ?-wildcard scan
	// and then verify matches against the original path to filter out false positives.
	if (strings.Contains(realpathWildcard, "[") || strings.Contains(realpathWildcard, "]")) && len(files) == 0 {
		newSearchPath := strings.ReplaceAll(realpathWildcard, "[", "?")
		newSearchPath = strings.ReplaceAll(newSearchPath, "]", "?")
		tmpFilelist, _ := filepath.Glob(newSearchPath)
		dirPath := filepath.ToSlash(filepath.Dir(realpathWildcard))
		for _, file := range tmpFilelist {
			file = filepath.ToSlash(file)
			if strings.Contains(file, dirPath) {
				files = append(files, file)
			}
		}
	}

	return files, err
}

func (l LocalFileSystemAbstraction) GetFileSize(realpath string) int64 {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.GetFileSize: realpath=%.120q", realpath)
	}
	fi, err := os.Stat(realpath)
	if err != nil {
		return 0
	}
	// get the size
	return fi.Size()
}

func (l LocalFileSystemAbstraction) GetModTime(realpath string) (int64, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.GetModTime: realpath=%.120q", realpath)
	}
	f, err := os.Open(realpath)
	if err != nil {
		return -1, err
	}
	statinfo, err := f.Stat()
	if err != nil {
		return -1, err
	}
	f.Close()
	return statinfo.ModTime().Unix(), nil
}

func (l LocalFileSystemAbstraction) WriteFile(filename string, content []byte, mode os.FileMode) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.WriteFile: filename=%.120q", filename)
	}
	return os.WriteFile(filename, content, mode)
}
func (l LocalFileSystemAbstraction) ReadFile(filename string) ([]byte, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.ReadFile: filename=%.120q", filename)
	}
	return os.ReadFile(filename)
}
func (l LocalFileSystemAbstraction) ReadDir(filename string) ([]fs.DirEntry, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.ReadDir: filename=%.120q", filename)
	}
	return os.ReadDir(filename)
}
func (l LocalFileSystemAbstraction) WriteStream(filename string, stream io.Reader, mode os.FileMode) error {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.WriteStream: filename=%.120q", filename)
	}
	// O_TRUNC: WriteStream replaces the file. Without it, writing fewer
	// bytes than the file already holds leaves the old tail behind and
	// corrupts structured formats (zip containers like .pptx read their
	// directory from the END of the file, so they keep opening as the
	// stale document - or fail to open at all)
	f, err := os.OpenFile(filename, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, mode)
	if err != nil {
		return err
	}
	_, err = io.Copy(f, stream)
	f.Close()
	return err
}
func (l LocalFileSystemAbstraction) ReadStream(filename string) (io.ReadCloser, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.ReadStream: filename=%.120q", filename)
	}
	f, err := os.OpenFile(filename, os.O_RDONLY, 0644)
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (l LocalFileSystemAbstraction) Walk(root string, walkFn filepath.WalkFunc) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.Walk: root=%.120q", root)
	}
	return filepath.Walk(root, walkFn)
}

func (l LocalFileSystemAbstraction) Heartbeat() error {
	logger.DebugTrace("filesystem/abstractions/localfs", "LocalFileSystemAbstraction.Heartbeat")
	return nil
}
