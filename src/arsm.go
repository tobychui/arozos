package main

/*
	ArOZ Remote Support and Management System
	author: tobychui

	This is a module for handling remote support and management of client
	devices from other side of the network (even behind NAT)

	This is a collection of submodules. Refer to the corrisponding submodules for more information
*/

import (
	"log"
	"net/http"

	"imuslab.com/arozos/mod/arsm/aecron"
	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
)

var (
	cronObject *aecron.Aecron
)

func ArsmInit() {
	/*
		System Scheudler

		The internal scheudler for arozos
	*/
	//Create an user router and its module
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "Tasks Scheduler",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			sendErrorResponse(w, "Permission Denied")
		},
	})

	//Register the module
	moduleHandler.RegisterModule(module.ModuleInfo{
		Name:        "Tasks Scheduler",
		Group:       "System Tools",
		IconPath:    "SystemAO/arsm/img/scheduler.png",
		Version:     "1.0",
		StartDir:    "SystemAO/arsm/scheduler.html",
		SupportFW:   true,
		InitFWSize:  []int{1080, 580},
		LaunchFWDir: "SystemAO/arsm/scheduler.html",
		SupportEmb:  false,
	})

	//Startup the ArOZ Emulated Crontab Service
	obj, err := aecron.NewArozEmulatedCrontab(userHandler, AGIGateway, "system/cron.json")
	if err != nil {
		log.Println("ArOZ Emulated Cron Startup Failed. Stopping all scheduled tasks.")
	}

	cronObject = obj

	//Register Endpoints
	http.HandleFunc("/system/arsm/aecron/list", func(w http.ResponseWriter, r *http.Request) {
		if authAgent.CheckAuth(r) {
			//User logged in
			obj.HandleListJobs(w, r)
		} else {
			//User not logged in
			http.NotFound(w, r)
		}
	})
	router.HandleFunc("/system/arsm/aecron/add", obj.HandleAddJob)
	router.HandleFunc("/system/arsm/aecron/remove", obj.HandleJobRemoval)
	router.HandleFunc("/system/arsm/aecron/listlog", obj.HandleShowLog)

	//Register settings
	registerSetting(settingModule{
		Name:         "Tasks Scheduler",
		Desc:         "System Tasks and Excution Scheduler",
		IconPath:     "SystemAO/arsm/img/small_icon.png",
		Group:        "Cluster",
		StartDir:     "SystemAO/arsm/aecron.html",
		RequireAdmin: false,
	})

	/*
		WsTerminal

		The terminal that perform remote WebSocket based reverse ssh
	*/
	/*
		wstRouter := prout.NewModuleRouter(prout.RouterOption{
			ModuleName:  "System Setting",
			AdminOnly:   true,
			UserHandler: userHandler,
			DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
				sendErrorResponse(w, "Permission Denied")
			},
		})

		//Register settings
		registerSetting(settingModule{
			Name:         "WsTerminal",
			Desc:         "Remote WebSocket Shell Terminal",
			IconPath:     "SystemAO/arsm/img/wst.png",
			Group:        "Cluster",
			StartDir:     "SystemAO/arsm/wsterminal.html",
			RequireAdmin: true,
		})

		log.Println("WebSocket Terminal, WIP: ", wstRouter)
	*/
}
