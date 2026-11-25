package webdavfs

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/studio-b12/gowebdav"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
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
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "NewWebDAVMount: UUID=%.120q Hierarchy=%.120q root=%.120q user=%.120q", UUID, Hierarchy, root, user)
	}
	//Connect to webdav server
	c := gowebdav.NewClient(root, user, password)
	err := c.Connect()
	if err != nil {
		logger.PrintAndLog("Webdavfs", fmt.Sprint("[WebDAV FS] Unable to connect to remote: ", err.Error()), nil)
		return nil, err
	} else {
		logger.PrintAndLog("Webdavfs", "[WebDAV FS] Connected to remote: "+root, nil)
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
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/webdavfs", "WebDAVFileSystem.Chmod: filename=%.120q", filename)
	}
	return errors.New("filesystem type not supported")
}
func (e WebDAVFileSystem) Chown(filename string, uid int, gid int) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/webdavfs", "WebDAVFileSystem.Chown: filename=%.120q uid=%d gid=%d", filename, uid, gid)
	}
	return errors.New("filesystem type not supported")
}
func (e WebDAVFileSystem) Chtimes(filename string, atime time.Time, mtime time.Time) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/webdavfs", "WebDAVFileSystem.Chtimes: filename=%.120q", filename)
	}
	//WebDAV has no standard way to set a modification time
	return arozfs.ErrOperationNotSupported
}
func (e WebDAVFileSystem) Create(filename string) (arozfs.File, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/webdavfs", "WebDAVFileSystem.Create: filename=%.120q", filename)
	}
	return nil, errors.New("filesystem type not supported")
}
func (e WebDAVFileSystem) Mkdir(filename string, mode os.FileMode) error {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.Mkdir: filename=%.120q", filename)
	}
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	return e.c.Mkdir(filename, mode)
}
func (e WebDAVFileSystem) MkdirAll(filename string, mode os.FileMode) error {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.MkdirAll: filename=%.120q", filename)
	}
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	return e.c.MkdirAll(filename, mode)
}
func (e WebDAVFileSystem) Name() string {
	logger.DebugTrace("filesystem/abstractions/webdavfs", "WebDAVFileSystem.Name")
	return ""
}
func (e WebDAVFileSystem) Open(filename string) (arozfs.File, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/webdavfs", "WebDAVFileSystem.Open: filename=%.120q", filename)
	}
	return nil, errors.New("filesystem type not supported")
}
func (e WebDAVFileSystem) OpenFile(filename string, flag int, perm os.FileMode) (arozfs.File, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/webdavfs", "WebDAVFileSystem.OpenFile: filename=%.120q flag=%d", filename, flag)
	}
	//Buffer the target file to memory
	//To be implement: Wait for Golang's fs.File.Write function to be released
	//f := bufffs.New(filename)
	//return f, nil
	return nil, errors.New("filesystem type not supported")
}
func (e WebDAVFileSystem) Remove(filename string) error {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.Remove: filename=%.120q", filename)
	}
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	return classify(e.c.Remove(filename))
}
func (e WebDAVFileSystem) RemoveAll(filename string) error {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.RemoveAll: filename=%.120q", filename)
	}
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	return e.c.RemoveAll(filename)
}
func (e WebDAVFileSystem) Rename(oldname, newname string) error {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.Rename: oldname=%.120q newname=%.120q", oldname, newname)
	}
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
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.Stat: filename=%.120q", filename)
	}
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	info, err := e.c.Stat(filename)
	return info, classify(err)
}

// classify turns the HTTP status gowebdav reports into the error the rest of
// ArozOS checks for, so os.IsNotExist and errors.Is work on this drive.
func classify(err error) error {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "classify: err=%v", err)
	}
	pe, ok := err.(*os.PathError)
	if !ok {
		return err
	}
	se, ok := pe.Err.(gowebdav.StatusError)
	if !ok {
		return err
	}
	switch se.Status {
	case 404, 410:
		return &os.PathError{Op: pe.Op, Path: pe.Path, Err: fs.ErrNotExist}
	case 401, 403:
		return &os.PathError{Op: pe.Op, Path: pe.Path, Err: fs.ErrPermission}
	}
	return err
}

func (e WebDAVFileSystem) VirtualPathToRealPath(subpath string, username string) (string, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/webdavfs", "WebDAVFileSystem.VirtualPathToRealPath: subpath=%.120q username=%.120q", subpath, username)
	}
	//The generic translator refuses subpaths that climb out of the remote
	//root or the user's home ("user:../bob")
	return arozfs.GenericVirtualPathToRealPathTranslator(e.UUID, e.Hierarchy, subpath, username)
}
func (e WebDAVFileSystem) RealPathToVirtualPath(rpath string, username string) (string, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.RealPathToVirtualPath: rpath=%.120q username=%.120q", rpath, username)
	}
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
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.FileExists: filename=%.120q", filename)
	}
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	_, err := e.c.Stat(filename)
	if os.IsNotExist(err) || err != nil {
		return false
	}

	return true
}
func (e WebDAVFileSystem) IsDir(filename string) bool {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/webdavfs", "WebDAVFileSystem.IsDir: filename=%.120q", filename)
	}
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	s, err := e.c.Stat(filename)
	if err != nil {
		return false
	}
	return s.IsDir()
}

