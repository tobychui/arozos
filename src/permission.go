package main

import (
	"encoding/json"
	"net/http"

	permission "imuslab.com/arozos/mod/permission"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

// handleGroupDeleteWithUserHandling handles group deletion with user migration options.
// POST params:
//   - groupname: name of the group to delete
//   - action: one of "reassign" | "removeonly" | "deleteusers"
//   - targetgroup: (required when action=="reassign") the group users are moved to
func handleGroupDeleteWithUserHandling(w http.ResponseWriter, r *http.Request) {
	groupname, err := utils.PostPara(r, "groupname")
	if err != nil {
		utils.SendErrorResponse(w, "groupname not defined")
		return
	}

	if !permissionHandler.GroupExists(groupname) {
		utils.SendErrorResponse(w, "Group not exists")
		return
	}

	if groupname == "administrator" {
		utils.SendErrorResponse(w, "You cannot remove the Administrator group")
		return
	}

	action, err := utils.PostPara(r, "action")
	if err != nil {
		utils.SendErrorResponse(w, "action not defined")
		return
	}

	allUsernames := authAgent.ListUsers()

	switch action {
	case "reassign":
		targetgroup, err := utils.PostPara(r, "targetgroup")
		if err != nil || targetgroup == "" {
			utils.SendErrorResponse(w, "targetgroup not defined")
			return
		}
		if !permissionHandler.GroupExists(targetgroup) {
			utils.SendErrorResponse(w, "Target group not exists: "+targetgroup)
			return
		}

		for _, username := range allUsernames {
			userinfo, err := userHandler.GetUserInfoFromUsername(username)
			if err != nil {
				continue
			}
			if !userinfo.UserIsInOneOfTheGroupOf([]string{groupname}) {
				continue
			}
			currentGroups := userinfo.GetUserPermissionGroupNames()
			newGroups := []string{}
			alreadyHasTarget := false
			for _, g := range currentGroups {
				if g == targetgroup {
					alreadyHasTarget = true
				}
				if g == groupname {
					// Will be replaced below
					continue
				}
				newGroups = append(newGroups, g)
			}
			if !alreadyHasTarget {
				newGroups = append(newGroups, targetgroup)
			}
			if len(newGroups) == 0 {
				newGroups = []string{targetgroup}
			}
			newPermGroups := permissionHandler.GetPermissionGroupByNameList(newGroups)
			userinfo.SetUserPermissionGroup(newPermGroups)
		}

	case "removeonly":
		for _, username := range allUsernames {
			userinfo, err := userHandler.GetUserInfoFromUsername(username)
			if err != nil {
				continue
			}
			if !userinfo.UserIsInOneOfTheGroupOf([]string{groupname}) {
				continue
			}
			currentGroups := userinfo.GetUserPermissionGroupNames()
			newGroups := []string{}
			for _, g := range currentGroups {
				if g != groupname {
					newGroups = append(newGroups, g)
				}
			}
			// Allow empty group list (user will see "Invalid interface module" warning on login)
			newPermGroups := permissionHandler.GetPermissionGroupByNameList(newGroups)
			userinfo.SetUserPermissionGroup(newPermGroups)
		}

	case "deleteusers":
		// Identify the caller so we never delete the account making this request.
		// If the admin is in the target group, we remove the group from their account
		// instead of deleting it — preventing an immediate session/system crash.
		callerUsername, _ := authAgent.GetUserName(w, r)

		for _, username := range allUsernames {
			userinfo, err := userHandler.GetUserInfoFromUsername(username)
			if err != nil {
				continue
			}
			if !userinfo.UserIsInOneOfTheGroupOf([]string{groupname}) {
				continue
			}
			if username == callerUsername {
				// Safety: only remove the group from the caller's own account.
				currentGroups := userinfo.GetUserPermissionGroupNames()
				newGroups := []string{}
				for _, g := range currentGroups {
					if g != groupname {
						newGroups = append(newGroups, g)
					}
				}
				newPermGroups := permissionHandler.GetPermissionGroupByNameList(newGroups)
				userinfo.SetUserPermissionGroup(newPermGroups)
				continue
			}
			userinfo.RemoveUser()
		}

	default:
		utils.SendErrorResponse(w, "Invalid action: "+action)
		return
	}

	// Remove the permission group itself
	group := permissionHandler.GetPermissionGroupByName(groupname)
	if group != nil {
		group.Remove()
	}

	newGroupList := []*permission.PermissionGroup{}
	for _, pg := range permissionHandler.PermissionGroups {
		if pg.Name != groupname {
			newGroupList = append(newGroupList, pg)
		}
	}
	permissionHandler.PermissionGroups = newGroupList

	utils.SendOK(w)
}

// handleGroupListUsers returns a JSON list of users in a group and whether each user
// has more than one group (used for warning in the delete UI).
// GET params:
//   - groupname: name of the group to inspect
type groupUserPreview struct {
	Username   string `json:"username"`
	GroupCount int    `json:"groupCount"`
}

func handleGroupListUsers(w http.ResponseWriter, r *http.Request) {
	groupname, err := utils.GetPara(r, "groupname")
	if err != nil {
		utils.SendErrorResponse(w, "groupname not defined")
		return
	}

	if !permissionHandler.GroupExists(groupname) {
		utils.SendErrorResponse(w, "Group not exists")
		return
	}

	allUsernames := authAgent.ListUsers()
	results := []groupUserPreview{}

	for _, username := range allUsernames {
		userinfo, err := userHandler.GetUserInfoFromUsername(username)
		if err != nil {
			continue
		}
		if userinfo.UserIsInOneOfTheGroupOf([]string{groupname}) {
			results = append(results, groupUserPreview{
				Username:   username,
				GroupCount: len(userinfo.GetUserPermissionGroupNames()),
			})
		}
	}

	jsonString, _ := json.Marshal(results)
	utils.SendJSONResponse(w, string(jsonString))
}

func permissionNewHandler() {
	ph, err := permission.NewPermissionHandler(sysdb)
	if err != nil {
		systemWideLogger.PrintAndLog("Permission", "Permission Handler creation failed.", err)
		panic(err)
	}
	permissionHandler = ph
	permissionHandler.LoadPermissionGroupsFromDatabase()

}

func permissionInit() {
	//Register the permission handler, require authentication except listgroup
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Must be handled by default router
	http.HandleFunc("/system/permission/listgroup", func(w http.ResponseWriter, r *http.Request) {
		if authAgent.GetUserCounts() == 0 {
			//There is no user within the system. Only allow register of admin account
			js, _ := json.Marshal([]string{"administrator"})
			utils.SendJSONResponse(w, string(js))
			//permissionHandler.HandleListGroup(w, r)
		} else {
			//There are already users in the system. Only allow authorized users
			if authAgent.CheckAuth(r) {
				requestingUser, _ := userHandler.GetUserInfoFromRequest(w, r)
				if requestingUser != nil && requestingUser.IsAdmin() {
					permissionHandler.HandleListGroup(w, r)
				} else {
					errorHandlePermissionDenied(w, r)
				}

			} else {
				errorHandlePermissionDenied(w, r)
				return
			}
		}

	})
	adminRouter.HandleFunc("/system/permission/newgroup", permissionHandler.HandleGroupCreate)
	adminRouter.HandleFunc("/system/permission/editgroup", permissionHandler.HandleGroupEdit)
	adminRouter.HandleFunc("/system/permission/delgroup", permissionHandler.HandleGroupRemove)
	adminRouter.HandleFunc("/system/permission/delgroupwithhandling", handleGroupDeleteWithUserHandling)
	adminRouter.HandleFunc("/system/permission/listgroupusers", handleGroupListUsers)

	registerSetting(settingModule{
		Name:         "Permission Groups",
		Desc:         "Handle the permission of access in groups",
		IconPath:     "SystemAO/users/img/small_icon.png",
		Group:        "Users",
		StartDir:     "SystemAO/users/group.html",
		RequireAdmin: true,
	})
}
