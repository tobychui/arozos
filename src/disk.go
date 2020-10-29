package main

/*
	ArOZ Online Disk Service Endpoint Handler

	This is a module to provide access to the disk services
*/

import (
	"net/http"
	"log"

	prout "imuslab.com/aroz_online/mod/prouter"
	diskspace "imuslab.com/aroz_online/mod/disk/diskspace"
	sortfile "imuslab.com/aroz_online/mod/disk/sortfile"
	smart "imuslab.com/aroz_online/mod/disk/smart"
)

func DiskServiceInit(){
	//Register Disk Utilities under System Setting
	//Disk info are only viewable by administrator
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName: "System Setting", 
		AdminOnly: false, 
		UserHandler: userHandler, 
		DeniedHandler: func(w http.ResponseWriter, r *http.Request){
			sendErrorResponse(w, "Permission Denied");
		},
	});

	//Disk Space Display endpoint
	router.HandleFunc("/system/disk/space/list", diskspace.HandleDiskSpaceList)
	
	//New Large File Scanner
	lfs := sortfile.NewLargeFileScanner(userHandler)
	router.HandleFunc("/system/disk/space/largeFiles", lfs.HandleLargeFileList)

	//Register settings
	registerSetting(settingModule{
		Name:     "Space Finder",
		Desc:     "Reclaim Storage Space on Disks",
		IconPath: "SystemAO/disk/space/img/small_icon.png",
		Group:    "Disk",
		StartDir: "SystemAO/disk/space/finder.html",
		RequireAdmin: false,
	})


	registerSetting(settingModule{
		Name:     "Disk Space",
		Desc:     "System Storage Space on Disks",
		IconPath: "SystemAO/disk/space/img/small_icon.png",
		Group:    "Disk",
		StartDir: "SystemAO/disk/space/diskspace.html",
		RequireAdmin: false,
	})

	
	//Register Disk SMART services
	if sudo_mode {
		//Create a new smart listerner
		smartListener, err := smart.NewSmartListener()
		if err != nil{
			//Listener creation failed
			log.Println("Failed to create SMART listener: " + err.Error())
		}else{
			//Listener created. Register endpoints
			//Create a new admin router
			adminRouter := prout.NewModuleRouter(prout.RouterOption{
				ModuleName: "System Setting", 
				AdminOnly: true, 
				UserHandler: userHandler, 
				DeniedHandler: func(w http.ResponseWriter, r *http.Request){
					sendErrorResponse(w, "Permission Denied");
				},
			});

			//Register as a system setting
			registerSetting(settingModule{
				Name:         "Disk SMART",
				Desc:         "HardDisk Health Checking",
				IconPath:     "SystemAO/disk/smart/img/small_icon.png",
				Group:        "Disk",
				StartDir:     "SystemAO/disk/smart/smart.html",
				RequireAdmin: true,
			})

			registerSetting(settingModule{
				Name:         "SMART Log",
				Desc:         "HardDisk Health Log",
				IconPath:     "SystemAO/disk/smart/img/small_icon.png",
				Group:        "Disk",
				StartDir:     "SystemAO/disk/smart/log.html",
				RequireAdmin: true,
			})

			
			adminRouter.HandleFunc("/system/disk/smart/getSMART", smartListener.GetSMART)
			adminRouter.HandleFunc("/system/disk/smart/getSMARTTable", smartListener.CheckDiskTable)
			adminRouter.HandleFunc("/system/disk/smart/getLogInfo", smartListener.CheckDiskTestStatus)
		}
		
	}
}

