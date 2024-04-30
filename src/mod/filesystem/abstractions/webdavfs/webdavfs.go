package webdavfs

import (
	"errors"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/studio-b12/gowebdav"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

/*
	WebDAV Client

	This script is design as a wrapper of the studio-b12/gowebdav module
	that allow access to webdav network drive in ArozOS and allow arozos
	cross-mounting each others

*/

type WebDAVFileSystem struct {
	UUID      string
	Hierarchy string
	root      string
	user      string
	c         *gowebdav.Client
}

func NewWebDAVMount(UUID string, Hierarchy string, root string, user string, password string) (*WebDAVFileSystem, error) {
	//Connect to webdav server
	c := gowebdav.NewClient(root, user, password)
	err := c.Connect()
	if err != nil {
		log.Println("[WebDAV FS] Unable to connect to remote: ", err.Error())
		return nil, err
	} else {
		log.Println("[WebDAV FS] Connected to remote: " + root)
	}
	return &WebDAVFileSystem{
		UUID:      UUID,
		Hierarchy: Hierarchy,
		c:         c,
		root:      root,
		user:      user,
	}, nil
}

func (e WebDAVFileSystem) Chmod(filename string, mode os.FileMode) error {
	return errors.New("filesystem type not supported")
}
func (e WebDAVFileSystem) Chown(filename string, uid int, gid int) error {
	return errors.New("filesystem type not supported")
}
func (e WebDAVFileSystem) Chtimes(filename string, atime time.Time, mtime time.Time) error {
	return errors.New("filesystem type not supported")
}
func (e WebDAVFileSystem) Create(filename string) (arozfs.File, error) {
	return nil, errors.New("filesystem type not supported")
}
func (e WebDAVFileSystem) Mkdir(filename string, mode os.FileMode) error {
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	return e.c.Mkdir(filename, mode)
}
func (e WebDAVFileSystem) MkdirAll(filename string, mode os.FileMode) error {
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	return e.c.MkdirAll(filename, mode)
}
func (e WebDAVFileSystem) Name() string {
	return ""
}
func (e WebDAVFileSystem) Open(filename string) (arozfs.File, error) {
	return nil, errors.New("filesystem type not supported")
}
func (e WebDAVFileSystem) OpenFile(filename string, flag int, perm os.FileMode) (arozfs.File, error) {
	//Buffer the target file to memory
	//To be implement: Wait for Golang's fs.File.Write function to be released
	//f := bufffs.New(filename)
	//return f, nil
	return nil, errors.New("filesystem type not supported")
}
func (e WebDAVFileSystem) Remove(filename string) error {
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	return e.c.Remove(filename)
}
func (e WebDAVFileSystem) RemoveAll(filename string) error {
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	return e.c.RemoveAll(filename)
}
func (e WebDAVFileSystem) Rename(oldname, newname string) error {
	oldname = filterFilepath(filepath.ToSlash(filepath.Clean(oldname)))
	newname = filterFilepath(filepath.ToSlash(filepath.Clean(newname)))
	err := e.c.Rename(oldname, newname, true)
	if err != nil {
		//Unable to rename due to reverse proxy issue. Use Copy and Delete
		f, err := e.c.ReadStream(oldname)
		if err != nil {
			return err
		}

		err = e.c.WriteStream(newname, f, 0775)
		if err != nil {
			return err
		}
		f.Close()
		e.c.RemoveAll(oldname)
	}
	return nil
}
func (e WebDAVFileSystem) Stat(filename string) (os.FileInfo, error) {
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	return e.c.Stat(filename)
}

func (e WebDAVFileSystem) VirtualPathToRealPath(subpath string, username string) (string, error) {
	subpath = filterFilepath(filepath.ToSlash(filepath.Clean(subpath)))
	if strings.HasPrefix(subpath, e.UUID+":") {
		//This is full virtual path. Trim the uuid and correct the subpath
		subpath = strings.TrimPrefix(subpath, e.UUID+":")
	}

	if e.Hierarchy == "user" {
		return filepath.ToSlash(filepath.Clean(filepath.Join("users", username, subpath))), nil
	} else if e.Hierarchy == "public" {
		return filepath.ToSlash(filepath.Clean(subpath)), nil
	}
	return "", errors.New("unsupported filesystem hierarchy")

}
func (e WebDAVFileSystem) RealPathToVirtualPath(rpath string, username string) (string, error) {
	rpath = filterFilepath(filepath.ToSlash(filepath.Clean(rpath)))
	if e.Hierarchy == "user" && strings.HasPrefix(rpath, "/users/"+username) {
		rpath = strings.TrimPrefix(rpath, "/users/"+username)
	}
	rpath = filepath.ToSlash(rpath)
	if !strings.HasPrefix(rpath, "/") {
		rpath = "/" + rpath
	}
	return e.UUID + ":" + rpath, nil
}
func (e WebDAVFileSystem) FileExists(filename string) bool {
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	_, err := e.c.Stat(filename)
	if os.IsNotExist(err) || err != nil {
		return false
	}

	return true
}
func (e WebDAVFileSystem) IsDir(filename string) bool {
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	s, err := e.c.Stat(filename)
	if err != nil {
		return false
	}
	return s.IsDir()
}

// Notes: This is not actual Glob function. This just emulate Glob using ReadDir with max depth 1 layer
func (e WebDAVFileSystem) Glob(wildcard string) ([]string, error) {
	wildcard = filepath.ToSlash(filepath.Clean(wildcard))

	if !strings.HasPrefix(wildcard, "/") {
		//Handle case for listing root, "*"
		wildcard = "/" + wildcard
	}
	chunks := strings.Split(strings.TrimPrefix(wildcard, "/"), "/")
	results, err := e.globpath("/", chunks, 0)
	return results, err
}

func (e WebDAVFileSystem) GetFileSize(filename string) int64 {
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	s, err := e.Stat(filename)
	if err != nil {
		log.Println(err)
		return 0
	}

	return s.Size()
}

func (e WebDAVFileSystem) GetModTime(filename string) (int64, error) {
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	s, err := e.Stat(filename)
	if err != nil {
		return 0, err
	}

	return s.ModTime().Unix(), nil
}

func (e WebDAVFileSystem) WriteFile(filename string, content []byte, mode os.FileMode) error {
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	return e.c.Write(filename, content, mode)
}

func (e WebDAVFileSystem) ReadFile(filename string) ([]byte, error) {
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	bytes, err := e.c.Read(filename)
	if err != nil {
		return []byte(""), err
	}
	return bytes, nil
}

func (e WebDAVFileSystem) ReadDir(filename string) ([]fs.DirEntry, error) {
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	fis, err := e.c.ReadDir(filename)
	if err != nil {
		return []fs.DirEntry{}, err
	}

	dirEntires := []fs.DirEntry{}
	for _, fi := range fis {
		dirEntires = append(dirEntires, newDirEntryFromFileInfo(fi))
	}
	return dirEntires, nil
}
func (e WebDAVFileSystem) WriteStream(filename string, stream io.Reader, mode os.FileMode) error {
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	return e.c.WriteStream(filename, stream, mode)

}
func (e WebDAVFileSystem) ReadStream(filename string) (io.ReadCloser, error) {
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	return e.c.ReadStream(filename)
}

func (e WebDAVFileSystem) Walk(rootpath string, walkFn filepath.WalkFunc) error {
	rootpath = filepath.ToSlash(filepath.Clean(rootpath))
	rootStat, err := e.Stat(rootpath)
	err = walkFn(rootpath, rootStat, err)
	if err != nil {
		return err
	}
	return e.walk(rootpath, walkFn)
}

func (e WebDAVFileSystem) Close() error {
	time.Sleep(500 * time.Millisecond)
	return nil
}

func (e WebDAVFileSystem) Heartbeat() error {
	_, err := e.c.ReadDir("/")
	return err
}

/*
	Helper Functions
*/

func (e WebDAVFileSystem) walk(thisPath string, walkFun filepath.WalkFunc) error {
	files, err := e.c.ReadDir(thisPath)
	if err != nil {
		return err
	}

	for _, file := range files {
		thisFileFullPath := filepath.ToSlash(filepath.Join(thisPath, file.Name()))
		if file.IsDir() {
			err = walkFun(thisFileFullPath, file, nil)
			if err != nil {
				return err
			}
			err = e.walk(thisFileFullPath, walkFun)
			if err != nil {
				return err
			}
		} else {
			err = walkFun(thisFileFullPath, file, nil)
			if err != nil {
				return err
			}
		}
	}
	return nil
}

func (e WebDAVFileSystem) globpath(currentPath string, pathSegments []string, depth int) ([]string, error) {
	const pathSeparatorsLimit = 1000
	if depth == pathSeparatorsLimit {
		return nil, errors.New("bad pattern")
	}

	// Check pattern is well-formed.
	if _, err := regexp.MatchString(wildCardToRegexp(strings.Join(pathSegments, "/")), ""); err != nil {
		return nil, err
	}

	if len(pathSegments) == 0 {
		//Reaching the bottom
		return []string{}, nil
	}

	thisSegment := pathSegments[0]
	if strings.Contains(thisSegment, "*") {
		//Search for matching
		matchPattern := currentPath + thisSegment
		files, err := e.c.ReadDir(currentPath)
		if err != nil {
			return []string{}, nil
		}

		//Check which file in the currentPath matches the wildcard
		matchedSubpaths := []string{}
		for _, file := range files {
			thisPath := currentPath + file.Name()
			match, _ := regexp.MatchString(wildCardToRegexp(matchPattern), thisPath)
			if match {
				if file.IsDir() {
					matchedSubpaths = append(matchedSubpaths, thisPath+"/")
				} else {
					matchedSubpaths = append(matchedSubpaths, thisPath)
				}

			}
		}

		if len(pathSegments[1:]) == 0 {
			return matchedSubpaths, nil
		}

		//For each of the subpaths, do a globpath
		matchingFilenames := []string{}
		for _, subpath := range matchedSubpaths {
			thisMatchedNames, _ := e.globpath(subpath, pathSegments[1:], depth+1)
			matchingFilenames = append(matchingFilenames, thisMatchedNames...)
		}
		return matchingFilenames, nil
	} else {
		//Check folder exists
		if e.FileExists(currentPath+thisSegment) && e.IsDir(currentPath+thisSegment) {
			return e.globpath(currentPath+thisSegment+"/", pathSegments[1:], depth+1)
		} else {
			//Not matching
			return []string{}, nil
		}
	}
}

func filterFilepath(rawpath string) string {
	rawpath = strings.TrimSpace(rawpath)
	if strings.HasPrefix(rawpath, "./") {
		return rawpath[1:]
	} else if rawpath == "." || rawpath == "" {
		return "/"
	}
	return rawpath
}

func wildCardToRegexp(pattern string) string {
	var result strings.Builder
	for i, literal := range strings.Split(pattern, "*") {
		// Replace * with .*
		if i > 0 {
			result.WriteString(".*")
		}

		// Quote any regular expression meta characters in the
		// literal text.
		result.WriteString(regexp.QuoteMeta(literal))
	}
	return result.String()
}
