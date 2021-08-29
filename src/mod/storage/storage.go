package storage

/*
	ArOZ Online Storage Handler Module
	author: tobychui

	This is a system for allowing generic interfacing to the filesystems
	To add more supports for different type of file system, add more storage handlers.
*/

import (
	"log"
	"os"

	"imuslab.com/arozos/mod/disk/hybridBackup"
	fs "imuslab.com/arozos/mod/filesystem"
)

type StoragePool struct {
	Owner              string                  //Owner of the storage pool, also act as the resolver's username
	OtherPermission    string                  //Permissions on other users but not the owner
	Storages           []*fs.FileSystemHandler //Storage pool accessable by this owner
	HyperBackupManager *hybridBackup.Manager   //HyperBackup Manager
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
	//Create new HypberBackup Manager
	backupManager := hybridBackup.NewHyperBackupManager()

	//Move all fshandler into the storageHandler
	storageHandlers := []*fs.FileSystemHandler{}
	for _, fsHandler := range fsHandlers {
		//Move the handler pointer to the target
		storageHandlers = append(storageHandlers, fsHandler)

		if fsHandler.Hierarchy == "backup" {
			//Backup disk. Build the Hierarchy Config for this drive
			backupConfig := fsHandler.HierarchyConfig.(hybridBackup.BackupTask)

			//Resolve parent path for backup File System Handler
			parentExists := false
			for _, potentialParnet := range fsHandlers {
				if potentialParnet.UUID == backupConfig.ParentUID {
					//This is the parent
					backupConfig.ParentPath = potentialParnet.Path
					parentExists = true
				}
			}

			if parentExists {
				backupManager.AddTask(&backupConfig)
			} else {
				log.Println("*ERROR* Backup disk " + backupConfig.DiskUID + ":/ source disk not found: " + backupConfig.ParentUID + ":/ not exists or it is from other storage pool!")
			}

		}
	}

	return &StoragePool{
		Owner:              owner,
		OtherPermission:    "readonly",
		Storages:           storageHandlers,
		HyperBackupManager: backupManager,
	}, nil
}

//Check if this storage pool contain this particular disk ID
func (s *StoragePool) ContainDiskID(diskID string) bool {
	for _, fsh := range s.Storages {
		if fsh.UUID == diskID {
			return true
		}
	}

	return false
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
	//Close the running backup tasks
	s.HyperBackupManager.Close()

	//For each storage pool, close it
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
