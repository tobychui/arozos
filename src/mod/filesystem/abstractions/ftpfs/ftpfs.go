package ftpfs

import (
	"bytes"
	"errors"
	"io"
	"io/fs"
	"math/rand"
	"net/textproto"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/jlaffaye/ftp"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
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
	logger.PrintAndLog("Ftpfs", "[FTP FS] "+hostname+" mounted via FTP-FS", nil)
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
		logger.PrintAndLog("Ftpfs", "[FTPFS] Unable to dial TCP: "+lastError.Error(), nil)
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
		//Servers answer 550 for a folder that exists, as for most failures
		if _, statErr := l.statWith(c, filterFilepath(filename)); statErr == nil {
			return &fs.PathError{Op: "mkdir", Path: filename, Err: fs.ErrExist}
		}
		return err
	}

	return nil
}

// errNotDir is what MkdirAll meets where a file stands in the way.
var errNotDir = errors.New("not a directory")

// MkdirAll makes a folder and any missing parents. FTP has no such command,
// so each level is made in turn; a folder that is already there is fine, as
// with os.MkdirAll.
func (l FTPFSAbstraction) MkdirAll(filename string, mode os.FileMode) error {
	filename = filterFilepath(filename)
	c, err := l.makeConn()
	if err != nil {
		return err
	}
	defer c.Quit()
	return l.mkdirAllWith(c, filename)
}

func (l FTPFSAbstraction) mkdirAllWith(c *ftp.ServerConn, dir string) error {
	if dir == "/" || dir == "." || dir == "" {
		return nil
	}
	if info, err := l.statWith(c, dir); err == nil {
		if info.IsDir() {
			return nil
		}
		return &fs.PathError{Op: "mkdir", Path: dir, Err: errNotDir}
	}
	if err := l.mkdirAllWith(c, path.Dir(dir)); err != nil {
		return err
	}
	if err := c.MakeDir(dir); err != nil {
		//Made by someone else in the meantime
		if info, statErr := l.statWith(c, dir); statErr == nil && info.IsDir() {
			return nil
		}
		return err
	}
	return nil
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
		return l.classify(c, "remove", filename, err)
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

// Stat looks a file up with MLST, or in the listing of its folder when the
// server has no MLST.
func (l FTPFSAbstraction) Stat(filename string) (os.FileInfo, error) {
	filename = filterFilepath(filename)
	c, err := l.makeConn()
	if err != nil {
		return nil, err
	}
	defer c.Quit()
	return l.statWith(c, filename)
}

func (l FTPFSAbstraction) statWith(c *ftp.ServerConn, filename string) (os.FileInfo, error) {
	name := path.Base(filename)
	entry, err := c.GetEntry(filename)
	if err == nil {
		entry.Name = name
		return NewFileInfoFromEntry(entry, nil, filename), nil
	}
	if filename == "/" {
		return NewFileInfoFromEntry(&ftp.Entry{Name: "/", Type: ftp.EntryTypeFolder}, nil, filename), nil
	}
	//No MLST, or a 550 that may be a refusal as well as a missing file: the
	//listing of the folder decides
	entries, err := c.List(path.Dir(filename))
	if err != nil {
		if answered(err) && l.missing(c, path.Dir(filename)) {
			return nil, notExist("stat", filename)
		}
		return nil, err
	}
	for _, e := range entries {
		if e.Name == name {
			return NewFileInfoFromEntry(e, nil, filename), nil
		}
	}
	return nil, notExist("stat", filename)
}

// isUnavailable reports a 550. Servers answer it for a missing file, but
// also for a refused permission and most other failures.
func isUnavailable(err error) bool {
	var te *textproto.Error
	return errors.As(err, &te) && te.Code == ftp.StatusFileUnavailable
}

// answered reports an error the server replied with, as opposed to a lost
// connection, which says nothing about the path.
func answered(err error) bool {
	var te *textproto.Error
	return errors.As(err, &te)
}

func notExist(op, filename string) error {
	return &fs.PathError{Op: op, Path: filename, Err: fs.ErrNotExist}
}

// missing reports whether a path is confirmed absent: its folder lists
// without it, or the folder is missing itself.
func (l FTPFSAbstraction) missing(c *ftp.ServerConn, filename string) bool {
	filename = path.Clean(filename)
	if filename == "/" || filename == "." {
		return false
	}
	parent := path.Dir(filename)
	entries, err := c.List(parent)
	if err != nil {
		//Servers refuse to list a missing folder with 450 or 550, as they
		//refuse an unreadable one: the folder above decides
		return answered(err) && l.missing(c, parent)
	}
	name := path.Base(filename)
	for _, e := range entries {
		if e.Name == name {
			return false
		}
	}
	return true
}

// classify turns the refusal of a missing path into the error the rest of
// ArozOS checks for, so os.IsNotExist and errors.Is work on this drive. A
// refusal for a path that is there, such as a denied delete, stays as it was:
// taken for absence, it would make a failed delete look done.
func (l FTPFSAbstraction) classify(c *ftp.ServerConn, op, filename string, err error) error {
	if answered(err) && l.missing(c, filename) {
		return notExist(op, filename)
	}
	return err
}
func (l FTPFSAbstraction) Close() error {
	time.Sleep(500 * time.Millisecond)
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
	_, err := l.Stat(realpath)
	return err == nil
}

func (l FTPFSAbstraction) IsDir(realpath string) bool {
	info, err := l.Stat(realpath)
	return err == nil && info.IsDir()
}

func (l FTPFSAbstraction) Glob(realpathWildcard string) ([]string, error) {
	return []string{}, arozfs.ErrOperationNotSupported
}

func (l FTPFSAbstraction) GetFileSize(realpath string) int64 {
	info, err := l.Stat(realpath)
	if err != nil {
		return 0
	}
	return info.Size()
}

func (l FTPFSAbstraction) GetModTime(realpath string) (int64, error) {
	info, err := l.Stat(realpath)
	if err != nil {
		return 0, err
	}
	return info.ModTime().Unix(), nil
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
		return []byte{}, l.classify(c, "open", filename, err)
	}
	defer r.Close()

	return io.ReadAll(r)
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
		return results, l.classify(c, "readdir", filename, err)
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

	retryCount := 0
	var lastErr error
	for retryCount < 5 {
		resp, err := c.Retr(filename)
		if err != nil {
			lastErr = err
			if isUnavailable(err) {
				break
			}
			retryCount++
			r := rand.Intn(500)
			time.Sleep(time.Duration(r) * time.Microsecond)
			continue
		}
		//The connection must outlive the read: quitting first cuts the
		//transfer short
		return &retrStream{resp: resp, conn: c}, nil
	}
	err = l.classify(c, "open", filename, lastErr)
	c.Quit()
	return nil, err
}

// retrStream is a download that ends its connection when it is closed.
type retrStream struct {
	resp *ftp.Response
	conn *ftp.ServerConn
}

func (r *retrStream) Read(p []byte) (int, error) { return r.resp.Read(p) }

func (r *retrStream) Close() error {
	err := r.resp.Close()
	r.conn.Quit()
	return err
}

func (l FTPFSAbstraction) Walk(root string, walkFn filepath.WalkFunc) error {
	root = filterFilepath(root)
	logger.PrintAndLog("Ftpfs", "[FTP FS] Walking a root on FTP is extremely slow. Please consider rewritting this function. Scanning: "+root, nil)
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

// Utilities
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
