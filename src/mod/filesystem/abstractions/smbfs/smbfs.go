package smbfs

import (
	"fmt"
	"io"
	"io/fs"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/hirochachacha/go-smb2"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
)

/*
	Server Message Block.go

	This is a file abstraction that mount SMB folders onto ArozOS as virtual drive

*/

type ServerMessageBlockFileSystemAbstraction struct {
	UUID       string
	Hierarchy  string
	root       string //Full smb root
	smbRoot    string //SMB Actual root, if the root is a path with multiple seperator, this will be the first item in the subpath
	fsaRoot    string //File System Abstraction root, can be a subfolder inside the SMB root
	ipaddr     string
	user       string
	pass       string
	conn       *net.Conn
	session    *smb2.Session
	share      *smb2.Share
	tickerChan chan bool
}

func NewServerMessageBlockFileSystemAbstraction(uuid string, hierarchy string, ipaddr string, rootShare string, username string, password string) (ServerMessageBlockFileSystemAbstraction, error) {
	logger.PrintAndLog("Smbfs", "[SMB-FS] Connecting to "+uuid+":/ ("+ipaddr+")", nil)
	//Patch the ip address if port not found
	if !strings.Contains(ipaddr, ":") {
		logger.PrintAndLog("Smbfs", "[SMB-FS] Port not set. Using default SMB port (:445)", nil)
		ipaddr = ipaddr + ":445" //Default port for SMB
	}
	logger.Debug("Smbfs", "[SMB-FS] "+uuid+":/ dialing "+ipaddr+" (share path "+rootShare+", user "+username+", hierarchy "+hierarchy+")")
	nd := net.Dialer{Timeout: 10 * time.Second}
	conn, err := nd.Dial("tcp", ipaddr)
	if err != nil {
		logger.PrintAndLog("Smbfs", fmt.Sprint("[SMB-FS] Unable to connect to remote: ", err.Error()), nil)
		return ServerMessageBlockFileSystemAbstraction{}, err
	}

	d := &smb2.Dialer{
		Initiator: &smb2.NTLMInitiator{
			User:     username,
			Password: password,
		},
	}

	logger.Debug("Smbfs", "[SMB-FS] "+uuid+":/ TCP connected to "+ipaddr+", starting SMB session")
	s, err := d.Dial(conn)
	if err != nil {
		logger.Debug("Smbfs", "[SMB-FS] "+uuid+":/ SMB session setup failed, the TCP connection to "+ipaddr+" is left open: "+err.Error())
		logger.PrintAndLog("Smbfs", fmt.Sprint("[SMB-FS] Unable to connect to remote: ", err.Error()), nil)
		return ServerMessageBlockFileSystemAbstraction{}, err
	}

	thisSmbRoot := rootShare
	thisFsaRoot := ""
	if strings.Contains(rootShare, "/") {
		pathChunks := strings.Split(rootShare, "/")
		thisSmbRoot = pathChunks[0]
		thisFsaRoot = strings.Join(pathChunks[1:], "/")
	}

	//Mound remote storage
	logger.Debug("Smbfs", "[SMB-FS] "+uuid+":/ mounting share "+thisSmbRoot+" (sub folder "+thisFsaRoot+")")
	fs, err := s.Mount(thisSmbRoot)
	if err != nil {
		logger.Debug("Smbfs", "[SMB-FS] "+uuid+":/ mounting share "+thisSmbRoot+" failed: "+err.Error())
		logger.PrintAndLog("Smbfs", fmt.Sprint("[SMB-FS] Unable to connect to remote: ", err.Error()), nil)
		return ServerMessageBlockFileSystemAbstraction{}, err
	}
	logger.PrintAndLog("Smbfs", "[SMB-FS] Mounted SMB Root Share: "+thisSmbRoot, nil)

	done := make(chan bool)
	fsAbstraction := ServerMessageBlockFileSystemAbstraction{
		UUID:       uuid,
		Hierarchy:  hierarchy,
		root:       rootShare,
		smbRoot:    thisSmbRoot,
		fsaRoot:    thisFsaRoot,
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
	filename = a.filterFilepath(filename)
	filename = toWinPath(filename)
	a.debugf("Chmod %q %v", filename, mode)
	return a.share.Chmod(filename, mode)
}
func (a ServerMessageBlockFileSystemAbstraction) Chown(filename string, uid int, gid int) error {
	return arozfs.ErrOperationNotSupported
}
func (a ServerMessageBlockFileSystemAbstraction) Chtimes(filename string, atime time.Time, mtime time.Time) error {
	filename = a.filterFilepath(filename)
	filename = toWinPath(filename)
	a.debugf("Chtimes %q", filename)
	return a.share.Chtimes(filename, atime, mtime)
}
func (a ServerMessageBlockFileSystemAbstraction) Create(filename string) (arozfs.File, error) {
	filename = a.filterFilepath(filename)
	a.debugf("Create %q", filename)
	f, err := a.share.Create(filename)
	if err != nil {
		a.debugf("Create %q failed: %v", filename, err)
		return nil, err
	}
	af := NewSmbFsFile(f)
	return af, nil
}
func (a ServerMessageBlockFileSystemAbstraction) Mkdir(filename string, mode os.FileMode) error {
	filename = a.filterFilepath(filename)
	filename = toWinPath(filename)
	a.debugf("Mkdir %q", filename)
	return a.share.Mkdir(filename, mode)
}
func (a ServerMessageBlockFileSystemAbstraction) MkdirAll(filename string, mode os.FileMode) error {
	filename = a.filterFilepath(filename)
	filename = toWinPath(filename)
	a.debugf("MkdirAll %q", filename)
	return a.share.MkdirAll(filename, mode)
}
func (a ServerMessageBlockFileSystemAbstraction) Name() string {
	return ""
}
func (a ServerMessageBlockFileSystemAbstraction) Open(filename string) (arozfs.File, error) {
	filename = toWinPath(a.filterFilepath(filename))
	a.debugf("Open %q", filename)
	f, err := a.share.Open(filename)
	if err != nil {
		a.debugf("Open %q failed: %v", filename, err)
		return nil, err
	}
	af := NewSmbFsFile(f)
	return af, nil
}
func (a ServerMessageBlockFileSystemAbstraction) OpenFile(filename string, flag int, perm os.FileMode) (arozfs.File, error) {
	filename = toWinPath(a.filterFilepath(filename))
	a.debugf("OpenFile %q flag=%#x perm=%v", filename, flag, perm)
	f, err := a.share.OpenFile(filename, flag, perm)
	if err != nil {
		a.debugf("OpenFile %q failed: %v", filename, err)
		return nil, err
	}
	af := NewSmbFsFile(f)
	return af, nil
}
func (a ServerMessageBlockFileSystemAbstraction) Remove(filename string) error {
	filename = a.filterFilepath(filename)
	filename = toWinPath(filename)
	a.debugf("Remove %q", filename)
	return a.share.Remove(filename)
}
func (a ServerMessageBlockFileSystemAbstraction) RemoveAll(filename string) error {
	filename = a.filterFilepath(filename)
	filename = toWinPath(filename)
	a.debugf("RemoveAll %q", filename)
	return a.share.RemoveAll(filename)
}
func (a ServerMessageBlockFileSystemAbstraction) Rename(oldname, newname string) error {
	oldname = toWinPath(a.filterFilepath(oldname))
	newname = toWinPath(a.filterFilepath(newname))
	a.debugf("Rename %q -> %q", oldname, newname)
	return a.share.Rename(oldname, newname)
}
func (a ServerMessageBlockFileSystemAbstraction) Stat(filename string) (os.FileInfo, error) {
	filename = toWinPath(a.filterFilepath(filename))
	a.debugf("Stat %q", filename)
	return a.share.Stat(filename)
}
func (a ServerMessageBlockFileSystemAbstraction) Close() error {
	defer logger.TracePanic("Smbfs", "closing the SMB connection of "+a.UUID+":/")
	logger.Debugf("Smbfs", "%s:/ closing share %q on %s (share set=%v session set=%v conn set=%v). Copies of this abstraction still in use keep the closed share", a.UUID, a.smbRoot, a.ipaddr, a.share != nil, a.session != nil, a.conn != nil)
	if a.share == nil || a.session == nil || a.conn == nil {
		logger.Debugf("Smbfs", "%s:/ was never connected; closing it panics with a nil pointer dereference", a.UUID)
	}
	//Stop connection checker
	go func() {
		a.tickerChan <- true
	}()

	//Unmount the smb folder
	time.Sleep(300 * time.Millisecond)
	umountErr := a.share.Umount()
	time.Sleep(300 * time.Millisecond)
	logoffErr := a.session.Logoff()
	time.Sleep(300 * time.Millisecond)
	conn := *(a.conn)
	closeErr := conn.Close()
	time.Sleep(500 * time.Millisecond)
	logger.Debugf("Smbfs", "%s:/ closed: umount %v, logoff %v, conn close %v", a.UUID, umountErr, logoffErr, closeErr)
	return nil
}

/*
	Abstraction Utilities
*/

func (a ServerMessageBlockFileSystemAbstraction) VirtualPathToRealPath(subpath string, username string) (string, error) {
	//The generic translator refuses subpaths that climb out of the share
	//root or the user's home ("user:../bob")
	rpath, err := arozfs.GenericVirtualPathToRealPathTranslator(a.UUID, a.Hierarchy, subpath, username)
	if err != nil {
		a.debugf("VirtualPathToRealPath %q for %s refused: %v", subpath, username, err)
		return "", err
	}
	realpath := toWinPath(filepath.ToSlash(filepath.Clean(filepath.Join(a.fsaRoot, rpath))))
	a.debugf("VirtualPathToRealPath %q for %s -> %q", subpath, username, realpath)
	return realpath, nil
}

func (a ServerMessageBlockFileSystemAbstraction) RealPathToVirtualPath(fullpath string, username string) (string, error) {
	fullpath = a.filterFilepath(fullpath)
	if a.fsaRoot != "" {
		fullpath = strings.TrimPrefix(fullpath, a.fsaRoot)
		//if there is an excess / prefix
		fullpath = strings.TrimPrefix(fullpath, "/")
	}
	fullpath = strings.TrimPrefix(fullpath, "\\")
	vpath := a.UUID + ":/" + strings.ReplaceAll(fullpath, "\\", "/")
	return vpath, nil
}

func (a ServerMessageBlockFileSystemAbstraction) FileExists(realpath string) bool {
	realpath = toWinPath(a.filterFilepath(realpath))
	a.debugf("FileExists %q", realpath)
	f, err := a.share.Open(realpath)
	if err != nil {
		return false
	}
	f.Close()
	return true
}

func (a ServerMessageBlockFileSystemAbstraction) IsDir(realpath string) bool {
	realpath = a.filterFilepath(realpath)
	realpath = toWinPath(realpath)
	a.debugf("IsDir %q", realpath)
	stx, err := a.share.Stat(realpath)
	if err != nil {
		return false
	}
	return stx.IsDir()
}

func (a ServerMessageBlockFileSystemAbstraction) Glob(realpathWildcard string) ([]string, error) {
	realpathWildcard = strings.ReplaceAll(realpathWildcard, "[", "?")
	realpathWildcard = strings.ReplaceAll(realpathWildcard, "]", "?")
	a.debugf("Glob %q", realpathWildcard)
	matches, err := a.share.Glob(realpathWildcard)
	if err != nil {
		return []string{}, err
	}
	return matches, nil
}

func (a ServerMessageBlockFileSystemAbstraction) GetFileSize(realpath string) int64 {
	realpath = toWinPath(a.filterFilepath(realpath))
	a.debugf("GetFileSize %q", realpath)
	stat, err := a.share.Stat(realpath)
	if err != nil {
		return 0
	}
	return stat.Size()
}

func (a ServerMessageBlockFileSystemAbstraction) GetModTime(realpath string) (int64, error) {
	realpath = toWinPath(a.filterFilepath(realpath))
	a.debugf("GetModTime %q", realpath)
	stat, err := a.share.Stat(realpath)
	if err != nil {
		return 0, nil
	}
	return stat.ModTime().Unix(), nil
}

func (a ServerMessageBlockFileSystemAbstraction) WriteFile(filename string, content []byte, mode os.FileMode) error {
	filename = toWinPath(a.filterFilepath(filename))
	a.debugf("WriteFile %q (%d bytes)", filename, len(content))
	return a.share.WriteFile(filename, content, mode)
}
func (a ServerMessageBlockFileSystemAbstraction) ReadFile(filename string) ([]byte, error) {
	filename = toWinPath(a.filterFilepath(filename))
	a.debugf("ReadFile %q", filename)
	return a.share.ReadFile(filename)
}

func (a ServerMessageBlockFileSystemAbstraction) ReadDir(filename string) ([]fs.DirEntry, error) {
	filename = toWinPath(a.filterFilepath(filename))
	a.debugf("ReadDir %q", filename)
	fis, err := a.share.ReadDir(filename)
	if err != nil {
		a.debugf("ReadDir %q failed: %v", filename, err)
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
	filename = toWinPath(a.filterFilepath(filename))
	a.debugf("WriteStream %q: opening for write", filename)
	f, err := a.share.OpenFile(filename, os.O_CREATE|os.O_WRONLY, mode)
	if err != nil {
		a.debugf("WriteStream %q: open failed: %v", filename, err)
		return err
	}

	p := make([]byte, 32768)
	for {
		_, err := stream.Read(p)
		if err != nil {
			if err == io.EOF {
				break
			} else {
				a.debugf("WriteStream %q: reading the source failed: %v", filename, err)
				return err
			}
		}
		_, err = f.Write(p)
		if err != nil {
			a.debugf("WriteStream %q: write failed: %v", filename, err)
			return err
		}
	}

	a.debugf("WriteStream %q: done", filename)
	return nil
}
func (a ServerMessageBlockFileSystemAbstraction) ReadStream(filename string) (io.ReadCloser, error) {
	filename = toWinPath(a.filterFilepath(filename))
	a.debugf("ReadStream %q", filename)
	f, err := a.share.OpenFile(filename, os.O_RDONLY, 0755)
	if err != nil {
		a.debugf("ReadStream %q failed: %v", filename, err)
		return nil, err
	}
	return f, nil
}

// Note that walk on SMB is super slow. Avoid using this if possible.
func (a ServerMessageBlockFileSystemAbstraction) Walk(root string, walkFn filepath.WalkFunc) error {
	root = toWinPath(a.filterFilepath(root))
	a.debugf("Walk %q", root)
	err := fs.WalkDir(a.share.DirFS(root), ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			a.debugf("Walk %q: error at %q, stopping: %v", root, path, err)
			return err
		}
		statInfo, err := d.Info()
		if err != nil {
			return err
		}
		//Hand the callback result back, so a walk can be stopped or a folder skipped
		return walkFn(filepath.ToSlash(filepath.Join(root, path)), statInfo, err)
	})
	return err
}

func (a ServerMessageBlockFileSystemAbstraction) Heartbeat() error {
	a.debugf("Heartbeat")
	_, err := a.share.Stat("")
	if err != nil {
		a.debugf("Heartbeat failed: %v", err)
	}
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

// debugf writes a DEBUG record about an operation on this drive (-debug flag).
// It says so when the drive holds no mounted share, because any call on the
// share would then panic with a nil pointer.
func (a ServerMessageBlockFileSystemAbstraction) debugf(format string, args ...interface{}) {
	if !logger.DebugEnabled() {
		return
	}
	state := ""
	if a.share == nil {
		state = " [share is nil: the drive is not connected, this call will panic]"
	}
	logger.DebugDepth(1, "Smbfs", "[SMB-FS] "+a.UUID+":/ ("+a.ipaddr+"/"+a.smbRoot+") "+fmt.Sprintf(format, args...)+state)
}

func toWinPath(filename string) string {
	backslashed := strings.ReplaceAll(filename, "/", "\\")
	return strings.TrimPrefix(backslashed, "\\")
}

func (a ServerMessageBlockFileSystemAbstraction) filterFilepath(rawpath string) string {
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