// Notes: This is not actual Glob function. This just emulate Glob using ReadDir with max depth 1 layer
func (e WebDAVFileSystem) Glob(wildcard string) ([]string, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.Glob: wildcard=%.120q", wildcard)
	}
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
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.GetFileSize: filename=%.120q", filename)
	}
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	s, err := e.Stat(filename)
	if err != nil {
		logger.PrintAndLog("Webdavfs", fmt.Sprint(err), nil)
		return 0
	}

	return s.Size()
}

func (e WebDAVFileSystem) GetModTime(filename string) (int64, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.GetModTime: filename=%.120q", filename)
	}
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	s, err := e.Stat(filename)
	if err != nil {
		return 0, err
	}

	return s.ModTime().Unix(), nil
}

func (e WebDAVFileSystem) WriteFile(filename string, content []byte, mode os.FileMode) error {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.WriteFile: filename=%.120q", filename)
	}
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	return e.c.Write(filename, content, mode)
}

func (e WebDAVFileSystem) ReadFile(filename string) ([]byte, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.ReadFile: filename=%.120q", filename)
	}
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	bytes, err := e.c.Read(filename)
	if err != nil {
		return []byte(""), classify(err)
	}
	return bytes, nil
}

func (e WebDAVFileSystem) ReadDir(filename string) ([]fs.DirEntry, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.ReadDir: filename=%.120q", filename)
	}
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	fis, err := e.c.ReadDir(filename)
	if err != nil {
		return []fs.DirEntry{}, classify(err)
	}

	dirEntires := []fs.DirEntry{}
	for _, fi := range fis {
		dirEntires = append(dirEntires, newDirEntryFromFileInfo(fi))
	}
	return dirEntires, nil
}
func (e WebDAVFileSystem) WriteStream(filename string, stream io.Reader, mode os.FileMode) error {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.WriteStream: filename=%.120q", filename)
	}
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	return e.c.WriteStream(filename, stream, mode)

}
func (e WebDAVFileSystem) ReadStream(filename string) (io.ReadCloser, error) {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "WebDAVFileSystem.ReadStream: filename=%.120q", filename)
	}
	filename = filterFilepath(filepath.ToSlash(filepath.Clean(filename)))
	rc, err := e.c.ReadStream(filename)
	return rc, classify(err)
}

func (e WebDAVFileSystem) Walk(rootpath string, walkFn filepath.WalkFunc) error {
	logger.Debug("filesystem/abstractions/webdavfs", "WebDAVFileSystem.Walk")
	rootpath = filepath.ToSlash(filepath.Clean(rootpath))
	rootStat, err := e.Stat(rootpath)
	err = walkFn(rootpath, rootStat, err)
	if err != nil {
		return err
	}
	return e.walk(rootpath, walkFn)
}

func (e WebDAVFileSystem) Close() error {
	logger.Debug("filesystem/abstractions/webdavfs", "WebDAVFileSystem.Close")
	time.Sleep(500 * time.Millisecond)
	return nil
}

func (e WebDAVFileSystem) Heartbeat() error {
	logger.Debug("filesystem/abstractions/webdavfs", "WebDAVFileSystem.Heartbeat")
	_, err := e.c.ReadDir("/")
	return err
}

/*
	Helper Functions
*/

func (e WebDAVFileSystem) walk(thisPath string, walkFun filepath.WalkFunc) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/webdavfs", "WebDAVFileSystem.walk: thisPath=%.120q", thisPath)
	}
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
	if logger.IsDebugTrace() {
		logger.DebugTracef("filesystem/abstractions/webdavfs", "WebDAVFileSystem.globpath: currentPath=%.120q len(pathSegments)=%d depth=%d", currentPath, len(pathSegments), depth)
	}
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
	logger.Debug("filesystem/abstractions/webdavfs", "filterFilepath")
	rawpath = strings.TrimSpace(rawpath)
	if strings.HasPrefix(rawpath, "./") {
		return rawpath[1:]
	} else if rawpath == "." || rawpath == "" {
		return "/"
	}
	return rawpath
}

func wildCardToRegexp(pattern string) string {
	if logger.IsDebug() {
		logger.Debugf("filesystem/abstractions/webdavfs", "wildCardToRegexp: pattern=%.120q", pattern)
	}
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
