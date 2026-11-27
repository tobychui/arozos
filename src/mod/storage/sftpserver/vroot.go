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
	"imuslab.com/arozos/mod/storage/quotafs"
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
	quota          quotafs.Quota //nil for no limit
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

// GetNewSFTPRoot serves the drives of a user. userQuota is the storage quota
// the user's writes are held to, or nil for none.
func GetNewSFTPRoot(username string, userAccess Access, userQuota quotafs.Quota) sftp.Handlers {
	root := &root{
		username:       username,
		rootFile:       &rootFolder{name: "/", modtime: time.Now(), isdir: true},
		startDirectory: "/",
		access:         userAccess,
		quota:          userQuota,
	}
	return sftp.Handlers{root, root, root, root}
}

func (fs *root) getFshFromID(fshID string) *filesystem.FileSystemHandler {
	for _, thisFsh := range fs.access.GetAllFileSystemHandler() {
		if thisFsh.UUID == fshID && !thisFsh.Closed {
			return thisFsh
		}
	}

	return nil
}

// getWritableFsh resolves a path the user is about to change
func (fs *root) getWritableFsh(pathname string) (*filesystem.FileSystemHandler, string, error) {
	fsh, subpath, rpath, err := fs.getFshAndSubpathFromSFTPPathname(pathname)
	if err != nil {
		return nil, "", err
	}
	if !fs.access.CanWrite(fsh.UUID + ":/" + subpath) {
		return nil, "", os.ErrPermission
	}
	return fsh, rpath, nil
}

func (fs *root) Fileread(r *sftp.Request) (io.ReaderAt, error) {
	flags := r.Pflags()
	if !flags.Read {
		// sanity check
		return nil, os.ErrInvalid
	}

	//Read only, or a user without write access could not read at all
	fsh, _, rpath, err := fs.getFshAndSubpathFromSFTPPathname(r.Filepath)
	if err != nil {
		return nil, err
	}

	f, err := fsh.FileSystemAbstraction.OpenFile(rpath, os.O_RDONLY, 0775)
	if err != nil {
		return nil, err
	}

	return f, nil
}

func (fs *root) Filewrite(r *sftp.Request) (io.WriterAt, error) {
	if arozfs.ToSlash(filepath.Dir(r.Filepath)) == "/" {
		//Uploading to virtual root folder. Return error
		return nil, errors.New("ArozOS SFTP root is read only")
	}

	fsh, rpath, err := fs.getWritableFsh(r.Filepath)
	if err != nil {
		return nil, err
	}

	f, err := quotafs.For(fsh, fs.quota).OpenFile(rpath, os.O_WRONLY|openFlags(r.Pflags()), 0775)
	if err != nil {
		return nil, err
	}

	return f, nil
}

func (fs *root) OpenFile(r *sftp.Request) (sftp.WriterAtReaderAt, error) {
	if arozfs.ToSlash(filepath.Dir(r.Filepath)) == "/" {
		return nil, errors.New("ArozOS SFTP root is read only")
	}
	fsh, rpath, err := fs.getWritableFsh(r.Filepath)
	if err != nil {
		return nil, err
	}

	f, err := quotafs.For(fsh, fs.quota).OpenFile(rpath, os.O_RDWR|openFlags(r.Pflags()), 0775)
	if err != nil {
		return nil, err
	}

	return f, nil
}

// openFlags carries the create, truncate, exclusive and append choices of a
// client over. Without the truncate flag, a smaller file uploaded over a
// bigger one would keep the old file's tail.
func openFlags(p sftp.FileOpenFlags) int {
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
	oldFsh, realOldPath, err := fs.getWritableFsh(oldpath)
	if err != nil {
		return err
	}
	newFsh, realNewPath, err := fs.getWritableFsh(newpath)
	if err != nil {
		return err
	}

	destDrive := quotafs.For(newFsh, fs.quota)
	if oldFsh.UUID == newFsh.UUID {
		//A rename can replace a file, whose space comes back
		replaced := int64(0)
		if destDrive.Tracked() && !strings.EqualFold(realOldPath, realNewPath) {
			if info, err := newFsh.FileSystemAbstraction.Stat(realNewPath); err == nil && !info.IsDir() {
				replaced = info.Size()
			}
		}

		//Use rename function
		err = oldFsh.FileSystemAbstraction.Rename(realOldPath, realNewPath)
		if err != nil {
			return err
		}
		destDrive.Claim(-replaced)
	} else {
		return fs.moveAcross(oldFsh, realOldPath, newFsh, realNewPath)
	}

	return nil
}

