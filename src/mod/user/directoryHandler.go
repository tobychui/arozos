package user

import (
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/storage"
	"imuslab.com/arozos/mod/storage/access"
)

/*
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
*/

// Get the user home file system handler, aka user:/
func (u *User) GetHomeFileSystemHandler() (*fs.FileSystemHandler, error) {
	return getHandlerFromID(u.HomeDirectories.Storages, "user")
}

// Get all user Acessible file system handlers (ignore special fsh like backups)
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

// Try to get the root file system handler from vpath where the root file system handler must be in user scope of permission
func (u *User) GetRootFSHFromVpathInUserScope(vpath string) *fs.FileSystemHandler {
	allFsh := u.GetAllAccessibleFileSystemHandler()
	var vpathSourceFsh *fs.FileSystemHandler
	for _, thisFsh := range allFsh {
		if thisFsh.IsRootOf(vpath) {
			vpathSourceFsh = thisFsh
			return vpathSourceFsh
		}
	}
	return nil
}

// drivePool is a storage pool a user may reach a drive through. home is the
// permission group the pool belongs to, empty for the system pool.
type drivePool struct {
	home string
	pool *storage.StoragePool
}

// drivePools lists every pool: the system pool, the user's own groups, then
// all other groups, whose drives a user reaches through a row of the drive's
// access list. The order matters only for a drive id used by two pools,
// where the first one wins the same way it always did.
func (u *User) drivePools() []drivePool {
	pools := []drivePool{}
	if u.HomeDirectories != nil {
		pools = append(pools, drivePool{pool: u.HomeDirectories})
	}

	listed := map[string]bool{}
	for _, pg := range u.PermissionGroup {
		listed[pg.Name] = true
		if pg.StoragePool != nil {
			pools = append(pools, drivePool{home: pg.Name, pool: pg.StoragePool})
		}
	}

	if u.parent != nil && u.parent.phandler != nil {
		for _, pg := range u.parent.phandler.PermissionGroups {
			if !listed[pg.Name] && pg.StoragePool != nil {
				pools = append(pools, drivePool{home: pg.Name, pool: pg.StoragePool})
			}
		}
	}
	return pools
}

// accessSubject describes this user to the access rules
func (u *User) accessSubject() access.Subject {
	return access.Subject{Groups: u.GetUserPermissionGroupNames(), IsAdmin: u.IsAdmin()}
}

// driveRule returns the access list of a drive
func (u *User) driveRule(uuid string, home string) access.Rule {
	if u.parent != nil && u.parent.driveRules != nil {
		if rule, ok := u.parent.driveRules.Rule(uuid); ok {
			return rule
		}
	}
	return access.DefaultRule(uuid, home)
}

// explainDrive works out what this user may do on one drive of one pool
func (u *User) explainDrive(fsh *fs.FileSystemHandler, home string, subject access.Subject) access.Decision {
	drive := access.Drive{UUID: fsh.UUID, HomeGroup: home, ReadOnly: fsh.ReadOnly}
	return access.Explain(drive, subject, u.driveRule(fsh.UUID, home))
}

// GetAllFileSystemHandler lists the opened drives this user may use, whichever
// pool they are configured in
func (u *User) GetAllFileSystemHandler() []*fs.FileSystemHandler {
	results := []*fs.FileSystemHandler{}
	listed := map[string]bool{}
	subject := u.accessSubject()
	for _, dp := range u.drivePools() {
		for _, store := range dp.pool.Storages {
			if store.Closed || listed[store.UUID] {
				continue
			}
			if u.explainDrive(store, dp.home, subject).Level == arozfs.FsDenied {
				continue
			}
			results = append(results, store)
			listed[store.UUID] = true
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

// Get a file system handler from a virtual path, this file system handler might not be the highest prioity one
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
