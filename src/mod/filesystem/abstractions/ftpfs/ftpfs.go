package ftpfs

import (
	"bytes"
	"fmt"
	"io"
	"io/fs"
	"io/ioutil"
	"log"
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
	conn      *ftp.ServerConn
	closer    chan bool
}

func NewFTPFSAbstraction(uuid string, hierarchy string, hostname string, username string, password string) (FTPFSAbstraction, error) {
	c, err := ftp.Dial(hostname, ftp.DialWithTimeout(5*time.Second))
	if err != nil {
		log.Println("[FTPFS] Unable to dial TCP: " + err.Error())
		return FTPFSAbstraction{}, err
	}

	if username == "" && password == "" {
		username = "anonymouss"
		password = "anonymous"
	}

	//Login to the FTP account
	err = c.Login(username, password)
	if err != nil {
		return FTPFSAbstraction{}, err
	}

	//Create a ticker to prevent connection close
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

	return FTPFSAbstraction{
		uuid:      uuid,
		hierarchy: hierarchy,
		conn:      c,
		closer:    done,
	}, nil
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
	return l.conn.MakeDir(filename)
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
	return l.conn.Delete(filename)
}
func (l FTPFSAbstraction) RemoveAll(path string) error {
	path = filterFilepath(path)
	return l.conn.Delete(path)
}
func (l FTPFSAbstraction) Rename(oldname, newname string) error {
	oldname = filterFilepath(oldname)
	newname = filterFilepath(newname)
	return l.conn.Rename(oldname, newname)
}
func (l FTPFSAbstraction) Stat(filename string) (os.FileInfo, error) {
	return nil, arozfs.ErrNullOperation
}
func (l FTPFSAbstraction) Close() error {
	return l.conn.Quit()
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
	_, err := l.conn.GetEntry(realpath)
	return err == nil
}

func (l FTPFSAbstraction) IsDir(realpath string) bool {
	realpath = filterFilepath(realpath)
	entry, err := l.conn.GetEntry(realpath)
	if err != nil {
		return false
	}

	return entry.Type == ftp.EntryTypeFolder
}

func (l FTPFSAbstraction) Glob(realpathWildcard string) ([]string, error) {
	return []string{}, arozfs.ErrNullOperation
}

func (l FTPFSAbstraction) GetFileSize(realpath string) int64 {
	realpath = filterFilepath(realpath)
	entry, err := l.conn.GetEntry(realpath)
	if err != nil {
		return 0
	}
	return int64(entry.Size)
}

func (l FTPFSAbstraction) GetModTime(realpath string) (int64, error) {
	realpath = filterFilepath(realpath)
	entry, err := l.conn.GetEntry(realpath)
	if err != nil {
		return 0, err
	}

	return entry.Time.Unix(), nil
}

func (l FTPFSAbstraction) WriteFile(filename string, content []byte, mode os.FileMode) error {
	filename = filterFilepath(filename)
	reader := bytes.NewReader(content)
	return l.conn.Stor(filename, reader)
}

func (l FTPFSAbstraction) ReadFile(filename string) ([]byte, error) {
	filename = filterFilepath(filename)
	r, err := l.conn.Retr(filename)
	if err != nil {
		panic(err)
	}
	defer r.Close()

	return ioutil.ReadAll(r)
}
func (l FTPFSAbstraction) ReadDir(filename string) ([]fs.DirEntry, error) {
	results := []fs.DirEntry{}
	filename = filterFilepath(filename)
	entries, err := l.conn.List(filename)
	if err != nil {

		return results, err
	}

	for _, entry := range entries {
		entryFilename := arozfs.ToSlash(filepath.Join(filename, entry.Name))
		fmt.Println(entryFilename)
		thisDirEntry := newDirEntryFromFTPEntry(entry, l.conn, entryFilename)
		results = append(results, thisDirEntry)
	}
	return results, nil
}
func (l FTPFSAbstraction) WriteStream(filename string, stream io.Reader, mode os.FileMode) error {
	filename = filterFilepath(filename)
	return l.conn.Stor(filename, stream)
}
func (l FTPFSAbstraction) ReadStream(filename string) (io.ReadCloser, error) {
	filename = filterFilepath(filename)
	return l.conn.Retr(filename)
}

func (l FTPFSAbstraction) Walk(root string, walkFn filepath.WalkFunc) error {
	return arozfs.ErrOperationNotSupported
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
