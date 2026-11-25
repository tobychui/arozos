package sftpserver

import (
	"errors"
	"io"
	"io/fs"
	"os"
	"path"
	"path/filepath"
	"sort"
	"strings"
	"syscall"
	"time"

	"github.com/pkg/sftp"
	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
)

// Access answers what the signed in user may do. It is asked on every
// operation rather than once at login, so that a change of a drive's access
// list reaches sessions that are already open. *user.User provides it.
type Access interface {
	GetAllFileSystemHandler() []*filesystem.FileSystemHandler
	CanRead(vpath string) bool
	CanWrite(vpath string) bool
}

// Root of the serving tree
type root struct {
	username       string
	rootFile       *rootFolder
	startDirectory string
	access         Access
}

type rootFolder struct {
	name    string
	modtime time.Time
	isdir   bool
	content []byte
}

// Fake folders in root for vroot redirections
type rootEntry struct {
	thisFsh *filesystem.FileSystemHandler
}

func NewVrootEmulatedDirEntry(fsh *filesystem.FileSystemHandler) (out0 *rootEntry) {
	defer logger.Out1(logger.In1("storage/sftpserver", "NewVrootEmulatedDirEntry", "fsh", fsh), &out0)
	return &rootEntry{
		thisFsh: fsh,
	}
}

func (r *rootEntry) Name() (out0 string) {
	defer logger.Out1(logger.In1("storage/sftpserver", "rootEntry.Name", "r", r), &out0)
	return r.thisFsh.UUID
}
func (r *rootEntry) Size() (out0 int64) {
	defer logger.Out1(logger.In1("storage/sftpserver", "rootEntry.Size", "r", r), &out0)
	return 0
}
func (r *rootEntry) Mode() (out0 os.FileMode) {
	defer logger.Out1(logger.In1("storage/sftpserver", "rootEntry.Mode", "r", r), &out0)
	return fs.ModeDir
}
func (r *rootEntry) ModTime() (out0 time.Time) {
	defer logger.Out1(logger.In1("storage/sftpserver", "rootEntry.ModTime", "r", r), &out0)
	return time.Now()
}
func (r *rootEntry) IsDir() (out0 bool) {
	defer logger.Out1(logger.In1("storage/sftpserver", "rootEntry.IsDir", "r", r), &out0)
	return true
}
func (r *rootEntry) Sys() (out0 interface{}) {
	defer logger.Out1(logger.In1("storage/sftpserver", "rootEntry.Sys", "r", r), &out0)
	return nil
}

func GetNewSFTPRoot(username string, userAccess Access) (out0 sftp.Handlers) {
	defer logger.Out1(logger.In2("storage/sftpserver", "GetNewSFTPRoot", "username", username, "&userAccess", &userAccess), &out0)
	root := &root{
		username:       username,
		rootFile:       &rootFolder{name: "/", modtime: time.Now(), isdir: true},
		startDirectory: "/",
		access:         userAccess,
	}
	return sftp.Handlers{root, root, root, root}
}

func (fs *root) getFshFromID(fshID string) (out0 *filesystem.FileSystemHandler) {
	defer logger.Out1(logger.In2("storage/sftpserver", "root.getFshFromID", "fs", fs, "fshID", fshID), &out0)
	for _, thisFsh := range fs.access.GetAllFileSystemHandler() {
		if thisFsh.UUID == fshID && !thisFsh.Closed {
			return thisFsh
		}
	}

	return nil
}

// getWritableFsh resolves a path the user is about to change
func (fs *root) getWritableFsh(pathname string) (out0 *filesystem.FileSystemHandler, out1 string, out2 error) {
	defer logger.Out3(logger.In2("storage/sftpserver", "root.getWritableFsh", "fs", fs, "pathname", pathname), &out0, &out1, &out2)
	fsh, subpath, rpath, err := fs.getFshAndSubpathFromSFTPPathname(pathname)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return nil, "", err
	}
	if !fs.access.CanWrite(fsh.UUID + ":/" + subpath) {
		return nil, "", os.ErrPermission
	}
	return fsh, rpath, nil
}

