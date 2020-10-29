package main

/*
	System Startup Script for ArOZ Online System
	author: tobychui
*/

import (
	"net/http"
	"log"

	//ArOZ Online Core Modules
	db "imuslab.com/aroz_online/mod/database"
	permission "imuslab.com/aroz_online/mod/permission"
	auth "imuslab.com/aroz_online/mod/auth"
	
)



func RunStartup(){
	//1. Initiate the main system database
	if !fileExists("system/"){
		panic("▒▒ SYSTEM FOLDER NOT FOUND ▒▒")
	}
	dbconn, err := db.NewDatabase("system/ao.db", false)
	if err != nil{
		panic(err)
	}
	sysdb = dbconn;

	//2. Initiate the auth Agent
	authAgent = auth.NewAuthenticationAgent("ao_auth", []byte(*session_key), sysdb, *allow_public_registry, func(w http.ResponseWriter, r *http.Request){
		//Login Redirection Handler, redirect it login.system
		w.Header().Set("Cache-Control", "no-cache, no-store, no-transform, must-revalidate, private, max-age=0")
		http.Redirect(w, r, "/login.system?redirect="+r.URL.Path, 307)
	})

	//Register the API endpoints for the authentication UI
	authAgent.RegisterPublicAPIs(auth.AuthEndpoints{
		Login: "/system/auth/login",
		Logout: "/system/auth/logout",
		Register: "/system/auth/register",
		CheckLoggedIn: "/system/auth/checkLogin",
	})

	//3. Start Permission Management Module
	ph, err := permission.NewPermissionHandler(sysdb)
	if err != nil{
		log.Println("Permission Handler creation failed.")
		panic(err)
	}
	permissionHandler = ph
	permissionHandler.LoadPermissionGroupsFromDatabase();



	//4. Mount and create the storage system base
	StorageInit(); //See storage.go
	
	//5. Start User Management Module
	UserSystemInit(); //See user.go
	permissionInit(); //Register permission interface after user
	RegisterSystemInit(); //See register.go

	

	//6. Kickstart the File System and Desktop
	FileSystemInit();				//Start FileSystem
	DesktopInit();					//Start Desktop
	PackagManagerInit();			//Start APT service agent
	HardwarePowerInit();			//Start host power manager

	//7. Initiate System Settings Handlers
	SystemSettingInit();			//Start System Setting Core 
	DiskQuotaInit();				//Disk Quota Management
	DiskServiceInit();				//Start Disk Services
	DeviceServiceInit();			//Client Device Management
	SystemInfoInit();				//System Information UI
	SystemIDInit();					//System UUID Manager
	

	//8. Startup network services
	NetworkServiceInit();
	WiFiInit();


	//9. Start Subservice and AGI loaders
	SubserviceInit();				//Subservice Handler
	AGIInit();						//ArOZ Javascript Gateway Interface

	//10. Initiate other things
	ModuleServiceInit();			//Module Handler
	

	//Other legacy stuffs
	system_time_init();
	util_init();
	system_resetpw_init();
	mediaServer_init();

	//Finally
	ModuleSortList();				//Sort the system module list
	
}