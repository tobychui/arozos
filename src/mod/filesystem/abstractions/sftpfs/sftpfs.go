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

func NewSFTPFileSystemAbstraction(uuid string, hierarchy string, serverUrl string, port int, mountFolder string, username string, password string) (out0 SFTPFileSystemAbstraction, out1 error) {
	defer logger.Out2(logger.In7("filesystem/abstractions/sftpfs", "NewSFTPFileSystemAbstraction", "uuid", uuid, "hierarchy", hierarchy, "serverUrl", serverUrl, "port", port, "mountFolder", mountFolder, "username", username, "!password", password), &out0, &out1)
	_, err := url.Parse(serverUrl)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
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
	conn, err := ssh.Dial("tcp", addr, &config)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
		logger.PrintAndLog("Sftpfs", fmt.Sprintf("[SFTP FS] Failed to connect to [%s] %v\n", addr, err), nil)
		return SFTPFileSystemAbstraction{}, err
	}

	// Create new SFTP client
	sc, err := sftp.NewClient(conn)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
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
func (s SFTPFileSystemAbstraction) Chmod(filename string, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.Chmod", "&s", &s, "filename", filename, "&mode", &mode), &out0)
	filename = arozfs.GenericPathFilter(filename)
	return s.client.Chmod(filename, mode)
}
func (s SFTPFileSystemAbstraction) Chown(filename string, uid int, gid int) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.Chown", "&s", &s, "filename", filename, "uid", uid, "gid", gid), &out0)
	filename = arozfs.GenericPathFilter(filename)
	return s.client.Chown(filename, uid, gid)
}
func (s SFTPFileSystemAbstraction) Chtimes(filename string, atime time.Time, mtime time.Time) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.Chtimes", "&s", &s, "filename", filename, "&atime", &atime, "&mtime", &mtime), &out0)
	filename = arozfs.GenericPathFilter(filename)
	return s.client.Chtimes(filename, atime, mtime)
}
func (s SFTPFileSystemAbstraction) Create(filename string) (out0 arozfs.File, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.Create", "&s", &s, "filename", filename), &out0, &out1)
	filename = arozfs.GenericPathFilter(filename)
	//TODO: ADD FILE TYPE CONVERSION
	return nil, arozfs.ErrNullOperation
}
func (s SFTPFileSystemAbstraction) Mkdir(filename string, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.Mkdir", "&s", &s, "filename", filename, "&mode", &mode), &out0)
	filename = arozfs.GenericPathFilter(filename)
	return s.client.Mkdir(filename)
}
func (s SFTPFileSystemAbstraction) MkdirAll(filename string, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.MkdirAll", "&s", &s, "filename", filename, "&mode", &mode), &out0)
	filename = arozfs.GenericPathFilter(filename)
	return s.client.MkdirAll(filename)
}
func (s SFTPFileSystemAbstraction) Name() (out0 string) {
	defer logger.Out1(logger.In1("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.Name", "&s", &s), &out0)
	return ""
}
func (s SFTPFileSystemAbstraction) Open(filename string) (out0 arozfs.File, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.Open", "&s", &s, "filename", filename), &out0, &out1)
	filename = arozfs.GenericPathFilter(filename)

	f, err := s.client.Open(filename)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
		return nil, err
	}

	stats, err := f.Stat()
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
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
func (s SFTPFileSystemAbstraction) OpenFile(filename string, flag int, perm os.FileMode) (out0 arozfs.File, out1 error) {
	defer logger.Out2(logger.In4("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.OpenFile", "&s", &s, "filename", filename, "flag", flag, "&perm", &perm), &out0, &out1)
	filename = arozfs.GenericPathFilter(filename)

	f, err := s.client.OpenFile(filename, flag)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
		return nil, err
	}

	stats, err := f.Stat()
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
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
func (s SFTPFileSystemAbstraction) Remove(filename string) (out0 error) {
	defer logger.Out1(logger.In2("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.Remove", "&s", &s, "filename", filename), &out0)
	filename = arozfs.GenericPathFilter(filename)
	return s.client.Remove(filename)
}
func (s SFTPFileSystemAbstraction) RemoveAll(filename string) (out0 error) {
	defer logger.Out1(logger.In2("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.RemoveAll", "&s", &s, "filename", filename), &out0)
	filename = arozfs.GenericPathFilter(filename)
	if s.IsDir(filename) {
		return s.client.RemoveDirectory(filename)
	}
	return s.Remove(filename)

}
func (s SFTPFileSystemAbstraction) Rename(oldname, newname string) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.Rename", "&s", &s, "oldname", oldname, "newname", newname), &out0)
	oldname = arozfs.GenericPathFilter(oldname)
	newname = arozfs.GenericPathFilter(newname)
	return s.client.Rename(oldname, newname)
}
func (s SFTPFileSystemAbstraction) Stat(filename string) (out0 os.FileInfo, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.Stat", "&s", &s, "filename", filename), &out0, &out1)
	filename = arozfs.GenericPathFilter(filename)
	return s.client.Stat(filename)
}
func (s SFTPFileSystemAbstraction) Close() (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.Close", "&s", &s), &out0)
	err := s.client.Close()
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
		return err
	}
	time.Sleep(300 * time.Millisecond)
	err = s.conn.Close()
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
		return err
	}
	time.Sleep(500 * time.Millisecond)
	return nil
}

/*
	Abstraction Utilities
*/

func (s SFTPFileSystemAbstraction) VirtualPathToRealPath(subpath string, username string) (out0 string, out1 error) {
	defer logger.Out2(logger.In3("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.VirtualPathToRealPath", "&s", &s, "subpath", subpath, "username", username), &out0, &out1)
	rpath, err := arozfs.GenericVirtualPathToRealPathTranslator(s.uuid, s.hierarchy, subpath, username)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
		return "", err
	}
	if !(len(rpath) >= len(s.mountFolder) && rpath[:len(s.mountFolder)] == s.mountFolder) {
		//Prepend the mount folder (aka root folder) to the translated output from generic path translator
		rpath = arozfs.ToSlash(filepath.Join(s.mountFolder, rpath))
	}
	return rpath, nil
}

