package main

/*
	User Management System

	Entry points for handler user functions
*/

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	uuid "github.com/satori/go.uuid"

	auth "imuslab.com/arozos/mod/auth"
	"imuslab.com/arozos/mod/common"
	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
	user "imuslab.com/arozos/mod/user"
)

func UserSystemInit() {
	//Create a new User Handler
	uh, err := user.NewUserHandler(sysdb, authAgent, permissionHandler, baseStoragePool, &shareEntryTable)
	if err != nil {
		panic(err)
	}
	userHandler = uh

	/*
		router := prout.NewModuleRouter(prout.RouterOption{
			ModuleName:  "System Settings",
			AdminOnly:   false,
			UserHandler: userHandler,
			DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
				common.SendErrorResponse(w, "Permission Denied")
			},
		})
	*/

	//Create Endpoint Listeners
	http.HandleFunc("/system/users/list", user_handleList)

	//Everyone logged in should have permission to view their profile and change their password
	http.HandleFunc("/system/users/userinfo", func(w http.ResponseWriter, r *http.Request) {
		authAgent.HandleCheckAuth(w, r, user_handleUserInfo)
	})

	//Interface info should be able to view by everyone logged in
	http.HandleFunc("/system/users/interfaceinfo", func(w http.ResponseWriter, r *http.Request) {
		authAgent.HandleCheckAuth(w, r, user_getInterfaceInfo)
	})

	//Register setting interface for module configuration
	registerSetting(settingModule{
		Name:         "My Account",
		Desc:         "Manage your account and password",
		IconPath:     "SystemAO/users/img/small_icon.png",
		Group:        "Users",
		StartDir:     "SystemAO/users/account.html",
		RequireAdmin: false,
	})

	registerSetting(settingModule{
		Name:         "User List",
		Desc:         "A list of users registered on this system",
		IconPath:     "SystemAO/users/img/small_icon.png",
		Group:        "Users",
		StartDir:     "SystemAO/users/userList.html",
		RequireAdmin: true,
	})

	//Register auth management events that requires user handler
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Settings",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			common.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Handle Authentication Unregister Handler
	adminRouter.HandleFunc("/system/auth/unregister", authAgent.HandleUnregister)
	adminRouter.HandleFunc("/system/users/editUser", user_handleUserEdit)
	adminRouter.HandleFunc("/system/users/removeUser", user_handleUserRemove)
}

//Remove a user from the system
func user_handleUserRemove(w http.ResponseWriter, r *http.Request) {
	username, err := common.Mv(r, "username", true)
	if err != nil {
		common.SendErrorResponse(w, "Username not defined")
		return
	}

	if !authAgent.UserExists(username) {
		common.SendErrorResponse(w, "User not exists")
		return
	}

	userinfo, err := userHandler.GetUserInfoFromUsername(username)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	currentUserinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		//This user has not logged in
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	if currentUserinfo.Username == userinfo.Username {
		//This user has not logged in
		common.SendErrorResponse(w, "You can't remove yourself")
		return
	}

	//Clear Core User Data
	userinfo.RemoveUser()

	//Clearn Up FileSystem preferences
	system_fs_removeUserPreferences(username)
	common.SendOK(w)
}

