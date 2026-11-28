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
	"os"
	"path/filepath"
	"reflect"
	"strconv"
	"strings"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/filesystem/abstractions/ftpfs"
	"imuslab.com/arozos/mod/filesystem/abstractions/localfs"
	"imuslab.com/arozos/mod/filesystem/abstractions/s3fs"
	sftpfs "imuslab.com/arozos/mod/filesystem/abstractions/sftpfs"
	"imuslab.com/arozos/mod/filesystem/abstractions/smbfs"
	"imuslab.com/arozos/mod/filesystem/abstractions/webdavfs"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
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

// Runtime persistence config, use to pass through startup paramters related to file system handlers
type RuntimePersistenceConfig struct {
	LocalBufferPath string
}

// System Handler for returing
type FileSystemHandler struct {
	Name                     string
	UUID                     string
	Path                     string
	Hierarchy                string
	HierarchyConfig          HierarchySpecificConfig
	ReadOnly                 bool
	RequireBuffer            bool //Set this to true if the fsh do not provide file header functions like Open() or Create(), require WriteStream() and ReadStream()
	Parentuid                string
	InitiationTime           int64
	FileSystemAbstraction    FileSystemAbstraction
	Filesystem               string
	StartOptions             FileSystemOption
	RuntimePersistenceConfig RuntimePersistenceConfig
	Closed                   bool
}

// Create a list of file system handler from the given json content
func NewFileSystemHandlersFromJSON(jsonContent []byte, runtimePersistenceConfig RuntimePersistenceConfig) ([]*FileSystemHandler, error) {
	//Generate a list of handler option from json file
	options, err := loadConfigFromJSON(jsonContent)
	if err != nil {
		return []*FileSystemHandler{}, err
	}

	logger.Debugf("Filesystem", "NewFileSystemHandlersFromJSON: %d drive option(s) in a %d byte config", len(options), len(jsonContent))
	resultingHandlers := []*FileSystemHandler{}
	for i, option := range options {
		logger.Debugf("Filesystem", "NewFileSystemHandlersFromJSON: opening drive %d of %d: %s", i+1, len(options), option.DebugString())
		thisHandler, err := NewFileSystemHandler(option, runtimePersistenceConfig)
		if err != nil {
			logger.PrintAndLog("Filesystem", "[File System] Failed to create system handler for "+option.Name, nil)
			logger.Debugf("Filesystem", "NewFileSystemHandlersFromJSON: skipped %s:/ (%s): %v", option.Uuid, option.Name, err)
			//log.Println(err.Error())
			continue
		}
		if thisHandler == nil || thisHandler.FileSystemAbstraction == nil {
			logger.Debugf("Filesystem", "NewFileSystemHandlersFromJSON: %s:/ returned no error but %s, it will be put in the pool as is", option.Uuid, thisHandler.Describe())
		}
		resultingHandlers = append(resultingHandlers, thisHandler)
	}

	logger.Debugf("Filesystem", "NewFileSystemHandlersFromJSON: opened %d of %d drive(s): %s", len(resultingHandlers), len(options), DebugHandlerList(resultingHandlers))
	return resultingHandlers, nil
}

