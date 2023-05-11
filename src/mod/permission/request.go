package permission

/*
	This is the handler to handle the permission request endpoints


	Group information are stored in database as follows
	group/{groupname} = module permissions
	isadmin/{groupname} = isAdmin
	quota/{groupname} = default quota in bytes
*/

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"imuslab.com/arozos/mod/utils"
)

//Handle group editing operations
func (h *PermissionHandler) HandleListGroup(w http.ResponseWriter, r *http.Request) {
	listPermission, _ := utils.GetPara(r, "showper")
	if listPermission == "" {
		//Only show the user group name
		results := []string{}
		for _, gp := range h.PermissionGroups {
			results = append(results, gp.Name)
		}
		jsonString, _ := json.Marshal(results)
		utils.SendJSONResponse(w, string(jsonString))
	} else {
		//Show user group and its module permissions
		results := make(map[string][]interface{})
		for _, gp := range h.PermissionGroups {
			var thisGroupInfo []interface{}
			thisGroupInfo = append(thisGroupInfo, gp.AccessibleModules)
			thisGroupInfo = append(thisGroupInfo, gp.IsAdmin)
			thisGroupInfo = append(thisGroupInfo, gp.DefaultStorageQuota)
			results[gp.Name] = thisGroupInfo
		}
		jsonString, _ := json.Marshal(results)
		utils.SendJSONResponse(w, string(jsonString))
	}
}

//Listing a group's detail for editing or updating the group content
func (h *PermissionHandler) HandleGroupEdit(w http.ResponseWriter, r *http.Request) {
	groupname, err := utils.PostPara(r, "groupname")
	if err != nil {
		utils.SendErrorResponse(w, "Group name not defined")
		return
	}

	listmode, _ := utils.GetPara(r, "list")
	if listmode == "" {
		//Edit update mode
		permission, err := utils.PostPara(r, "permission")
		if err != nil {
			utils.SendErrorResponse(w, "Group name not defined")
			return
		}

		permissionSlice := []string{}
		err = json.Unmarshal([]byte(permission), &permissionSlice)
		if err != nil {
			utils.SendErrorResponse(w, "Failed to parse module list")
			return
		}

		isAdmin, err := utils.PostPara(r, "isAdmin")
		if err != nil {
			utils.SendErrorResponse(w, "Admin permission not defined")
			return
		}

		//Do not allow removal of admin permission from administrator group
		if isAdmin == "false" && groupname == "administrator" {
			utils.SendErrorResponse(w, "You cannot unset admin permission from administrator group")
			return
		}

		quota, err := utils.PostPara(r, "defaultQuota")
		if err != nil {
			utils.SendErrorResponse(w, "Default Quota not defined")
			return
		}

		interfaceModule, err := utils.PostPara(r, "interfaceModule")
		if err != nil {
			utils.SendErrorResponse(w, "Default Interface Module not defined")
			return
		}

		//Check if the group name already exists
		if !h.GroupExists(groupname) {
			utils.SendErrorResponse(w, "Group not exists")
			return
		}

		quotaInt, err := strconv.Atoi(quota)
		if err != nil {
			utils.SendErrorResponse(w, "Invalid Quota.")
			return
		}

		h.UpdatePermissionGroup(groupname, isAdmin == "true", int64(quotaInt), permissionSlice, interfaceModule)
		utils.SendOK(w)
	} else {
		//Listing mode

		//Check if the group exists
		if !h.GroupExists(groupname) {
			utils.SendErrorResponse(w, "Group not exists")
			return
		}

		//OK. Get the group information
		pg := h.GetPermissionGroupByName(groupname)

		//pg will not be nil because group exists has checked it availbilty
		jsonString, _ := json.Marshal(pg)
		utils.SendJSONResponse(w, string(jsonString))

	}

}

func (h *PermissionHandler) HandleGroupCreate(w http.ResponseWriter, r *http.Request) {
	groupname, err := utils.PostPara(r, "groupname")
	if err != nil {
		utils.SendErrorResponse(w, "Group name not defined")
		return
	}

	permission, err := utils.PostPara(r, "permission")
	if err != nil {
		utils.SendErrorResponse(w, "Group name not defined")
		return
	}

	permissionSlice := []string{}
	err = json.Unmarshal([]byte(permission), &permissionSlice)
	if err != nil {
		utils.SendErrorResponse(w, "Failed to parse module list")
		return
	}

	isAdmin, err := utils.PostPara(r, "isAdmin")
	if err != nil {
		utils.SendErrorResponse(w, "Admin permission not defined")
		return
	}

	quota, err := utils.PostPara(r, "defaultQuota")
	if err != nil {
		utils.SendErrorResponse(w, "Default Quota not defined")
		return
	}

	interfaceModule, err := utils.PostPara(r, "interfaceModule")
	if err != nil {
		utils.SendErrorResponse(w, "Default Interface Module not defined")
		return
	}

	//Check if the group name already exists
	if h.GroupExists(groupname) {
		utils.SendErrorResponse(w, "Group already exists")
		return
	}

	quotaInt, err := strconv.Atoi(quota)
	if err != nil {
		utils.SendErrorResponse(w, "Invalid Quota.")
		return
	}

	if quotaInt < -1 {
		utils.SendErrorResponse(w, "Quota cannot be smaller than -1. (Set to -1 for unlimited quota)")
		return
	}

	//Migrated the creation process to a seperated function
	h.NewPermissionGroup(groupname, isAdmin == "true", int64(quotaInt), permissionSlice, interfaceModule)

	/*
		//OK. Write the results into database
		h.database.Write("permission", "group/" + groupname, permission)
		h.database.Write("permission", "isadmin/" + groupname, isAdmin)
		h.database.Write("permission", "quota/" + groupname, int64(quotaInt))
		h.database.Write("permission", "interfaceModule/" + groupname, interfaceModule)

		//Update the current cached permission group table
		h.LoadPermissionGroupsFromDatabase()
	*/

	utils.SendOK(w)
	log.Println("Creating New Permission Group:", groupname, permission, isAdmin, quota)
}

func (h *PermissionHandler) HandleGroupRemove(w http.ResponseWriter, r *http.Request) {
	groupname, err := utils.PostPara(r, "groupname")
	if err != nil {
		utils.SendErrorResponse(w, "Group name not defined")
		return
	}

	//Check if the group name  exists
	if !h.GroupExists(groupname) {
		utils.SendErrorResponse(w, "Group not exists")
		return
	}

	//Check if this is administrator group
	if groupname == "administrator" {
		utils.SendErrorResponse(w, "You cannot remove Administrator group.")
		return
	}

	//Get the group by its name
	group := h.GetPermissionGroupByName(groupname)

	//Remove the group
	group.Remove()

	//Update the current cached permission group table
	newGroupList := []*PermissionGroup{}
	for _, pg := range h.PermissionGroups {
		if pg.Name != groupname {
			newGroupList = append(newGroupList, pg)
		}
	}

	h.PermissionGroups = newGroupList

	//Update 27-12-2020: Replaced database reload with new group list creation
	//h.LoadPermissionGroupsFromDatabase()

	utils.SendOK(w)
}
