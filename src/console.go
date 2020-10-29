package main

import (
	"strings"
	"encoding/json"
	"fmt"
)

//Handle console command from the console module
func consoleCommandHandler(input string)string{
	chunk := strings.Split(input, " ");
	if len(chunk) > 0 && chunk[0] == "auth" {
		if (matchSubfix(chunk, []string{"auth","new"}, 4, "auth new {username} {password}")){
			return "Creating a new user " + chunk[2] + " with password " + chunk[3]
		}
	}else if (len(chunk) > 0 && chunk[0] == "permission"){
		if (matchSubfix(chunk, []string{"permission","list"}, 2, "")){
			fmt.Println("> ",permissionHandler.PermissionGroups)
			return "OK"
		}else if matchSubfix(chunk, []string{"permission","user"}, 3, "permission user {username}"){
			username := chunk[2];
			group, _ := permissionHandler.GetUsersPermissionGroup(username);
			for _, thisGroup := range group{
				fmt.Println(thisGroup)
			}
			return "OK"
		}else if matchSubfix(chunk, []string{"permission","group"}, 3, "permission group {groupname}"){
			groupname := chunk[2];
			groups := permissionHandler.PermissionGroups;
			for _, thisGroup := range groups{
				if (thisGroup.Name == groupname){
					fmt.Println(thisGroup)
				}
			}
			return "OK"
		}else if matchSubfix(chunk, []string{"permission","getinterface"}, 3, "permission getinterface {username}"){
			//Get the list of interface module for this user
			userinfo, err := userHandler.GetUserInfoFromUsername(chunk[2])
			if err != nil{
				return err.Error()
			}
			return strings.Join(userinfo.GetInterfaceModules(), ",")
		}
	}else if (len(chunk) > 0 && chunk[0] == "quota"){
		if (matchSubfix(chunk, []string{"quota","user"}, 3, "quota user {username}")){
			userinfo, err := userHandler.GetUserInfoFromUsername(chunk[2])
			if err != nil{
				return err.Error()
			}

			fmt.Println("> " + "User Quota: ", userinfo.StorageQuota.GetUserStorageQuota(), "bytes")
			return "OK"
		}
	}else if (len(chunk) > 0 && chunk[0] == "database"){
		if (matchSubfix(chunk, []string{"database","dump"}, 3, "database dump {filename}")){
			//Dump the database to file
			
			return "WIP"
		}else if (matchSubfix(chunk, []string{"database","list","tables"}, 3, "")){
			//List all opened tables
			for key, _ := range sysdb.Tables{
				fmt.Println(key);
			}
			return "OK"
		}else if (matchSubfix(chunk, []string{"database","view"}, 3, "database list {tablename}")){
			//List everything in this table
			tableList := []string{}
			for key, _ := range sysdb.Tables{
				tableList = append(tableList, key)
			}
			if !inArray(tableList, chunk[2]){
				return "Table not exists"
			}else if (chunk[2] == "auth"){
				return "You cannot view this database table"
			}
			entries, err := sysdb.ListTable(chunk[2])
			if err != nil{
				return err.Error()
			}
			
			for _, keypairs := range entries{
				fmt.Println("> " + string(keypairs[0]) + ":" + string(keypairs[1]))
			}

			fmt.Println("Total Entry Count: ", len(entries));
			return "OK"
		}
	}else if (len(chunk) > 0 && chunk[0] == "user"){
		if (matchSubfix(chunk, []string{"user","object","dump"}, 4, "user object dump {username}")){
			//Dump the given user object as json
			userinfo, err := userHandler.GetUserInfoFromUsername(chunk[3])
			if err != nil{
				return err.Error()
			}

			jsonString, _ := json.Marshal(userinfo)
			return string(jsonString)
		}else if (matchSubfix(chunk, []string{"user","quota"}, 3, "user quota {username}")){
			//List user quota of the given username
			userinfo, err := userHandler.GetUserInfoFromUsername(chunk[2])
			if err != nil{
				return err.Error()
			}

			fmt.Println(userinfo.StorageQuota.UsedStorageQuota, "/", userinfo.StorageQuota.TotalStorageQuota)
			return "OK"
		}
	}else if (len(chunk) > 0 && chunk[0] == "storage"){
			if (matchSubfix(chunk, []string{"storage","list","basepool"}, 3, "")){
				//Dump the base storage pool
				jsonString, _ := json.Marshal(userHandler.GetStoragePool())
				return string(jsonString)
			}
	}else if (len(chunk) == 1 && chunk[0] == "stop"){
		//Stopping the server
		fmt.Println("Shutting down aroz online system by terminal request")
		executeShutdownSequence()
	}

	return "Invalid Command"
}


//Check if the given line input match the requirement
func matchSubfix(chunk []string, match []string, minlength int, usageExample string) bool{
	matching := true
	//Check if the chunk contains minmium length of the command request
	if len(chunk) >= len(match){
		for i, cchunk := range match{
			if (chunk[i] != cchunk){
				matching = false
			}
		}
	}else{
		matching = false
	}

	if len(chunk) - minlength == -1 && chunk[len(chunk) - 1] == match[len(match) - 1] {
		fmt.Println("Paramter missing. Usage: " + usageExample)
		return false
	}

	return matching
}