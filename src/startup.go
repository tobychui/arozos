package main

/*
	System Startup Script for ArOZ Online System
	author: tobychui
*/

import (
	//ArOZ Online Core Modules
	db "imuslab.com/arozos/mod/database"
)

func RunStartup() {
	//1. Initiate the main system database
	if !fileExists("system/") {
		panic("▒▒ ERROR: SYSTEM FOLDER NOT FOUND ▒▒")
	}

	if !fileExists("web/") {
		panic("▒▒ ERROR: WEB FOLDER NOT FOUND ▒▒")
	}

	dbconn, err := db.NewDatabase("system/ao.db", false)
	if err != nil {
		panic(err)
	}
	sysdb = dbconn

	//2. Initiate the auth Agent
	AuthInit() //See auth.go

	//3. Start Permission Management Module
	permissionNewHandler() //See permission.go

	//4. Mount and create the storage system base
	StorageInit() //See storage.go

	//5. Startup user and permission sytem
	UserSystemInit()       //See user.go
	permissionInit()       //Register permission interface after user
	RegisterSystemInit()   //See register.go
	GroupStoragePoolInit() //Register permission groups's storage pool, require permissionInit()

	//6.Start Modules and Package Manager
	ModuleServiceInit() //Module Handler
	PackagManagerInit() //Start APT service agent

	//7. Kickstart the File System and Desktop
	FileSystemInit()     //Start FileSystem
	DesktopInit()        //Start Desktop
	HardwarePowerInit()  //Start host power manager
	WebsocketShellInit() //Start WebSocket tty server

	//8 Start AGI and Subservice modules (Must start after module)
	AGIInit()        //ArOZ Javascript Gateway Interface, must start after fs
	SubserviceInit() //Subservice Handler

	//9. Initiate System Settings Handlers
	SystemSettingInit()       //Start System Setting Core
	DiskQuotaInit()           //Disk Quota Management
	DiskServiceInit()         //Start Disk Services
	DeviceServiceInit()       //Client Device Management
	SystemInfoInit()          //System Information UI
	SystemIDInit()            //System UUID Manager
	AuthSettingsInit()        //Authentication Settings Handler, must be start after user Handler
	AdvanceSettingInit()      //System Advance Settings
	RegisterStorageSettings() //Storage Settings

	//10. Startup network services and schedule services
	NetworkServiceInit() //Initalize network serves (ssdp / mdns etc)
	WiFiInit()           //Inialize WiFi management module

	ArsmInit() //Inialize ArOZ Remote Support & Management Framework

	//11. Other stuffs
	//system_time_init()
	util_init()
	system_resetpw_init()
	mediaServer_init()

	//Start High Level Services that requires full arozos architectures
	FTPServerInit() //Start FTP Server Endpoints
	WebDAVInit()    //Start WebDAV Endpoint

	NightlyInit() //Start Nightly Tasks

	//Finally
	moduleHandler.ModuleSortList() //Sort the system module list

}
