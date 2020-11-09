package main

/*
	User Management System

	Entry points for handler user functions
*/


import (
	"net/http"
	"log"
	"encoding/json"
	"strconv"
	"strings"
	"github.com/satori/go.uuid"

	auth "imuslab.com/aroz_online/mod/auth"
	user "imuslab.com/aroz_online/mod/user"
	prout "imuslab.com/aroz_online/mod/prouter"
	module "imuslab.com/aroz_online/mod/modules"
)

func UserSystemInit(){
	//Create a new User Handler
	uh, err := user.NewUserHandler(sysdb, authAgent, permissionHandler, baseStoragePool)
	if err != nil{
		panic(err)
	}
	userHandler = uh;

	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName: "System Settings", 
		AdminOnly: false, 
		UserHandler: userHandler, 
		DeniedHandler: func(w http.ResponseWriter, r *http.Request){
			sendErrorResponse(w, "Permission Denied");
		},
	});


	//Create Endpoint Listeners
	router.HandleFunc("/system/users/list", user_handleList)

	//Everyone logged in should have permission to view their profile and change their password
	http.HandleFunc("/system/users/userinfo", func(w http.ResponseWriter, r *http.Request){
		authAgent.HandleCheckAuth(w,r,user_handleUserInfo)	
	})

	//Interface info should be able to view by everyone logged in
	http.HandleFunc("/system/users/interfaceinfo", func(w http.ResponseWriter, r *http.Request){
		authAgent.HandleCheckAuth(w,r,user_getInterfaceInfo)	
	})

	//Register setting interface for module configuration
	registerSetting(settingModule{
		Name: "My Account",
		Desc: "Manage your account and password",
		IconPath: "SystemAO/users/img/small_icon.png",
		Group: "Users",
		StartDir: "SystemAO/users/account.html",
		RequireAdmin: false,
	})

	registerSetting(settingModule{
		Name: "User List",
		Desc: "A list of users registered on this system",
		IconPath: "SystemAO/users/img/small_icon.png",
		Group: "Users",
		StartDir: "SystemAO/users/userList.html",
		RequireAdmin: true,
	})


	//Handle db / auth / permissions related functions that requires user permission systems. See user.go
	user_createPostUserHandlers();	
}

func user_createPostUserHandlers(){
	//Register auth management events that requires user handler
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName: "System Settings", 
		AdminOnly: true, 
		UserHandler: userHandler, 
		DeniedHandler: func(w http.ResponseWriter, r *http.Request){
			sendErrorResponse(w, "Permission Denied");
		},
	});

	//Handle Authentication Unregister Handler
	adminRouter.HandleFunc("/system/auth/unregister", authAgent.HandleUnregister)
	adminRouter.HandleFunc("/system/users/editUser", user_handleUserEdit)
	adminRouter.HandleFunc("/system/users/removeUser", user_handleUserRemove)
}

//Remove a user from the system
func user_handleUserRemove(w http.ResponseWriter, r *http.Request){
	username, err := mv(r, "username", true);
	if err != nil{
		sendErrorResponse(w, "Username not defined")
		return
	}

	if !authAgent.UserExists(username){
		sendErrorResponse(w, "User not exists")
		return
	}

	userinfo, err := userHandler.GetUserInfoFromUsername(username)
	if err != nil{
		sendErrorResponse(w, err.Error())
		return
	}
	
	//Clear Core User Data
	userinfo.RemoveUser()

	//Clearn Up FileSystem preferences
	system_fs_removeUserPreferences(username);
	sendOK(w);
}

func user_handleUserEdit(w http.ResponseWriter, r *http.Request){
	userinfo, err := userHandler.GetUserInfoFromRequest(w,r)
	if (err != nil){
        //This user has not logged in
        sendErrorResponse(w, "User not logged in");
        return;
	}
	
	if userinfo.IsAdmin() == false{
		//Require admin access
		sendErrorResponse(w, "Permission Denied");
        return;
	}
	
	opr, _ := mv(r, "opr", true)
	username, _ := mv(r, "username", true)
	if !authAgent.UserExists(username){
		sendErrorResponse(w, "User not exists")
		return
	}

	if opr == ""{
		//List this user information
		type returnValue struct{
			Username string;
			Icondata string;
			Usergroup []string;
			Quota int64;
		}
		iconData := getUserIcon(username)
		userGroup, err := permissionHandler.GetUsersPermissionGroup(username)
		if (err != nil){
			sendErrorResponse(w, "Unable to get user group")
			return;
		}
		
		//Parse the user permission groupts
		userGroupNames := []string{}
		for _, gp := range userGroup{
			userGroupNames = append(userGroupNames, gp.Name)
		}

		//Get the user's storaeg quota
		userinfo, _ := userHandler.GetUserInfoFromUsername(username)

		jsonString, _ := json.Marshal(returnValue{
			Username: username,
			Icondata: iconData,
			Usergroup: userGroupNames,
			Quota: userinfo.StorageQuota.GetUserStorageQuota(),
		})

		sendJSONResponse(w, string(jsonString))
	}else if opr == "updateUserGroup"{
		//Update the target user's group
		newgroup, err := mv(r, "newgroup", true)
		if err != nil{
			log.Println(err.Error())
			sendErrorResponse(w, "New Group not defined");
			return
		}

		newQuota, err := mv(r, "quota", true)
		if err != nil{
			log.Println(err.Error())
			sendErrorResponse(w, "Quota not defined");
			return
		}

		quotaInt, err := strconv.Atoi(newQuota)
		if err != nil{
			log.Println(err.Error())
			sendErrorResponse(w, "Invalid Quota Value");
			return
		}


		newGroupKeys := []string{}
		err = json.Unmarshal([]byte(newgroup), &newGroupKeys)
		if err != nil{
			log.Println(err.Error())
			sendErrorResponse(w, "Unable to parse new groups");
			return
		}

		if len(newGroupKeys) == 0{
			sendErrorResponse(w, "User must be in at least one user permission group");
			return
		}

		//Check if each group exists
		for _, thisgp := range newGroupKeys{
			if !permissionHandler.GroupExists(thisgp){
				sendErrorResponse(w, "Group not exists, given: " + thisgp)
				return
			}
		}


	
		//OK to proceed
		userinfo,  err := userHandler.GetUserInfoFromUsername(username)
		if err != nil{
			sendErrorResponse(w, err.Error())
			return
		}

		//Get the permission groups by their ids
		newPermissioGroups := userHandler.GetPermissionHandler().GetPermissionGroupByIDs(newGroupKeys)
		
		//Set the user's permission to these groups
		userinfo.SetUserPermissionGroup(newPermissioGroups)
		if err != nil{
			sendErrorResponse(w, err.Error())
			return
		}

		//Write to quota handler
		userinfo.StorageQuota.SetUserStorageQuota(int64(quotaInt))

		sendOK(w)
	}else if opr == "resetPassword"{
		//Reset password for this user
		//Generate a random password for this user
		tmppassword := uuid.NewV4().String()
		hashedPassword := auth.Hash(tmppassword);
    	err := sysdb.Write("auth", "passhash/" + username, hashedPassword)
		if err != nil{
			sendErrorResponse(w, err.Error())
			return
		}
		//Finish. Send back the reseted password
		sendJSONResponse(w, "\"" + tmppassword + "\"")

	}else{
		sendErrorResponse(w, "Not supported opr")
		return
	}
}