// Create a new file system handler with the given config
func NewFileSystemHandler(option FileSystemOption, RuntimePersistenceConfig RuntimePersistenceConfig) (*FileSystemHandler, error) {
	defer logger.TracePanicFunc("Filesystem", func() string {
		return "creating the drive handler of " + option.Uuid + ":/ (" + option.Filesystem + ")"
	})
	fstype := strings.ToLower(option.Filesystem)
	logger.Debugf("Filesystem", "NewFileSystemHandler: %s (buffer folder %q)", option.DebugString(), RuntimePersistenceConfig.LocalBufferPath)
	if inSlice([]string{"ext4", "ext2", "ext3", "fat", "vfat", "ntfs"}, fstype) || fstype == "" {
		//Check if the target fs require mounting
		if option.Automount == true {
			// If a partition UUID is stored, try to resolve the actual device path from
			// the UUID first (survives USB device renames across reboots). Fall back to
			// the stored device path if UUID lookup fails.
			actualMountDev := option.Mountdev
			if option.DiskUUID != "" {
				if resolvedPath, err := ResolveDeviceByUUID(option.DiskUUID); err == nil {
					logger.PrintAndLog("Filesystem", "[Storage] Resolved device by UUID "+option.DiskUUID+" -> "+resolvedPath, nil)
					actualMountDev = resolvedPath
				} else {
					logger.PrintAndLog("Filesystem", "[Storage] UUID lookup failed for "+option.DiskUUID+", falling back to device path "+option.Mountdev, nil)
				}
			}
			logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ mounting device %q (%s) at %q", option.Uuid, actualMountDev, option.Filesystem, option.Mountpt)
			err := MountDevice(option.Mountpt, actualMountDev, option.Filesystem)
			if err != nil {
				logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ mount of %q failed: %v. Returning an EMPTY handler with no abstraction along with the error; a caller that uses it anyway panics on a nil FileSystemAbstraction", option.Uuid, actualMountDev, err)
				return &FileSystemHandler{}, err
			}
			logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ mounted %q at %q", option.Uuid, actualMountDev, option.Mountpt)
		}

		//Check if the path exists
		if !FileExists(option.Path) {
			logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ root %q does not exist. Returning an EMPTY handler with no abstraction along with the error; a caller that uses it anyway panics on a nil FileSystemAbstraction", option.Uuid, option.Path)
			return &FileSystemHandler{}, errors.New("Mount point not exists!")
		}

		//Handle Hierarchy branching
		if option.Hierarchy == "user" {
			//Create user hierarchy for this virtual device
			os.MkdirAll(filepath.ToSlash(filepath.Clean(option.Path))+"/users", 0755)
		}

		rootpath := filepath.ToSlash(filepath.Clean(option.Path)) + "/"
		logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ is a local drive rooted at %q (%s hierarchy)", option.Uuid, rootpath, option.Hierarchy)
		return &FileSystemHandler{
			Name:                     option.Name,
			UUID:                     option.Uuid,
			Path:                     filepath.ToSlash(filepath.Clean(option.Path)) + "/",
			ReadOnly:                 option.Access == arozfs.FsReadOnly,
			RequireBuffer:            false,
			Hierarchy:                option.Hierarchy,
			HierarchyConfig:          DefaultEmptyHierarchySpecificConfig,
			InitiationTime:           time.Now().Unix(),
			FileSystemAbstraction:    localfs.NewLocalFileSystemAbstraction(option.Uuid, rootpath, option.Hierarchy, option.Access == arozfs.FsReadOnly),
			Filesystem:               fstype,
			StartOptions:             option,
			RuntimePersistenceConfig: RuntimePersistenceConfig,
			Closed:                   false,
		}, nil

	} else if fstype == "webdav" {
		//WebDAV. Create an object and mount it
		root := option.Path
		user := option.Username
		password := option.Password

		logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ connecting to WebDAV %q", option.Uuid, root)
		webdavfs, err := webdavfs.NewWebDAVMount(option.Uuid, option.Hierarchy, root, user, password)
		if err != nil {
			logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ WebDAV connection failed: %v", option.Uuid, err)
			return nil, err
		}
		logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ WebDAV connected (%s)", option.Uuid, DebugAbstractionType(webdavfs))
		return &FileSystemHandler{
			Name:                  option.Name,
			UUID:                  option.Uuid,
			Path:                  option.Path,
			ReadOnly:              option.Access == arozfs.FsReadOnly,
			RequireBuffer:         true,
			Hierarchy:             option.Hierarchy,
			HierarchyConfig:       nil,
			InitiationTime:        time.Now().Unix(),
			FileSystemAbstraction: webdavfs,
			Filesystem:            fstype,
			StartOptions:          option,
			Closed:                false,
		}, nil
	} else if fstype == "smb" {
		//SMB. Create an object and mount it
		pathChunks := strings.Split(strings.ReplaceAll(option.Path, "\\", "/"), "/")

		if len(pathChunks) < 2 {
			logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ SMB path %q has no share part", option.Uuid, option.Path)
			logger.PrintAndLog("Filesystem", "[File System] Invalid configured smb filepath: Path format not matching [ip_addr]:[port]/[root_share path]", nil)
			return nil, errors.New("Invalid configured smb filepath: Path format not matching [ip_addr]:[port]/[root_share path]")
		}

		ipAddr := pathChunks[0]
		rootShare := strings.Join(pathChunks[1:], "/")
		user := option.Username
		password := option.Password
		logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ connecting to SMB host %q share %q", option.Uuid, ipAddr, rootShare)
		smbfs, err := smbfs.NewServerMessageBlockFileSystemAbstraction(
			option.Uuid,
			option.Hierarchy,
			ipAddr,
			rootShare,
			user,
			password,
		)
		if err != nil {
			logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ SMB connection failed: %v", option.Uuid, err)
			return nil, err
		}
		logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ SMB connected (%s)", option.Uuid, DebugAbstractionType(smbfs))

		thisFsh := FileSystemHandler{
			Name:                  option.Name,
			UUID:                  option.Uuid,
			Path:                  option.Path,
			ReadOnly:              option.Access == arozfs.FsReadOnly,
			RequireBuffer:         false,
			Hierarchy:             option.Hierarchy,
			HierarchyConfig:       nil,
			InitiationTime:        time.Now().Unix(),
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
		logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ connecting to SFTP %s:%d root %q", option.Uuid, ipAddr, port, "/"+strings.Join(rootShare, "/"))
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
			logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ SFTP connection failed: %v", option.Uuid, err)
			return nil, err
		}
		logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ SFTP connected (%s)", option.Uuid, DebugAbstractionType(sftpfs))

		thisFsh := FileSystemHandler{
			Name:                  option.Name,
			UUID:                  option.Uuid,
			Path:                  option.Path,
			ReadOnly:              option.Access == arozfs.FsReadOnly,
			RequireBuffer:         false,
			Hierarchy:             option.Hierarchy,
			HierarchyConfig:       nil,
			InitiationTime:        time.Now().Unix(),
			FileSystemAbstraction: sftpfs,
			Filesystem:            fstype,
			StartOptions:          option,
			Closed:                false,
		}

		return &thisFsh, nil
	} else if fstype == "ftp" {

		logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ connecting to FTP %q", option.Uuid, option.Path)
		ftpfs, err := ftpfs.NewFTPFSAbstraction(option.Uuid, option.Hierarchy, option.Path, option.Username, option.Password)
		if err != nil {
			logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ FTP connection failed: %v", option.Uuid, err)
			return nil, err
		}
		logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ FTP connected (%s)", option.Uuid, DebugAbstractionType(ftpfs))
		return &FileSystemHandler{
			Name:                  option.Name,
			UUID:                  option.Uuid,
			Path:                  option.Path,
			ReadOnly:              option.Access == arozfs.FsReadOnly,
			RequireBuffer:         true,
			Hierarchy:             option.Hierarchy,
			HierarchyConfig:       nil,
			InitiationTime:        time.Now().Unix(),
			FileSystemAbstraction: ftpfs,
			Filesystem:            fstype,
			StartOptions:          option,
			Closed:                false,
		}, nil

	} else if fstype == "s3" {
		// S3-compatible object storage (AWS S3, MinIO, Wasabi, Backblaze B2, Cloudflare R2, …)
		//
		// Path format: "[http://]<endpoint>[:<port>]/<bucket>[/<prefix>]"
		//   Username  = Access Key ID
		//   Password  = Secret Access Key
		//
		// SSL is enabled by default.  Prefix the endpoint with "http://" to
		// force plain HTTP (e.g. for local MinIO in development).

		rawPath := option.Path
		useSSL := true

		if strings.HasPrefix(rawPath, "http://") {
			useSSL = false
			rawPath = strings.TrimPrefix(rawPath, "http://")
		} else if strings.HasPrefix(rawPath, "https://") {
			rawPath = strings.TrimPrefix(rawPath, "https://")
		}

		// Split into endpoint / bucket / optional prefix
		pathChunks := strings.SplitN(rawPath, "/", 3)
		if len(pathChunks) < 2 {
			return nil, errors.New("invalid S3 path format; expected: [http://]<endpoint>/<bucket>[/<prefix>]")
		}

		endpoint := pathChunks[0]
		bucket := pathChunks[1]
		prefix := ""
		if len(pathChunks) == 3 {
			prefix = strings.Trim(pathChunks[2], "/")
		}

		logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ connecting to S3 endpoint %q bucket %q prefix %q ssl=%v", option.Uuid, endpoint, bucket, prefix, useSSL)
		s3fsh, err := s3fs.NewS3FSAbstraction(
			option.Uuid,
			option.Hierarchy,
			endpoint,
			bucket,
			prefix,
			option.Username,
			option.Password,
			useSSL,
		)
		if err != nil {
			logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ S3 connection failed: %v", option.Uuid, err)
			return nil, err
		}
		logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ S3 connected (%s)", option.Uuid, DebugAbstractionType(s3fsh))

		return &FileSystemHandler{
			Name:                  option.Name,
			UUID:                  option.Uuid,
			Path:                  option.Path,
			ReadOnly:              option.Access == arozfs.FsReadOnly,
			RequireBuffer:         true, // S3 uses streaming only; no file-handle semantics
			Hierarchy:             option.Hierarchy,
			HierarchyConfig:       nil,
			InitiationTime:        time.Now().Unix(),
			FileSystemAbstraction: s3fsh,
			Filesystem:            fstype,
			StartOptions:          option,
			Closed:                false,
		}, nil

	} else if option.Filesystem == "virtual" {
		//Virtual filesystem, deprecated
		logger.PrintAndLog("Filesystem", "[File System] Deprecated file system type: Virtual", nil)
	}

	logger.Debugf("Filesystem", "NewFileSystemHandler: %s:/ has unsupported file system %q, no handler created", option.Uuid, fstype)
	return nil, errors.New("Not supported file system: " + fstype)
}

