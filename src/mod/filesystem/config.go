package filesystem

import (
	"encoding/json"
	"errors"
	"strings"
)

//FileSystem configuration. Append more lines if required.
type FileSystemOption struct {
	Name       string `json:"name"`                 //Display name of this device
	Uuid       string `json:"uuid"`                 //UUID of this device, e.g. S1
	Path       string `json:"path"`                 //Path for the storage root
	Access     string `json:"access,omitempty"`     //Access right, allow {readonly, readwrite}
	Hierarchy  string `json:"hierarchy"`            //Folder hierarchy, allow {public, user}
	Automount  bool   `json:"automount"`            //Automount this device if exists
	Filesystem string `json:"filesystem,omitempty"` //Support {"ext4","ext2", "ext3", "fat", "vfat", "ntfs"}
	Mountdev   string `json:"mountdev,omitempty"`   //Device file (e.g. /dev/sda1)
	Mountpt    string `json:"mountpt,omitempty"`    //Device mount point (e.g. /media/storage1)

	//Backup Hierarchy Options
	Parentuid  string `json:"parentuid,omitempty"`  //The parent mount point for backup source, backup disk only
	BackupMode string `json:"backupmode,omitempty"` //Backup mode of the virtual disk

	Username string `json:"username,omitempty"` //Username if the storage require auth
	Password string `json:"password,omitempty"` //Password if the storage require auth
}

//Parse a list of StorageConfig from the given json content
func loadConfigFromJSON(jsonContent []byte) ([]FileSystemOption, error) {
	storageInConfig := []FileSystemOption{}
	//Try to parse the JSON content
	err := json.Unmarshal(jsonContent, &storageInConfig)
	return storageInConfig, err
}

//Validate if the given options are correct
func ValidateOption(options *FileSystemOption) error {
	//Check if path exists
	if options.Name == "" {
		return errors.New("File System Handler name cannot be empty")
	}
	if options.Uuid == "" {
		return errors.New("File System Handler uuid cannot be empty")
	}
	if !fileExists(options.Path) {
		return errors.New("Path not exists, given: " + options.Path)
	}

	//Check if access mode is supported
	if !inSlice([]string{"readonly", "readwrite"}, options.Access) {
		return errors.New("Not supported access mode: " + options.Access)
	}

	//Check if hierarchy is supported
	if !inSlice([]string{"user", "public", "backup"}, options.Hierarchy) {
		return errors.New("Not supported hierarchy: " + options.Hierarchy)
	}

	//Check disk format is supported
	if !inSlice([]string{"ext4", "ext2", "ext3", "fat", "vfat", "ntfs"}, options.Filesystem) {
		return errors.New("Not supported file system type: " + options.Filesystem)
	}

	//Check if mount point exists
	if options.Mountpt != "" && !fileExists(options.Mountpt) {
		return errors.New("Mount point not exists: " + options.Mountpt)
	}

	//This drive is backup drive
	if options.Hierarchy == "backup" {
		//Check if parent uid is not empty
		if strings.TrimSpace(options.Parentuid) == "" {
			return errors.New("Invalid backup source ID given")
		}

		//Check if the backup drive source and target are not the same drive
		if options.Parentuid == options.Uuid {
			return errors.New("Recursive backup detected. You cannot backup the backup drive itself.")
		}

		//Check if the backup mode exists
		if !inSlice([]string{"basic", "nightly", "version"}, options.BackupMode) {
			return errors.New("Invalid backup mode given")
		}
	}

	return nil
}
