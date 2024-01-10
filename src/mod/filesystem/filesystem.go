package filesystem

/*
	ArOZ Online File System Handler Wrappers
	author: tobychui

	This is a module design to do the followings
	1. Mount / Create a fs when open
	2. Provide the basic function and operations of a file system type
	3. THIS MODULE **SHOULD NOT CONTAIN** CROSS FILE SYSTEM TYPE OPERATIONS
*/

import (
	"crypto/md5"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/filesystem/abstractions/ftpfs"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	sftpfs "imuslab.com/arozos/mod/filesystem/abstractions/sftpfs"
	"imuslab.com/arozos/mod/filesystem/abstractions/smbfs"
	"imuslab.com/arozos/mod/filesystem/abstractions/webdavfs"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

//Options for creating new file system handler
/*
type FileSystemOpeningOptions struct{
	Name      string `json:"name"`						//Display name of this device
	Uuid      string `json:"uuid"`						//UUID of this device, e.g. S1
	Path      string `json:"path"`						//Path for the storage root
	Access    string `json:"access,omitempty"`			//Access right, allow {readonly, readwrite}
	Hierarchy string `json:"hierarchy"`					//Folder hierarchy, allow {public, user}
	Automount bool   `json:"automount"`					//Automount this device if exists
	Filesystem string `json:"filesystem,omitempty"`		//Support {"ext4","ext2", "ext3", "fat", "vfat", "ntfs"}
	Mountdev  string `json:"mountdev,omitempty"`		//Device file (e.g. /dev/sda1)
	Mountpt  string `json:"mountpt,omitempty"`			//Device mount point (e.g. /media/storage1)
}
*/

/*
An interface for storing data related to a specific hierarchy settings.
Example like the account information of network drive,
backup mode of backup drive etc
*/
type HierarchySpecificConfig interface{}

type FileSystemAbstraction interface {
	//Fundamental Functions
	Chmod(string, os.FileMode) error
	Chown(string, int, int) error
	Chtimes(string, time.Time, time.Time) error
	Create(string) (arozfs.File, error)
	Mkdir(string, os.FileMode) error
	MkdirAll(string, os.FileMode) error
	Name() string
	Open(string) (arozfs.File, error)
	OpenFile(string, int, os.FileMode) (arozfs.File, error)
	Remove(string) error
	RemoveAll(string) error
	Rename(string, string) error
	Stat(string) (os.FileInfo, error)
	Close() error

	//Utils Functions
	VirtualPathToRealPath(string, string) (string, error)
	RealPathToVirtualPath(string, string) (string, error)
	FileExists(string) bool
	IsDir(string) bool
	Glob(string) ([]string, error)
	GetFileSize(string) int64
	GetModTime(string) (int64, error)
	WriteFile(string, []byte, os.FileMode) error
	ReadFile(string) ([]byte, error)
	ReadDir(string) ([]fs.DirEntry, error)
	WriteStream(string, io.Reader, os.FileMode) error
	ReadStream(string) (io.ReadCloser, error)
	Walk(string, filepath.WalkFunc) error
	Heartbeat() error
}

// System Handler for returing
type FileSystemHandler struct {
	Name                  string
	UUID                  string
	Path                  string
	Hierarchy             string
	HierarchyConfig       HierarchySpecificConfig
	ReadOnly              bool
	RequireBuffer         bool //Set this to true if the fsh do not provide file header functions like Open() or Create(), require WriteStream() and ReadStream()
	Parentuid             string
	InitiationTime        int64
	FilesystemDatabase    *db.Database
	FileSystemAbstraction FileSystemAbstraction
	Filesystem            string
	StartOptions          FileSystemOption
	Closed                bool
}

// Create a list of file system handler from the given json content
func NewFileSystemHandlersFromJSON(jsonContent []byte) ([]*FileSystemHandler, error) {
	//Generate a list of handler option from json file
	options, err := loadConfigFromJSON(jsonContent)
	if err != nil {
		return []*FileSystemHandler{}, err
	}

	resultingHandlers := []*FileSystemHandler{}
	for _, option := range options {
		thisHandler, err := NewFileSystemHandler(option)
		if err != nil {
			log.Println("[File System] Failed to create system handler for " + option.Name)
			//log.Println(err.Error())
			continue
		}
		resultingHandlers = append(resultingHandlers, thisHandler)
	}

	return resultingHandlers, nil
}

// Create a new file system handler with the given config
func NewFileSystemHandler(option FileSystemOption) (*FileSystemHandler, error) {
	fstype := strings.ToLower(option.Filesystem)
	if inSlice([]string{"ext4", "ext2", "ext3", "fat", "vfat", "ntfs"}, fstype) || fstype == "" {
		//Check if the target fs require mounting
		if option.Automount == true {
			err := MountDevice(option.Mountpt, option.Mountdev, option.Filesystem)
			if err != nil {
				return &FileSystemHandler{}, err
			}
		}

		//Check if the path exists
		if !FileExists(option.Path) {
			return &FileSystemHandler{}, errors.New("Mount point not exists!")
		}

		//Handle Hierarchy branching
		if option.Hierarchy == "user" {
			//Create user hierarchy for this virtual device
			os.MkdirAll(filepath.ToSlash(filepath.Clean(option.Path))+"/users", 0755)
		}

		//Create the fsdb for this handler
		var fsdb *db.Database = nil
		dbp, err := db.NewDatabase(filepath.ToSlash(filepath.Join(filepath.Clean(option.Path), "aofs.db")), false)
		if err != nil {
			if option.Access != arozfs.FsReadOnly {
				log.Println("[File System] Invalid config: Trying to mount a read only path as read-write mount point. Changing " + option.Name + " mount point to READONLY.")
				option.Access = arozfs.FsReadOnly
			}
		} else {
			fsdb = dbp
		}
		rootpath := filepath.ToSlash(filepath.Clean(option.Path)) + "/"
		return &FileSystemHandler{
			Name:                  option.Name,
			UUID:                  option.Uuid,
			Path:                  filepath.ToSlash(filepath.Clean(option.Path)) + "/",
			ReadOnly:              option.Access == arozfs.FsReadOnly,
			RequireBuffer:         false,
			Hierarchy:             option.Hierarchy,
			HierarchyConfig:       DefaultEmptyHierarchySpecificConfig,
			InitiationTime:        time.Now().Unix(),
			FilesystemDatabase:    fsdb,
			FileSystemAbstraction: localfs.NewLocalFileSystemAbstraction(option.Uuid, rootpath, option.Hierarchy, option.Access == arozfs.FsReadOnly),
			Filesystem:            fstype,
			StartOptions:          option,
			Closed:                false,
		}, nil

	} else if fstype == "webdav" {
		//WebDAV. Create an object and mount it
		root := option.Path
		user := option.Username
		password := option.Password

		webdavfs, err := webdavfs.NewWebDAVMount(option.Uuid, option.Hierarchy, root, user, password)
		if err != nil {
			return nil, err
		}
		return &FileSystemHandler{
			Name:                  option.Name,
			UUID:                  option.Uuid,
			Path:                  option.Path,
			ReadOnly:              option.Access == arozfs.FsReadOnly,
			RequireBuffer:         true,
			Hierarchy:             option.Hierarchy,
			HierarchyConfig:       nil,
			InitiationTime:        time.Now().Unix(),
			FilesystemDatabase:    nil,
			FileSystemAbstraction: webdavfs,
			Filesystem:            fstype,
			StartOptions:          option,
			Closed:                false,
		}, nil
	} else if fstype == "smb" {
		//SMB. Create an object and mount it
		pathChunks := strings.Split(strings.ReplaceAll(option.Path, "\\", "/"), "/")

		if len(pathChunks) < 2 {
			log.Println("[File System] Invalid configured smb filepath: Path format not matching [ip_addr]:[port]/[root_share path]")
			return nil, errors.New("Invalid configured smb filepath: Path format not matching [ip_addr]:[port]/[root_share path]")
		}

		ipAddr := pathChunks[0]
		rootShare := strings.Join(pathChunks[1:], "/")
		user := option.Username
		password := option.Password
		smbfs, err := smbfs.NewServerMessageBlockFileSystemAbstraction(
			option.Uuid,
			option.Hierarchy,
			ipAddr,
			rootShare,
			user,
			password,
		)
		if err != nil {
			return nil, err
		}

		thisFsh := FileSystemHandler{
			Name:                  option.Name,
			UUID:                  option.Uuid,
			Path:                  option.Path,
			ReadOnly:              option.Access == arozfs.FsReadOnly,
			RequireBuffer:         false,
			Hierarchy:             option.Hierarchy,
			HierarchyConfig:       nil,
			InitiationTime:        time.Now().Unix(),
			FilesystemDatabase:    nil,
			FileSystemAbstraction: smbfs,
			Filesystem:            fstype,
			StartOptions:          option,
			Closed:                false,
		}

		return &thisFsh, nil
	} else if fstype == "sftp" {
		//SFTP
		pathChunks := strings.Split(strings.ReplaceAll(option.Path, "\\", "/"), "/")
		ipAddr := pathChunks[0]
		port := 22
		if strings.Contains(ipAddr, ":") {
			//Custom port defined
			ipChunks := strings.Split(ipAddr, ":")
			ipAddr = ipChunks[0]
			p, err := strconv.Atoi(ipChunks[1])
			if err == nil {
				port = p
			}
		}
		rootShare := pathChunks[1:]
		user := option.Username
		password := option.Password
		sftpfs, err := sftpfs.NewSFTPFileSystemAbstraction(
			option.Uuid,
			option.Hierarchy,
			ipAddr,
			port,
			"/"+strings.Join(rootShare, "/"),
			user,
			password,
		)
		if err != nil {
			fmt.Println(err.Error())
			return nil, err
		}

		thisFsh := FileSystemHandler{
			Name:                  option.Name,
			UUID:                  option.Uuid,
			Path:                  option.Path,
			ReadOnly:              option.Access == arozfs.FsReadOnly,
			RequireBuffer:         false,
			Hierarchy:             option.Hierarchy,
			HierarchyConfig:       nil,
			InitiationTime:        time.Now().Unix(),
			FilesystemDatabase:    nil,
			FileSystemAbstraction: sftpfs,
			Filesystem:            fstype,
			StartOptions:          option,
			Closed:                false,
		}

		return &thisFsh, nil
	} else if fstype == "ftp" {

		ftpfs, err := ftpfs.NewFTPFSAbstraction(option.Uuid, option.Hierarchy, option.Path, option.Username, option.Password)
		if err != nil {
			return nil, err
		}
		return &FileSystemHandler{
			Name:                  option.Name,
			UUID:                  option.Uuid,
			Path:                  option.Path,
			ReadOnly:              option.Access == arozfs.FsReadOnly,
			RequireBuffer:         true,
			Hierarchy:             option.Hierarchy,
			HierarchyConfig:       nil,
			InitiationTime:        time.Now().Unix(),
			FilesystemDatabase:    nil,
			FileSystemAbstraction: ftpfs,
			Filesystem:            fstype,
			StartOptions:          option,
			Closed:                false,
		}, nil

	} else if option.Filesystem == "virtual" {
		//Virtual filesystem, deprecated
		log.Println("[File System] Deprecated file system type: Virtual")
	}

	return nil, errors.New("Not supported file system: " + fstype)
}

func (fsh *FileSystemHandler) IsNetworkDrive() bool {
	return arozfs.IsNetworkDrive(fsh.Filesystem)
}

//Check if a fsh is virtual (e.g. Network or fs Abstractions that cannot be listed with normal fs API)
/*
func (fsh *FileSystemHandler) IsVirtual() bool {
	if fsh.Hierarchy == "virtual" || fsh.Filesystem == "webdav" {
		//Check if the config return placeholder
		c, ok := fsh.HierarchyConfig.(EmptyHierarchySpecificConfig)
		if ok && c.HierarchyType == "placeholder" {
			//Real file system.
			return false
		}

		//Do more checking here if needed
		return true
	}
	return false
}
*/

func (fsh *FileSystemHandler) IsRootOf(vpath string) bool {
	return strings.HasPrefix(vpath, fsh.UUID+":")
}

func (fsh *FileSystemHandler) GetUniquePathHash(vpath string, username string) (string, error) {
	fshAbs := fsh.FileSystemAbstraction
	rpath := ""
	if strings.Contains(vpath, ":/") {
		r, err := fshAbs.VirtualPathToRealPath(vpath, username)
		if err != nil {
			return "", err
		}
		rpath = filepath.ToSlash(r)
	} else {
		//Passed in realpath as vpath.
		rpath = vpath
	}
	hash := md5.Sum([]byte(fsh.UUID + "_" + rpath))
	return hex.EncodeToString(hash[:]), nil
}

func (fsh *FileSystemHandler) GetDirctorySizeFromRealPath(rpath string, includeHidden bool) (int64, int) {
	var size int64 = 0
	var fileCount int = 0
	err := fsh.FileSystemAbstraction.Walk(rpath, func(thisFilename string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			if includeHidden {
				//append all into the file count and size
				size += info.Size()
				fileCount++
			} else {
				//Check if this is hidden
				if !IsInsideHiddenFolder(thisFilename) {
					size += info.Size()
					fileCount++
				}

			}

		}
		return nil
	})
	if err != nil {
		return 0, fileCount
	}
	return size, fileCount
}

