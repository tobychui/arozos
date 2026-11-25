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

func NewServerMessageBlockFileSystemAbstraction(uuid string, hierarchy string, ipaddr string, rootShare string, username string, password string) (out0 ServerMessageBlockFileSystemAbstraction, out1 error) {
	defer logger.Out2(logger.In6("filesystem/abstractions/smbfs", "NewServerMessageBlockFileSystemAbstraction", "uuid", uuid, "hierarchy", hierarchy, "ipaddr", ipaddr, "rootShare", rootShare, "username", username, "!password", password), &out0, &out1)
	logger.PrintAndLog("Smbfs", "[SMB-FS] Connecting to "+uuid+":/ ("+ipaddr+")", nil)
	//Patch the ip address if port not found
	if !strings.Contains(ipaddr, ":") {
		logger.PrintAndLog("Smbfs", "[SMB-FS] Port not set. Using default SMB port (:445)", nil)
		ipaddr = ipaddr + ":445" //Default port for SMB
	}
	nd := net.Dialer{Timeout: 10 * time.Second}
	conn, err := nd.Dial("tcp", ipaddr)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
		logger.PrintAndLog("Smbfs", fmt.Sprint("[SMB-FS] Unable to connect to remote: ", err.Error()), nil)
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
		logger.DebugErr("filesystem/abstractions/smbfs", err)
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
	fs, err := s.Mount(thisSmbRoot)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
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

func (a ServerMessageBlockFileSystemAbstraction) Chmod(filename string, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.Chmod", "&a", &a, "filename", filename, "&mode", &mode), &out0)
	filename = a.filterFilepath(filename)
	filename = toWinPath(filename)
	return a.share.Chmod(filename, mode)
}
func (a ServerMessageBlockFileSystemAbstraction) Chown(filename string, uid int, gid int) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.Chown", "&a", &a, "filename", filename, "uid", uid, "gid", gid), &out0)
	return arozfs.ErrOperationNotSupported
}
func (a ServerMessageBlockFileSystemAbstraction) Chtimes(filename string, atime time.Time, mtime time.Time) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.Chtimes", "&a", &a, "filename", filename, "&atime", &atime, "&mtime", &mtime), &out0)
	filename = a.filterFilepath(filename)
	filename = toWinPath(filename)
	return a.share.Chtimes(filename, atime, mtime)
}
func (a ServerMessageBlockFileSystemAbstraction) Create(filename string) (out0 arozfs.File, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.Create", "&a", &a, "filename", filename), &out0, &out1)
	filename = a.filterFilepath(filename)
	f, err := a.share.Create(filename)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
		return nil, err
	}
	af := NewSmbFsFile(f)
	return af, nil
}
func (a ServerMessageBlockFileSystemAbstraction) Mkdir(filename string, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.Mkdir", "&a", &a, "filename", filename, "&mode", &mode), &out0)
	filename = a.filterFilepath(filename)
	filename = toWinPath(filename)
	return a.share.Mkdir(filename, mode)
}
func (a ServerMessageBlockFileSystemAbstraction) MkdirAll(filename string, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.MkdirAll", "&a", &a, "filename", filename, "&mode", &mode), &out0)
	filename = a.filterFilepath(filename)
	filename = toWinPath(filename)
	return a.share.MkdirAll(filename, mode)
}
func (a ServerMessageBlockFileSystemAbstraction) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.Name", "&a", &a), &out0)
	return ""
}
func (a ServerMessageBlockFileSystemAbstraction) Open(filename string) (out0 arozfs.File, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.Open", "&a", &a, "filename", filename), &out0, &out1)
	filename = toWinPath(a.filterFilepath(filename))
	f, err := a.share.Open(filename)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
		return nil, err
	}
	af := NewSmbFsFile(f)
	return af, nil
}
func (a ServerMessageBlockFileSystemAbstraction) OpenFile(filename string, flag int, perm os.FileMode) (out0 arozfs.File, out1 error) {
	defer logger.Out2(logger.In4("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.OpenFile", "&a", &a, "filename", filename, "flag", flag, "&perm", &perm), &out0, &out1)
	filename = toWinPath(a.filterFilepath(filename))
	f, err := a.share.OpenFile(filename, flag, perm)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
		return nil, err
	}
	af := NewSmbFsFile(f)
	return af, nil
}
func (a ServerMessageBlockFileSystemAbstraction) Remove(filename string) (out0 error) {
	defer logger.Out1(logger.In2("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.Remove", "&a", &a, "filename", filename), &out0)
	filename = a.filterFilepath(filename)
	filename = toWinPath(filename)
	return a.share.Remove(filename)
}
func (a ServerMessageBlockFileSystemAbstraction) RemoveAll(filename string) (out0 error) {
	defer logger.Out1(logger.In2("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.RemoveAll", "&a", &a, "filename", filename), &out0)
	filename = a.filterFilepath(filename)
	filename = toWinPath(filename)
	return a.share.RemoveAll(filename)
}
func (a ServerMessageBlockFileSystemAbstraction) Rename(oldname, newname string) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.Rename", "&a", &a, "oldname", oldname, "newname", newname), &out0)
	oldname = toWinPath(a.filterFilepath(oldname))
	newname = toWinPath(a.filterFilepath(newname))
	return a.share.Rename(oldname, newname)
}
func (a ServerMessageBlockFileSystemAbstraction) Stat(filename string) (out0 os.FileInfo, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.Stat", "&a", &a, "filename", filename), &out0, &out1)
	filename = toWinPath(a.filterFilepath(filename))
	return a.share.Stat(filename)
}
func (a ServerMessageBlockFileSystemAbstraction) Close() (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.Close", "&a", &a), &out0)
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

func (a ServerMessageBlockFileSystemAbstraction) VirtualPathToRealPath(subpath string, username string) (out0 string, out1 error) {
	defer logger.Out2(logger.In3("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.VirtualPathToRealPath", "&a", &a, "subpath", subpath, "username", username), &out0, &out1)
	//The generic translator refuses subpaths that climb out of the share
	//root or the user's home ("user:../bob")
	rpath, err := arozfs.GenericVirtualPathToRealPathTranslator(a.UUID, a.Hierarchy, subpath, username)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
		return "", err
	}
	return toWinPath(filepath.ToSlash(filepath.Clean(filepath.Join(a.fsaRoot, rpath)))), nil
}

