package main

import (
	"net/http"
	"os"
	"path/filepath"

	prout "imuslab.com/arozos/mod/prouter"
	subservice "imuslab.com/arozos/mod/subservice"
)

/*
	ArOZ Online System - Dynamic Subsystem loading services

*/

var (
	ssRouter     *subservice.SubServiceRouter
	reservePaths = []string{
		"web",
		"system",
		"SystemAO",
		"img",
		"STDIN",
		"STDOUT",
		"STDERR",
		"COM",
		"ws",
	}
)

func SubserviceInit() {
	//If subservice is disabled, do not register endpoints
	if *disable_subservices {
		return
	}

	//Create a new subservice handler
	ssRouter = subservice.NewSubServiceRouter(
		reservePaths,
		subserviceBasePort,
		userHandler,
		moduleHandler,
		*listen_port,
	)

	//Create an admin router for subservice related functions
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			sendErrorResponse(w, "Permission Denied")
		},
	})

	//Register url endpoints
	adminRouter.HandleFunc("/system/subservice/list", ssRouter.HandleListing)
	adminRouter.HandleFunc("/system/subservice/kill", ssRouter.HandleKillSubService)
	adminRouter.HandleFunc("/system/subservice/start", ssRouter.HandleStartSubService)

	//Make subservice dir
	os.MkdirAll("./subservice", 0644)

	//Scan and load all subservice modules
	subservices, _ := filepath.Glob("./subservice/*")
	for _, servicePath := range subservices {
		if IsDir(servicePath) && !fileExists(servicePath+"/.disabled") {
			//Only enable module with no suspended config file
			ssRouter.Launch(servicePath, true)
		}

	}
}

//Stop all the subprocess correctly
func SubserviceHandleShutdown() {
	if ssRouter != nil {
		ssRouter.Close()
	}
}
