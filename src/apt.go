package main

import (
	"net/http"

	apt "imuslab.com/arozos/mod/apt"
	"imuslab.com/arozos/mod/common"
	prout "imuslab.com/arozos/mod/prouter"
)

func PackagManagerInit() {
	//Create a package manager
	packageManager = apt.NewPackageManager(*allow_package_autoInstall)
	systemWideLogger.PrintAndLog("APT", "Package Manager Initiated", nil)

	//Create a System Setting handler
	//aka who can access System Setting can see contents about packages
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			common.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Handle package listing request
	router.HandleFunc("/system/apt/list", apt.HandlePackageListRequest)

}
