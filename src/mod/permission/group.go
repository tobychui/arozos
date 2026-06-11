package permission

import "imuslab.com/arozos/mod/utils"

func (gp *PermissionGroup) AddModule(modulename string) {
	if !utils.StringInArray(gp.AccessibleModules, modulename) {
		gp.AccessibleModules = append(gp.AccessibleModules, modulename)
	}
}

func (gp *PermissionGroup) RemoveModule(modulename string) {
	newModuleList := []string{}
	if utils.StringInArray(gp.AccessibleModules, modulename) {
		for _, thisModuleName := range gp.AccessibleModules {
			if thisModuleName != modulename {
				newModuleList = append(newModuleList, thisModuleName)
			}
		}

		gp.AccessibleModules = newModuleList
	}
}

// GetCronJobPermission returns whether this group can create cron jobs
func (gp *PermissionGroup) GetCronJobPermission() bool {
	if gp.IsAdmin {
		return true
	}
	return gp.CanCreateCronJob
}

// SetCronJobPermission sets whether this group can create cron jobs and persists the change
func (gp *PermissionGroup) SetCronJobPermission(allow bool) {
	if gp.IsAdmin {
		// Admin groups always retain cron permission
		gp.CanCreateCronJob = true
		return
	}
	gp.CanCreateCronJob = allow
	allowStr := "false"
	if allow {
		allowStr = "true"
	}
	gp.parent.database.Write("permission", "canCreateCronJob/"+gp.Name, allowStr)
}

// Remove this permission group
func (gp *PermissionGroup) Remove() {
	db := gp.parent.database

	//Close the groups' storage pool
	gp.StoragePool.Close()

	//Remove the group from database
	db.Delete("permission", "group/"+gp.Name)
	db.Delete("permission", "isadmin/"+gp.Name)
	db.Delete("permission", "quota/"+gp.Name)
	db.Delete("permission", "interfaceModule/"+gp.Name)

}
