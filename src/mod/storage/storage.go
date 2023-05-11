package storage

/*
	ArOZ Online Storage Handler Module
	author: tobychui

	This is a system for allowing generic interfacing to the filesystems
	To add more supports for different type of file system, add more storage handlers.
*/

import (
	"errors"
	"os"
	"strings"

	"imuslab.com/arozos/mod/filesystem"
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
)

type StoragePool struct {
	Owner           string                  //Owner of the storage pool, also act as the resolver's username
	OtherPermission string                  //Permissions on other users but not the owner
	Storages        []*fs.FileSystemHandler //Storage pool accessable by this owner
	//HyperBackupManager *hybridBackup.Manager   //HyperBackup Manager
}

/*
	Permission Levels (From TOP to BOTTOM -> HIGHEST to LOWEST)
	1. readwrite
	2. readonly
	3. denied
*/

// Create all the required folder structure if it didn't exists
func init() {
	os.MkdirAll("./system/storage", 0755)
}

// Create a new StoragePool objects with given uuids
func NewStoragePool(fsHandlers []*fs.FileSystemHandler, owner string) (*StoragePool, error) {
	//Move all fshandler into the storageHandler
	storageHandlers := []*fs.FileSystemHandler{}
	for _, fsHandler := range fsHandlers {
		//Move the handler pointer to the target
		storageHandlers = append(storageHandlers, fsHandler)
	}

	return &StoragePool{
		Owner:           owner,
		OtherPermission: arozfs.FsReadOnly,
		Storages:        storageHandlers,
	}, nil
}

// Check if this storage pool contain this particular disk ID
func (s *StoragePool) ContainDiskID(diskID string) bool {
	for _, fsh := range s.Storages {
		if fsh.UUID == diskID {
			return true
		}
	}

	return false
}

// Use to compare two StoragePool permissions leve
func (s *StoragePool) HasHigherOrEqualPermissionThan(a *StoragePool) bool {
	if s.OtherPermission == arozfs.FsReadOnly && a.OtherPermission == arozfs.FsReadWrite {
		return false
	} else if s.OtherPermission == arozfs.FsDenied && a.OtherPermission != arozfs.FsDenied {
		return false
	}
	return true
}

// Get fsh from virtual path
func (s *StoragePool) GetFSHandlerFromVirtualPath(vpath string) (*fs.FileSystemHandler, string, error) {
	fshid, subpath, err := filesystem.GetIDFromVirtualPath(vpath)
	if err != nil {
		return nil, subpath, err
	}

	fsh, err := s.GetFsHandlerByUUID(fshid)
	if err != nil {
		return nil, subpath, err
	}

	return fsh, subpath, nil
}

func (s *StoragePool) GetFsHandlerByUUID(uuid string) (*fs.FileSystemHandler, error) {
	//Filter out the :/ fropm uuid if exists
	if strings.Contains(uuid, ":") {
		uuid = strings.Split(uuid, ":")[0]
	}

	for _, fsh := range s.Storages {
		if fsh.UUID == uuid {
			return fsh, nil
		}
	}

	return nil, arozfs.ErrFSHNotFOund
}

// Attach a file system handler to this pool
func (s *StoragePool) AttachFsHandler(fsh *filesystem.FileSystemHandler) error {
	if s.ContainDiskID(fsh.UUID) {
		return errors.New("file system handler with same uuid already exists in this pool")
	}

	s.Storages = append(s.Storages, fsh)
	return nil
}

// Detech a file system handler from this pool array
func (s *StoragePool) DetachFsHandler(uuid string) {
	newFshList := []*fs.FileSystemHandler{}
	for _, fsh := range s.Storages {
		if fsh.UUID != uuid {
			newFshList = append(newFshList, fsh)
		}
	}

	s.Storages = newFshList
}

// Close all fsHandler under this storage pool
func (s *StoragePool) Close() {
	//For each storage pool, close it
	for _, fsh := range s.Storages {
		if !fsh.Closed {
			fsh.Close()
		}
	}
}
