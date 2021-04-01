package storage

/*
	ArOZ Online Storage Handler Module
	author: tobychui

	This is a system for allowing generic interfacing to the filesystems
	To add more supports for different type of file system, add more storage handlers.
*/

import (
	"os"

	fs "imuslab.com/arozos/mod/filesystem"
)

type StoragePool struct {
	Owner           string                  //Owner of the storage pool, also act as the resolver's username
	OtherPermission string                  //Permissions on other users but not the owner
	Storages        []*fs.FileSystemHandler //Storage pool accessable by this owner
}

/*
	Permission Levels (From TOP to BOTTOM -> HIGHEST to LOWEST)
	1. readwrite
	2. readonly
	3. denied
*/

//Create all the required folder structure if it didn't exists
func init() {
	os.MkdirAll("./system/storage", 0755)
}

//Create a new StoragePool objects with given uuids
func NewStoragePool(fsHandlers []*fs.FileSystemHandler, owner string) (*StoragePool, error) {
	//Move all fshandler into the storageHandler
	storageHandlers := []*fs.FileSystemHandler{}
	for _, fsHandler := range fsHandlers {
		//Move the handler pointer to the target
		storageHandlers = append(storageHandlers, fsHandler)
	}

	return &StoragePool{
		Owner:           owner,
		OtherPermission: "readonly",
		Storages:        storageHandlers,
	}, nil
}

//Use to compare two StoragePool permissions leve
func (s *StoragePool) HasHigherOrEqualPermissionThan(a *StoragePool) bool {
	if s.OtherPermission == "readonly" && a.OtherPermission == "readwrite" {
		return false
	} else if s.OtherPermission == "denied" && a.OtherPermission != "denied" {
		return false
	}
	return true
}

//Close all fsHandler under this storage pool
func (s *StoragePool) Close() {
	for _, fsh := range s.Storages {
		fsh.Close()
	}
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
