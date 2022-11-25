package user

import (
	"errors"
	"os"
	"path/filepath"

	"imuslab.com/arozos/mod/filesystem"
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

//Get all user Acessible file system handlers (ignore special fsh like backups)
func (u *User) GetAllAccessibleFileSystemHandler() []*fs.FileSystemHandler {
	results := []*fs.FileSystemHandler{}
	fshs := u.GetAllFileSystemHandler()
	for _, fsh := range fshs {
		if fsh.Hierarchy != "backup" {
			results = append(results, fsh)
		}
	}

	return results
}

//Try to get the root file system handler from vpath where the root file system handler must be in user scope of permission
func (u *User) GetRootFSHFromVpathInUserScope(vpath string) *fs.FileSystemHandler {
	allFsh := u.GetAllAccessibleFileSystemHandler()
	var vpathSourceFsh *filesystem.FileSystemHandler
	for _, thisFsh := range allFsh {
		if thisFsh.IsRootOf(vpath) {
			vpathSourceFsh = thisFsh
			return vpathSourceFsh
		}
	}
	return nil
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

/*
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

	if strings.Contains(filepath.ToSlash(filepath.Clean(subpath)), "../") || filepath.Clean(subpath) == ".." {
		return "", errors.New("Request path out of storage root")
	}

	//Look for the handler with the same virtualPath ID
	for _, storage := range userFsHandlers {
		if storage.UUID == vid {
			//This storage is the one we are looking at

			//Check if this has been closed
			if storage.Closed == true {
				return "", errors.New("Request Filesystem Handler has been closed by another process")
			}

			//Check if this is a backup drive
			if storage.Hierarchy == "backup" {
				return "", errors.New("Request Filesystem Handler do not allow direct access")
			}

			//A bit hacky to make sure subpath contains no traversal
			//Will migrate this to File System Vpath Resolver in the next large update
			subpath = strings.ReplaceAll(subpath, "../", "")

			//Handle general cases
			if storage.Hierarchy == "user" {
				return filepath.ToSlash(filepath.Join(filepath.Clean(storage.Path), "/users/", u.Username, subpath)), nil
			} else if storage.Hierarchy == "public" {
				return filepath.ToSlash(filepath.Join(filepath.Clean(storage.Path), subpath)), nil
			} else {
				return "", errors.New("Unknown Filesystem Handler Hierarchy")
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
		//Fix: 20 May 2021: Allow using ../folder as virtual root directory
		//Check if there are vroots that actually use relative path as root directory.
		allowSpecialCasePassThrough := false
		for _, fsh := range userFsHandlers {
			thisVrootPath := fsh.Path
			if len(realPath) > len(thisVrootPath) && filepath.ToSlash(realPath[:len(thisVrootPath)]) == filepath.ToSlash(thisVrootPath) {
				allowSpecialCasePassThrough = true
			}
		}

		if !allowSpecialCasePassThrough {
			return "", errors.New("Request path out of storage root")
		}

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
		if len(realPath) > len(thisStorageRoot) && filepath.ToSlash(realPath[:len(thisStorageRoot)]) == filepath.ToSlash(thisStorageRoot) {
			//This realpath is in contained inside this storage root
			pathContained = true
			subtractionPath := thisStorageRoot
			if storage.Hierarchy == "user" {
				//Check if this file is belongs to this user
				startOffset := len(filepath.Clean(thisStorageRoot) + "/users/")
				if len(realPath) < startOffset+len(u.Username) {
					//This file is not owned by this user
					return "", errors.New("File not owned by this user")
				} else {
					userNameMatch := realPath[startOffset : startOffset+len(u.Username)]
					if userNameMatch != u.Username {
						//This file is not owned by this user
						return "", errors.New("File not owned by this user")
					}
				}

				//Generate subtraction path
				subtractionPath = thisStorageRoot + "/users/" + u.Username + "/"
			}

			if len(subtractionPath) < len(realPath) {
				subPath = realPath[len(subtractionPath):]
			}

		} else if len(realPath) > len(thisStorageRootAbs) && filepath.ToSlash(realPath[:len(thisStorageRootAbs)]) == filepath.ToSlash(thisStorageRootAbs) {
			//The realpath contains the absolute path of this storage root
			pathContained = true
			subtractionPath := thisStorageRootAbs
			if storage.Hierarchy == "user" {
				subtractionPath = thisStorageRootAbs + "/users/" + u.Username + "/"
			}

			if len(subtractionPath) < len(realPath) {
				subPath = realPath[len(subtractionPath):]
			}
		} else if filepath.ToSlash(realPath) == filepath.ToSlash(thisStorageRoot) {
			//Storage Root's root
			pathContained = true
			subPath = ""
		}

		if len(subPath) > 1 && subPath[:1] == "/" {
			subPath = subPath[1:]
		}
		if pathContained == true {
			//This storage is one of the root of the given realpath. Translate it into this
			if storage == true {
				return "", errors.New("Request Filesystem Handler has been closed by another process")
			}
			return storage.UUID + ":/" + subPath, nil
		}

	}

	return "", errors.New("Unable to resolve realpath in virtual devices root path")
}
*/

//Get a file system handler from a virtual path, this file system handler might not be the highest prioity one
func (u *User) GetFileSystemHandlerFromVirtualPath(vpath string) (*fs.FileSystemHandler, error) {
	fsHandlers := u.GetAllFileSystemHandler()
	handler, err := getHandlerFromVirtualPath(fsHandlers, vpath)
	return handler, err
}

/*
func (u *User) GetFileSystemHandlerFromRealPath(rpath string) (*fs.FileSystemHandler, error) {
	vpath, err := u.RealPathToVirtualPath(rpath)
	if err != nil {
		return &fs.FileSystemHandler{}, err
	}

	return u.GetFileSystemHandlerFromVirtualPath(vpath)
}
*/