func (a ServerMessageBlockFileSystemAbstraction) RealPathToVirtualPath(fullpath string, username string) (out0 string, out1 error) {
	defer logger.Out2(logger.In3("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.RealPathToVirtualPath", "&a", &a, "fullpath", fullpath, "username", username), &out0, &out1)
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

func (a ServerMessageBlockFileSystemAbstraction) FileExists(realpath string) (out0 bool) {
	defer logger.Out1(logger.In2("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.FileExists", "&a", &a, "realpath", realpath), &out0)
	realpath = toWinPath(a.filterFilepath(realpath))
	f, err := a.share.Open(realpath)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
		return false
	}
	f.Close()
	return true
}

func (a ServerMessageBlockFileSystemAbstraction) IsDir(realpath string) (out0 bool) {
	defer logger.Out1(logger.In2("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.IsDir", "&a", &a, "realpath", realpath), &out0)
	realpath = a.filterFilepath(realpath)
	realpath = toWinPath(realpath)
	stx, err := a.share.Stat(realpath)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
		return false
	}
	return stx.IsDir()
}

func (a ServerMessageBlockFileSystemAbstraction) Glob(realpathWildcard string) (out0 []string, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.Glob", "&a", &a, "realpathWildcard", realpathWildcard), &out0, &out1)
	realpathWildcard = strings.ReplaceAll(realpathWildcard, "[", "?")
	realpathWildcard = strings.ReplaceAll(realpathWildcard, "]", "?")
	matches, err := a.share.Glob(realpathWildcard)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
		return []string{}, err
	}
	return matches, nil
}

func (a ServerMessageBlockFileSystemAbstraction) GetFileSize(realpath string) (out0 int64) {
	defer logger.Out1(logger.In2("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.GetFileSize", "&a", &a, "realpath", realpath), &out0)
	realpath = toWinPath(a.filterFilepath(realpath))
	stat, err := a.share.Stat(realpath)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
		return 0
	}
	return stat.Size()
}

func (a ServerMessageBlockFileSystemAbstraction) GetModTime(realpath string) (out0 int64, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.GetModTime", "&a", &a, "realpath", realpath), &out0, &out1)
	realpath = toWinPath(a.filterFilepath(realpath))
	stat, err := a.share.Stat(realpath)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
		return 0, nil
	}
	return stat.ModTime().Unix(), nil
}