func (fs *root) Fileread(r *sftp.Request) (out0 io.ReaderAt, out1 error) {
	defer logger.Out2(logger.In2("storage/sftpserver", "root.Fileread", "fs", fs, "r", r), &out0, &out1)
	flags := r.Pflags()
	if !flags.Read {
		// sanity check
		return nil, os.ErrInvalid
	}

	//Read only, or a user without write access could not read at all
	fsh, _, rpath, err := fs.getFshAndSubpathFromSFTPPathname(r.Filepath)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return nil, err
	}

	f, err := fsh.FileSystemAbstraction.OpenFile(rpath, os.O_RDONLY, 0775)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return nil, err
	}

	return f, nil
}

func (fs *root) Filewrite(r *sftp.Request) (out0 io.WriterAt, out1 error) {
	defer logger.Out2(logger.In2("storage/sftpserver", "root.Filewrite", "fs", fs, "r", r), &out0, &out1)
	if arozfs.ToSlash(filepath.Dir(r.Filepath)) == "/" {
		//Uploading to virtual root folder. Return error
		return nil, errors.New("ArozOS SFTP root is read only")
	}

	fsh, rpath, err := fs.getWritableFsh(r.Filepath)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return nil, err
	}

	f, err := fsh.FileSystemAbstraction.OpenFile(rpath, os.O_WRONLY|openFlags(r.Pflags()), 0775)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return nil, err
	}

	return f, nil
}

func (fs *root) OpenFile(r *sftp.Request) (out0 sftp.WriterAtReaderAt, out1 error) {
	defer logger.Out2(logger.In2("storage/sftpserver", "root.OpenFile", "fs", fs, "r", r), &out0, &out1)
	if arozfs.ToSlash(filepath.Dir(r.Filepath)) == "/" {
		return nil, errors.New("ArozOS SFTP root is read only")
	}
	fsh, rpath, err := fs.getWritableFsh(r.Filepath)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return nil, err
	}

	f, err := fsh.FileSystemAbstraction.OpenFile(rpath, os.O_RDWR|openFlags(r.Pflags()), 0775)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return nil, err
	}

	return f, nil
}

// openFlags carries the create, truncate, exclusive and append choices of a
// client over. Without the truncate flag, a smaller file uploaded over a
// bigger one would keep the old file's tail.
func openFlags(p sftp.FileOpenFlags) (out0 int) {
	defer logger.Out1(logger.In1("storage/sftpserver", "openFlags", "&p", &p), &out0)
	flags := 0
	if p.Creat {
		flags |= os.O_CREATE
	}
	if p.Trunc {
		flags |= os.O_TRUNC
	}
	if p.Excl {
		flags |= os.O_EXCL
	}
	if p.Append {
		flags |= os.O_APPEND
	}
	return flags
}

func (fs *root) Filecmd(r *sftp.Request) (out0 error) {
	defer logger.Out1(logger.In2("storage/sftpserver", "root.Filecmd", "fs", fs, "r", r), &out0)
	switch r.Method {
	case "Setstat":

		return nil
	case "Rename":
		// SFTP-v2: "It is an error if there already exists a file with the name specified by newpath."
		// This varies from the POSIX specification, which allows limited replacement of target files.
		//if fs.exists(r.Target) {
		//	return os.ErrExist
		//}

		return fs.rename(r.Filepath, r.Target)

	case "Rmdir":
		return fs.rmdir(r.Filepath)

	case "Remove":
		// IEEE 1003.1 remove explicitly can unlink files and remove empty directories.
		// We use instead here the semantics of unlink, which is allowed to be restricted against directories.
		return fs.unlink(r.Filepath)

	case "Mkdir":
		return fs.mkdir(r.Filepath)

	case "Link":
		return fs.link(r.Filepath, r.Target)

	case "Symlink":
		// NOTE: r.Filepath is the target, and r.Target is the linkpath.
		return fs.symlink(r.Filepath, r.Target)
	}

	return errors.New("unsupported")
}

