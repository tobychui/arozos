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
	"imuslab.com/arozos/mod/info/logger"
)

// StoragePool is where the drives of the system or of one permission group are
// configured. Who may use a drive is decided per drive, see mod/storage/access.
type StoragePool struct {
	Owner    string                  //"system" or the name of the permission group this pool belongs to
	Storages []*fs.FileSystemHandler //The drives configured in this pool
	//HyperBackupManager *hybridBackup.Manager   //HyperBackup Manager
}

// Create all the required folder structure if it didn't exists
func init() {
	os.MkdirAll("./system/storage", 0755)
}

// Create a new StoragePool objects with given uuids
func NewStoragePool(fsHandlers []*fs.FileSystemHandler, owner string) (*StoragePool, error) {
	//Move all fshandler into the storageHandler
	storageHandlers := []*fs.FileSystemHandler{}
	for _, fsHandler := range fsHandlers {
		if fsHandler == nil {
			logger.Debugf("Storage", "NewStoragePool: pool %q was given a nil drive, readers of this pool will panic", owner)
		}
		//Move the handler pointer to the target
		storageHandlers = append(storageHandlers, fsHandler)
	}
	logger.Debugf("Storage", "NewStoragePool: pool %q created with %d drive(s)", owner, len(storageHandlers))

	return &StoragePool{
		Owner:    owner,
		Storages: storageHandlers,
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

// Get fsh from virtual path
func (s *StoragePool) GetFSHandlerFromVirtualPath(vpath string) (*fs.FileSystemHandler, string, error) {
	fshid, subpath, err := filesystem.GetIDFromVirtualPath(vpath)
	if err != nil {
		logger.Debugf("Storage", "Pool %q: cannot parse virtual path %q: %v", s.Owner, vpath, err)
		return nil, subpath, err
	}

	fsh, err := s.GetFsHandlerByUUID(fshid)
	if err != nil {
		logger.Debugf("Storage", "Pool %q: no drive %q for %q", s.Owner, fshid, vpath)
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
	if fsh == nil {
		logger.Debugf("Storage", "Pool %q: AttachFsHandler called with a nil drive, panics below", s.Owner)
	}
	if s.ContainDiskID(fsh.UUID) {
		logger.Debugf("Storage", "Pool %q: refused to attach %s:/ twice", s.Owner, fsh.UUID)
		return errors.New("file system handler with same uuid already exists in this pool")
	}

	s.Storages = append(s.Storages, fsh)
	logger.Debugf("Storage", "Pool %q: attached %s:/ (%s, handler %p), now %d drive(s)", s.Owner, fsh.UUID, fsh.Filesystem, fsh, len(s.Storages))
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

	logger.Debugf("Storage", "Pool %q: detached %s:/, %d -> %d drive(s)", s.Owner, uuid, len(s.Storages), len(newFshList))
	s.Storages = newFshList
}

// Close all fsHandler under this storage pool
func (s *StoragePool) Close() {
	if s == nil {
		logger.Debug("Storage", "StoragePool.Close called on a nil pool, panics below")
	} else {
		logger.Debugf("Storage", "Pool %q: closing %d drive(s)", s.Owner, len(s.Storages))
	}
	//For each storage pool, close it
	for _, fsh := range s.Storages {
		if fsh == nil {
			logger.Debugf("Storage", "Pool %q: holds a nil drive, panics below", s.Owner)
		}
		if !fsh.Closed {
			fsh.Close()
		}
	}
}
