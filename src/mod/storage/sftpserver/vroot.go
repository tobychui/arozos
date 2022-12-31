package sftpserver

import (
	"errors"
	"fmt"
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
)

//Root of the serving tree
type root struct {
	username       string
	rootFile       *rootFolder
	startDirectory string
	fshs           []*filesystem.FileSystemHandler
}

type rootFolder struct {
	name    string
	modtime time.Time
	isdir   bool
	content []byte
}

//Fake folders in root for vroot redirections
type rootEntry struct {
	thisFsh *filesystem.FileSystemHandler
}

func NewVrootEmulatedDirEntry(fsh *filesystem.FileSystemHandler) *rootEntry {
	return &rootEntry{
		thisFsh: fsh,
	}
}

func (r *rootEntry) Name() string {
	return r.thisFsh.UUID
}
func (r *rootEntry) Size() int64 {
	return 0
}
func (r *rootEntry) Mode() os.FileMode {
	return fs.ModeDir
}
func (r *rootEntry) ModTime() time.Time {
	return time.Now()
}
func (r *rootEntry) IsDir() bool {
	return true
}
func (r *rootEntry) Sys() interface{} {
	return nil
}

type sftpFileInterface interface {
	Name() string
	Size() int64
	Mode() os.FileMode
	ModTime() time.Time
	IsDir() bool
	Sys() interface{}
	ReadAt([]byte, int64) (int, error)
	WriteAt([]byte, int64) (int, error)
}

//Wrapper for the arozfs File to provide missing functions
type wrappedArozFile struct {
	file arozfs.File
}

func newArozFileWrapper(arozfile arozfs.File) *wrappedArozFile {
	return &wrappedArozFile{file: arozfile}
}

func (f *wrappedArozFile) Name() string {
	return f.file.Name()
}

func (f *wrappedArozFile) Size() int64 {
	stat, err := f.file.Stat()
	if err != nil {
		return 0
	}

	return stat.Size()
}
func (f *wrappedArozFile) Mode() os.FileMode {
	stat, err := f.file.Stat()
	if err != nil {
		return 0
	}

	return stat.Mode()
}
func (f *wrappedArozFile) ModTime() time.Time {
	stat, err := f.file.Stat()
	if err != nil {
		return time.Time{}
	}

	return stat.ModTime()
}
func (f *wrappedArozFile) IsDir() bool {
	stat, err := f.file.Stat()
	if err != nil {
		return false
	}

	return stat.IsDir()
}
func (f *wrappedArozFile) Sys() interface{} {
	return nil
}

func (f *wrappedArozFile) ReadAt(b []byte, off int64) (int, error) {
	return f.file.ReadAt(b, off)
}

func (f *wrappedArozFile) WriteAt(b []byte, off int64) (int, error) {
	return f.file.WriteAt(b, off)
}

func GetNewSFTPRoot(username string, accessibleFileSystemHandlers []*filesystem.FileSystemHandler) sftp.Handlers {
	root := &root{
		username:       username,
		rootFile:       &rootFolder{name: "/", modtime: time.Now(), isdir: true},
		startDirectory: "/",
		fshs:           accessibleFileSystemHandlers,
	}
	return sftp.Handlers{root, root, root, root}
}

func (fs *root) getFshFromID(fshID string) *filesystem.FileSystemHandler {
	for _, thisFsh := range fs.fshs {
		if thisFsh.UUID == fshID && !thisFsh.Closed {
			return thisFsh
		}
	}

	return nil
}

func (fs *root) Fileread(r *sftp.Request) (io.ReaderAt, error) {
	flags := r.Pflags()
	if !flags.Read {
		// sanity check
		return nil, os.ErrInvalid
	}

	return fs.OpenFile(r)
}

func (fs *root) Filewrite(r *sftp.Request) (io.WriterAt, error) {
	if arozfs.ToSlash(filepath.Dir(r.Filepath)) == "/" {
		//Uploading to virtual root folder. Return error
		return nil, errors.New("ArozOS SFTP root is read only")
	}

	fsh, _, rpath, err := fs.getFshAndSubpathFromSFTPPathname(r.Filepath)
	if err != nil {
		return nil, err
	}

	f, err := fsh.FileSystemAbstraction.OpenFile(rpath, os.O_CREATE|os.O_WRONLY, 0775)
	if err != nil {
		return nil, err
	}

	return f, nil
}

