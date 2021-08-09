package main

/*
	ArOZ Online Disk Service Endpoint Handler

	This is a module to provide access to the disk services
*/

import (
	"log"
	"net/http"

	"imuslab.com/arozos/mod/disk/diskcapacity"
	"imuslab.com/arozos/mod/disk/diskmg"
	diskspace "imuslab.com/arozos/mod/disk/diskspace"
	smart "imuslab.com/arozos/mod/disk/smart"
	sortfile "imuslab.com/arozos/mod/disk/sortfile"
	prout "imuslab.com/arozos/mod/prouter"
)

func DiskServiceInit() {
	//Register Disk Utilities under System Setting
	//Disk info are only viewable by administrator
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			sendErrorResponse(w, "Permission Denied")
		},
	})

	//Disk Space Display endpoint
	router.HandleFunc("/system/disk/space/list", diskspace.HandleDiskSpaceList)

	//Handle Virtual Disk Properties display endpoints
	dc := diskcapacity.NewCapacityResolver(userHandler)
	router.HandleFunc("/system/disk/space/resolve", dc.HandleCapacityResolving)

	//New Large File Scanner
	lfs := sortfile.NewLargeFileScanner(userHandler)
	router.HandleFunc("/system/disk/space/largeFiles", lfs.HandleLargeFileList)

	//Register settings
	registerSetting(settingModule{
		Name:         "Space Finder",
		Desc:         "Reclaim Storage Space on Disks",
		IconPath:     "SystemAO/disk/space/img/small_icon.png",
		Group:        "Disk",
		StartDir:     "SystemAO/disk/space/finder.html",
		RequireAdmin: false,
	})

	if *allow_hardware_management {
		//Displaying remaining space on disk, only enabled when allow hardware is true
		registerSetting(settingModule{
			Name:         "Disk Space",
			Desc:         "System Storage Space on Disks",
			IconPath:     "SystemAO/disk/space/img/small_icon.png",
			Group:        "Disk",
			StartDir:     "SystemAO/disk/space/diskspace.html",
			RequireAdmin: false,
		})
	}

	//Register Disk SMART services
	if sudo_mode {
		//Create a new admin router
		adminRouter := prout.NewModuleRouter(prout.RouterOption{
			ModuleName:  "System Setting",
			AdminOnly:   true,
			UserHandler: userHandler,
			DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
				sendErrorResponse(w, "Permission Denied")
			},
		})

		/*
			SMART Listener
			Handle disk SMART and disk information

			See disk/SMART for more information
		*/
		if *allow_hardware_management {
			smartListener, err := smart.NewSmartListener()
			if err != nil {
				//Listener creation failed
				log.Println("Failed to create SMART listener: " + err.Error())
			} else {
				//Listener created. Register endpoints

				//Register as a system setting
				registerSetting(settingModule{
					Name:         "Disk SMART",
					Desc:         "HardDisk Health Checking",
					IconPath:     "SystemAO/disk/smart/img/small_icon.png",
					Group:        "Disk",
					StartDir:     "SystemAO/disk/smart/smart.html",
					RequireAdmin: true,
				})

				/*
					registerSetting(settingModule{
						Name:         "SMART Log",
						Desc:         "HardDisk Health Log",
						IconPath:     "SystemAO/disk/smart/img/small_icon.png",
						Group:        "Disk",
						StartDir:     "SystemAO/disk/smart/log.html",
						RequireAdmin: true,
					})
				*/

				adminRouter.HandleFunc("/system/disk/smart/getSMART", smartListener.GetSMART)
			}
		}

		/*
			Disk Manager Initialization
			See disk/diskmg.go for more details

			For setting register, see setting.advance.go
		*/

		if *allow_hardware_management {
			adminRouter.HandleFunc("/system/disk/diskmg/view", diskmg.HandleView)
			adminRouter.HandleFunc("/system/disk/diskmg/platform", diskmg.HandlePlatform)
			adminRouter.HandleFunc("/system/disk/diskmg/mount", func(w http.ResponseWriter, r *http.Request) {
				//Mount option require passing in all filesystem handlers
				diskmg.HandleMount(w, r, fsHandlers)
			})
			adminRouter.HandleFunc("/system/disk/diskmg/format", func(w http.ResponseWriter, r *http.Request) {
				//Format option require passing in all filesystem handlers
				diskmg.HandleFormat(w, r, fsHandlers)
			})
			adminRouter.HandleFunc("/system/disk/diskmg/mpt", diskmg.HandleListMountPoints)
		}

	}

}
