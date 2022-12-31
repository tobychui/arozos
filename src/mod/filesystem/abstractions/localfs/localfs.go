package localfs

import (
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
	"time"

	"imuslab.com/arozos/mod/filesystem/arozfs"
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
	return LocalFileSystemAbstraction{
		UUID:      uuid,
		Rootpath:  root,
		Hierarchy: hierarchy,
		ReadOnly:  readonly,
	}
}

func (l LocalFileSystemAbstraction) Chmod(filename string, mode os.FileMode) error {
	return os.Chmod(filename, mode)
}
func (l LocalFileSystemAbstraction) Chown(filename string, uid int, gid int) error {
	return os.Chown(filename, uid, gid)
}
func (l LocalFileSystemAbstraction) Chtimes(filename string, atime time.Time, mtime time.Time) error {
	return os.Chtimes(filename, atime, mtime)
}
func (l LocalFileSystemAbstraction) Create(filename string) (arozfs.File, error) {
	return os.Create(filename)
}
func (l LocalFileSystemAbstraction) Mkdir(filename string, mode os.FileMode) error {
	return os.Mkdir(filename, mode)
}
func (l LocalFileSystemAbstraction) MkdirAll(filename string, mode os.FileMode) error {
	return os.MkdirAll(filename, mode)
}
func (l LocalFileSystemAbstraction) Name() string {
	return ""
}
func (l LocalFileSystemAbstraction) Open(filename string) (arozfs.File, error) {
	return os.Open(filename)
}
func (l LocalFileSystemAbstraction) OpenFile(filename string, flag int, perm os.FileMode) (arozfs.File, error) {
	return os.OpenFile(filename, flag, perm)
}
func (l LocalFileSystemAbstraction) Remove(filename string) error {
	return os.Remove(filename)
}
func (l LocalFileSystemAbstraction) RemoveAll(path string) error {
	return os.RemoveAll(path)
}
func (l LocalFileSystemAbstraction) Rename(oldname, newname string) error {
	return os.Rename(oldname, newname)
}
func (l LocalFileSystemAbstraction) Stat(filename string) (os.FileInfo, error) {
	return os.Stat(filename)
}
func (l LocalFileSystemAbstraction) Close() error {
	return nil
}

/*
	Abstraction Utilities
*/

func (l LocalFileSystemAbstraction) VirtualPathToRealPath(subpath string, username string) (string, error) {
	subpath = filepath.ToSlash(subpath)
	if strings.HasPrefix(subpath, l.UUID+":") {
		//This is full virtual path. Trim the uuid and correct the subpath
		subpath = subpath[len(l.UUID+":"):]
	}

	if l.Hierarchy == "user" {
		return filepath.ToSlash(filepath.Join(l.Rootpath, "users", username, subpath)), nil
	} else if l.Hierarchy == "public" {
		return filepath.ToSlash(filepath.Join(l.Rootpath, subpath)), nil
	}
	return "", arozfs.ErrVpathResolveFailed
}

func (l LocalFileSystemAbstraction) RealPathToVirtualPath(fullpath string, username string) (string, error) {
	/*
		thisStorageRootAbs, err := filepath.Abs(l.Rootpath)
		if err != nil {
			//Fail to abs this path. Maybe this is a emulated file system?
			thisStorageRootAbs = l.Rootpath
		}
		thisStorageRootAbs = filepath.ToSlash(filepath.Clean(thisStorageRootAbs))

		subPath := ""
		if len(fullpath) > len(l.Rootpath) && filepath.ToSlash(fullpath[:len(l.Rootpath)]) == filepath.ToSlash(l.Rootpath) {
			//This realpath is in contained inside this storage root
			subtractionPath := l.Rootpath
			if l.Hierarchy == "user" {
				//Check if this file is belongs to this user
				startOffset := len(filepath.Clean(l.Rootpath) + "/users/")
				if len(fullpath) < startOffset+len(username) {
					//This file is not owned by this user
					return "", errors.New("File not owned by this user")
				} else {
					userNameMatch := fullpath[startOffset : startOffset+len(username)]
					if userNameMatch != username {
						//This file is not owned by this user
						return "", errors.New("File not owned by this user")
					}
				}

				//Generate subtraction path
				subtractionPath = filepath.ToSlash(filepath.Clean(filepath.Join(l.Rootpath, "users", username)))
			}

			if len(subtractionPath) < len(fullpath) {
				subPath = fullpath[len(subtractionPath):]
			}

		} else if len(fullpath) > len(thisStorageRootAbs) && filepath.ToSlash(fullpath[:len(thisStorageRootAbs)]) == filepath.ToSlash(thisStorageRootAbs) {
			//The realpath contains the absolute path of this storage root
			subtractionPath := thisStorageRootAbs
			if l.Hierarchy == "user" {
				subtractionPath = thisStorageRootAbs + "/users/" + username + "/"
			}

			if len(subtractionPath) < len(fullpath) {
				subPath = fullpath[len(subtractionPath):]
			}
		} else if filepath.ToSlash(fullpath) == filepath.ToSlash(l.Rootpath) {
			//Storage Root's root
			subPath = ""
		}

		if len(subPath) > 1 && subPath[:1] == "/" {
			subPath = subPath[1:]
		}
	*/
	fullpath = filepath.ToSlash(fullpath)
	if strings.HasPrefix(fullpath, l.UUID+":") && !utils.FileExists(fullpath) {
		return "", arozfs.ErrRpathResolveFailed
	}
	prefix := filepath.ToSlash(filepath.Join(l.Rootpath, "users", username))
	if l.Hierarchy == "public" {
		prefix = filepath.ToSlash(l.Rootpath)
	}
	fullpath = filepath.ToSlash(filepath.Clean(fullpath))
	subPath := strings.TrimPrefix(fullpath, prefix)
	if !strings.HasPrefix(subPath, "/") {
		subPath = "/" + subPath
	}

	return l.UUID + ":" + filepath.ToSlash(subPath), nil
}

func (l LocalFileSystemAbstraction) FileExists(realpath string) bool {
	return utils.FileExists(realpath)
}

func (l LocalFileSystemAbstraction) IsDir(realpath string) bool {
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
	return filepath.Glob(realpathWildcard)
}

func (l LocalFileSystemAbstraction) GetFileSize(realpath string) int64 {
	fi, err := os.Stat(realpath)
	if err != nil {
		return 0
	}
	// get the size
	return fi.Size()
}

func (l LocalFileSystemAbstraction) GetModTime(realpath string) (int64, error) {
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
	return os.WriteFile(filename, content, mode)
}
func (l LocalFileSystemAbstraction) ReadFile(filename string) ([]byte, error) {
	return os.ReadFile(filename)
}
func (l LocalFileSystemAbstraction) ReadDir(filename string) ([]fs.DirEntry, error) {
	return os.ReadDir(filename)
}
func (l LocalFileSystemAbstraction) WriteStream(filename string, stream io.Reader, mode os.FileMode) error {
	f, err := os.OpenFile(filename, os.O_CREATE|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	_, err = io.Copy(f, stream)
	f.Close()
	return err
}
func (l LocalFileSystemAbstraction) ReadStream(filename string) (io.ReadCloser, error) {
	f, err := os.OpenFile(filename, os.O_RDONLY, 0644)
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (l LocalFileSystemAbstraction) Walk(root string, walkFn filepath.WalkFunc) error {
	return filepath.Walk(root, walkFn)
}

func (l LocalFileSystemAbstraction) Heartbeat() error {
	return nil
}
