package main

import (
	"net/http"

	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

/*
	AGI Runtime Manager

	Registers the "AGI Runtimes" tab in System Settings > Developer Options
	and exposes two authenticated endpoints:

	  GET  /system/ajgi/runtime/list    – list running VMs (filtered by role)
	  POST /system/ajgi/runtime/stop    – force-stop a VM by execid

	Regular users may list and stop their own VMs.
	Admins may list and stop any VM.
*/

func AGIRuntimeManagerInit() {
	// Register the settings tab in the "Advance" (Developer Options) group.
	// RequireAdmin: false so regular users can view their own running scripts.
	registerSetting(settingModule{
		Name:         "AGI Runtimes",
		Desc:         "Monitor and force-stop running AGI script VM instances",
		IconPath:     "SystemAO/advance/img/small_icon.png",
		Group:        "Advance",
		StartDir:     "SystemAO/advance/agi_runtime.html",
		RequireAdmin: false,
	})

	// Authenticated, non-admin router so every logged-in user can reach these
	// endpoints. Permission filtering is enforced inside the handler methods.
	authRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Settings",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	authRouter.HandleFunc("/system/ajgi/runtime/list", AGIGateway.HandleListRuntimes)
	authRouter.HandleFunc("/system/ajgi/runtime/stop", AGIGateway.HandleForceStopRuntime)
}
