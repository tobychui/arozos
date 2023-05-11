package user

import (
	//"log"
	"errors"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	permission "imuslab.com/arozos/mod/permission"
	storage "imuslab.com/arozos/mod/storage"
	"imuslab.com/arozos/mod/utils"
)

//Permissions related to modules
func (u *User) GetModuleAccessPermission(moduleName string) bool {
	//Check if this module permission is within user's permission group access
	moduleName = strings.ToLower(moduleName)
	for _, pg := range u.PermissionGroup {
		if pg.IsAdmin {
			//This user is admin. Allow all module access
			return true
		} else if utils.StringInArrayIgnoreCase(pg.AccessibleModules, moduleName) {
			//This permission group contain the module we want. Allow accessed
			return true
		} else if utils.StringInArrayIgnoreCase(u.parent.UniversalModules, moduleName) {
			//This is system tools or utilities that everyone is allowed to access
			return true
		} else if moduleName == strings.ToLower(pg.DefaultInterfaceModule) {
			//This is the interfacing module for the group this user is in
			return true
		}
	}

	//This user has no permission group that has access to this module
	return false
}

func (u *User) GetUserAccessibleModules() []string {
	userAccessibleModules := []string{}
	userAccessibleModulesMap := map[string]bool{}
	//Load the base modules
	for _, umod := range u.parent.UniversalModules {
		userAccessibleModules = append(userAccessibleModules, umod)
		userAccessibleModulesMap[umod] = true
	}

	//Load the user modules
	for _, pg := range u.GetUserPermissionGroup() {
		groupAccessiableModules := pg.AccessibleModules
		for _, gmod := range groupAccessiableModules {
			_, ok := userAccessibleModulesMap[gmod]
			if !ok {
				//This module is not in accessible list yet
				userAccessibleModules = append(userAccessibleModules, gmod)
				userAccessibleModulesMap[gmod] = true
			}

		}
	}

	return userAccessibleModules
}

func (u *User) IsAdmin() bool {
	isAdmin := false
	for _, pg := range u.PermissionGroup {
		if pg.IsAdmin {
			isAdmin = true
		}
	}

	return isAdmin
}

//Get the (or a list of ) Interface Module (aka booting module) for this user, returning module uuids
func (u *User) GetInterfaceModules() []string {
	results := []string{}
	for _, pg := range u.PermissionGroup {
		if !utils.StringInArray(results, pg.DefaultInterfaceModule) {
			results = append(results, pg.DefaultInterfaceModule)
		}

	}

	if len(results) == 0 && u.IsAdmin() {
		//Critial error occured. Assign desktop module to admin
		results = append(results, "desktop")
	}

	return results
}

//Check if the user has access to this virthal filepath
func (u *User) GetPathAccessPermission(vpath string) string {
	fsid, _, err := getIDFromVirtualPath(filepath.ToSlash(vpath))
	if err != nil {
		return arozfs.FsDenied
	}
	topAccessRightStoragePool, err := u.GetHighestAccessRightStoragePool(fsid)
	if err != nil {
		return arozfs.FsDenied
	}
	if topAccessRightStoragePool.Owner == u.Username {
		//This user own this storage pool. CHeck if the fs itself is readonly
		fsHandler, _ := getHandlerFromID(u.GetAllFileSystemHandler(), fsid)
		if fsHandler.ReadOnly {
			return arozfs.FsReadOnly
		}
		return arozfs.FsReadWrite
	} else if topAccessRightStoragePool.Owner == "system" {
		//System storage pool. Allow both read and write if the system handler is readwrite
		fsHandler, _ := getHandlerFromID(u.GetAllFileSystemHandler(), fsid)
		if fsHandler.ReadOnly {
			return arozfs.FsReadOnly
		}
		return arozfs.FsReadWrite
	} else {
		//This user do not own this storage pool. Use the pools' config
		fsHandler, _ := getHandlerFromID(u.GetAllFileSystemHandler(), fsid)
		if fsHandler.ReadOnly {
			return arozfs.FsReadOnly
		}
		return topAccessRightStoragePool.OtherPermission
	}
}

//Helper function for checking permission
func (u *User) CanRead(vpath string) bool {
	rwp := u.GetPathAccessPermission(vpath)
	if rwp == arozfs.FsReadOnly || rwp == arozfs.FsReadWrite {
		return true
	} else {
		return false
	}
}

func (u *User) CanWrite(vpath string) bool {
	rwp := u.GetPathAccessPermission(vpath)
	if rwp == arozfs.FsReadWrite || rwp == arozfs.FsWriteOnly {
		return true
	} else {
		return false
	}
}

//Get the highest access right to the given fs uuid
func (u *User) GetHighestAccessRightStoragePool(fsUUID string) (*storage.StoragePool, error) {
	//List all storage pool that have access to this fsUUID
	matchingStoragePool := []*storage.StoragePool{}
	for _, h := range u.HomeDirectories.Storages {
		if h.UUID == fsUUID {
			//User Home directory contain access to this fsUUID
			matchingStoragePool = append(matchingStoragePool, u.HomeDirectories)
		}
	}

	//Look for other permission groups this user is in
	for _, pg := range u.PermissionGroup {
		for _, h := range pg.StoragePool.Storages {
			if h.UUID == fsUUID {
				//User Home directory contain access to this fsUUID
				matchingStoragePool = append(matchingStoragePool, u.HomeDirectories)
			}
		}

	}

	//Check the highest priority in the list
	if len(matchingStoragePool) == 0 {
		return &storage.StoragePool{}, errors.New("no access to this filesystem was found")
	}

	currentTopStoragePool := matchingStoragePool[0]
	for _, storagePool := range matchingStoragePool {
		if storagePool.Owner == u.Username {
			//Owner of this ppol. Return this
			return storagePool, nil
		} else if storagePool.Owner == "system" {
			//System storage pool. Everyone can read write to this.
			return storagePool, nil
		} else {
			//Compare the priority. Replace the top one if the current one has higher priority
			if storagePool.HasHigherOrEqualPermissionThan(currentTopStoragePool) {
				currentTopStoragePool = storagePool
			}
		}
	}

	return currentTopStoragePool, nil
}

func (u *User) GetUserPermissionGroup() []*permission.PermissionGroup {
	return u.PermissionGroup
}

func (u *User) GetUserPermissionGroupNames() []string {
	userPermissionGroups := []string{}
	for _, pg := range u.PermissionGroup {
		userPermissionGroups = append(userPermissionGroups, pg.Name)
	}
	return userPermissionGroups
}

//Check if the user is in one of the permission groups, require groupname
func (u *User) UserIsInOneOfTheGroupOf(groupnames []string) bool {
	userpg := u.GetUserPermissionGroup()
	for _, thispg := range userpg {
		for _, thisname := range groupnames {
			if thispg.Name == thisname {
				return true
			}
		}
	}
	return false
}

func (u *User) SetUserPermissionGroup(groups []*permission.PermissionGroup) {
	groupIds := []string{}
	for _, gp := range groups {
		groupIds = append(groupIds, gp.Name)
	}
	u.parent.database.Write("auth", "group/"+u.Username, groupIds)
}