func (s SFTPFileSystemAbstraction) RealPathToVirtualPath(fullpath string, username string) (out0 string, out1 error) {
	defer logger.Out2(logger.In3("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.RealPathToVirtualPath", "&s", &s, "fullpath", fullpath, "username", username), &out0, &out1)
	if len(fullpath) >= len(s.mountFolder) && fullpath[:len(s.mountFolder)] == s.mountFolder {
		//Trim out the mount folder path from the full path before passing into the generic path translator
		fullpath = fullpath[len(s.mountFolder):]
	}
	return arozfs.GenericRealPathToVirtualPathTranslator(s.uuid, s.hierarchy, fullpath, username)
}

func (s SFTPFileSystemAbstraction) FileExists(realpath string) (out0 bool) {
	defer logger.Out1(logger.In2("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.FileExists", "&s", &s, "realpath", realpath), &out0)
	_, err := s.Stat(realpath)
	return err == nil
}

func (s SFTPFileSystemAbstraction) IsDir(realpath string) (out0 bool) {
	defer logger.Out1(logger.In2("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.IsDir", "&s", &s, "realpath", realpath), &out0)
	info, err := s.Stat(realpath)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
		return false
	}

	return info.IsDir()
}

func (s SFTPFileSystemAbstraction) Glob(realpathWildcard string) (out0 []string, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.Glob", "&s", &s, "realpathWildcard", realpathWildcard), &out0, &out1)
	realpathWildcard = arozfs.GenericPathFilter(realpathWildcard)
	return s.client.Glob(realpathWildcard)
}

func (s SFTPFileSystemAbstraction) GetFileSize(realpath string) (out0 int64) {
	defer logger.Out1(logger.In2("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.GetFileSize", "&s", &s, "realpath", realpath), &out0)
	info, err := s.Stat(realpath)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
		return 0
	}

	return info.Size()
}

func (s SFTPFileSystemAbstraction) GetModTime(realpath string) (out0 int64, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.GetModTime", "&s", &s, "realpath", realpath), &out0, &out1)
	info, err := s.Stat(realpath)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
		return 0, err
	}

	return info.ModTime().Unix(), nil
}

func (s SFTPFileSystemAbstraction) WriteFile(filename string, content []byte, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.WriteFile", "&s", &s, "filename", filename, "content", content, "&mode", &mode), &out0)
	filename = arozfs.GenericPathFilter(filename)
	f, err := s.client.OpenFile(filename, os.O_CREATE|os.O_WRONLY)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
		return err
	}

	_, err = f.Write(content)
	return err
}
func (s SFTPFileSystemAbstraction) ReadFile(filename string) (out0 []byte, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.ReadFile", "&s", &s, "filename", filename), &out0, &out1)
	filename = arozfs.GenericPathFilter(filename)
	f, err := s.client.OpenFile(filename, os.O_RDONLY)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
		return []byte(""), err
	}

	return io.ReadAll(f)
}
func (s SFTPFileSystemAbstraction) ReadDir(filename string) (out0 []fs.DirEntry, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.ReadDir", "&s", &s, "filename", filename), &out0, &out1)
	filename = arozfs.GenericPathFilter(filename)
	result := []fs.DirEntry{}
	infos, err := s.client.ReadDir(filename)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
		return result, err
	}

	for _, finfo := range infos {
		de := newDirEntryFromFileInfo(finfo)
		result = append(result, de)
	}

	return result, nil
}
func (s SFTPFileSystemAbstraction) WriteStream(filename string, stream io.Reader, mode os.FileMode) (out0 error) {
	defer logger.Out1(logger.In4("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.WriteStream", "&s", &s, "filename", filename, "stream", stream, "&mode", &mode), &out0)
	filename = arozfs.GenericPathFilter(filename)
	f, err := s.client.OpenFile(filename, os.O_CREATE|os.O_WRONLY)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
		return err
	}
	_, err = io.Copy(f, stream)
	return err
}
func (s SFTPFileSystemAbstraction) ReadStream(filename string) (out0 io.ReadCloser, out1 error) {
	defer logger.Out2(logger.In2("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.ReadStream", "&s", &s, "filename", filename), &out0, &out1)
	filename = arozfs.GenericPathFilter(filename)
	f, err := s.client.OpenFile(filename, os.O_RDONLY)
	if err != nil {
		logger.DebugErr("filesystem/abstractions/sftpfs", err)
		return nil, err
	}
	return f, nil
}

func (s SFTPFileSystemAbstraction) Walk(root string, walkFn filepath.WalkFunc) (out0 error) {
	defer logger.Out1(logger.In3("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.Walk", "&s", &s, "root", root, "&walkFn", &walkFn), &out0)
	root = arozfs.GenericPathFilter(root)
	walker := s.client.Walk(root)
	for walker.Step() {
		err := walkFn(walker.Path(), walker.Stat(), walker.Err())
		if err == filepath.SkipDir {
			walker.SkipDir()
		} else if err != nil {
			logger.DebugErr("filesystem/abstractions/sftpfs", err)
			//The callback asked to stop, e.g. the user cancelled the operation
			return err
		}
	}
	return nil
}

func (s SFTPFileSystemAbstraction) Heartbeat() (out0 error) {
	defer logger.Out1(logger.In1("filesystem/abstractions/sftpfs", "SFTPFileSystemAbstraction.Heartbeat", "&s", &s), &out0)
	return nil
}