func user_handleUserEdit(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		//This user has not logged in
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	if userinfo.IsAdmin() == false {
		//Require admin access
		common.SendErrorResponse(w, "Permission Denied")
		return
	}

	opr, _ := common.Mv(r, "opr", true)
	username, _ := common.Mv(r, "username", true)
	if !authAgent.UserExists(username) {
		common.SendErrorResponse(w, "User not exists")
		return
	}

	if opr == "" {
		//List this user information
		type returnValue struct {
			Username  string
			Icondata  string
			Usergroup []string
			Quota     int64
		}
		iconData := getUserIcon(username)
		userGroup, err := permissionHandler.GetUsersPermissionGroup(username)
		if err != nil {
			common.SendErrorResponse(w, "Unable to get user group")
			return
		}

		//Parse the user permission groupts
		userGroupNames := []string{}
		for _, gp := range userGroup {
			userGroupNames = append(userGroupNames, gp.Name)
		}

		//Get the user's storaeg quota
		userinfo, _ := userHandler.GetUserInfoFromUsername(username)

		jsonString, _ := json.Marshal(returnValue{
			Username:  username,
			Icondata:  iconData,
			Usergroup: userGroupNames,
			Quota:     userinfo.StorageQuota.GetUserStorageQuota(),
		})

		common.SendJSONResponse(w, string(jsonString))
	} else if opr == "updateUserGroup" {
		//Update the target user's group
		newgroup, err := common.Mv(r, "newgroup", true)
		if err != nil {
			systemWideLogger.PrintAndLog("User", err.Error(), err)
			common.SendErrorResponse(w, "New Group not defined")
			return
		}

		newQuota, err := common.Mv(r, "quota", true)
		if err != nil {
			systemWideLogger.PrintAndLog("User", err.Error(), err)
			common.SendErrorResponse(w, "Quota not defined")
			return
		}

		quotaInt, err := strconv.Atoi(newQuota)
		if err != nil {
			systemWideLogger.PrintAndLog("User", err.Error(), err)
			common.SendErrorResponse(w, "Invalid Quota Value")
			return
		}

		newGroupKeys := []string{}
		err = json.Unmarshal([]byte(newgroup), &newGroupKeys)
		if err != nil {
			systemWideLogger.PrintAndLog("User", err.Error(), err)
			common.SendErrorResponse(w, "Unable to parse new groups")
			return
		}

		if len(newGroupKeys) == 0 {
			common.SendErrorResponse(w, "User must be in at least one user permission group")
			return
		}

		//Check if each group exists
		for _, thisgp := range newGroupKeys {
			if !permissionHandler.GroupExists(thisgp) {
				common.SendErrorResponse(w, "Group not exists, given: "+thisgp)
				return
			}
		}

		//OK to proceed
		userinfo, err := userHandler.GetUserInfoFromUsername(username)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}

		//Check if the current user is the only one admin in the administrator group and he is leaving the group
		allAdministratorGroupUsers, err := userHandler.GetUsersInPermissionGroup("administrator")
		if err == nil {
			//Skip checking if error
			if len(allAdministratorGroupUsers) == 1 && userinfo.UserIsInOneOfTheGroupOf([]string{"administrator"}) && !common.StringInArray(newGroupKeys, "administrator") {
				//Current administrator group only contain 1 user
				//This user is in the administrator group
				//The user want to unset himself from administrator group
				//Reject the operation as this will cause system lockdown
				common.SendErrorResponse(w, "You are the only administrator. You cannot remove yourself from the administrator group.")
				return
			}
		}

		//Get the permission groups by their ids
		newPermissioGroups := userHandler.GetPermissionHandler().GetPermissionGroupByNameList(newGroupKeys)

		//Set the user's permission to these groups
		userinfo.SetUserPermissionGroup(newPermissioGroups)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}

		//Write to quota handler
		userinfo.StorageQuota.SetUserStorageQuota(int64(quotaInt))

		common.SendOK(w)
	} else if opr == "resetPassword" {
		//Reset password for this user
		//Generate a random password for this user
		tmppassword := uuid.NewV4().String()
		hashedPassword := auth.Hash(tmppassword)
		err := sysdb.Write("auth", "passhash/"+username, hashedPassword)
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}
		//Finish. Send back the reseted password
		common.SendJSONResponse(w, "\""+tmppassword+"\"")

	} else {
		common.SendErrorResponse(w, "Not supported opr")
		return
	}
}

