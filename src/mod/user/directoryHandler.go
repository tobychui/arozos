package user

import (
	"errors"
	"path/filepath"
	"strings"
	"os"
	fs "imuslab.com/arozos/mod/filesystem"
)

func (u *User) GetHomeDirectory() (string, error) {
	//Return the realpath of the user home directory
	for _, dir := range u.HomeDirectories.Storages {
		if dir.UUID == "user" {
			//This is the target user root
			root := filepath.ToSlash(filepath.Clean(dir.Path) + "/users/" + u.Username + "/")
			os.MkdirAll(root, 0755)
			return root, nil
		}
	}

	return "", errors.New("User root not found. Is this a permission group instead of a real user?")
}

func (u *User) GetAllFileSystemHandler() []*fs.FileSystemHandler {
	results := []*fs.FileSystemHandler{}
	uuids := []string{}
	//Get all FileSystem Handler from this user's Home Directory (aka base directory)
	for _, store := range u.HomeDirectories.Storages {
		if store.Closed == false {
			//Only return opened file system handlers
			results = append(results, store)
			uuids = append(uuids, store.UUID)
		}

	}

	//Get all the FileSystem handler that is accessable by this user
	for _, pg := range u.PermissionGroup {
		//For each permission group that this user is in
		for _, store := range pg.StoragePool.Storages {
			//Get each of the storage of this permission group is assigned to
			if !inSlice(uuids, store.UUID) {
				if store.Closed == false {
					//Only return opened file system handlers
					results = append(results, store)
					uuids = append(uuids, store.UUID)
				}

			}
		}
	}

	return results
}

func (u *User) VirtualPathToRealPath(vpath string) (string, error) {
	//Get all usable filesystem handler from the user's home directory and permission groups
	userFsHandlers := u.GetAllFileSystemHandler()

	//Clear the path
	virtualPath := filepath.ToSlash(filepath.Clean(vpath))

	//Check for path escape
	if len(virtualPath) > 2 && virtualPath[:2] == ".." {
		return "", errors.New("Request path out of storage root")
	}

	//Check for valid virtual device id
	vid, subpath, err := getIDFromVirtualPath(vpath)
	if err != nil {
		return "", err
	}

	//Look for the handler with the same virtualPath ID
	for _, storage := range userFsHandlers {
		if storage.UUID == vid {
			//This storage is the one we are looking at

			//Check if this has been closed
			if storage.Closed == true {
				return "", errors.New("Request Filesystem Handler has been closed by another process")
			}
			if storage.Hierarchy == "user" {
				return filepath.Clean(storage.Path) + "/users/" + u.Username + subpath, nil
			} else {
				return filepath.Clean(storage.Path) + subpath, nil
			}

		}
	}

	return "", errors.New("Translation failed: Vitrual storage ID not found")
}

func (u *User) RealPathToVirtualPath(rpath string) (string, error) {
	//Get all usable filesystem handler
	userFsHandlers := u.GetAllFileSystemHandler()

	//Clear the path
	realPath := filepath.ToSlash(filepath.Clean(rpath))

	//Check for path escape
	if len(realPath) > 2 && realPath[:2] == ".." {
		return "", errors.New("Request path out of storage root")
	}

	//Look for a real path of a virtual device that the realpath is containing
	for _, storage := range userFsHandlers {
		thisStorageRoot := filepath.Clean(filepath.ToSlash(storage.Path))
		thisStorageRootAbs, err := filepath.Abs(thisStorageRoot)
		if err != nil {
			//Fail to abs this path. Maybe this is a emulated file system?
			thisStorageRootAbs = thisStorageRoot
		}

		thisStorageRootAbs = filepath.ToSlash(filepath.Clean(thisStorageRootAbs))
		pathContained := false
		subPath := ""
		if len(realPath) > len(thisStorageRoot) && realPath[:len(thisStorageRoot)] == thisStorageRoot {
			//This realpath is in contained inside this storage root
			pathContained = true
			subtractionPath := thisStorageRoot
			if storage.Hierarchy == "user" {
				subtractionPath = thisStorageRoot + "/users/" + u.Username + "/"
			}

			if len(subtractionPath) < len(realPath) {
				subPath = realPath[len(subtractionPath):]
			}
		} else if len(realPath) > len(thisStorageRootAbs) && realPath[:len(thisStorageRootAbs)] == thisStorageRootAbs {
			//The realpath contains the absolute path of this storage root
			pathContained = true
			subtractionPath := thisStorageRootAbs
			if storage.Hierarchy == "user" {
				subtractionPath = thisStorageRootAbs + "/users/" + u.Username + "/"
			}

			if len(subtractionPath) < len(realPath) {
				subPath = realPath[len(subtractionPath):]
			}
		} else if realPath == thisStorageRoot {
			//Storage Root's root
			pathContained = true
			subPath = ""
		}

		if len(subPath) > 1 && subPath[:1] == "/" {
			subPath = subPath[1:]
		}
		if pathContained == true {
			//This storage is one of the root of the given realpath. Translate it into this
			if storage.Closed == true {
				return "", errors.New("Request Filesystem Handler has been closed by another process")
			}
			return storage.UUID + ":/" + subPath, nil
		}

	}

	return "", errors.New("Unable to resolve realpath in virtual devices root path")
}

//Get a file system handler from a virtual path, this file system handler might not be the highest prioity one
func (u *User) GetFileSystemHandlerFromVirtualPath(vpath string) (*fs.FileSystemHandler, error) {
	fsHandlers := u.GetAllFileSystemHandler()
	handler, err := getHandlerFromVirtualPath(fsHandlers, vpath)
	return handler, err
}

func (u *User) GetFileSystemHandlerFromRealPath(rpath string) (*fs.FileSystemHandler, error) {
	vpath, err := u.RealPathToVirtualPath(rpath)
	if err != nil {
		return &fs.FileSystemHandler{}, err
	}

	return u.GetFileSystemHandlerFromVirtualPath(vpath)
}

/*

	PRIVATE FUNCTIONS HANDLERS

*/
//Get a fs handler from a virtual path, quick function for getIDFromHandler + GetHandlerFromID
func getHandlerFromVirtualPath(storages []*fs.FileSystemHandler, vpath string) (*fs.FileSystemHandler, error) {
	vid, _, err := getIDFromVirtualPath(vpath)
	if err != nil {
		return &fs.FileSystemHandler{}, err
	}

	return getHandlerFromID(storages, vid)
}

//Get a fs handler from the given virtial device id
func getHandlerFromID(storages []*fs.FileSystemHandler, vid string) (*fs.FileSystemHandler, error) {
	for _, storage := range storages {
		if storage.UUID == vid {
			//This storage is the one we are looking at
			return storage, nil
		}
	}

	return &fs.FileSystemHandler{}, errors.New("Handler Not Found")
}

//Get the ID part of a virtual path, return ID, subpath and error
func getIDFromVirtualPath(vpath string) (string, string, error) {
	if strings.Contains(vpath, ":") == false {
		return "", "", errors.New("Path missing Virtual Device ID. Given: " + vpath)
	}

	//Clean up the virutal path 
	vpath = filepath.ToSlash(filepath.Clean(vpath))

	tmp := strings.Split(vpath, ":")
	vdID := tmp[0]
	pathSlice := tmp[1:]
	path := strings.Join(pathSlice, ":")

	return vdID, path, nil
}
