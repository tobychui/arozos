package user

import (
	"errors"

	fs "imuslab.com/arozos/mod/filesystem"
)

/*
	Private functions
*/

// Get a fs handler from a virtual path, quick function for getIDFromHandler + GetHandlerFromID
func getHandlerFromVirtualPath(storages []*fs.FileSystemHandler, vpath string) (*fs.FileSystemHandler, error) {
	vid, _, err := getIDFromVirtualPath(vpath)
	if err != nil {
		return &fs.FileSystemHandler{}, err
	}

	return getHandlerFromID(storages, vid)
}

// Get a fs handler from the given virtial device id
func getHandlerFromID(storages []*fs.FileSystemHandler, vid string) (*fs.FileSystemHandler, error) {
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
	return fs.GetIDFromVirtualPath(vpath)
}
