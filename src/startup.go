package main

/*
	System Startup Script for ArOZ Online System
	author: tobychui
*/

import (
	"fmt"
	"log"
	"os"

	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/filesystem"
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
)

func RunStartup() {
	systemWideLogger, _ = logger.NewLogger("system", "system/logs/system/", true)
	//1. Initiate the main system database

	//Check if system or web both not exists and web.tar.gz exists. Unzip it for the user
	if (!fs.FileExists("system/") || !fs.FileExists("web/")) && fs.FileExists("./web.tar.gz") {
		log.Println("[Update] Unzipping system critical files from archive")
		extErr := filesystem.ExtractTarGzipFile("./web.tar.gz", "./")
		if extErr != nil {
			//Extract failed
			fmt.Println("▒▒ ERROR: UNABLE TO EXTRACT CRITICAL SYSTEM FOLDERS ▒▒")
			fmt.Println(extErr)
			panic("Unable to extract content from web.tar.gz to fix the missing system / web folder. Please unzip the web.tar.gz manually.")
		}

		//Extract success
		extErr = os.Remove("./web.tar.gz")
		if extErr != nil {
			systemWideLogger.PrintAndLog("Update", "Unable to remove web.tar.gz: "+extErr.Error(), extErr)
		}
	}

	if !fs.FileExists("system/") {
		fmt.Println("▒▒ ERROR: SYSTEM FOLDER NOT FOUND ▒▒")
		panic("This error occurs because the system folder is missing. Please follow the installation guide and don't just download a binary and run it.")
	}

	if !fs.FileExists("web/") {
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
	storageHeartbeatTickerInit()
	OAuthInit()        //Oauth system init
	ldapInit()         //LDAP system init
	notificationInit() //Notification system init

	//Start High Level Services that requires full arozos architectures
	FileServerInit()
	//FTPServerInit() //Start FTP Server Endpoints
	//WebDAVInit()    //Start WebDAV Endpoint
	ClusterInit() //Start Cluster Services
	IoTHubInit()  //Inialize ArozOS IoT Hub module

	ModuleInstallerInit() //Start Module Installer

	//Finally
	moduleHandler.ModuleSortList() //Sort the system module list

}
