package sftpfs

import (
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"github.com/pkg/sftp"
	"golang.org/x/crypto/ssh"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
)

/*
	SFTP-FS.go

	SSH File Transfer Protocol as File System Abstraction

*/

type SFTPFileSystemAbstraction struct {
	uuid      string
	hierarchy string
	url       string
	port      int

	username    string
	password    string
	mountFolder string

	client *sftp.Client
	conn   *ssh.Client
}

func NewSFTPFileSystemAbstraction(uuid string, hierarchy string, serverUrl string, port int, mountFolder string, username string, password string) (SFTPFileSystemAbstraction, error) {
	_, err := url.Parse(serverUrl)
	if err != nil {
		return SFTPFileSystemAbstraction{}, errors.New("[SFTP] to parse url: " + err.Error())
	}

	// Get user name and pass
	//user := parsedUrl.User.Username()
	//, _ := parsedUrl.User.Password()

	// Parse Host and Port

	logger.PrintAndLog("Sftpfs", "[SFTP FS] Establishing connection with "+serverUrl+"...", nil)

	var auths []ssh.AuthMethod

	// Use password authentication if provided
	if password != "" {
		auths = append(auths, ssh.Password(password))
	}

	// Initialize client configuration
	config := ssh.ClientConfig{
		User: username,
		Auth: auths,
		// Uncomment to ignore host key check
		HostKeyCallback: ssh.InsecureIgnoreHostKey(),
		//HostKeyCallback: ssh.FixedHostKey(hostKey),
	}

	addr := fmt.Sprintf("%s:%d", serverUrl, port)

	// Connect to server
	logger.Debug("Sftpfs", fmt.Sprintf("[SFTP FS] %s:/ dialing %s (user %s, mount folder %s, hierarchy %s, password auth %v)", uuid, addr, username, mountFolder, hierarchy, password != ""))
	conn, err := ssh.Dial("tcp", addr, &config)
	if err != nil {
		logger.PrintAndLog("Sftpfs", fmt.Sprintf("[SFTP FS] Failed to connect to [%s] %v\n", addr, err), nil)
		return SFTPFileSystemAbstraction{}, err
	}

	// Create new SFTP client
	logger.Debug("Sftpfs", "[SFTP FS] "+uuid+":/ SSH connected to "+addr+", starting the SFTP subsystem")
	sc, err := sftp.NewClient(conn)
	if err != nil {
		logger.Debugf("Sftpfs", "[SFTP FS] %s:/ SFTP subsystem failed, the SSH connection to %s is left open", uuid, addr)
		logger.PrintAndLog("Sftpfs", fmt.Sprintf("[SFTP FS] Unable to start SFTP subsystem: %v\n", err), nil)
		return SFTPFileSystemAbstraction{}, err
	}

	logger.PrintAndLog("Sftpfs", "[SFTP FS] Connected to remote: "+addr, nil)
	return SFTPFileSystemAbstraction{
		uuid:        uuid,
		hierarchy:   hierarchy,
		url:         serverUrl,
		port:        port,
		username:    username,
		password:    password,
		mountFolder: mountFolder,
		client:      sc,
		conn:        conn,
	}, nil
}
func (s SFTPFileSystemAbstraction) Chmod(filename string, mode os.FileMode) error {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("Chmod %q %v", filename, mode)
	return s.client.Chmod(filename, mode)
}
func (s SFTPFileSystemAbstraction) Chown(filename string, uid int, gid int) error {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("Chown %q %d:%d", filename, uid, gid)
	return s.client.Chown(filename, uid, gid)
}
func (s SFTPFileSystemAbstraction) Chtimes(filename string, atime time.Time, mtime time.Time) error {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("Chtimes %q", filename)
	return s.client.Chtimes(filename, atime, mtime)
}
func (s SFTPFileSystemAbstraction) Create(filename string) (arozfs.File, error) {
	filename = arozfs.GenericPathFilter(filename)
	//TODO: ADD FILE TYPE CONVERSION
	return nil, arozfs.ErrNullOperation
}
func (s SFTPFileSystemAbstraction) Mkdir(filename string, mode os.FileMode) error {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("Mkdir %q", filename)
	return s.client.Mkdir(filename)
}
func (s SFTPFileSystemAbstraction) MkdirAll(filename string, mode os.FileMode) error {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("MkdirAll %q", filename)
	return s.client.MkdirAll(filename)
}
func (s SFTPFileSystemAbstraction) Name() string {
	return ""
}
func (s SFTPFileSystemAbstraction) Open(filename string) (arozfs.File, error) {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("Open %q", filename)

	f, err := s.client.Open(filename)
	if err != nil {
		return nil, err
	}

	stats, err := f.Stat()
	if err != nil {
		return nil, err
	}

	isDir := stats.IsDir()
	de := []fs.DirEntry{}
	if isDir {
		dirEntries, err := s.ReadDir(filename)
		if err == nil {
			de = dirEntries
		}
	}

	//Wrap the file and return
	wf := newSftpFsFile(f, isDir, de)
	return wf, nil
}
func (s SFTPFileSystemAbstraction) OpenFile(filename string, flag int, perm os.FileMode) (arozfs.File, error) {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("OpenFile %q flag=%#x perm=%v", filename, flag, perm)

	f, err := s.client.OpenFile(filename, flag)
	if err != nil {
		return nil, err
	}

	stats, err := f.Stat()
	if err != nil {
		return nil, err
	}

	isDir := stats.IsDir()
	de := []fs.DirEntry{}
	if isDir {
		dirEntries, err := s.ReadDir(filename)
		if err == nil {
			de = dirEntries
		}
	}

	//Wrap the file and return
	wf := newSftpFsFile(f, isDir, de)
	return wf, nil
}
func (s SFTPFileSystemAbstraction) Remove(filename string) error {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("Remove %q", filename)
	return s.client.Remove(filename)
}
func (s SFTPFileSystemAbstraction) RemoveAll(filename string) error {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("RemoveAll %q", filename)
	if s.IsDir(filename) {
		return s.client.RemoveDirectory(filename)
	}
	return s.Remove(filename)

}
func (s SFTPFileSystemAbstraction) Rename(oldname, newname string) error {
	oldname = arozfs.GenericPathFilter(oldname)
	newname = arozfs.GenericPathFilter(newname)
	s.debugf("Rename %q -> %q", oldname, newname)
	return s.client.Rename(oldname, newname)
}
func (s SFTPFileSystemAbstraction) Stat(filename string) (os.FileInfo, error) {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("Stat %q", filename)
	return s.client.Stat(filename)
}
func (s SFTPFileSystemAbstraction) Close() error {
	defer logger.TracePanic("Sftpfs", "closing the SFTP connection of "+s.uuid+":/")
	logger.Debugf("Sftpfs", "%s:/ closing %s:%d (client set=%v conn set=%v). Copies of this abstraction still in use keep the closed client", s.uuid, s.url, s.port, s.client != nil, s.conn != nil)
	if s.client == nil || s.conn == nil {
		logger.Debugf("Sftpfs", "%s:/ was never connected; closing it panics with a nil pointer dereference", s.uuid)
	}
	err := s.client.Close()
	if err != nil {
		logger.Debugf("Sftpfs", "%s:/ SFTP client close failed, the SSH connection is left open: %v", s.uuid, err)
		return err
	}
	time.Sleep(300 * time.Millisecond)
	err = s.conn.Close()
	if err != nil {
		logger.Debugf("Sftpfs", "%s:/ SSH connection close failed: %v", s.uuid, err)
		return err
	}
	time.Sleep(500 * time.Millisecond)
	logger.Debugf("Sftpfs", "%s:/ closed", s.uuid)
	return nil
}

