package user

import (
	//"log"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
	permission "imuslab.com/arozos/mod/permission"
	"imuslab.com/arozos/mod/storage/access"
	"imuslab.com/arozos/mod/utils"
)

// Permissions related to modules
func (u *User) GetModuleAccessPermission(moduleName string) bool {
	if logger.IsDebug() {
		logger.Debugf("user", "User.GetModuleAccessPermission: moduleName=%.120q", moduleName)
	}
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
	logger.Debug("user", "User.GetUserAccessibleModules")
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
	logger.Debug("user", "User.IsAdmin")
	isAdmin := false
	for _, pg := range u.PermissionGroup {
		if pg.IsAdmin {
			isAdmin = true
		}
	}

	return isAdmin
}

// Get the (or a list of ) Interface Module (aka booting module) for this user, returning module uuids
func (u *User) GetInterfaceModules() []string {
	logger.Debug("user", "User.GetInterfaceModules")
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

// Check if the user has access to this virthal filepath
func (u *User) GetPathAccessPermission(vpath string) string {
	if logger.IsDebug() {
		logger.Debugf("user", "User.GetPathAccessPermission: vpath=%.120q", vpath)
	}
	fsid, subpath, err := getIDFromVirtualPath(filepath.ToSlash(vpath))
	if err != nil || arozfs.SubpathEscapesRoot(subpath) {
		//Everything below decides by the drive alone, so a subpath that climbs
		//out of the drive or the user's home ("user:../bob") must be denied here
		return arozfs.FsDenied
	}
	decision, found := u.ExplainDriveAccess(fsid)
	if !found {
		return arozfs.FsDenied
	}
	return decision.Level
}

// ExplainDriveAccess works out what this user may do on a drive and why. found
// is false if no pool holds a drive with this id. A drive id used by two pools
// gives the higher of the two.
func (u *User) ExplainDriveAccess(uuid string) (decision access.Decision, found bool) {
	if logger.IsDebug() {
		logger.Debugf("user", "User.ExplainDriveAccess: uuid=%.120q", uuid)
	}
	subject := u.accessSubject()
	for _, dp := range u.drivePools() {
		for _, store := range dp.pool.Storages {
			if store.UUID != uuid {
				continue
			}
			thisDecision := u.explainDrive(store, dp.home, subject)
			if !found || access.Higher(decision.Level, thisDecision.Level) != decision.Level {
				decision = thisDecision
			}
			found = true
		}
	}
	return decision, found
}

// Helper function for checking permission
func (u *User) CanRead(vpath string) bool {
	if logger.IsDebug() {
		logger.Debugf("user", "User.CanRead: vpath=%.120q", vpath)
	}
	rwp := u.GetPathAccessPermission(vpath)
	if rwp == arozfs.FsReadOnly || rwp == arozfs.FsReadWrite {
		return true
	} else {
		return false
	}
}

func (u *User) CanWrite(vpath string) bool {
	if logger.IsDebug() {
		logger.Debugf("user", "User.CanWrite: vpath=%.120q", vpath)
	}
	rwp := u.GetPathAccessPermission(vpath)
	if rwp == arozfs.FsReadWrite || rwp == arozfs.FsWriteOnly {
		return true
	} else {
		return false
	}
}

func (u *User) GetUserPermissionGroup() []*permission.PermissionGroup {
	logger.DebugTrace("user", "User.GetUserPermissionGroup")
	return u.PermissionGroup
}

func (u *User) GetUserPermissionGroupNames() []string {
	logger.Debug("user", "User.GetUserPermissionGroupNames")
	userPermissionGroups := []string{}
	for _, pg := range u.PermissionGroup {
		userPermissionGroups = append(userPermissionGroups, pg.Name)
	}
	return userPermissionGroups
}

// Check if the user is in one of the permission groups, require groupname
func (u *User) UserIsInOneOfTheGroupOf(groupnames []string) bool {
	if logger.IsDebug() {
		logger.Debugf("user", "User.UserIsInOneOfTheGroupOf: len(groupnames)=%d", len(groupnames))
	}
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

// CanCreateCronJob returns true if the user is allowed to create cron jobs.
// Admin users always have this permission; others need it explicitly granted on their group.
func (u *User) CanCreateCronJob() bool {
	logger.Debug("user", "User.CanCreateCronJob")
	if u.IsAdmin() {
		return true
	}
	for _, pg := range u.PermissionGroup {
		if pg.GetCronJobPermission() {
			return true
		}
	}
	return false
}

func (u *User) SetUserPermissionGroup(groups []*permission.PermissionGroup) {
	if logger.IsDebug() {
		logger.Debugf("user", "User.SetUserPermissionGroup: len(groups)=%d", len(groups))
	}
	groupIds := []string{}
	for _, gp := range groups {
		groupIds = append(groupIds, gp.Name)
	}
	u.parent.database.Write("auth", "group/"+u.Username, groupIds)
}
