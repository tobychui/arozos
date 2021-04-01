package main

import (
	"encoding/json"
	"log"
	"net/http"

	prout "imuslab.com/arozos/mod/prouter"
)

/*
	Startup Flags Manager

	This script is design to provide interface for editing the boot flags
	during the system is running

*/

func StartupFlagsInit() {
	//Create a admin permission router for handling requests
	//Register a boot flag modifier
	registerSetting(settingModule{
		Name:         "Startup",
		Desc:         "Platform Startup Flags",
		IconPath:     "SystemAO/info/img/small_icon.png",
		Group:        "Info",
		StartDir:     "SystemAO/boot/bootflags.html",
		RequireAdmin: true,
	})

	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			sendErrorResponse(w, "Permission Denied")
		},
	})

	adminRouter.HandleFunc("/system/bootflags", handleBootFlagsFunction)
}

func handleBootFlagsFunction(w http.ResponseWriter, r *http.Request) {
	type bootFlags struct {
		Hostname          string
		MaxUploadSize     int
		MaxFileUploadBuff int
		FileIOBuffer      int
		DisableIPResolver bool
		EnableHomePage    bool
		EnableDirListing  bool
	}
	opr, _ := mv(r, "opr", true)
	if opr == "" {
		//List the current boot flag, all units in MB
		js, _ := json.Marshal(bootFlags{
			*host_name,
			int(max_upload_size >> 20),
			*upload_buf,
			*file_opr_buff,
			*disable_ip_resolve_services,
			*allow_homepage,
			*enable_dir_listing,
		})

		sendJSONResponse(w, string(js))
	} else if opr == "set" {
		//Set and update the boot flags
		newSettings, err := mv(r, "value", true)
		if err != nil {
			sendErrorResponse(w, "Invalid new seting value")
			return
		}

		//Try parse it
		newConfig := bootFlags{
			"My ArOZ",
			8192,
			25,
			1024,
			false,
			false,
			true,
		}
		err = json.Unmarshal([]byte(newSettings), &newConfig)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}

		//Update the current global flags
		log.Println("Updating boot flag to:", newSettings)
		*host_name = newConfig.Hostname
		max_upload_size = int64(newConfig.MaxUploadSize << 20)
		*upload_buf = newConfig.MaxFileUploadBuff
		*file_opr_buff = newConfig.FileIOBuffer
		*disable_ip_resolve_services = newConfig.DisableIPResolver
		*allow_homepage = newConfig.EnableHomePage
		*enable_dir_listing = newConfig.EnableDirListing

		sendOK(w)
	} else {
		sendErrorResponse(w, "Unknown operation")
	}
}