/*
	Abstraction Utilities
*/

func (s SFTPFileSystemAbstraction) VirtualPathToRealPath(subpath string, username string) (string, error) {
	rpath, err := arozfs.GenericVirtualPathToRealPathTranslator(s.uuid, s.hierarchy, subpath, username)
	if err != nil {
		s.debugf("VirtualPathToRealPath %q for %s refused: %v", subpath, username, err)
		return "", err
	}
	if !(len(rpath) >= len(s.mountFolder) && rpath[:len(s.mountFolder)] == s.mountFolder) {
		//Prepend the mount folder (aka root folder) to the translated output from generic path translator
		rpath = arozfs.ToSlash(filepath.Join(s.mountFolder, rpath))
	}
	s.debugf("VirtualPathToRealPath %q for %s -> %q", subpath, username, rpath)
	return rpath, nil
}

func (s SFTPFileSystemAbstraction) RealPathToVirtualPath(fullpath string, username string) (string, error) {
	if len(fullpath) >= len(s.mountFolder) && fullpath[:len(s.mountFolder)] == s.mountFolder {
		//Trim out the mount folder path from the full path before passing into the generic path translator
		fullpath = fullpath[len(s.mountFolder):]
	}
	return arozfs.GenericRealPathToVirtualPathTranslator(s.uuid, s.hierarchy, fullpath, username)
}