// moveAcross moves a file or folder tree to another drive: everything is
// copied over, and the source is only removed once the whole copy succeeded.
// A copy that fails leaves the source as it was and removes what it wrote.
func (fs *root) moveAcross(srcFsh *filesystem.FileSystemHandler, src string, destFsh *filesystem.FileSystemHandler, dest string) error {
	srcFsa, destFsa := srcFsh.FileSystemAbstraction, destFsh.FileSystemAbstraction
	srcInfo, err := srcFsa.Stat(src)
	if err != nil {
		return err
	}
	destExisted := false
	if destInfo, err := destFsa.Stat(dest); err == nil {
		if destInfo.IsDir() || srcInfo.IsDir() {
			//Like a rename on one drive, a folder is not merged into another
			//and a file does not replace a folder
			return os.ErrExist
		}
		destExisted = true
	}

	//What each drive gains or loses, of which only the gain is claimed up
	//front, so that a refused move changes nothing
	srcDrive, destDrive := quotafs.For(srcFsh, fs.quota), quotafs.For(destFsh, fs.quota)
	moved := srcDrive.Size(src)
	change := int64(0)
	if destDrive.Tracked() {
		change += moved - destDrive.Size(dest)
	}
	if srcDrive.Tracked() {
		change -= moved
	}
	if change > 0 {
		if err := destDrive.Claim(change); err != nil {
			return err
		}
	}

	if err := copyTree(srcFsa, src, destFsa, dest); err != nil {
		if !destExisted {
			destFsa.RemoveAll(dest)
		}
		if change > 0 {
			destDrive.Claim(-change)
		}
		return err
	}
	if err := srcFsa.RemoveAll(src); err != nil {
		//Both copies are on disk now; the recount at the end of the session
		//corrects the usage
		return err
	}
	if change < 0 {
		//Space comes back to the quota, through whichever drive counts
		counted := destDrive
		if !counted.Tracked() {
			counted = srcDrive
		}
		counted.Claim(change)
	}
	return nil
}

// copyTree copies a file or folder tree from one drive to another
func copyTree(srcFsa filesystem.FileSystemAbstraction, src string, destFsa filesystem.FileSystemAbstraction, dest string) error {
	info, err := srcFsa.Stat(src)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		f, err := srcFsa.ReadStream(src)
		if err != nil {
			return err
		}
		defer f.Close()
		return destFsa.WriteStream(dest, f, 0775)
	}

	if err := destFsa.MkdirAll(dest, 0775); err != nil {
		return err
	}
	entries, err := srcFsa.ReadDir(src)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		//Real paths of remote drives use forward slashes on every host
		err := copyTree(srcFsa, path.Join(arozfs.ToSlash(src), entry.Name()), destFsa, path.Join(arozfs.ToSlash(dest), entry.Name()))
		if err != nil {
			return err
		}
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
	fsh, rpath, err := fs.getWritableFsh(pathname)
	if err != nil {
		return err
	}

	return fsh.FileSystemAbstraction.MkdirAll(rpath, 0775)
}

func (fs *root) rmdir(pathname string) error {
	fsh, rpath, err := fs.getWritableFsh(pathname)
	if err != nil {
		return err
	}
	return quotafs.For(fsh, fs.quota).RemoveAll(rpath)
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
	fsh, rpath, err := fs.getWritableFsh(pathname)
	if err != nil {
		return err
	}

	if fsh.FileSystemAbstraction.IsDir(rpath) {
		// IEEE 1003.1: implementations may opt out of allowing the unlinking of directories.
		// SFTP-v2: SSH_FXP_REMOVE may not remove directories.
		return os.ErrInvalid
	}

	return quotafs.For(fsh, fs.quota).Remove(rpath)
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
		for _, fsh := range fs.access.GetAllFileSystemHandler() {
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

// Convert sftp raw path into fsh, subpath and realpath. return err if any
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
	if !fs.access.CanRead(vpath) {
		return nil, "", "", os.ErrPermission
	}

	//Translate it realpath and get from fsh
	fshAbs := fsh.FileSystemAbstraction
	rpath, err := fshAbs.VirtualPathToRealPath(vpath, fs.username)
	if err != nil {
		return nil, "", "", err
	}

	return fsh, subpath, rpath, nil
}

func (fs *root) lfetch(path string) (os.FileInfo, error) {
	path = strings.TrimSpace(path)
	if path == "/" {
		//fmt.Println("Requesting SFTP Root")
		return fs.rootFile, nil
	}

	//Fetching path other than root. Extract the vroot id from the path
	fsh, _, rpath, err := fs.getFshAndSubpathFromSFTPPathname(path)
	if err != nil {
		return nil, err
	}
	//Stat only: a file opened here would never be closed again, and every
	//stat of a client would keep one more file open on the server
	info, err := fsh.FileSystemAbstraction.Stat(rpath)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, os.ErrNotExist
		}
		return nil, err
	}
	return info, nil
}

func (fs *root) fetch(path string) (os.FileInfo, error) {
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
	//SFTP paths are POSIX paths on every host: filepath.Clean would read a
	//leading // as a Windows network path
	p = path.Clean(filepath.ToSlash(p))
	if !path.IsAbs(p) {
		return path.Join(base, p)
	}
	return p
}
