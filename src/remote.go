package main

import (
	"net/http"

	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/wsshell"
)

/*
	Remote.go
	author: tobychui

	This module handles the remote maintaince of the arozos system
	Any modules that handles remote access / deployment should be placed here

*/

func WebsocketShellInit() {
	//This module only avaible for administrator that has permission to this module and is admin
	ttyRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "WsTTY",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			sendErrorResponse(w, "Permission Denied")
		},
	})

	//Create new terminal object
	terminal := wsshell.NewWebSocketShellTerminal()
	ttyRouter.HandleFunc("/system/tty/", terminal.HandleOpen)

	//Register the module
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:        "WsTTY",
		Group:       "System Tools",
		IconPath:    "SystemAO/wstty/img/small_icon.png",
		Version:     "1.0",
		StartDir:    "SystemAO/wstty/console.html",
		SupportFW:   true,
		InitFWSize:  []int{900, 480},
		LaunchFWDir: "SystemAO/wstty/console.html",
		SupportEmb:  false,
	})
}