//Get the user interface info for the user to launch into
func user_getInterfaceInfo(w http.ResponseWriter, r *http.Request){
	userinfo, err := userHandler.GetUserInfoFromRequest(w,r)
	if err != nil{
		//User not logged in
		http.NotFound(w,r)
		return
	}

	interfacingModules := userinfo.GetInterfaceModules();

	interfaceModuleInfos := []module.ModuleInfo{}
	for _, im := range interfacingModules{
		interfaceModuleInfos = append(interfaceModuleInfos, *moduleHandler.GetModuleInfoByID(im))
	}

	jsonString, _ := json.Marshal(interfaceModuleInfos);
	sendJSONResponse(w, string(jsonString))
}

func user_handleUserInfo(w http.ResponseWriter, r *http.Request){
	username, err := authAgent.GetUserName(w,r);
	if (err != nil){
		sendErrorResponse(w, "User not logged in")
		return;
	}
	opr, _ := mv(r, "opr", true)

	if (opr == ""){
		//Listing mode
		iconData := getUserIcon(username)
		userGroup, err := permissionHandler.GetUsersPermissionGroup(username)
		if (err != nil){
			sendErrorResponse(w, "Unable to get user group")
			return;
		}

		userGroupNames := []string{}
		for _, group := range userGroup{
			userGroupNames = append(userGroupNames, group.Name)
		}
		type returnValue struct{
			Username string;
			Icondata string;
			Usergroup []string;
		}
		jsonString, _ := json.Marshal(returnValue{
			Username: username,
			Icondata: iconData,
			Usergroup: userGroupNames,
		})

		sendJSONResponse(w, string(jsonString))
		return;
	}else if (opr == "changepw"){
		oldpw, _ := mv(r, "oldpw", true)
		newpw, _ := mv(r, "newpw", true)
		if (oldpw == "" || newpw == ""){
			sendErrorResponse(w, "Password cannot be empty")
			return;
		}
		//valid the old password
		hashedPassword := auth.Hash(oldpw)
		var passwordInDB string
		err = sysdb.Read("auth", "passhash/" + username, &passwordInDB)
		if (hashedPassword != passwordInDB){
			//Old password entry invalid.
			sendErrorResponse(w, "Invalid old password.")
			return;
		}
		//OK! Change user password
		newHashedPassword := auth.Hash(newpw)
		sysdb.Write("auth", "passhash/" + username, newHashedPassword)
		sendOK(w);
	}else if (opr == "changeprofilepic"){
		picdata, _ := mv(r, "picdata", true)
		if (picdata != ""){
			setUserIcon(username, picdata);
			sendOK(w);
		}else{
			sendErrorResponse(w, "Empty image data received.")
			return
		}
	}else{
		sendErrorResponse(w, "Not supported opr")
		return
	}
}

func user_handleList(w http.ResponseWriter, r *http.Request){
	userinfo, err := userHandler.GetUserInfoFromRequest(w,r)
	if (err != nil){
        //This user has not logged in
        sendErrorResponse(w, "User not logged in");
        return;
    }
	if (userinfo.IsAdmin() == true){
		entries,_ := sysdb.ListTable("auth")
		var results [][]interface{}
		for _, keypairs := range entries{
			if (strings.Contains(string(keypairs[0]), "group/")){
				username:= strings.Split(string(keypairs[0]),"/")[1]
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
		sendJSONResponse(w, string(jsonString))
	}else{
		sendErrorResponse(w, "Permission denied")
		return;
	}
}

func getUserIcon(username string) string{
	var userIconpath []byte;
	sysdb.Read("auth","profilepic/" + username, &userIconpath)
	return string(userIconpath);
}

func setUserIcon(username string, base64data string){
	sysdb.Write("auth","profilepic/" + username, []byte(base64data))
	return
}