func (fs *root) rename(oldpath, newpath string) (out0 error) {
	defer logger.Out1(logger.In3("storage/sftpserver", "root.rename", "fs", fs, "oldpath", oldpath, "newpath", newpath), &out0)
	oldFsh, realOldPath, err := fs.getWritableFsh(oldpath)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return err
	}
	newFsh, realNewPath, err := fs.getWritableFsh(newpath)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return err
	}

	if oldFsh.UUID == newFsh.UUID {
		//Use rename function
		err = oldFsh.FileSystemAbstraction.Rename(realOldPath, realNewPath)
		if err != nil {
			logger.DebugErr("storage/sftpserver", err)
			return err
		}
	} else {
		//Cross root rename (aka move)
		src, err := oldFsh.FileSystemAbstraction.ReadStream(realOldPath)
		if err != nil {
			logger.DebugErr("storage/sftpserver", err)
			return err
		}
		defer src.Close()

		err = newFsh.FileSystemAbstraction.WriteStream(realNewPath, src, 0775)
		if err != nil {
			logger.DebugErr("storage/sftpserver", err)
			return err
		}

		//Remove the src
		//oldFsh.FileSystemAbstraction.RemoveAll(realOldPath)
	}

	return nil
}

func (fs *root) PosixRename(r *sftp.Request) (out0 error) {
	defer logger.Out1(logger.In2("storage/sftpserver", "root.PosixRename", "fs", fs, "r", r), &out0)
	return fs.rename(r.Filepath, r.Target)
}

func (fs *root) StatVFS(r *sftp.Request) (out0 *sftp.StatVFS, out1 error) {
	defer logger.Out2(logger.In2("storage/sftpserver", "root.StatVFS", "fs", fs, "r", r), &out0, &out1)
	return nil, errors.New("unsupported")
}

func (fs *root) mkdir(pathname string) (out0 error) {
	defer logger.Out1(logger.In2("storage/sftpserver", "root.mkdir", "fs", fs, "pathname", pathname), &out0)
	fsh, rpath, err := fs.getWritableFsh(pathname)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return err
	}

	return fsh.FileSystemAbstraction.MkdirAll(rpath, 0775)
}

func (fs *root) rmdir(pathname string) (out0 error) {
	defer logger.Out1(logger.In2("storage/sftpserver", "root.rmdir", "fs", fs, "pathname", pathname), &out0)
	fsh, rpath, err := fs.getWritableFsh(pathname)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return err
	}
	return fsh.FileSystemAbstraction.RemoveAll(rpath)
}

func (fs *root) link(oldpath, newpath string) (out0 error) {
	defer logger.Out1(logger.In3("storage/sftpserver", "root.link", "fs", fs, "oldpath", oldpath, "newpath", newpath), &out0)
	return errors.New("unsupported")
}

// symlink() creates a symbolic link named `linkpath` which contains the string `target`.
// NOTE! This would be called with `symlink(req.Filepath, req.Target)` due to different semantics.
func (fs *root) symlink(target, linkpath string) (out0 error) {
	defer logger.Out1(logger.In3("storage/sftpserver", "root.symlink", "fs", fs, "target", target, "linkpath", linkpath), &out0)
	return errors.New("unsupported")
}

func (fs *root) unlink(pathname string) (out0 error) {
	defer logger.Out1(logger.In2("storage/sftpserver", "root.unlink", "fs", fs, "pathname", pathname), &out0)
	fsh, rpath, err := fs.getWritableFsh(pathname)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return err
	}

	if fsh.FileSystemAbstraction.IsDir(rpath) {
		// IEEE 1003.1: implementations may opt out of allowing the unlinking of directories.
		// SFTP-v2: SSH_FXP_REMOVE may not remove directories.
		return os.ErrInvalid
	}

	return fsh.FileSystemAbstraction.Remove(rpath)
}

type listerat []os.FileInfo

// Modeled after strings.Reader's ReadAt() implementation
func (f listerat) ListAt(ls []os.FileInfo, offset int64) (out0 int, out1 error) {
	defer logger.Out2(logger.In3("storage/sftpserver", "listerat.ListAt", "&f", &f, "ls", ls, "offset", offset), &out0, &out1)
	var n int
	if offset >= int64(len(f)) {
		return 0, io.EOF
	}
	n = copy(ls, f[offset:])
	if n < len(ls) {
		return n, io.EOF
	}
	return n, nil
}

