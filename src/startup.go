package main

/*
	System Startup Script for ArOZ Online System
	author: tobychui
*/

import (
	"fmt"

	db "imuslab.com/arozos/mod/database"
)

func RunStartup() {
	//1. Initiate the main system database
	if !fileExists("system/") {
		fmt.Println("▒▒ ERROR: SYSTEM FOLDER NOT FOUND ▒▒")
		panic("This error occurs because the system folder is missing. Please follow the installation guide and don't just download a binary and run it.")
	}

	if !fileExists("web/") {
		fmt.Println("▒▒ ERROR: WEB FOLDER NOT FOUND ▒▒")
		panic("This error occurs because the web folder is missing. Please follow the installation guide and don't just download a binary and run it.")
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
	UserSystemInit()        //See user.go
	permissionInit()        //Register permission interface after user
	RegisterSystemInit()    //See register.go
	OAuthInit()             //Oauth system init
	GroupStoragePoolInit()  //Register permission groups's storage pool, require permissionInit()
	BridgeStoragePoolInit() //Register the bridged storage pool based on mounted storage pools

	//6. Start Modules and Package Manager
	ModuleServiceInit() //Module Handler
	PackagManagerInit() //Start APT service agent

	//7. Kickstart the File System and Desktop
	NightlyTasksInit() //Start Nightly task scheduler
	FileSystemInit()   //Start FileSystem
	DesktopInit()      //Start Desktop

	//StorageDaemonInit() //Start File System handler daemon (for backup and other sync process)

	//8 Start AGI and Subservice modules (Must start after module)
	AGIInit()        //ArOZ Javascript Gateway Interface, must start after fs
	SchedulerInit()  //Start System Scheudler
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
	StartupFlagsInit()        //System BootFlag settibg
	HardwarePowerInit()       //Start host power manager
	RegisterStorageSettings() //Storage Settings

	//10. Startup network services and schedule services
	NetworkServiceInit() //Initalize network serves (ssdp / mdns etc)
	WiFiInit()           //Inialize WiFi management module

	//ARSM Moved to scheduler, remote support is rewrite pending
	//ArsmInit() //Inialize ArOZ Remote Support & Management Framework

	//11. Other stuffs
	util_init()
	system_resetpw_init()
	mediaServer_init()
	security_init()
	backup_init()

	//Start High Level Services that requires full arozos architectures
	FTPServerInit() //Start FTP Server Endpoints
	WebDAVInit()    //Start WebDAV Endpoint
	ClusterInit()   //Start Cluster Services
	IoTHubInit()    //Inialize ArozOS IoT Hub module

	ModuleInstallerInit() //Start Module Installer

	//Finally
	moduleHandler.ModuleSortList() //Sort the system module list
}