func (s SFTPFileSystemAbstraction) FileExists(realpath string) bool {
	_, err := s.Stat(realpath)
	return err == nil
}

func (s SFTPFileSystemAbstraction) IsDir(realpath string) bool {
	info, err := s.Stat(realpath)
	if err != nil {
		return false
	}

	return info.IsDir()
}

func (s SFTPFileSystemAbstraction) Glob(realpathWildcard string) ([]string, error) {
	realpathWildcard = arozfs.GenericPathFilter(realpathWildcard)
	s.debugf("Glob %q", realpathWildcard)
	return s.client.Glob(realpathWildcard)
}

func (s SFTPFileSystemAbstraction) GetFileSize(realpath string) int64 {
	info, err := s.Stat(realpath)
	if err != nil {
		return 0
	}

	return info.Size()
}

func (s SFTPFileSystemAbstraction) GetModTime(realpath string) (int64, error) {
	info, err := s.Stat(realpath)
	if err != nil {
		return 0, err
	}

	return info.ModTime().Unix(), nil
}

func (s SFTPFileSystemAbstraction) WriteFile(filename string, content []byte, mode os.FileMode) error {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("WriteFile %q (%d bytes)", filename, len(content))
	f, err := s.client.OpenFile(filename, os.O_CREATE|os.O_WRONLY)
	if err != nil {
		return err
	}

	_, err = f.Write(content)
	return err
}
func (s SFTPFileSystemAbstraction) ReadFile(filename string) ([]byte, error) {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("ReadFile %q", filename)
	f, err := s.client.OpenFile(filename, os.O_RDONLY)
	if err != nil {
		return []byte(""), err
	}

	return io.ReadAll(f)
}
func (s SFTPFileSystemAbstraction) ReadDir(filename string) ([]fs.DirEntry, error) {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("ReadDir %q", filename)
	result := []fs.DirEntry{}
	infos, err := s.client.ReadDir(filename)
	if err != nil {
		return result, err
	}

	for _, finfo := range infos {
		de := newDirEntryFromFileInfo(finfo)
		result = append(result, de)
	}

	return result, nil
}
func (s SFTPFileSystemAbstraction) WriteStream(filename string, stream io.Reader, mode os.FileMode) error {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("WriteStream %q", filename)
	f, err := s.client.OpenFile(filename, os.O_CREATE|os.O_WRONLY)
	if err != nil {
		return err
	}
	_, err = io.Copy(f, stream)
	return err
}
func (s SFTPFileSystemAbstraction) ReadStream(filename string) (io.ReadCloser, error) {
	filename = arozfs.GenericPathFilter(filename)
	s.debugf("ReadStream %q", filename)
	f, err := s.client.OpenFile(filename, os.O_RDONLY)
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (s SFTPFileSystemAbstraction) Walk(root string, walkFn filepath.WalkFunc) error {
	root = arozfs.GenericPathFilter(root)
	s.debugf("Walk %q", root)
	walker := s.client.Walk(root)
	for walker.Step() {
		if walker.Err() != nil {
			s.debugf("Walk %q: error at %q (%v), the walk callback gets a nil FileInfo", root, walker.Path(), walker.Err())
		}
		err := walkFn(walker.Path(), walker.Stat(), walker.Err())
		if err == filepath.SkipDir {
			walker.SkipDir()
		} else if err != nil {
			//The callback asked to stop, e.g. the user cancelled the operation
			return err
		}
	}
	return nil
}

func (s SFTPFileSystemAbstraction) Heartbeat() error {
	s.debugf("Heartbeat")
	return nil
}

// debugf writes a DEBUG record about an operation on this drive (-debug flag).
// It says so when the drive holds no SFTP client, because any call on it
// would then panic with a nil pointer.
func (s SFTPFileSystemAbstraction) debugf(format string, args ...interface{}) {
	if !logger.DebugEnabled() {
		return
	}
	state := ""
	if s.client == nil {
		state = " [client is nil: the drive is not connected, this call will panic]"
	}
	logger.DebugDepth(1, "Sftpfs", fmt.Sprintf("[SFTP FS] %s:/ (%s:%d%s) ", s.uuid, s.url, s.port, s.mountFolder)+fmt.Sprintf(format, args...)+state)
}
