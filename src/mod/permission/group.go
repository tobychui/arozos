package permission

func (gp *PermissionGroup) AddModule(modulename string) {
	if !inSlice(gp.AccessibleModules, modulename) {
		gp.AccessibleModules = append(gp.AccessibleModules, modulename)
	}
}

func (gp *PermissionGroup) RemoveModule(modulename string) {
	newModuleList := []string{}
	if inSlice(gp.AccessibleModules, modulename) {
		for _, thisModuleName := range gp.AccessibleModules {
			if thisModuleName != modulename {
				newModuleList = append(newModuleList, thisModuleName)
			}
		}

		gp.AccessibleModules = newModuleList
	}
}

//Remove this permission group
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
