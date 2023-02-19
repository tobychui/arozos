package smbfs

import (
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/hirochachacha/go-smb2"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

/*
	Server Message Block.go

	This is a file abstraction that mount SMB folders onto ArozOS as virtual drive

*/

type ServerMessageBlockFileSystemAbstraction struct {
	UUID       string
	Hierarchy  string
	root       string
	ipaddr     string
	user       string
	pass       string
	conn       *net.Conn
	session    *smb2.Session
	share      *smb2.Share
	tickerChan chan bool
}

func NewServerMessageBlockFileSystemAbstraction(uuid string, hierarchy string, ipaddr string, rootShare string, username string, password string) (ServerMessageBlockFileSystemAbstraction, error) {
	log.Println("[SMB-FS] Connecting to " + uuid + ":/ (" + ipaddr + ")")
	//Patch the ip address if port not found
	if !strings.Contains(ipaddr, ":") {
		log.Println("[SMB-FS] Port not set. Using default SMB port (:445)")
		ipaddr = ipaddr + ":445" //Default port for SMB
	}
	nd := net.Dialer{Timeout: 10 * time.Second}
	conn, err := nd.Dial("tcp", ipaddr)
	if err != nil {
		log.Println("[SMB-FS] Unable to connect to remote: ", err.Error())
		return ServerMessageBlockFileSystemAbstraction{}, err
	}

	d := &smb2.Dialer{
		Initiator: &smb2.NTLMInitiator{
			User:     username,
			Password: password,
		},
	}

	s, err := d.Dial(conn)
	if err != nil {
		log.Println("[SMB-FS] Unable to connect to remote: ", err.Error())
		return ServerMessageBlockFileSystemAbstraction{}, err
	}

	//Mound remote storage
	fs, err := s.Mount(rootShare)
	if err != nil {
		log.Println("[SMB-FS] Unable to connect to remote: ", err.Error())
		return ServerMessageBlockFileSystemAbstraction{}, err
	}

	done := make(chan bool)
	fsAbstraction := ServerMessageBlockFileSystemAbstraction{
		UUID:       uuid,
		Hierarchy:  hierarchy,
		root:       rootShare,
		ipaddr:     ipaddr,
		user:       username,
		pass:       password,
		conn:       &conn,
		session:    s,
		share:      fs,
		tickerChan: done,
	}

	return fsAbstraction, nil
}

func (a ServerMessageBlockFileSystemAbstraction) Chmod(filename string, mode os.FileMode) error {
	filename = filterFilepath(filename)
	filename = toWinPath(filename)
	return a.share.Chmod(filename, mode)
}
func (a ServerMessageBlockFileSystemAbstraction) Chown(filename string, uid int, gid int) error {
	return arozfs.ErrOperationNotSupported
}
func (a ServerMessageBlockFileSystemAbstraction) Chtimes(filename string, atime time.Time, mtime time.Time) error {
	filename = filterFilepath(filename)
	filename = toWinPath(filename)
	return a.share.Chtimes(filename, atime, mtime)
}
func (a ServerMessageBlockFileSystemAbstraction) Create(filename string) (arozfs.File, error) {
	filename = filterFilepath(filename)
	f, err := a.share.Create(filename)
	if err != nil {
		return nil, err
	}
	af := NewSmbFsFile(f)
	return af, nil
}
func (a ServerMessageBlockFileSystemAbstraction) Mkdir(filename string, mode os.FileMode) error {
	filename = filterFilepath(filename)
	filename = toWinPath(filename)
	return a.share.Mkdir(filename, mode)
}
func (a ServerMessageBlockFileSystemAbstraction) MkdirAll(filename string, mode os.FileMode) error {
	filename = filterFilepath(filename)
	filename = toWinPath(filename)
	return a.share.MkdirAll(filename, mode)
}
func (a ServerMessageBlockFileSystemAbstraction) Name() string {
	return ""
}
func (a ServerMessageBlockFileSystemAbstraction) Open(filename string) (arozfs.File, error) {
	filename = toWinPath(filterFilepath(filename))
	f, err := a.share.Open(filename)
	if err != nil {
		return nil, err
	}
	af := NewSmbFsFile(f)
	return af, nil
}
func (a ServerMessageBlockFileSystemAbstraction) OpenFile(filename string, flag int, perm os.FileMode) (arozfs.File, error) {
	filename = toWinPath(filterFilepath(filename))
	f, err := a.share.OpenFile(filename, flag, perm)
	if err != nil {
		return nil, err
	}
	af := NewSmbFsFile(f)
	return af, nil
}
func (a ServerMessageBlockFileSystemAbstraction) Remove(filename string) error {
	filename = filterFilepath(filename)
	filename = toWinPath(filename)
	return a.share.Remove(filename)
}
func (a ServerMessageBlockFileSystemAbstraction) RemoveAll(filename string) error {
	filename = filterFilepath(filename)
	filename = toWinPath(filename)
	return a.share.RemoveAll(filename)
}
func (a ServerMessageBlockFileSystemAbstraction) Rename(oldname, newname string) error {
	oldname = toWinPath(filterFilepath(oldname))
	newname = toWinPath(filterFilepath(newname))
	return a.share.Rename(oldname, newname)
}
func (a ServerMessageBlockFileSystemAbstraction) Stat(filename string) (os.FileInfo, error) {
	filename = toWinPath(filterFilepath(filename))
	return a.share.Stat(filename)
}
func (a ServerMessageBlockFileSystemAbstraction) Close() error {
	//Stop connection checker
	go func() {
		a.tickerChan <- true
	}()

	//Unmount the smb folder
	time.Sleep(300 * time.Millisecond)
	a.share.Umount()
	time.Sleep(300 * time.Millisecond)
	a.session.Logoff()
	time.Sleep(300 * time.Millisecond)
	conn := *(a.conn)
	conn.Close()
	time.Sleep(500 * time.Millisecond)
	return nil
}

/*
	Abstraction Utilities
*/

func (a ServerMessageBlockFileSystemAbstraction) VirtualPathToRealPath(subpath string, username string) (string, error) {
	if strings.HasPrefix(subpath, a.UUID+":") {
		//This is full virtual path. Trim the uuid and correct the subpath
		subpath = strings.TrimPrefix(subpath, a.UUID+":")
	}
	subpath = filterFilepath(subpath)

	if a.Hierarchy == "user" {
		return toWinPath(filepath.ToSlash(filepath.Clean(filepath.Join("users", username, subpath)))), nil
	} else if a.Hierarchy == "public" {
		return toWinPath(filepath.ToSlash(filepath.Clean(subpath))), nil
	}

	return "", arozfs.ErrVpathResolveFailed
}

func (a ServerMessageBlockFileSystemAbstraction) RealPathToVirtualPath(fullpath string, username string) (string, error) {
	fullpath = filterFilepath(fullpath)
	fullpath = strings.TrimPrefix(fullpath, "\\")
	vpath := a.UUID + ":/" + strings.ReplaceAll(fullpath, "\\", "/")
	return vpath, nil
}

func (a ServerMessageBlockFileSystemAbstraction) FileExists(realpath string) bool {
	realpath = toWinPath(filterFilepath(realpath))
	f, err := a.share.Open(realpath)
	if err != nil {
		return false
	}
	f.Close()
	return true
}

func (a ServerMessageBlockFileSystemAbstraction) IsDir(realpath string) bool {
	realpath = filterFilepath(realpath)
	realpath = toWinPath(realpath)
	stx, err := a.share.Stat(realpath)
	if err != nil {
		return false
	}
	return stx.IsDir()
}

func (a ServerMessageBlockFileSystemAbstraction) Glob(realpathWildcard string) ([]string, error) {
	realpathWildcard = strings.ReplaceAll(realpathWildcard, "[", "?")
	realpathWildcard = strings.ReplaceAll(realpathWildcard, "]", "?")
	matches, err := a.share.Glob(realpathWildcard)
	if err != nil {
		return []string{}, err
	}
	return matches, nil
}

func (a ServerMessageBlockFileSystemAbstraction) GetFileSize(realpath string) int64 {
	realpath = toWinPath(filterFilepath(realpath))
	stat, err := a.share.Stat(realpath)
	if err != nil {
		return 0
	}
	return stat.Size()
}

func (a ServerMessageBlockFileSystemAbstraction) GetModTime(realpath string) (int64, error) {
	realpath = toWinPath(filterFilepath(realpath))
	stat, err := a.share.Stat(realpath)
	if err != nil {
		return 0, nil
	}
	return stat.ModTime().Unix(), nil
}

func (a ServerMessageBlockFileSystemAbstraction) WriteFile(filename string, content []byte, mode os.FileMode) error {
	filename = toWinPath(filterFilepath(filename))
	return a.share.WriteFile(filename, content, mode)
}
func (a ServerMessageBlockFileSystemAbstraction) ReadFile(filename string) ([]byte, error) {
	filename = toWinPath(filterFilepath(filename))
	return a.share.ReadFile(filename)
}

func (a ServerMessageBlockFileSystemAbstraction) ReadDir(filename string) ([]fs.DirEntry, error) {
	filename = toWinPath(filterFilepath(filename))
	fis, err := a.share.ReadDir(filename)
	if err != nil {
		return []fs.DirEntry{}, err
	}
	dirEntires := []fs.DirEntry{}
	for _, fi := range fis {
		if fi.Name() == "System Volume Information" || fi.Name() == "$RECYCLE.BIN" || fi.Name() == "$MFT" {
			//System folders. Hide it
			continue
		}
		dirEntires = append(dirEntires, newDirEntryFromFileInfo(fi))
	}
	return dirEntires, nil
}

func (a ServerMessageBlockFileSystemAbstraction) WriteStream(filename string, stream io.Reader, mode os.FileMode) error {
	filename = toWinPath(filterFilepath(filename))
	f, err := a.share.OpenFile(filename, os.O_CREATE|os.O_WRONLY, mode)
	if err != nil {
		return err
	}

	p := make([]byte, 32768)
	for {
		_, err := stream.Read(p)
		if err != nil {
			if err == io.EOF {
				break
			} else {
				return err
			}
		}
		_, err = f.Write(p)
		if err != nil {
			return err
		}
	}

	return nil
}
func (a ServerMessageBlockFileSystemAbstraction) ReadStream(filename string) (io.ReadCloser, error) {
	filename = toWinPath(filterFilepath(filename))
	f, err := a.share.OpenFile(filename, os.O_RDONLY, 0755)
	if err != nil {
		return nil, err
	}
	return f, nil
}

//Note that walk on SMB is super slow. Avoid using this if possible.
func (a ServerMessageBlockFileSystemAbstraction) Walk(root string, walkFn filepath.WalkFunc) error {
	root = toWinPath(filterFilepath(root))
	err := fs.WalkDir(a.share.DirFS(root), ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		statInfo, err := d.Info()
		if err != nil {
			return err
		}
		walkFn(filepath.ToSlash(filepath.Join(root, path)), statInfo, err)
		return nil
	})
	return err
}

func (a ServerMessageBlockFileSystemAbstraction) Heartbeat() error {
	_, err := a.share.Stat("")
	return err
}

/*

	Optional Functions

*/

func (a *ServerMessageBlockFileSystemAbstraction) CapacityInfo() {
	fsinfo, err := a.share.Statfs(".")
	if err != nil {
		return
	}

	fmt.Println(fsinfo)
}

/*

	Helper Functions

*/

func toWinPath(filename string) string {
	backslashed := strings.ReplaceAll(filename, "/", "\\")
	return strings.TrimPrefix(backslashed, "\\")

}

func filterFilepath(rawpath string) string {
	rawpath = filepath.ToSlash(filepath.Clean(rawpath))
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
