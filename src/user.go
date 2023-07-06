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
	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
	user "imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
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
				utils.SendErrorResponse(w, "Permission Denied")
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
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Handle Authentication Unregister Handler
	adminRouter.HandleFunc("/system/auth/unregister", authAgent.HandleUnregister)
	adminRouter.HandleFunc("/system/users/editUser", user_handleUserEdit)
	adminRouter.HandleFunc("/system/users/removeUser", user_handleUserRemove)
}

// Remove a user from the system
func user_handleUserRemove(w http.ResponseWriter, r *http.Request) {
	username, err := utils.PostPara(r, "username")
	if err != nil {
		utils.SendErrorResponse(w, "Username not defined")
		return
	}

	if !authAgent.UserExists(username) {
		utils.SendErrorResponse(w, "User not exists")
		return
	}

	userinfo, err := userHandler.GetUserInfoFromUsername(username)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	currentUserinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		//This user has not logged in
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	if currentUserinfo.Username == userinfo.Username {
		//This user has not logged in
		utils.SendErrorResponse(w, "You can't remove yourself")
		return
	}

	//Clear Core User Data
	userinfo.RemoveUser()

	//Clearn Up FileSystem preferences
	system_fs_removeUserPreferences(username)
	utils.SendOK(w)
}

func user_handleUserEdit(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		//This user has not logged in
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	if userinfo.IsAdmin() == false {
		//Require admin access
		utils.SendErrorResponse(w, "Permission Denied")
		return
	}

	opr, _ := utils.PostPara(r, "opr")
	username, _ := utils.PostPara(r, "username")
	if !authAgent.UserExists(username) {
		utils.SendErrorResponse(w, "User not exists")
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
			utils.SendErrorResponse(w, "Unable to get user group")
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

		utils.SendJSONResponse(w, string(jsonString))
	} else if opr == "updateUserGroup" {
		//Update the target user's group
		newgroup, err := utils.PostPara(r, "newgroup")
		if err != nil {
			systemWideLogger.PrintAndLog("User", err.Error(), err)
			utils.SendErrorResponse(w, "New Group not defined")
			return
		}

		newQuota, err := utils.PostPara(r, "quota")
		if err != nil {
			systemWideLogger.PrintAndLog("User", err.Error(), err)
			utils.SendErrorResponse(w, "Quota not defined")
			return
		}

		quotaInt, err := strconv.Atoi(newQuota)
		if err != nil {
			systemWideLogger.PrintAndLog("User", err.Error(), err)
			utils.SendErrorResponse(w, "Invalid Quota Value")
			return
		}

		newGroupKeys := []string{}
		err = json.Unmarshal([]byte(newgroup), &newGroupKeys)
		if err != nil {
			systemWideLogger.PrintAndLog("User", err.Error(), err)
			utils.SendErrorResponse(w, "Unable to parse new groups")
			return
		}

		if len(newGroupKeys) == 0 {
			utils.SendErrorResponse(w, "User must be in at least one user permission group")
			return
		}

		//Check if each group exists
		for _, thisgp := range newGroupKeys {
			if !permissionHandler.GroupExists(thisgp) {
				utils.SendErrorResponse(w, "Group not exists, given: "+thisgp)
				return
			}
		}

		//OK to proceed
		userinfo, err := userHandler.GetUserInfoFromUsername(username)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		//Check if the current user is the only one admin in the administrator group and he is leaving the group
		allAdministratorGroupUsers, err := userHandler.GetUsersInPermissionGroup("administrator")
		if err == nil {
			//Skip checking if error
			if len(allAdministratorGroupUsers) == 1 && userinfo.UserIsInOneOfTheGroupOf([]string{"administrator"}) && !utils.StringInArray(newGroupKeys, "administrator") {
				//Current administrator group only contain 1 user
				//This user is in the administrator group
				//The user want to unset himself from administrator group
				//Reject the operation as this will cause system lockdown
				utils.SendErrorResponse(w, "You are the only administrator. You cannot remove yourself from the administrator group.")
				return
			}
		}

		//Get the permission groups by their ids
		newPermissioGroups := userHandler.GetPermissionHandler().GetPermissionGroupByNameList(newGroupKeys)

		//Set the user's permission to these groups
		userinfo.SetUserPermissionGroup(newPermissioGroups)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		//Write to quota handler
		userinfo.StorageQuota.SetUserStorageQuota(int64(quotaInt))

		utils.SendOK(w)
	} else if opr == "resetPassword" {
		//Reset password for this user
		//Generate a random password for this user
		tmppassword := uuid.NewV4().String()
		hashedPassword := auth.Hash(tmppassword)
		err := sysdb.Write("auth", "passhash/"+username, hashedPassword)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		//Finish. Send back the reseted password
		utils.SendJSONResponse(w, "\""+tmppassword+"\"")

	} else {
		utils.SendErrorResponse(w, "Not supported opr")
		return
	}
}

// Get the user interface info for the user to launch into
func user_getInterfaceInfo(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		//User not logged in
		utils.SendErrorResponse(w, "User not logged in")
		return
	}

	interfacingModules := userinfo.GetInterfaceModules()

	interfaceModuleInfos := []module.ModuleInfo{}
	for _, im := range interfacingModules {
		interfaceModuleInfos = append(interfaceModuleInfos, *moduleHandler.GetModuleInfoByID(im))
	}

	jsonString, _ := json.Marshal(interfaceModuleInfos)
	utils.SendJSONResponse(w, string(jsonString))
}

func user_handleUserInfo(w http.ResponseWriter, r *http.Request) {
	username, err := authAgent.GetUserName(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	opr, _ := utils.PostPara(r, "opr")

	if opr == "" {
		//Listing mode
		iconData := getUserIcon(username)
		userGroup, err := permissionHandler.GetUsersPermissionGroup(username)
		if err != nil {
			utils.SendErrorResponse(w, "Unable to get user group")
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

		utils.SendJSONResponse(w, string(jsonString))
		return
	} else if opr == "changepw" {
		oldpw, _ := utils.PostPara(r, "oldpw")
		newpw, _ := utils.PostPara(r, "newpw")
		if oldpw == "" || newpw == "" {
			utils.SendErrorResponse(w, "Password cannot be empty")
			return
		}
		//valid the old password
		hashedPassword := auth.Hash(oldpw)
		var passwordInDB string
		err = sysdb.Read("auth", "passhash/"+username, &passwordInDB)
		if hashedPassword != passwordInDB {
			//Old password entry invalid.
			utils.SendErrorResponse(w, "Invalid old password.")
			return
		}

		//Logout users from all switchable accounts
		authAgent.SwitchableAccountManager.ExpireUserFromAllSwitchableAccountPool(username)

		//OK! Change user password
		newHashedPassword := auth.Hash(newpw)
		sysdb.Write("auth", "passhash/"+username, newHashedPassword)
		utils.SendOK(w)
	} else if opr == "changeprofilepic" {
		picdata, _ := utils.PostPara(r, "picdata")
		if picdata != "" {
			setUserIcon(username, picdata)
			utils.SendOK(w)
		} else {
			utils.SendErrorResponse(w, "Empty image data received.")
			return
		}
	} else {
		utils.SendErrorResponse(w, "Not supported opr")
		return
	}
}

func user_handleList(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		//This user has not logged in
		utils.SendErrorResponse(w, "User not logged in")
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
		utils.SendJSONResponse(w, string(jsonString))
	} else {
		utils.SendErrorResponse(w, "Permission Denied")
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
