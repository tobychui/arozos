package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	//"log"
)

/*
	This is the permission management module of the ArOZ Online System

	In default mode, the system only contains a user group named "administrator"
	This module also handle permission checking and others
*/

//Initiate function for system permission
func system_permission_service_init() {
	//Register permission configuration endpoints
	http.HandleFunc("/system/permission/listgroup", system_permission_handleListGroup)
	http.HandleFunc("/system/permission/newgroup", system_permission_createUserGroupHandler)
	http.HandleFunc("/system/permission/delgroup", system_permission_removeUserGroupHandler)
	http.HandleFunc("/system/permission/isAdmin", system_permission_handleAdminCheck)
	//http.HandleFunc("/system/permission/groupdetails", system_permission_handleGroupDetail)

	//Create table if not exists
	system_db_newTable(sysdb, "permission")

	//Register setting interface for module configuration
	registerSetting(settingModule{
		Name:         "Permission Groups",
		Desc:         "Handle the permission of access in groups",
		IconPath:     "SystemAO/users/img/small_icon.png",
		Group:        "Users",
		StartDir:     "SystemAO/users/group.html",
		RequireAdmin: true,
	})

}

func system_permission_getUserGroups(username string) (string, error) {
	group := ""
	system_db_read(sysdb, "auth", "group/"+username, &group)
	if group == "" {
		return "", errors.New("User group not found")
	}
	return group, nil
}

//Return a list of usergorup stored in the system
func system_permission_listGroup() []string {
	groups := []string{}
	entries := system_db_listTable(sysdb, "permission")
	for _, keypairs := range entries {
		if strings.Contains(string(keypairs[0]), "group/") {
			groups = append(groups, strings.Split(string(keypairs[0]), "/")[1])
		}
	}

	return groups
}

//Return the current list of usergroup from the database as JSON
func system_permission_handleListGroup(w http.ResponseWriter, r *http.Request) {
	groups := []string{}
	entries := system_db_listTable(sysdb, "permission")
	listPermission, _ := mv(r, "showper", false)
	if listPermission == "" {
		for _, keypairs := range entries {
			if strings.Contains(string(keypairs[0]), "group/") {
				//This is a group name record. Append the group name only.
				groups = append(groups, strings.Split(string(keypairs[0]), "/")[1])
			}
		}

		//Check if the group list is empty. If yes, create the administrator group
		if len(groups) == 0 {
			err := system_permission_createGroup("administrator", []string{"*"})
			if err != nil {
				panic("Failed to create administrator group. Is database writable?")
			}
			groups = append(groups, "administrator")
		}

		jsonString, _ := json.Marshal(groups)
		sendJSONResponse(w, string(jsonString))
	} else {
		results := map[string][]string{}
		for _, keypairs := range entries {
			if strings.Contains(string(keypairs[0]), "group/") {
				//This is a group name record. Append the group name only.
				thisGroupPermission := []string{}
				json.Unmarshal(keypairs[1], &thisGroupPermission)
				results[strings.Split(string(keypairs[0]), "/")[1]] = thisGroupPermission
			}
		}

		jsonString, _ := json.Marshal(results)
		sendJSONResponse(w, string(jsonString))
	}

	/*
		//Deprecated method for listing group with JSON string storage
		groupsData := "";
		system_db_read(sysdb, "permission", "groups", &groups)
		//There are always at least one group and this key must be valid. Not need to check for error.
		w.Header().Set("Content-Type", "application/json")
		sendTextResponse(w,groups)
	*/
}

func system_permission_handleAdminCheck(w http.ResponseWriter, r *http.Request) {
	isAdmin := system_permission_checkUserIsAdmin(w, r)
	if isAdmin {
		sendJSONResponse(w, "true")
	} else {
		sendJSONResponse(w, "false")
	}
}

func system_permission_handleGroupDetail(w http.ResponseWriter, r *http.Request) {
	opr, _ := mv(r, "opr", false)
	if opr == "" {
		//List all groups with detail
		var groupsRaw []byte
		system_db_read(sysdb, "permission", "groups", &groupsRaw)
		var groups []string
		json.Unmarshal(groupsRaw, &groups)

	}
}

func system_permission_createGroup(groupname string, modulepermission []string) error {
	//Check if group already exists
	if !system_permission_groupExists(groupname) {
		//This group do not exists. Continue to create
		err := system_db_write(sysdb, "permission", "group/"+groupname, modulepermission)
		if err != nil {
			return err
		}
	} else {
		//This group exists.
		return errors.New("Group already exists")
	}
	return nil
}

func system_permission_removeUserGroupHandler(w http.ResponseWriter, r *http.Request) {
	//Check if user is admin
	isAdmin := system_permission_checkUserIsAdmin(w, r)
	if !isAdmin {
		sendErrorResponse(w, "Permission denied")
		return
	}

	//Check if the groupname is provided
	groupname, err := mv(r, "groupname", false)
	if err != nil {
		sendErrorResponse(w, "Groupname not defined")
		return
	}

	//Remove the group from database
	if system_permission_groupExists(groupname) {
		//This group exits. Continue removal
		err := system_db_delete(sysdb, "permission", "group/"+groupname)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}
	} else {
		//This group exists.
		sendErrorResponse(w, "Given group not exists")
		return
	}

	sendOK(w)
}

func system_permission_createUserGroupHandler(w http.ResponseWriter, r *http.Request) {
	isAdmin := system_permission_checkUserIsAdmin(w, r)
	if !isAdmin {
		sendErrorResponse(w, "Permission denied")
		return
	}
	groupname, err := mv(r, "groupname", true)
	if err != nil {
		sendErrorResponse(w, "Groupname not defined")
		return
	}

	permissions, err := mv(r, "permission", true)
	if err != nil {
		sendErrorResponse(w, "Permission not defined")
		return
	}
	permissionList := []string{}
	err = json.Unmarshal([]byte(permissions), &permissionList)
	if err != nil {
		sendErrorResponse(w, "Failed to parse the permission list")
		return
	}
	system_permission_createGroup(groupname, permissionList)
	sendOK(w)
}


func system_permission_getGroupAccessList(groupname string) []string {
	moduleList := []string{}
	err := system_db_read(sysdb, "permission", "group/"+groupname, &moduleList)
	if err != nil {
		return []string{}
	}
	return moduleList
}

func system_permission_checkUserHasAccessToModule(username string, modulename string) bool {
	//Get user group and see if group exists.
	usergroup := system_permission_getUserPermissionGroup(username)
	groupExists := system_permission_groupExists(usergroup)
	if !groupExists {
		return false
	}

	//Group exists. Check permission on module
	groupAccessList := system_permission_getGroupAccessList(usergroup)
	if len(groupAccessList) == 1 && groupAccessList[0] == "*" {
		return true
	}
	if stringInSlice(modulename, groupAccessList) {
		return true
	}

	return false
}

func system_permission_checkUserIsAdmin(w http.ResponseWriter, r *http.Request) bool {
	username, err := system_auth_getUserName(w, r)
	if err != nil{
		return false
	}
	userGroup := system_permission_getUserPermissionGroup(username)
	if userGroup == "administrator" {
		return true
	}
	return false
}

func system_permission_getUserPermissionGroup(username string) string {
	usergroup := ""
	system_db_read(sysdb, "auth", "group/"+username, &usergroup)
	return (usergroup)
}

//This function check if the given usergroup ID exists.
func system_permission_groupExists(group string) bool {
	dummyPermission := []string{}
	err := system_db_read(sysdb, "permission", "group/"+group, &dummyPermission)
	if err != nil || len(dummyPermission) == 0 {
		return false
	}
	return true
}
