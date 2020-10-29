package main

import (
	"net/http"
	"log"
	prout "imuslab.com/aroz_online/mod/prouter"
	apt "imuslab.com/aroz_online/mod/apt"
)

func PackagManagerInit(){
	//Create a package manager
	packageManager = apt.NewPackageManager(*allow_package_autoInstall);
	log.Println("Package Manager Initiated")

	//Create a System Setting handler 
	//aka who can access System Setting can see contents about packages
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName: "System Setting", 
		AdminOnly: false, 
		UserHandler: userHandler, 
		DeniedHandler: func(w http.ResponseWriter, r *http.Request){
			sendErrorResponse(w, "Permission Denied");
		},
	});
	
	//Handle package listing request
	router.HandleFunc("/system/apt/list", apt.HandlePackageListRequest)

}
