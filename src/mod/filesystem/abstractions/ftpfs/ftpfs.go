package ftpfs

import (
	"bytes"
	"io"
	"io/fs"
	"io/ioutil"
	"log"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/jlaffaye/ftp"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

/*
	FTPFS.go

	FTP Server as File System Abstraction

*/

type FTPFSAbstraction struct {
	uuid      string
	hierarchy string
	hostname  string
	username  string
	password  string
	//conn      *ftp.ServerConn
	//closer    chan bool
}

func NewFTPFSAbstraction(uuid string, hierarchy string, hostname string, username string, password string) (FTPFSAbstraction, error) {

	//Create a ticker to prevent connection close
	/*
		ticker := time.NewTicker(180 * time.Second)
		done := make(chan bool)

		go func() {
			for {
				select {
				case <-done:
					return
				case <-ticker.C:
					c.NoOp()
				}
			}
		}()
	*/
	log.Println("[FTP FS] " + hostname + " mounted via FTP-FS")
	return FTPFSAbstraction{
		uuid:      uuid,
		hierarchy: hierarchy,
		hostname:  hostname,
		username:  username,
		password:  password,
	}, nil
}

func (l FTPFSAbstraction) makeConn() (*ftp.ServerConn, error) {
	username := l.username
	password := l.password

	retryCount := 0
	var lastError error = nil
	succ := false
	var c *ftp.ServerConn
	for retryCount < 5 && !succ {
		c, lastError = ftp.Dial(l.hostname, ftp.DialWithTimeout(3*time.Second))
		if lastError != nil {
			//Connection failed. Delay and retry
			retryCount++
			r := rand.Intn(500)
			time.Sleep(time.Duration(r) * time.Microsecond)
			continue
		}

		//Connection established.
		succ = true
		lastError = nil
	}

	if !succ && lastError != nil {
		log.Println("[FTPFS] Unable to dial TCP: " + lastError.Error())
		return nil, lastError
	}

	if username == "" && password == "" {
		username = "anonymouss"
		password = "anonymous"
	}

	//Login to the FTP account
	err := c.Login(username, password)
	if err != nil {
		return nil, err
	}

	return c, nil
}

func (l FTPFSAbstraction) Chmod(filename string, mode os.FileMode) error {
	return arozfs.ErrOperationNotSupported
}
func (l FTPFSAbstraction) Chown(filename string, uid int, gid int) error {
	return arozfs.ErrOperationNotSupported
}
func (l FTPFSAbstraction) Chtimes(filename string, atime time.Time, mtime time.Time) error {
	return arozfs.ErrOperationNotSupported
}
func (l FTPFSAbstraction) Create(filename string) (arozfs.File, error) {
	return nil, arozfs.ErrOperationNotSupported
}
func (l FTPFSAbstraction) Mkdir(filename string, mode os.FileMode) error {
	c, err := l.makeConn()
	if err != nil {
		return err
	}

	defer c.Quit()

	err = c.MakeDir(filename)
	if err != nil {
		return err
	}

	return nil
}
func (l FTPFSAbstraction) MkdirAll(filename string, mode os.FileMode) error {
	return l.Mkdir(filename, mode)
}
func (l FTPFSAbstraction) Name() string {
	return ""
}
func (l FTPFSAbstraction) Open(filename string) (arozfs.File, error) {
	return nil, arozfs.ErrOperationNotSupported
}
func (l FTPFSAbstraction) OpenFile(filename string, flag int, perm os.FileMode) (arozfs.File, error) {
	return nil, arozfs.ErrOperationNotSupported
}
func (l FTPFSAbstraction) Remove(filename string) error {
	filename = filterFilepath(filename)
	c, err := l.makeConn()
	if err != nil {
		return err
	}
	defer c.Quit()

	err = c.Delete(filename)
	if err != nil {
		return err
	}

	return nil
}
func (l FTPFSAbstraction) RemoveAll(path string) error {
	path = filterFilepath(path)
	return l.Remove(path)
}
func (l FTPFSAbstraction) Rename(oldname, newname string) error {
	oldname = filterFilepath(oldname)
	newname = filterFilepath(newname)
	c, err := l.makeConn()
	if err != nil {
		return err
	}
	defer c.Quit()
	err = c.Rename(oldname, newname)
	if err != nil {
		return err
	}

	return nil
}
func (l FTPFSAbstraction) Stat(filename string) (os.FileInfo, error) {
	return nil, arozfs.ErrNullOperation
}
func (l FTPFSAbstraction) Close() error {
	return nil
}

/*
	Abstraction Utilities
*/

func (l FTPFSAbstraction) VirtualPathToRealPath(subpath string, username string) (string, error) {
	return arozfs.GenericVirtualPathToRealPathTranslator(l.uuid, l.hierarchy, subpath, username)
}

func (l FTPFSAbstraction) RealPathToVirtualPath(fullpath string, username string) (string, error) {
	return arozfs.GenericRealPathToVirtualPathTranslator(l.uuid, l.hierarchy, fullpath, username)
}

func (l FTPFSAbstraction) FileExists(realpath string) bool {
	realpath = filterFilepath(realpath)
	c, err := l.makeConn()
	if err != nil {
		return false
	}
	_, err = c.GetEntry(realpath)
	c.Quit()
	return err == nil
}

func (l FTPFSAbstraction) IsDir(realpath string) bool {
	realpath = filterFilepath(realpath)
	c, err := l.makeConn()
	if err != nil {
		return false
	}
	defer c.Quit()
	entry, err := c.GetEntry(realpath)
	if err != nil {
		return false
	}

	return entry.Type == ftp.EntryTypeFolder
}

func (l FTPFSAbstraction) Glob(realpathWildcard string) ([]string, error) {
	return []string{}, arozfs.ErrOperationNotSupported
}

func (l FTPFSAbstraction) GetFileSize(realpath string) int64 {
	realpath = filterFilepath(realpath)
	c, err := l.makeConn()
	if err != nil {
		return 0
	}
	entry, err := c.GetEntry(realpath)
	if err != nil {
		return 0
	}
	return int64(entry.Size)
}

func (l FTPFSAbstraction) GetModTime(realpath string) (int64, error) {
	realpath = filterFilepath(realpath)
	c, err := l.makeConn()
	if err != nil {
		return 0, err
	}
	defer c.Quit()
	entry, err := c.GetEntry(realpath)
	if err != nil {
		return 0, err
	}

	return entry.Time.Unix(), nil
}

func (l FTPFSAbstraction) WriteFile(filename string, content []byte, mode os.FileMode) error {
	filename = filterFilepath(filename)
	c, err := l.makeConn()
	if err != nil {
		return err
	}
	defer c.Quit()
	reader := bytes.NewReader(content)
	return c.Stor(filename, reader)
}

func (l FTPFSAbstraction) ReadFile(filename string) ([]byte, error) {
	filename = filterFilepath(filename)
	c, err := l.makeConn()
	if err != nil {
		return []byte{}, err
	}
	defer c.Quit()

	r, err := c.Retr(filename)
	if err != nil {
		return []byte{}, err
	}
	defer r.Close()

	return ioutil.ReadAll(r)
}
func (l FTPFSAbstraction) ReadDir(filename string) ([]fs.DirEntry, error) {
	results := []fs.DirEntry{}
	filename = filterFilepath(filename)
	c, err := l.makeConn()
	if err != nil {
		return []fs.DirEntry{}, err
	}
	defer c.Quit()
	entries, err := c.List(filename)
	if err != nil {

		return results, err
	}

	for _, entry := range entries {
		entryFilename := arozfs.ToSlash(filepath.Join(filename, entry.Name))
		//fmt.Println(entryFilename)
		thisDirEntry := newDirEntryFromFTPEntry(entry, c, entryFilename)
		results = append(results, thisDirEntry)
	}
	return results, nil
}
func (l FTPFSAbstraction) WriteStream(filename string, stream io.Reader, mode os.FileMode) error {
	filename = filterFilepath(filename)
	c, err := l.makeConn()
	if err != nil {
		return err
	}
	defer c.Quit()
	return c.Stor(filename, stream)
}
func (l FTPFSAbstraction) ReadStream(filename string) (io.ReadCloser, error) {
	filename = filterFilepath(filename)
	c, err := l.makeConn()
	if err != nil {
		return nil, err
	}
	defer c.Quit()

	retryCount := 0
	succ := false
	var lastErr error
	for retryCount < 5 && !succ {
		resp, err := c.Retr(filename)
		if err != nil {
			lastErr = err
			retryCount++
			r := rand.Intn(500)
			time.Sleep(time.Duration(r) * time.Microsecond)
			continue
		} else {
			succ = true
			return resp, nil
		}
	}

	return nil, lastErr
}

func (l FTPFSAbstraction) Walk(root string, walkFn filepath.WalkFunc) error {
	root = filterFilepath(root)
	log.Println("[FTP FS] Walking a root on FTP is extremely slow. Please consider rewritting this function. Scanning: " + root)
	c, err := l.makeConn()
	if err != nil {
		return err
	}
	defer c.Quit()
	rootStat, err := c.GetEntry(root)
	rootStatInfo := NewFileInfoFromEntry(rootStat, c, root)
	err = walkFn(root, rootStatInfo, err)
	if err != nil {
		return err
	}
	return l.walk(root, walkFn)
}

func (l FTPFSAbstraction) Heartbeat() error {
	return nil
}

//Utilities
func filterFilepath(rawpath string) string {
	rawpath = arozfs.ToSlash(filepath.Clean(strings.TrimSpace(rawpath)))
	if strings.HasPrefix(rawpath, "./") {
		return rawpath[1:]
	} else if rawpath == "." || rawpath == "" {
		return "/"
	}
	return rawpath
}

func (l FTPFSAbstraction) walk(thisPath string, walkFun filepath.WalkFunc) error {
	files, err := l.ReadDir(thisPath)
	if err != nil {
		return err
	}

	for _, file := range files {
		thisFileFullPath := filepath.ToSlash(filepath.Join(thisPath, file.Name()))
		finfo, _ := file.Info()
		if file.IsDir() {
			err = walkFun(thisFileFullPath, finfo, nil)
			if err != nil {
				return err
			}
			err = l.walk(thisFileFullPath, walkFun)
			if err != nil {
				return err
			}
		} else {
			err = walkFun(thisFileFullPath, finfo, nil)
			if err != nil {
				return err
			}
		}
	}
	return nil
}
