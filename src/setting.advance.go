package main

import (
	"net/http"

	autologin "imuslab.com/arozos/mod/auth/autologin"
	"imuslab.com/arozos/mod/common"
	prout "imuslab.com/arozos/mod/prouter"
)

/*
	Advance Setting Group
	This is a function group that help handles system advance functions

*/

func AdvanceSettingInit() {
	/*

		Define common routers

	*/
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Settings",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			common.SendErrorResponse(w, "Permission Denied")
		},
	})

	/*
		Billboard mode / Bot login mode

		This method allows users or machine to login with token instead of login interface
	*/
	registerSetting(settingModule{
		Name:         "Auto Login Mode",
		Desc:         "Allow bots logging into the system automatically",
		IconPath:     "SystemAO/advance/img/small_icon.png",
		Group:        "Advance",
		StartDir:     "SystemAO/advance/autologin.html",
		RequireAdmin: true,
	})

	autoLoginHandler := autologin.NewAutoLoginHandler(userHandler)

	adminRouter.HandleFunc("/system/autologin/list", autoLoginHandler.HandleUserTokensListing)
	adminRouter.HandleFunc("/system/autologin/create", autoLoginHandler.HandleUserTokenCreation)
	adminRouter.HandleFunc("/system/autologin/delete", autoLoginHandler.HandleUserTokenRemoval)

	/*
		Advance Disk Management Interface

		This methods allow hot swapping / mounting of storage devices

	*/
	if *allow_hardware_management {
		registerSetting(settingModule{
			Name:         "Disk Manager",
			Desc:         "Mount, Unmount and Formatting Local Disks",
			IconPath:     "SystemAO/disk/img/small_icon.png",
			Group:        "Advance",
			StartDir:     "SystemAO/disk/diskmg.html",
			RequireAdmin: true,
		})
	}
}