// Check if a fsh is a network drive
func (fsh *FileSystemHandler) IsNetworkDrive() bool {
	return arozfs.IsNetworkDrive(fsh.Filesystem)
}

// Check if a fsh is a local disk drive
func (fsh *FileSystemHandler) IsLocalDrive() bool {
	//Check if network drive
	if arozfs.IsNetworkDrive(fsh.Filesystem) {
		return false
	}

	//Check if mounted locally
	if _, err := os.Stat(fsh.Path); os.IsNotExist(err) {
		return false
	}

	return true
}

// Buffer a file to local tmp folder and return the tmp location for further processing
func (fsh *FileSystemHandler) BufferRemoteToLocal(rpath string) (string, error) {
	defer logger.TracePanicFunc("Filesystem", func() string { return "buffering " + rpath + " to the local disk" })
	logger.Debugf("Filesystem", "BufferRemoteToLocal: %q from %s", rpath, fsh.Describe())
	//Check if the remote file exists
	fsa := fsh.FileSystemAbstraction
	if !fsa.FileExists(rpath) {
		//Target file not exists
		return "", errors.New("target file not exists on remote")
	}

	//Check if the remote is a file (not support dir)
	if fsa.IsDir(rpath) {
		return "", errors.New("directory cannot be buffered to local")
	}

	//Get the tmp folder directory
	tmpdir := fsh.RuntimePersistenceConfig.LocalBufferPath
	if !utils.FileExists(tmpdir) {
		//Create the tmp dir if not exists
		os.MkdirAll(tmpdir, 0775)
	}

	//Generate a filename for the buffer file
	tmpFilename := uuid.NewV4().String()
	tmpFilepath := arozfs.ToSlash(filepath.Join(tmpdir, tmpFilename+filepath.Ext(rpath)))

	//Copy the file from remote location to local
	src, err := fsh.FileSystemAbstraction.ReadStream(rpath)
	if err != nil {
		return "", err
	}
	defer src.Close()

	dest, err := os.OpenFile(tmpFilepath, os.O_CREATE|os.O_WRONLY, 0777)
	if err != nil {
		return "", errors.New("unable to write to buffer location: " + err.Error())
	}
	defer dest.Close()

	copied, err := io.Copy(dest, src)
	if err != nil {
		logger.Debugf("Filesystem", "BufferRemoteToLocal: %q failed after %d bytes: %v", rpath, copied, err)
		return "", errors.New("file buffer failed: " + err.Error())
	}

	//Return the buffered filepath on local disk
	logger.Debugf("Filesystem", "BufferRemoteToLocal: %q buffered to %q (%d bytes)", rpath, tmpFilepath, copied)
	return tmpFilepath, nil
}

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
	logger.Debugf("Filesystem", "GetDirctorySizeFromRealPath: walking %q on %s", rpath, fsh.Describe())
	err := fsh.FileSystemAbstraction.Walk(rpath, func(thisFilename string, info os.FileInfo, err error) error {
		if err != nil {
			logger.Debugf("Filesystem", "GetDirctorySizeFromRealPath: %q: error at %q: %v", rpath, thisFilename, err)
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

// Reload the target file system abstraction
func (fsh *FileSystemHandler) ReloadFileSystelAbstraction() error {
	defer logger.TracePanicFunc("Filesystem", func() string { return "reloading the abstraction of " + fsh.UUID + ":/" })
	logger.PrintAndLog("Filesystem", "[File System] Reloading File System Abstraction for "+fsh.Name, nil)
	logger.Debugf("Filesystem", "ReloadFileSystelAbstraction: closing %s. Until the reload ends it stays closed, and calls already holding it use the old abstraction", fsh.Describe())
	//Load the start option for this fsh
	originalStartOption := fsh.StartOptions
	runtimePersistenceConfig := fsh.RuntimePersistenceConfig
	//Close the file system handler
	fsh.Close()

	//Give it a few ms to do physical disk stuffs
	time.Sleep(800 * time.Millisecond)

	//Generate a new fsh from original start option
	reloadedFsh, err := NewFileSystemHandler(originalStartOption, runtimePersistenceConfig)
	if err != nil {
		logger.Debugf("Filesystem", "ReloadFileSystelAbstraction: %s:/ could not be opened again: %v. It stays CLOSED with its old, closed abstraction", fsh.UUID, err)
		return err
	}
	logger.Debugf("Filesystem", "ReloadFileSystelAbstraction: %s:/ reconnected, swapping in the new %s", fsh.UUID, DebugAbstractionType(reloadedFsh.FileSystemAbstraction))

	//Overwrite the pointers to target fsa
	fsh.FileSystemAbstraction = reloadedFsh.FileSystemAbstraction
	fsh.Closed = false
	logger.Debugf("Filesystem", "ReloadFileSystelAbstraction: %s reopened", fsh.Describe())
	return nil
}

// Check if this file system require user isolation (aka Hierarchy == user)
func (fsh *FileSystemHandler) RequierUserIsolation() bool {
	return fsh.Hierarchy == "user"
}

// Close an openeded File System
func (fsh *FileSystemHandler) Close() {
	defer logger.TracePanicFunc("Filesystem", func() string { return "closing drive handler " + fsh.DebugString() })
	logger.Debugf("Filesystem", "Close: %s", fsh.Describe())
	if fsh.FileSystemAbstraction == nil {
		logger.Debugf("Filesystem", "Close: %s:/ has no abstraction, closing it panics with a nil pointer dereference", fsh.UUID)
	}
	//Set the close flag to true so others function wont access it
	fsh.Closed = true

	//Close the file system object
	err := fsh.FileSystemAbstraction.Close()
	if err != nil {
		logger.PrintAndLog("Filesystem", "[File System]  Unable to close File System Abstraction for Handler: "+fsh.UUID+". Skipping.", nil)
		logger.Debugf("Filesystem", "Close: %s:/ abstraction close error: %v", fsh.UUID, err)
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

/*
	Debug descriptions

	Descriptions of drive handlers and their start options for DEBUG log
	lines (see logger.Debug). They never fail on a half built handler, since
	those are what a crash trace is usually after, and never hold a
	password.
*/

// DebugString describes a drive handler in one line, as
//
//	"Photos" (photos:/ ext4 public rw, *localfs.LocalFileSystemAbstraction)
//
// It names a missing or nil pointer abstraction and a closed handler, the
// two states that turn later calls on the handler into a panic.
func (fsh *FileSystemHandler) DebugString() string {
	if fsh == nil {
		return "<nil drive handler>"
	}
	access := "rw"
	if fsh.ReadOnly {
		access = "ro"
	}
	details := []string{fsh.UUID + ":/", orDash(fsh.Filesystem), orDash(fsh.Hierarchy), access}
	description := strconv.Quote(fsh.Name) + " (" + strings.Join(details, " ") + ", " + DebugAbstractionType(fsh.FileSystemAbstraction)
	if fsh.Closed {
		description += ", CLOSED"
	}
	return description + ")"
}

// HandlerDescription prints as the DebugString of a drive handler. It holds
// only the pointer, so passing one to logger.Debugf costs nothing while
// debug is off: the description is built when the line is written.
type HandlerDescription struct {
	fsh *FileSystemHandler
}

func (d HandlerDescription) String() string {
	return d.fsh.DebugString()
}

// Describe returns fsh for a logger.Debugf argument, described as by
// DebugString only if the debug line is written. Use it instead of
// DebugString in debug lines on paths every request takes.
func (fsh *FileSystemHandler) Describe() HandlerDescription {
	return HandlerDescription{fsh: fsh}
}

// DebugAbstractionType names the type of a file system abstraction, and
// says when it is nil or a nil pointer: calling a method on either panics
func DebugAbstractionType(fsa FileSystemAbstraction) string {
	if fsa == nil {
		return "abstraction <nil>"
	}
	name := fmt.Sprintf("%T", fsa)
	value := reflect.ValueOf(fsa)
	switch value.Kind() {
	case reflect.Pointer, reflect.Map, reflect.Slice, reflect.Interface, reflect.Func, reflect.Chan:
		if value.IsNil() {
			return name + " <nil pointer>"
		}
	}
	return name
}

// DebugString describes a drive's start options in one line. The password
// is left out; only whether one is set is shown.
func (option FileSystemOption) DebugString() string {
	parts := []string{
		"name=" + strconv.Quote(option.Name),
		"uuid=" + option.Uuid,
		"fs=" + orDash(option.Filesystem),
		"path=" + strconv.Quote(option.Path),
		"hierarchy=" + orDash(option.Hierarchy),
		"access=" + orDash(option.Access),
	}
	if option.Automount {
		parts = append(parts, "automount=true", "mountdev="+orDash(option.Mountdev), "mountpt="+strconv.Quote(option.Mountpt))
	}
	if option.DiskUUID != "" {
		parts = append(parts, "diskuuid="+option.DiskUUID)
	}
	if option.Username != "" {
		parts = append(parts, "username="+strconv.Quote(option.Username))
	}
	if option.Password != "" {
		parts = append(parts, "password=<set>")
	}
	return strings.Join(parts, " ")
}

// DebugHandlerList describes a list of drive handlers as their ids, for
// one line listing what a pool holds
func DebugHandlerList(handlers []*FileSystemHandler) string {
	ids := make([]string, 0, len(handlers))
	for _, fsh := range handlers {
		if fsh == nil {
			ids = append(ids, "<nil>")
			continue
		}
		id := fsh.UUID + ":/"
		if fsh.FileSystemAbstraction == nil {
			id += "(no abstraction)"
		}
		if fsh.Closed {
			id += "(closed)"
		}
		ids = append(ids, id)
	}
	return "[" + strings.Join(ids, ", ") + "]"
}

func orDash(s string) string {
	if s == "" {
		return "-"
	}
	return s
}
