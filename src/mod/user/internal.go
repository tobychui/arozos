package user

import (
	"errors"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
)

/*
	Private functions
*/

// Get a fs handler from a virtual path, quick function for getIDFromHandler + GetHandlerFromID
func getHandlerFromVirtualPath(storages []*fs.FileSystemHandler, vpath string) (*fs.FileSystemHandler, error) {
	if logger.IsDebug() {
		logger.Debugf("user", "getHandlerFromVirtualPath: len(storages)=%d vpath=%.120q", len(storages), vpath)
	}
	vid, _, err := getIDFromVirtualPath(vpath)
	if err != nil {
		return &fs.FileSystemHandler{}, err
	}

	return getHandlerFromID(storages, vid)
}

// Get a fs handler from the given virtial device id
func getHandlerFromID(storages []*fs.FileSystemHandler, vid string) (*fs.FileSystemHandler, error) {
	if logger.IsDebug() {
		logger.Debugf("user", "getHandlerFromID: len(storages)=%d vid=%.120q", len(storages), vid)
	}
	for _, storage := range storages {
		if storage.UUID == vid {
			//This storage is the one we are looking at
			return storage, nil
		}
	}

	return &fs.FileSystemHandler{}, errors.New("handler Not Found")
}

// Get the ID part of a virtual path, return ID, subpath and error
func getIDFromVirtualPath(vpath string) (string, string, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("user", "getIDFromVirtualPath: vpath=%.120q", vpath)
	}
	return fs.GetIDFromVirtualPath(vpath)
}
