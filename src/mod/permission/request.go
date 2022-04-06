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
)

//Handle group editing operations
func (h *PermissionHandler) HandleListGroup(w http.ResponseWriter, r *http.Request) {
	listPermission, _ := mv(r, "showper", false)
	if listPermission == "" {
		//Only show the user group name
		results := []string{}
		for _, gp := range h.PermissionGroups {
			results = append(results, gp.Name)
		}
		jsonString, _ := json.Marshal(results)
		sendJSONResponse(w, string(jsonString))
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
		sendJSONResponse(w, string(jsonString))
	}
}

//Listing a group's detail for editing or updating the group content
func (h *PermissionHandler) HandleGroupEdit(w http.ResponseWriter, r *http.Request) {
	groupname, err := mv(r, "groupname", true)
	if err != nil {
		sendErrorResponse(w, "Group name not defined")
		return
	}

	listmode, _ := mv(r, "list", false)
	if listmode == "" {
		//Edit update mode
		permission, err := mv(r, "permission", true)
		if err != nil {
			sendErrorResponse(w, "Group name not defined")
			return
		}

		permissionSlice := []string{}
		err = json.Unmarshal([]byte(permission), &permissionSlice)
		if err != nil {
			sendErrorResponse(w, "Failed to parse module list")
			return
		}

		isAdmin, err := mv(r, "isAdmin", true)
		if err != nil {
			sendErrorResponse(w, "Admin permission not defined")
			return
		}

		//Do not allow removal of admin permission from administrator group
		if isAdmin == "false" && groupname == "administrator" {
			sendErrorResponse(w, "You cannot unset admin permission from administrator group")
			return
		}

		quota, err := mv(r, "defaultQuota", true)
		if err != nil {
			sendErrorResponse(w, "Default Quota not defined")
			return
		}

		interfaceModule, err := mv(r, "interfaceModule", true)
		if err != nil {
			sendErrorResponse(w, "Default Interface Module not defined")
			return
		}

		//Check if the group name already exists
		if !h.GroupExists(groupname) {
			sendErrorResponse(w, "Group not exists")
			return
		}

		quotaInt, err := strconv.Atoi(quota)
		if err != nil {
			sendErrorResponse(w, "Invalid Quota.")
			return
		}

		h.UpdatePermissionGroup(groupname, isAdmin == "true", int64(quotaInt), permissionSlice, interfaceModule)
		sendOK(w)
	} else {
		//Listing mode

		//Check if the group exists
		if !h.GroupExists(groupname) {
			sendErrorResponse(w, "Group not exists")
			return
		}

		//OK. Get the group information
		pg := h.GetPermissionGroupByName(groupname)

		//pg will not be nil because group exists has checked it availbilty
		jsonString, _ := json.Marshal(pg)
		sendJSONResponse(w, string(jsonString))

	}

}

func (h *PermissionHandler) HandleGroupCreate(w http.ResponseWriter, r *http.Request) {
	groupname, err := mv(r, "groupname", true)
	if err != nil {
		sendErrorResponse(w, "Group name not defined")
		return
	}

	permission, err := mv(r, "permission", true)
	if err != nil {
		sendErrorResponse(w, "Group name not defined")
		return
	}

	permissionSlice := []string{}
	err = json.Unmarshal([]byte(permission), &permissionSlice)
	if err != nil {
		sendErrorResponse(w, "Failed to parse module list")
		return
	}

	isAdmin, err := mv(r, "isAdmin", true)
	if err != nil {
		sendErrorResponse(w, "Admin permission not defined")
		return
	}

	quota, err := mv(r, "defaultQuota", true)
	if err != nil {
		sendErrorResponse(w, "Default Quota not defined")
		return
	}

	interfaceModule, err := mv(r, "interfaceModule", true)
	if err != nil {
		sendErrorResponse(w, "Default Interface Module not defined")
		return
	}

	//Check if the group name already exists
	if h.GroupExists(groupname) {
		sendErrorResponse(w, "Group already exists")
		return
	}

	quotaInt, err := strconv.Atoi(quota)
	if err != nil {
		sendErrorResponse(w, "Invalid Quota.")
		return
	}

	if quotaInt < -1 {
		sendErrorResponse(w, "Quota cannot be smaller than -1. (Set to -1 for unlimited quota)")
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

	sendOK(w)
	log.Println("Creating New Permission Group:", groupname, permission, isAdmin, quota)
}

func (h *PermissionHandler) HandleGroupRemove(w http.ResponseWriter, r *http.Request) {
	groupname, err := mv(r, "groupname", true)
	if err != nil {
		sendErrorResponse(w, "Group name not defined")
		return
	}

	//Check if the group name  exists
	if !h.GroupExists(groupname) {
		sendErrorResponse(w, "Group not exists")
		return
	}

	//Check if this is administrator group
	if groupname == "administrator" {
		sendErrorResponse(w, "You cannot remove Administrator group.")
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

	sendOK(w)
}