func (fs *root) Filelist(r *sftp.Request) (out0 sftp.ListerAt, out1 error) {
	defer logger.Out2(logger.In2("storage/sftpserver", "root.Filelist", "fs", fs, "r", r), &out0, &out1)
	switch r.Method {
	case "List":
		files, err := fs.readdir(r.Filepath)
		if err != nil {
			logger.DebugErr("storage/sftpserver", err)
			return nil, err
		}
		return listerat(files), nil

	case "Stat":
		file, err := fs.fetch(r.Filepath)
		if err != nil {
			logger.DebugErr("storage/sftpserver", err)
			return nil, err
		}
		return listerat{file}, nil

	case "Readlink":
		return nil, errors.New("unsupported")
	}

	return nil, errors.New("unsupported")
}

func (fs *root) readdir(pathname string) (out0 []os.FileInfo, out1 error) {
	defer logger.Out2(logger.In2("storage/sftpserver", "root.readdir", "fs", fs, "pathname", pathname), &out0, &out1)
	if cleanPath(pathname) == "/" {
		//Handle special root listing
		results := []os.FileInfo{}
		for _, fsh := range fs.access.GetAllFileSystemHandler() {
			results = append(results, NewVrootEmulatedDirEntry(fsh))
		}
		return results, nil
	}

	//Get the content of the dir using fsh infrastructure
	targetFsh, _, rpath, err := fs.getFshAndSubpathFromSFTPPathname(pathname)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return nil, err
	}

	if !targetFsh.FileSystemAbstraction.IsDir(rpath) {
		return nil, syscall.ENOTDIR
	}

	//Read Dir, and convert the results into os.FileInfo
	entries, err := targetFsh.FileSystemAbstraction.ReadDir(rpath)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return nil, err
	}
	files := []os.FileInfo{}
	for _, entry := range entries {
		i, err := entry.Info()
		if err != nil {
			logger.DebugErr("storage/sftpserver", err)
			continue
		}
		files = append(files, i)
	}

	sort.Slice(files, func(i, j int) bool { return files[i].Name() < files[j].Name() })

	return files, nil
}

func (fs *root) readlink(pathname string) (out0 string, out1 error) {
	defer logger.Out2(logger.In2("storage/sftpserver", "root.readlink", "fs", fs, "pathname", pathname), &out0, &out1)
	return "", errors.New("unsupported")
}

// implements LstatFileLister interface
func (fs *root) Lstat(r *sftp.Request) (out0 sftp.ListerAt, out1 error) {
	defer logger.Out2(logger.In2("storage/sftpserver", "root.Lstat", "fs", fs, "r", r), &out0, &out1)
	file, err := fs.lfetch(r.Filepath)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return nil, err
	}
	return listerat{file}, nil
}

// implements RealpathFileLister interface
func (fs *root) Realpath(p string) (out0 string) {
	defer logger.Out1(logger.In2("storage/sftpserver", "root.Realpath", "fs", fs, "p", p), &out0)
	if fs.startDirectory == "" || fs.startDirectory == "/" {
		return cleanPath(p)
	}
	return cleanPathWithBase(fs.startDirectory, p)
}

// Convert sftp raw path into fsh, subpath and realpath. return err if any
func (fs *root) getFshAndSubpathFromSFTPPathname(pathname string) (out0 *filesystem.FileSystemHandler, out1 string, out2 string, out3 error) {
	defer logger.Out4(logger.In2("storage/sftpserver", "root.getFshAndSubpathFromSFTPPathname", "fs", fs, "pathname", pathname), &out0, &out1, &out2, &out3)
	pathname = strings.TrimSpace(pathname)
	if pathname[0:1] != "/" {
		pathname = "/" + pathname
	}

	pathChunks := strings.Split(pathname, "/")
	vrootID := pathChunks[1]
	subpath := ""
	if len(pathChunks) >= 2 {
		//Something like /user/Music
		subpath = strings.Join(pathChunks[2:], "/")
	}

	//Get target fsh
	fsh := fs.getFshFromID(vrootID)
	if fsh == nil {
		//Target fsh not found
		return nil, "", "", os.ErrExist
	}

	//Combined virtual path
	vpath := vrootID + ":/" + subpath
	if !fs.access.CanRead(vpath) {
		return nil, "", "", os.ErrPermission
	}

	//Translate it realpath and get from fsh
	fshAbs := fsh.FileSystemAbstraction
	rpath, err := fshAbs.VirtualPathToRealPath(vpath, fs.username)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return nil, "", "", err
	}

	return fsh, subpath, rpath, nil
}