func (fs *root) OpenFile(r *sftp.Request) (sftp.WriterAtReaderAt, error) {
	fmt.Println("Open File", r.Filepath)
	fsh, _, rpath, err := fs.getFshAndSubpathFromSFTPPathname(r.Filepath)
	if err != nil {
		return nil, err
	}

	f, err := fsh.FileSystemAbstraction.OpenFile(rpath, os.O_RDWR, 0775)
	if err != nil {
		return nil, err
	}

	return f, nil
}

func (fs *root) Filecmd(r *sftp.Request) error {
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

func (fs *root) rename(oldpath, newpath string) error {
	oldFsh, _, realOldPath, err := fs.getFshAndSubpathFromSFTPPathname(oldpath)
	if err != nil {
		return err
	}
	newFsh, _, realNewPath, err := fs.getFshAndSubpathFromSFTPPathname(newpath)
	if err != nil {
		return err
	}

	if oldFsh.UUID == newFsh.UUID {
		//Use rename function
		err = oldFsh.FileSystemAbstraction.Rename(realOldPath, realNewPath)
		if err != nil {
			return err
		}
	} else {
		//Cross root rename (aka move)
		src, err := oldFsh.FileSystemAbstraction.ReadStream(realOldPath)
		if err != nil {
			return err
		}
		defer src.Close()

		err = newFsh.FileSystemAbstraction.WriteStream(realNewPath, src, 0775)
		if err != nil {
			return err
		}

		//Remove the src
		//oldFsh.FileSystemAbstraction.RemoveAll(realOldPath)
	}

	return nil
}

func (fs *root) PosixRename(r *sftp.Request) error {
	return fs.rename(r.Filepath, r.Target)
}

func (fs *root) StatVFS(r *sftp.Request) (*sftp.StatVFS, error) {
	return nil, errors.New("unsupported")
}

func (fs *root) mkdir(pathname string) error {
	fsh, _, rpath, err := fs.getFshAndSubpathFromSFTPPathname(pathname)
	if err != nil {
		return err
	}

	return fsh.FileSystemAbstraction.MkdirAll(rpath, 0775)
}

func (fs *root) rmdir(pathname string) error {
	fsh, _, rpath, err := fs.getFshAndSubpathFromSFTPPathname(pathname)
	if err != nil {
		return err
	}
	return fsh.FileSystemAbstraction.RemoveAll(rpath)
}

func (fs *root) link(oldpath, newpath string) error {
	return errors.New("unsupported")
}

// symlink() creates a symbolic link named `linkpath` which contains the string `target`.
// NOTE! This would be called with `symlink(req.Filepath, req.Target)` due to different semantics.
func (fs *root) symlink(target, linkpath string) error {
	return errors.New("unsupported")
}

func (fs *root) unlink(pathname string) error {
	fsh, _, rpath, err := fs.getFshAndSubpathFromSFTPPathname(pathname)
	if err != nil {
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
func (f listerat) ListAt(ls []os.FileInfo, offset int64) (int, error) {
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

func (fs *root) Filelist(r *sftp.Request) (sftp.ListerAt, error) {
	switch r.Method {
	case "List":
		files, err := fs.readdir(r.Filepath)
		if err != nil {
			return nil, err
		}
		return listerat(files), nil

	case "Stat":
		file, err := fs.fetch(r.Filepath)
		if err != nil {
			return nil, err
		}
		return listerat{file}, nil

	case "Readlink":
		return nil, errors.New("unsupported")
	}

	return nil, errors.New("unsupported")
}

func (fs *root) readdir(pathname string) ([]os.FileInfo, error) {
	if cleanPath(pathname) == "/" {
		//Handle special root listing
		results := []os.FileInfo{}
		for _, fsh := range fs.fshs {
			results = append(results, NewVrootEmulatedDirEntry(fsh))
		}
		return results, nil
	}

	//Get the content of the dir using fsh infrastructure
	targetFsh, _, rpath, err := fs.getFshAndSubpathFromSFTPPathname(pathname)
	if err != nil {
		return nil, err
	}

	if !targetFsh.FileSystemAbstraction.IsDir(rpath) {
		return nil, syscall.ENOTDIR
	}

	//Read Dir, and convert the results into os.FileInfo
	entries, err := targetFsh.FileSystemAbstraction.ReadDir(rpath)
	if err != nil {
		return nil, err
	}
	files := []os.FileInfo{}
	for _, entry := range entries {
		i, err := entry.Info()
		if err != nil {
			continue
		}
		files = append(files, i)
	}

	sort.Slice(files, func(i, j int) bool { return files[i].Name() < files[j].Name() })

	return files, nil
}

func (fs *root) readlink(pathname string) (string, error) {
	return "", errors.New("unsupported")
}

// implements LstatFileLister interface
func (fs *root) Lstat(r *sftp.Request) (sftp.ListerAt, error) {
	file, err := fs.lfetch(r.Filepath)
	if err != nil {
		return nil, err
	}
	return listerat{file}, nil
}

// implements RealpathFileLister interface
func (fs *root) Realpath(p string) string {
	if fs.startDirectory == "" || fs.startDirectory == "/" {
		return cleanPath(p)
	}
	return cleanPathWithBase(fs.startDirectory, p)
}

//Convert sftp raw path into fsh, subpath and realpath. return err if any
func (fs *root) getFshAndSubpathFromSFTPPathname(pathname string) (*filesystem.FileSystemHandler, string, string, error) {
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

	//Translate it realpath and get from fsh
	fshAbs := fsh.FileSystemAbstraction
	rpath, err := fshAbs.VirtualPathToRealPath(vpath, fs.username)
	if err != nil {
		return nil, "", "", err
	}

	return fsh, subpath, rpath, nil
}

func (fs *root) lfetch(path string) (sftpFileInterface, error) {
	path = strings.TrimSpace(path)
	if path == "/" {
		fmt.Println("Requesting SFTP Root")
		return fs.rootFile, nil
	}

	//Fetching path other than root. Extract the vroot id from the path
	fsh, _, rpath, err := fs.getFshAndSubpathFromSFTPPathname(path)
	if err != nil {
		return nil, err
	}
	fshAbs := fsh.FileSystemAbstraction

	if !fshAbs.FileExists(rpath) {
		//Target file not exists
		return nil, os.ErrExist
	}

	//Open the file and return
	f, err := fshAbs.Open(rpath)
	if err != nil {
		return nil, err
	}

	f2 := newArozFileWrapper(f)
	return f2, nil
}

func (fs *root) fetch(path string) (sftpFileInterface, error) {
	file, err := fs.lfetch(path)
	if err != nil {
		return nil, err
	}
	return file, nil
}

// Have memFile fulfill os.FileInfo interface
func (f *rootFolder) Name() string { return path.Base(f.name) }
func (f *rootFolder) Size() int64 {
	return int64(len(f.content))
}
func (f *rootFolder) Mode() os.FileMode {
	return os.FileMode(0755) | os.ModeDir
}
func (f *rootFolder) ModTime() time.Time { return f.modtime }
func (f *rootFolder) IsDir() bool        { return f.isdir }
func (f *rootFolder) Sys() interface{} {
	return nil
}

func (f *rootFolder) ReadAt(b []byte, off int64) (int, error) {
	return 0, errors.New("root folder not support writeAt")
}

func (f *rootFolder) WriteAt(b []byte, off int64) (int, error) {
	// mimic write delays, should be optional
	time.Sleep(time.Microsecond * time.Duration(len(b)))
	return 0, errors.New("root folder not support writeAt")
}

/*

	Utilities

*/

// Makes sure we have a clean POSIX (/) absolute path to work with
func cleanPath(p string) string {
	return cleanPathWithBase("/", p)
}

func cleanPathWithBase(base, p string) string {
	p = filepath.ToSlash(filepath.Clean(p))
	if !path.IsAbs(p) {
		return path.Join(base, p)
	}
	return p
}