//Get the user interface info for the user to launch into
func user_getInterfaceInfo(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		//User not logged in
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	interfacingModules := userinfo.GetInterfaceModules()

	interfaceModuleInfos := []module.ModuleInfo{}
	for _, im := range interfacingModules {
		interfaceModuleInfos = append(interfaceModuleInfos, *moduleHandler.GetModuleInfoByID(im))
	}

	jsonString, _ := json.Marshal(interfaceModuleInfos)
	common.SendJSONResponse(w, string(jsonString))
}

func user_handleUserInfo(w http.ResponseWriter, r *http.Request) {
	username, err := authAgent.GetUserName(w, r)
	if err != nil {
		common.SendErrorResponse(w, "User not logged in")
		return
	}
	opr, _ := common.Mv(r, "opr", true)

	if opr == "" {
		//Listing mode
		iconData := getUserIcon(username)
		userGroup, err := permissionHandler.GetUsersPermissionGroup(username)
		if err != nil {
			common.SendErrorResponse(w, "Unable to get user group")
			return
		}

		userGroupNames := []string{}
		for _, group := range userGroup {
			userGroupNames = append(userGroupNames, group.Name)
		}
		type returnValue struct {
			Username  string
			Icondata  string
			Usergroup []string
		}
		jsonString, _ := json.Marshal(returnValue{
			Username:  username,
			Icondata:  iconData,
			Usergroup: userGroupNames,
		})

		common.SendJSONResponse(w, string(jsonString))
		return
	} else if opr == "changepw" {
		oldpw, _ := common.Mv(r, "oldpw", true)
		newpw, _ := common.Mv(r, "newpw", true)
		if oldpw == "" || newpw == "" {
			common.SendErrorResponse(w, "Password cannot be empty")
			return
		}
		//valid the old password
		hashedPassword := auth.Hash(oldpw)
		var passwordInDB string
		err = sysdb.Read("auth", "passhash/"+username, &passwordInDB)
		if hashedPassword != passwordInDB {
			//Old password entry invalid.
			common.SendErrorResponse(w, "Invalid old password.")
			return
		}
		//OK! Change user password
		newHashedPassword := auth.Hash(newpw)
		sysdb.Write("auth", "passhash/"+username, newHashedPassword)
		common.SendOK(w)
	} else if opr == "changeprofilepic" {
		picdata, _ := common.Mv(r, "picdata", true)
		if picdata != "" {
			setUserIcon(username, picdata)
			common.SendOK(w)
		} else {
			common.SendErrorResponse(w, "Empty image data received.")
			return
		}
	} else {
		common.SendErrorResponse(w, "Not supported opr")
		return
	}
}

func user_handleList(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		//This user has not logged in
		common.SendErrorResponse(w, "User not logged in")
		return
	}
	if authAgent.CheckAuth(r) {
		entries, _ := sysdb.ListTable("auth")
		var results [][]interface{}
		for _, keypairs := range entries {
			if strings.Contains(string(keypairs[0]), "group/") {
				username := strings.Split(string(keypairs[0]), "/")[1]
				group := []string{}
				//Get user icon if it exists in the database
				userIcon := getUserIcon(username)

				json.Unmarshal(keypairs[1], &group)
				var thisUserInfo []interface{}
				thisUserInfo = append(thisUserInfo, username)
				thisUserInfo = append(thisUserInfo, group)
				thisUserInfo = append(thisUserInfo, userIcon)
				thisUserInfo = append(thisUserInfo, username == userinfo.Username)
				results = append(results, thisUserInfo)
			}
		}

		jsonString, _ := json.Marshal(results)
		common.SendJSONResponse(w, string(jsonString))
	} else {
		common.SendErrorResponse(w, "Permission Denied")
	}
}

func getUserIcon(username string) string {
	var userIconpath []byte
	sysdb.Read("auth", "profilepic/"+username, &userIconpath)
	return string(userIconpath)
}

func setUserIcon(username string, base64data string) {
	sysdb.Write("auth", "profilepic/"+username, []byte(base64data))
	return
}
