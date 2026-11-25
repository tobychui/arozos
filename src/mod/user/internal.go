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
func getHandlerFromVirtualPath(storages []*fs.FileSystemHandler, vpath string) (out0 *fs.FileSystemHandler, out1 error) {
	defer logger.Out2(logger.In2("user", "getHandlerFromVirtualPath", "storages", storages, "vpath", vpath), &out0, &out1)
	vid, _, err := getIDFromVirtualPath(vpath)
	if err != nil {
		logger.DebugErr("user", err)
		return &fs.FileSystemHandler{}, err
	}

	return getHandlerFromID(storages, vid)
}

// Get a fs handler from the given virtial device id
func getHandlerFromID(storages []*fs.FileSystemHandler, vid string) (out0 *fs.FileSystemHandler, out1 error) {
	defer logger.Out2(logger.In2("user", "getHandlerFromID", "storages", storages, "vid", vid), &out0, &out1)
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
	logger.DebugTrace("user", "getIDFromVirtualPath")
	return fs.GetIDFromVirtualPath(vpath)
}
