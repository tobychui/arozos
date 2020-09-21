package main

import (
	"net/http"
	"log"
	"strings"
	"encoding/json"
)

/*
	USERS MANAGER

	Manage user creation, listing, remove and others
*/

func system_user_init(){
	http.HandleFunc("/system/users/list", system_user_handleList)
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

func system_user_handleUserInfo(w http.ResponseWriter, r *http.Request){
	username, err := system_auth_getUserName(w,r);
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
		hashedPassword := system_auth_hash(oldpw)
		var passwordInDB string
		err = system_db_read(sysdb, "auth", "passhash/" + username, &passwordInDB)
		if (hashedPassword != passwordInDB){
			//Old password entry invalid.
			sendErrorResponse(w, "Invalid old password.")
			return;
		}
		//OK! Change user password
		newHashedPassword := system_auth_hash(newpw)
		system_db_write(sysdb, "auth", "passhash/" + username, newHashedPassword)
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
	system_db_read(sysdb, "auth","profilepic/" + username, &userIconpath)
	return string(userIconpath);
}

func setUserIcon(username string, base64data string){
	system_db_write(sysdb, "auth","profilepic/" + username, []byte(base64data))
	return
}

func system_user_handleList(w http.ResponseWriter, r *http.Request){
	//List all users within the auth database.
	if (system_auth_chkauth(w,r) == false){
        //This user has not logged in
        sendErrorResponse(w, "User not logged in");
        return;
    }
	if (system_permission_checkUserIsAdmin(w,r) == true){
		entries := system_db_listTable(sysdb, "auth")
		results := [][]string{}
		for _, keypairs := range entries{
			if (strings.Contains(string(keypairs[0]), "group/")){
				username:= strings.Split(string(keypairs[0]),"/")[1]
				group := ""
				//Get user icon if it exists in the database
				userIcon := getUserIcon(username)
				
				//Get the user account states
				accountStatus := "normal"
				system_db_read(sysdb, "auth","acstatus/" + username, &accountStatus)

				json.Unmarshal(keypairs[1], &group)
				results = append(results, []string{username, group, userIcon, accountStatus})
			}
		}
		
		jsonString, _ := json.Marshal(results)
		sendJSONResponse(w, string(jsonString))
		return
	}else{
		username, _ := system_auth_getUserName(w,r);
		log.Println("[Permission] " + username + " tries to access admin only function.")
		sendErrorResponse(w, "Permission denied")
		return;
	}
}