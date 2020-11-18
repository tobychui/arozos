package main

import (
	"net/http"
	"log"
	"strings"
	"encoding/json"
	"github.com/satori/go.uuid"

	auth "imuslab.com/arozos/mod/auth"
)

/*
	USERS MANAGER

	Manage user creation, listing, remove and others
*/

func system_user_init(){
	http.HandleFunc("/system/users/list", system_user_handleList)
	http.HandleFunc("/system/users/editUser", system_user_handleUserEdit)
	http.HandleFunc("/system/users/userinfo", system_user_handleUserInfo)

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
}

//User edit handle. For admin to change settings for a user
func system_user_handleUserEdit(w http.ResponseWriter, r *http.Request){
	//Require admin access
	if !system_permission_checkUserIsAdmin(w,r){
        sendErrorResponse(w, "Permission denied")
	}
	
	opr, _ := mv(r, "opr", true)
	username, _ := mv(r, "username", true)
	if !system_user_userExists(username){
		sendErrorResponse(w, "User not exists")
		return
	}

	if opr == ""{
		//List this user information
		type returnValue struct{
			Username string;
			Icondata string;
			Usergroup string;
		}
		iconData := getUserIcon(username)
		userGroup, err := system_permission_getUserGroups(username)
		if (err != nil){
			sendErrorResponse(w, "Unable to get user group")
			return;
		}
		jsonString, _ := json.Marshal(returnValue{
			Username: username,
			Icondata: iconData,
			Usergroup: userGroup,
		})

		sendJSONResponse(w, string(jsonString))
	}else if opr == "updateUserGroup"{
		//Update the target user's group
		newgroup, err := mv(r, "newgroup", true)
		if err != nil{
			sendErrorResponse(w, "New Group not defined");
			return
		}

		//Check if new group exists
		if !system_permission_groupExists(newgroup){
			sendErrorResponse(w, "Group not exists")
			return
		}

		//OK to proceed
		err = sysdb.Write("auth", "group/" + username, newgroup)
		if err != nil{
			sendErrorResponse(w, err.Error())
			return
		}
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

//User Info handler. Handle user's editing for his / her own profile
func system_user_handleUserInfo(w http.ResponseWriter, r *http.Request){
	username, err := authAgent.GetUserName(w,r);
	if (err != nil){
		sendErrorResponse(w, "User not logged in")
		return;
	}
	opr, _ := mv(r, "opr", true)

	if (opr == ""){
		//Listing mode
		iconData := getUserIcon(username)
		userGroup, err := system_permission_getUserGroups(username)
		if (err != nil){
			sendErrorResponse(w, "Unable to get user group")
			return;
		}
		type returnValue struct{
			Username string;
			Icondata string;
			Usergroup string;
		}
		jsonString, _ := json.Marshal(returnValue{
			Username: username,
			Icondata: iconData,
			Usergroup: userGroup,
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

//Get and set user profile icon
func getUserIcon(username string) string{
	var userIconpath []byte;
	sysdb.Read("auth","profilepic/" + username, &userIconpath)
	return string(userIconpath);
}

func setUserIcon(username string, base64data string){
	sysdb.Write("auth","profilepic/" + username, []byte(base64data))
	return
}

func system_user_userExists(username string) bool{
	//Implement alternative interface for checking user exists
	return authAgent.UserExists(username);
}

func system_user_handleList(w http.ResponseWriter, r *http.Request){
	//List all users within the auth database.
	if (authAgent.CheckAuth(r) == false){
        //This user has not logged in
        sendErrorResponse(w, "User not logged in");
        return;
    }
	if (system_permission_checkUserIsAdmin(w,r) == true){
		entries,_ := sysdb.ListTable("auth")
		results := [][]string{}
		for _, keypairs := range entries{
			if (strings.Contains(string(keypairs[0]), "group/")){
				username:= strings.Split(string(keypairs[0]),"/")[1]
				group := ""
				//Get user icon if it exists in the database
				userIcon := getUserIcon(username)
				
				//Get the user account states
				accountStatus := "normal"
				sysdb.Read("auth","acstatus/" + username, &accountStatus)

				json.Unmarshal(keypairs[1], &group)
				results = append(results, []string{username, group, userIcon, accountStatus})
			}
		}
		
		jsonString, _ := json.Marshal(results)
		sendJSONResponse(w, string(jsonString))
		return
	}else{
		username, _ := authAgent.GetUserName(w,r);
		log.Println("[Permission] " + username + " tries to access admin only function.")
		sendErrorResponse(w, "Permission denied")
		return;
	}
}