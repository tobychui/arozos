package filesystem

import (
	"encoding/json"
	"errors"
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
	Username   string `json:"username,omitempty"`   //Username if the storage require auth
	Password   string `json:"password,omitempty"`   //Password if the storage require auth
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

	if !inSlice([]string{"readonly", "readwrite"}, options.Access) {
		return errors.New("Not supported access mode: " + options.Access)
	}

	if !inSlice([]string{"user", "public"}, options.Hierarchy) {
		return errors.New("Not supported hierarchy: " + options.Hierarchy)
	}

	if !inSlice([]string{"ext4", "ext2", "ext3", "fat", "vfat", "ntfs"}, options.Filesystem) {
		return errors.New("Not supported file system type: " + options.Filesystem)
	}

	if options.Mountpt != "" && !fileExists(options.Mountpt) {
		return errors.New("Mount point not exists: " + options.Mountpt)
	}

	return nil
}