func (a ServerMessageBlockFileSystemAbstraction) WriteFile(filename string, content []byte, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.WriteFile", "&a", &a, "filename", filename, "content", content, "&mode", &mode), &out0)
	filename = toWinPath(a.filterFilepath(filename))
	return a.share.WriteFile(filename, content, mode)
}
func (a ServerMessageBlockFileSystemAbstraction) ReadFile(filename string) (out0 []byte, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.ReadFile", "&a", &a, "filename", filename), &out0, &out1)
	filename = toWinPath(a.filterFilepath(filename))
	return a.share.ReadFile(filename)
}

func (a ServerMessageBlockFileSystemAbstraction) ReadDir(filename string) (out0 []fs.DirEntry, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.ReadDir", "&a", &a, "filename", filename), &out0, &out1)
	filename = toWinPath(a.filterFilepath(filename))
	fis, err := a.share.ReadDir(filename)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
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

func (a ServerMessageBlockFileSystemAbstraction) WriteStream(filename string, stream io.Reader, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.WriteStream", "&a", &a, "filename", filename, "stream", stream, "&mode", &mode), &out0)
	filename = toWinPath(a.filterFilepath(filename))
	f, err := a.share.OpenFile(filename, os.O_CREATE|os.O_WRONLY, mode)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
		return err
	}

	p := make([]byte, 32768)
	for {
		_, err := stream.Read(p)
		if err != nil {
			logger.DebugErr("filesystem/abstractions/smbfs", err)
			if err == io.EOF {
				break
			} else {
				return err
			}
		}
		_, err = f.Write(p)
		if err != nil {
			logger.DebugErr("filesystem/abstractions/smbfs", err)
			return err
		}
	}

	return nil
}
func (a ServerMessageBlockFileSystemAbstraction) ReadStream(filename string) (out0 io.ReadCloser, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.ReadStream", "&a", &a, "filename", filename), &out0, &out1)
	filename = toWinPath(a.filterFilepath(filename))
	f, err := a.share.OpenFile(filename, os.O_RDONLY, 0755)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
		return nil, err
	}
	return f, nil
}

// Note that walk on SMB is super slow. Avoid using this if possible.
func (a ServerMessageBlockFileSystemAbstraction) Walk(root string, walkFn filepath.WalkFunc) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.Walk", "&a", &a, "root", root, "&walkFn", &walkFn), &out0)
	root = toWinPath(a.filterFilepath(root))
	err := fs.WalkDir(a.share.DirFS(root), ".", func(path string, d fs.DirEntry, err error) error {
		if err != nil {
			logger.DebugErr("filesystem/abstractions/smbfs", err)
			return err
		}
		statInfo, err := d.Info()
		if err != nil {
			logger.DebugErr("filesystem/abstractions/smbfs", err)
			return err
		}
		//Hand the callback result back, so a walk can be stopped or a folder skipped
		return walkFn(filepath.ToSlash(filepath.Join(root, path)), statInfo, err)
	})
	return err
}

func (a ServerMessageBlockFileSystemAbstraction) Heartbeat() (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.Heartbeat", "&a", &a), &out0)
	_, err := a.share.Stat("")
	return err
}

/*

	Optional Functions

*/

func (a *ServerMessageBlockFileSystemAbstraction) CapacityInfo() {
	defer logger.Out0(logger.In1("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.CapacityInfo", "a", a))
	fsinfo, err := a.share.Statfs(".")
	if err != nil {
		logger.DebugErr("filesystem/abstractions/smbfs", err)
		return
	}

	fmt.Println(fsinfo)
}

/*

	Helper Functions

*/

func toWinPath(filename string) (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/smbfs", "toWinPath", "filename", filename), &out0)
	backslashed := strings.ReplaceAll(filename, "/", "\\")
	return strings.TrimPrefix(backslashed, "\\")
}

func (a ServerMessageBlockFileSystemAbstraction) filterFilepath(rawpath string) (out0 string) {
	defer logger.Out1(logger.In2("filesystem/abstractions/smbfs", "ServerMessageBlockFileSystemAbstraction.filterFilepath", "&a", &a, "rawpath", rawpath), &out0)
	rawpath = filepath.ToSlash(filepath.Clean(rawpath))
	rawpath = strings.TrimSpace(rawpath)

	if strings.HasPrefix(rawpath, "./") {
		return rawpath[1:]
	} else if rawpath == "." || rawpath == "" {
		return "/"
	}

	return rawpath
}

func wildCardToRegexp(pattern string) (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/smbfs", "wildCardToRegexp", "pattern", pattern), &out0)
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
