package arozfs

/*
	arozfs.go

	This package handle error related to file systems.
	See comments below for usage.
*/
import (
	"errors"
	"io"
	"io/fs"
	"path/filepath"
	"regexp"
	"strings"
)

type File interface {
	Chdir() error
	Chmod(mode fs.FileMode) error
	Chown(uid, gid int) error
	Close() error
	Name() string
	Read(b []byte) (n int, err error)
	ReadAt(b []byte, off int64) (n int, err error)
	Readdirnames(n int) (names []string, err error)
	ReadFrom(r io.Reader) (n int64, err error)
	Readdir(n int) ([]fs.FileInfo, error)
	Seek(offset int64, whence int) (ret int64, err error)
	Stat() (fs.FileInfo, error)
	Sync() error
	Truncate(size int64) error
	Write(b []byte) (n int, err error)
	WriteAt(b []byte, off int64) (n int, err error)
	WriteString(s string) (n int, err error)
}

// A shortcut representing struct
type ShortcutData struct {
	Type string //The type of shortcut
	Name string //The name of the shortcut
	Path string //The path of shortcut
	Icon string //The icon of shortcut
}

var (

	/*
		READ WRITE PERMISSIONS
	*/
	FsReadOnly  = "readonly"
	FsWriteOnly = "writeonly"
	FsReadWrite = "readwrite"
	FsDenied    = "denied"

	/*
		ERROR TYPES
	*/
	//Redirective Error
	ErrRedirectParent      = errors.New("Redirect:parent")
	ErrRedirectCurrentRoot = errors.New("Redirect:root")
	ErrRedirectUserRoot    = errors.New("Redirect:userroot")

	//Resolve errors
	ErrVpathResolveFailed = errors.New("FS_VPATH_RESOLVE_FAILED")
	ErrRpathResolveFailed = errors.New("FS_RPATH_RESOLVE_FAILED")
	ErrFSHNotFOund        = errors.New("FS_FILESYSTEM_HANDLER_NOT_FOUND")

	//Operation errors
	ErrOperationNotSupported = errors.New("FS_OPR_NOT_SUPPORTED")
	ErrNullOperation         = errors.New("FS_NULL_OPR")
)

// Generate a File Manager redirection error message
func NewRedirectionError(targetVpath string) error {
	return errors.New("Redirect:" + targetVpath)
}

// Check if a file system is network drive
func IsNetworkDrive(fstype string) bool {
	if fstype == "webdav" || fstype == "ftp" || fstype == "smb" || fstype == "sftp" {
		return true
	}

	return false
}

// Get a list of supported file system types for mounting via arozos
func GetSupportedFileSystemTypes() []string {
	return []string{"ext4", "ext2", "ext3", "fat", "vfat", "ntfs", "webdav", "ftp", "smb", "sftp"}
}

/*
	Standard file system abstraction translate function
*/

// Generic virtual path to real path translator
func GenericVirtualPathToRealPathTranslator(uuid string, hierarchy string, subpath string, username string) (string, error) {
	subpath = ToSlash(filepath.Clean(subpath))
	subpath = ToSlash(filepath.Clean(strings.TrimSpace(subpath)))
	if strings.HasPrefix(subpath, "./") {
		subpath = subpath[1:]
	}

	if subpath == "." || subpath == "" {
		subpath = "/"
	}
	if strings.HasPrefix(subpath, uuid+":") {
		//This is full virtual path. Trim the uuid and correct the subpath
		subpath = strings.TrimPrefix(subpath, uuid+":")
	}

	if hierarchy == "user" {
		return filepath.ToSlash(filepath.Clean(filepath.Join("users", username, subpath))), nil
	} else if hierarchy == "public" {
		return filepath.ToSlash(filepath.Clean(subpath)), nil
	}
	return "", errors.New("unsupported filesystem hierarchy")
}

// Generic real path to virtual path translator
func GenericRealPathToVirtualPathTranslator(uuid string, hierarchy string, rpath string, username string) (string, error) {
	rpath = ToSlash(filepath.Clean(strings.TrimSpace(rpath)))
	if strings.HasPrefix(rpath, "./") {
		rpath = rpath[1:]
	}

	if rpath == "." || rpath == "" {
		rpath = "/"
	}

	if hierarchy == "user" && strings.HasPrefix(rpath, "/users/"+username) {
		rpath = strings.TrimPrefix(rpath, "/users/"+username)
	}

	rpath = filepath.ToSlash(rpath)
	if !strings.HasPrefix(rpath, "/") {
		rpath = "/" + rpath
	}

	return uuid + ":" + rpath, nil
}

// Generic function for abstraction driver to filter incoming paths
func GenericPathFilter(filename string) string {
	filename = ToSlash(filepath.Clean(filename))
	rawpath := strings.TrimSpace(filename)
	if strings.HasPrefix(rawpath, "./") {
		return rawpath[1:]
	} else if rawpath == "." || rawpath == "" {
		return "/"
	}
	return rawpath
}

// Filter illegal characters in filename
func FilterIllegalCharInFilename(filename string, replacement string) string {
	re, _ := regexp.Compile(`[\\\[\]$?#<>+%!"'|{}:@]`)
	return re.ReplaceAllString(filename, replacement)
}

/*
	OS Independent filepath functions
*/

func ToSlash(filename string) string {
	return strings.ReplaceAll(filename, "\\", "/")
}

func Base(filename string) string {
	filename = ToSlash(filename)
	if filename == "" {
		return "."
	}
	if filename == "/" {
		return filename
	}
	for len(filename) > 0 && filename[len(filename)-1] == '/' {
		filename = filename[0 : len(filename)-1]
	}

	c := strings.Split(filename, "/")
	if len(c) == 1 {
		return c[0]
	} else {
		return c[len(c)-1]
	}
}
