package main

/*
	ArOZ Online Disk Service Endpoint Handler

	This is a module to provide access to the disk services
*/

import (
	"net/http"

	"imuslab.com/arozos/mod/disk/diskcapacity"
	"imuslab.com/arozos/mod/disk/diskmg"
	diskspace "imuslab.com/arozos/mod/disk/diskspace"
	smart "imuslab.com/arozos/mod/disk/smart"
	sortfile "imuslab.com/arozos/mod/disk/sortfile"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

func DiskServiceInit() {
	//Register Disk Utilities under System Setting
	//Disk info are only viewable by administrator
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Anyone logged in can load router
	authRouter := prout.NewModuleRouter(prout.RouterOption{
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Disk Space Display endpoint
	router.HandleFunc("/system/disk/space/list", diskspace.HandleDiskSpaceList)

	//Handle Virtual Disk Properties display endpoints
	dc := diskcapacity.NewCapacityResolver(userHandler)
	router.HandleFunc("/system/disk/space/resolve", dc.HandleCapacityResolving)
	authRouter.HandleFunc("/system/disk/space/tmp", dc.HandleTmpCapacityResolving)

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
				utils.SendErrorResponse(w, "Permission Denied")
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
				systemWideLogger.PrintAndLog("Disk", "Failed to create SMART listener: "+err.Error(), err)
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

				authRouter.HandleFunc("/system/disk/smart/getSMART", smartListener.GetSMART)
			}
		}

		/*
			Disk Manager Initialization
			See disk/diskmg.go for more details

			For setting register, see setting.advance.go
		*/

		if *allow_hardware_management {
			authRouter.HandleFunc("/system/disk/diskmg/view", diskmg.HandleView)
			adminRouter.HandleFunc("/system/disk/diskmg/platform", diskmg.HandlePlatform)
			adminRouter.HandleFunc("/system/disk/diskmg/mount", func(w http.ResponseWriter, r *http.Request) {
				//Mount option require passing in all filesystem handlers
				allFsh := GetAllLoadedFsh()
				diskmg.HandleMount(w, r, allFsh)
			})
			adminRouter.HandleFunc("/system/disk/diskmg/format", func(w http.ResponseWriter, r *http.Request) {
				//Check if request are made in POST mode
				if r.Method != http.MethodPost {
					w.WriteHeader(http.StatusMethodNotAllowed)
					w.Write([]byte("405 - Method Not Allowed"))
					return
				}

				//Check if ArozOS is running in sudo mode
				if !sudo_mode {
					w.WriteHeader(http.StatusUnauthorized)
					w.Write([]byte("401 - Unauthorized (Is ArozOS running in sudo mode?)"))
					return
				}

				//Format option require passing in all filesystem handlers
				allFsh := GetAllLoadedFsh()
				diskmg.HandleFormat(w, r, allFsh)
			})
			adminRouter.HandleFunc("/system/disk/diskmg/mpt", diskmg.HandleListMountPoints)
		}

	}

}
