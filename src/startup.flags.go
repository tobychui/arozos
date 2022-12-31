package main

import (
	"encoding/json"
	"net/http"

	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
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
		Name:         "Runtime",
		Desc:         "Change startup paramter in runtime",
		IconPath:     "SystemAO/info/img/small_icon.png",
		Group:        "Info",
		StartDir:     "SystemAO/boot/bootflags.html",
		RequireAdmin: true,
	})

	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
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
	opr, _ := utils.PostPara(r, "opr")
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

		utils.SendJSONResponse(w, string(js))
	} else if opr == "set" {
		//Set and update the boot flags
		newSettings, err := utils.PostPara(r, "value")
		if err != nil {
			utils.SendErrorResponse(w, "Invalid new seting value")
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
			utils.SendErrorResponse(w, err.Error())
			return
		}

		//Update the current global flags
		systemWideLogger.PrintAndLog("System", "Updating boot flag to:"+newSettings, nil)
		*host_name = newConfig.Hostname
		max_upload_size = int64(newConfig.MaxUploadSize << 20)
		*upload_buf = newConfig.MaxFileUploadBuff
		*file_opr_buff = newConfig.FileIOBuffer
		*disable_ip_resolve_services = newConfig.DisableIPResolver
		*allow_homepage = newConfig.EnableHomePage
		*enable_dir_listing = newConfig.EnableDirListing

		utils.SendOK(w)
	} else {
		utils.SendErrorResponse(w, "Unknown operation")
	}
}
