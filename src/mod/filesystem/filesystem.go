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
	"errors"
	"log"
	"os"
	"path/filepath"
	"strings"
	"time"

	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/disk/hybridBackup"
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

//System Handler for returing
type FileSystemHandler struct {
	Name               string
	UUID               string
	Path               string
	Hierarchy          string
	HierarchyConfig    HierarchySpecificConfig
	ReadOnly           bool
	Parentuid          string
	InitiationTime     int64
	FilesystemDatabase *db.Database
	Filesystem         string
	Closed             bool
}

//Create a list of file system handler from the given json content
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
			log.Println("Failed to create system handler for " + option.Name)
			log.Println(err.Error())
			continue
		}
		resultingHandlers = append(resultingHandlers, thisHandler)
	}

	return resultingHandlers, nil
}

//Create a new file system handler with the given config
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
		if !fileExists(option.Path) {
			return &FileSystemHandler{}, errors.New("Mount point not exists!")
		}

		//Handle Hierarchy branching
		var hierarchySpecificConfig interface{} = nil

		if option.Hierarchy == "user" {
			//Create user hierarchy for this virtual device
			os.MkdirAll(filepath.ToSlash(filepath.Clean(option.Path))+"/users", 0755)
		}

		if option.Hierarchy == "backup" {
			//Backup disk. Create an Hierarchy Config for this drive
			hierarchySpecificConfig = hybridBackup.BackupTask{
				CycleCounter:      0,
				LastCycleTime:     0,
				DiskUID:           option.Uuid,
				DiskPath:          option.Path,
				ParentUID:         option.Parentuid,
				Mode:              option.BackupMode,
				DeleteFileMarkers: map[string]int64{},
			}

		}

		//Create the fsdb for this handler
		fsdb, err := db.NewDatabase(filepath.ToSlash(filepath.Join(filepath.Clean(option.Path), "aofs.db")), false)
		if err != nil {
			return &FileSystemHandler{}, errors.New("Unable to create fsdb inside the target path. Is the directory read only?")
		}

		return &FileSystemHandler{
			Name:               option.Name,
			UUID:               option.Uuid,
			Path:               filepath.ToSlash(filepath.Clean(option.Path)) + "/",
			ReadOnly:           option.Access == "readonly",
			Parentuid:          option.Parentuid,
			Hierarchy:          option.Hierarchy,
			HierarchyConfig:    hierarchySpecificConfig,
			InitiationTime:     time.Now().Unix(),
			FilesystemDatabase: fsdb,
			Filesystem:         fstype,
			Closed:             false,
		}, nil
	}

	return nil, errors.New("Not supported file system: " + fstype)
}

//Create a file ownership record
func (fsh *FileSystemHandler) CreateFileRecord(realpath string, owner string) error {
	rpabs, _ := filepath.Abs(realpath)
	fsrabs, _ := filepath.Abs(fsh.Path)
	reldir, err := filepath.Rel(fsrabs, rpabs)
	if err != nil {
		return err

	}
	fsh.FilesystemDatabase.NewTable("owner")
	fsh.FilesystemDatabase.Write("owner", "owner/"+reldir, owner)
	return nil
}

//Read the owner of a file
func (fsh *FileSystemHandler) GetFileRecord(realpath string) (string, error) {
	rpabs, _ := filepath.Abs(realpath)
	fsrabs, _ := filepath.Abs(fsh.Path)
	reldir, err := filepath.Rel(fsrabs, rpabs)
	if err != nil {
		return "", err
	}
	fsh.FilesystemDatabase.NewTable("owner")
	if fsh.FilesystemDatabase.KeyExists("owner", "owner/"+reldir) {
		owner := ""
		fsh.FilesystemDatabase.Read("owner", "owner/"+reldir, &owner)
		return owner, nil
	} else {
		return "", errors.New("Owner not exists")
	}
}

//Delete a file ownership record
func (fsh *FileSystemHandler) DeleteFileRecord(realpath string) error {
	rpabs, _ := filepath.Abs(realpath)
	fsrabs, _ := filepath.Abs(fsh.Path)
	reldir, err := filepath.Rel(fsrabs, rpabs)
	if err != nil {
		return err
	}
	fsh.FilesystemDatabase.NewTable("owner")
	if fsh.FilesystemDatabase.KeyExists("owner", "owner/"+reldir) {
		fsh.FilesystemDatabase.Delete("owner", "owner/"+reldir)
	}

	return nil
}

//Close an openeded File System
func (fsh *FileSystemHandler) Close() {
	//Close the fsh database
	fsh.FilesystemDatabase.Close()
}

//Helper function
func inSlice(slice []string, val string) bool {
	for _, item := range slice {
		if item == val {
			return true
		}
	}
	return false
}

func FileExists(filename string) bool {
	return fileExists(filename)
}

//Check if file exists
func fileExists(filename string) bool {
	_, err := os.Stat(filename)
	if os.IsNotExist(err) {
		return false
	}
	return true
}
