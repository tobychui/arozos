package main

import (
	"net/http"
	"log"

	agi "imuslab.com/aroz_online/mod/agi"
)

var (
	AGIGateway *agi.Gateway
)
func AGIInit(){
	//Create new AGI Gateway object
	gw, err := agi.NewGateway(agi.AgiSysInfo{
		BuildVersion: build_version,
		InternalVersion: internal_version,
		LoadedModule: system_module_getModuleNameList(),
		ReservedTables: []string{"auth","permisson","desktop"},
		ModuleRegisterParser: registerModuleFromJSON,
		PackageManager: packageManager,
		UserHandler: userHandler,
		StartupRoot: "./web",
		ActivateScope: []string{"./web", "./subservice"},
	})
	if err != nil{
		log.Println("AGI Gateway Initialization Failed")
	}


	//Register handler endpoint
	http.HandleFunc("/system/ajgi/interface", func(w http.ResponseWriter, r *http.Request){
		//Require login check
		authAgent.HandleCheckAuth(w,r, gw.InterfaceHandler)
	})

	AGIGateway = gw
}