package main

import (
	"net/http"
	"log"
	"os"

	module "imuslab.com/arozos/mod/modules"
)

var (
	moduleHandler *module.ModuleHandler
)


func ModuleServiceInit(){
	//Create a new module handler
	moduleHandler = module.NewModuleHandler(userHandler);

	//Pass through the endpoint to authAgent
	http.HandleFunc("/system/modules/list", func(w http.ResponseWriter, r *http.Request){
		authAgent.HandleCheckAuth(w,r,moduleHandler.ListLoadedModules)
	})
	http.HandleFunc("/system/modules/getDefault", func(w http.ResponseWriter, r *http.Request){
		authAgent.HandleCheckAuth(w,r,moduleHandler.HandleDefaultLauncher)
	})
	http.HandleFunc("/system/modules/getLaunchPara", func(w http.ResponseWriter, r *http.Request){
		authAgent.HandleCheckAuth(w,r,moduleHandler.GetLaunchParameter)
	})

	//Register setting interface for module configuration
	registerSetting(settingModule{
		Name: "Module List",
		Desc: "A list of module currently loaded in the system",
		IconPath: "SystemAO/modules/img/small_icon.png",
		Group: "Module",
		StartDir: "SystemAO/modules/moduleList.html",
	})

	registerSetting(settingModule{
		Name: "Default Module",
		Desc: "Default module use to open a file",
		IconPath: "SystemAO/modules/img/small_icon.png",
		Group: "Module",
		StartDir: "SystemAO/modules/defaultOpener.html",
	})

	if !*disable_subservices {
		registerSetting(settingModule{
			Name: "Subservices",
			Desc: "Launch and kill subservices",
			IconPath: "SystemAO/modules/img/small_icon.png",
			Group: "Module",
			StartDir: "SystemAO/modules/subservices.html",
			RequireAdmin: true,
		})
	}
	
	err := sysdb.NewTable("module")
	if (err != nil){
		log.Fatal(err);
		os.Exit(0);
	}
}