func (fsh *FileSystemHandler) GetDirctorySizeFromVpath(vpath string, username string, includeHidden bool) (int64, int) {
	realpath, _ := fsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, username)
	return fsh.GetDirctorySizeFromRealPath(realpath, includeHidden)
}

/*
	File Record Related Functions
	fsh database that keep track of which files is owned by whom
*/

// Create a file ownership record
func (fsh *FileSystemHandler) CreateFileRecord(rpath string, owner string) error {
	if fsh.FilesystemDatabase == nil {
		//Not supported file system type
		return errors.New("Not supported filesystem type")
	}
	fsh.FilesystemDatabase.NewTable("owner")
	fsh.FilesystemDatabase.Write("owner", "owner/"+rpath, owner)
	return nil
}

// Read the owner of a file
func (fsh *FileSystemHandler) GetFileRecord(rpath string) (string, error) {
	if fsh.FilesystemDatabase == nil {
		//Not supported file system type
		return "", errors.New("Not supported filesystem type")
	}

	fsh.FilesystemDatabase.NewTable("owner")
	if fsh.FilesystemDatabase.KeyExists("owner", "owner/"+rpath) {
		owner := ""
		fsh.FilesystemDatabase.Read("owner", "owner/"+rpath, &owner)
		return owner, nil
	} else {
		return "", errors.New("Owner not exists")
	}
}

