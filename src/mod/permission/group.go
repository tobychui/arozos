package permission

func (gp *PermissionGroup)AddModule(modulename string){
	if (!inSlice(gp.AccessibleModules, modulename)){
		gp.AccessibleModules = append(gp.AccessibleModules, modulename);
	}
}

func (gp *PermissionGroup)RemoveModule(modulename string){
	newModuleList := []string{}
	if (inSlice(gp.AccessibleModules, modulename)){
		for _, thisModuleName := range gp.AccessibleModules{
			if thisModuleName != modulename{
				newModuleList = append(newModuleList, thisModuleName)
			}
		}

		gp.AccessibleModules = newModuleList
	}
}