func (fs *root) lfetch(path string) (out0 os.FileInfo, out1 error) {
	defer logger.Out2(logger.In2("storage/sftpserver", "root.lfetch", "fs", fs, "path", path), &out0, &out1)
	path = strings.TrimSpace(path)
	if path == "/" {
		//fmt.Println("Requesting SFTP Root")
		return fs.rootFile, nil
	}

	//Fetching path other than root. Extract the vroot id from the path
	fsh, _, rpath, err := fs.getFshAndSubpathFromSFTPPathname(path)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return nil, err
	}
	//Stat only: a file opened here would never be closed again, and every
	//stat of a client would keep one more file open on the server
	info, err := fsh.FileSystemAbstraction.Stat(rpath)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		if errors.Is(err, os.ErrNotExist) {
			return nil, os.ErrNotExist
		}
		return nil, err
	}
	return info, nil
}

func (fs *root) fetch(path string) (out0 os.FileInfo, out1 error) {
	defer logger.Out2(logger.In2("storage/sftpserver", "root.fetch", "fs", fs, "path", path), &out0, &out1)
	file, err := fs.lfetch(path)
	if err != nil {
		logger.DebugErr("storage/sftpserver", err)
		return nil, err
	}
	return file, nil
}

// Have memFile fulfill os.FileInfo interface
func (f *rootFolder) Name() (out0 string) {
	defer logger.Out1(logger.In1("storage/sftpserver", "rootFolder.Name", "f", f), &out0)
	return path.Base(f.name)
}
func (f *rootFolder) Size() (out0 int64) {
	defer logger.Out1(logger.In1("storage/sftpserver", "rootFolder.Size", "f", f), &out0)
	return int64(len(f.content))
}
func (f *rootFolder) Mode() (out0 os.FileMode) {
	defer logger.Out1(logger.In1("storage/sftpserver", "rootFolder.Mode", "f", f), &out0)
	return os.FileMode(0755) | os.ModeDir
}
func (f *rootFolder) ModTime() (out0 time.Time) {
	defer logger.Out1(logger.In1("storage/sftpserver", "rootFolder.ModTime", "f", f), &out0)
	return f.modtime
}
func (f *rootFolder) IsDir() (out0 bool) {
	defer logger.Out1(logger.In1("storage/sftpserver", "rootFolder.IsDir", "f", f), &out0)
	return f.isdir
}
func (f *rootFolder) Sys() (out0 interface{}) {
	defer logger.Out1(logger.In1("storage/sftpserver", "rootFolder.Sys", "f", f), &out0)
	return nil
}

func (f *rootFolder) ReadAt(b []byte, off int64) (int, error) {
	logger.DebugTrace("storage/sftpserver", "rootFolder.ReadAt")
	return 0, errors.New("root folder not support writeAt")
}

func (f *rootFolder) WriteAt(b []byte, off int64) (int, error) {
	logger.DebugTrace("storage/sftpserver", "rootFolder.WriteAt")
	// mimic write delays, should be optional
	time.Sleep(time.Microsecond * time.Duration(len(b)))
	return 0, errors.New("root folder not support writeAt")
}

/*

	Utilities

*/

// Makes sure we have a clean POSIX (/) absolute path to work with
func cleanPath(p string) (out0 string) {
	defer logger.Out1(logger.In1("storage/sftpserver", "cleanPath", "p", p), &out0)
	return cleanPathWithBase("/", p)
}

func cleanPathWithBase(base, p string) (out0 string) {
	defer logger.Out1(logger.In2("storage/sftpserver", "cleanPathWithBase", "base", base, "p", p), &out0)
	//SFTP paths are POSIX paths on every host: filepath.Clean would read a
	//leading // as a Windows network path
	p = path.Clean(filepath.ToSlash(p))
	if !path.IsAbs(p) {
		return path.Join(base, p)
	}
	return p
}