// Delete a file ownership record
func (fsh *FileSystemHandler) DeleteFileRecord(rpath string) error {
	if fsh.FilesystemDatabase == nil {
		//Not supported file system type
		return errors.New("Not supported filesystem type")
	}

	fsh.FilesystemDatabase.NewTable("owner")
	if fsh.FilesystemDatabase.KeyExists("owner", "owner/"+rpath) {
		fsh.FilesystemDatabase.Delete("owner", "owner/"+rpath)
	}

	return nil
}

// Reload the target file system abstraction
func (fsh *FileSystemHandler) ReloadFileSystelAbstraction() error {
	log.Println("[File System] Reloading File System Abstraction for " + fsh.Name)
	//Load the start option for this fsh
	originalStartOption := fsh.StartOptions

	//Close the file system handler
	fsh.Close()

	//Give it a few ms to do physical disk stuffs
	time.Sleep(800 * time.Millisecond)

	//Generate a new fsh from original start option
	reloadedFsh, err := NewFileSystemHandler(originalStartOption)
	if err != nil {
		return err
	}

	//Overwrite the pointers to target fsa
	fsh.FileSystemAbstraction = reloadedFsh.FileSystemAbstraction
	fsh.FilesystemDatabase = reloadedFsh.FilesystemDatabase
	fsh.Closed = false
	return nil
}

// Close an openeded File System
func (fsh *FileSystemHandler) Close() {
	//Set the close flag to true so others function wont access it
	fsh.Closed = true

	//Close the fsh database
	if fsh.FilesystemDatabase != nil {
		fsh.FilesystemDatabase.Close()
	}

	//Close the file system object
	err := fsh.FileSystemAbstraction.Close()
	if err != nil {
		log.Println("[File System]  Unable to close File System Abstraction for Handler: " + fsh.UUID + ". Skipping.")
	}
}

// Helper function
func inSlice(slice []string, val string) bool {
	for _, item := range slice {
		if item == val {
			return true
		}
	}
	return false
}

func FileExists(filename string) bool {
	_, err := os.Stat(filename)
	if os.IsNotExist(err) {
		return false
	}
	return true
}
