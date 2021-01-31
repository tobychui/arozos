package main

import (
	"log"
	"net/http"
	"os"

	module "imuslab.com/arozos/mod/modules"
	prout "imuslab.com/arozos/mod/prouter"
)

var (
	moduleHandler *module.ModuleHandler
)

func ModuleServiceInit() {
	//Create a new module handler
	moduleHandler = module.NewModuleHandler(userHandler, *tmp_directory)

	//Pass through the endpoint to authAgent
	http.HandleFunc("/system/modules/list", func(w http.ResponseWriter, r *http.Request) {
		authAgent.HandleCheckAuth(w, r, moduleHandler.ListLoadedModules)
	})
	http.HandleFunc("/system/modules/getDefault", func(w http.ResponseWriter, r *http.Request) {
		authAgent.HandleCheckAuth(w, r, moduleHandler.HandleDefaultLauncher)
	})
	http.HandleFunc("/system/modules/getLaunchPara", func(w http.ResponseWriter, r *http.Request) {
		authAgent.HandleCheckAuth(w, r, moduleHandler.GetLaunchParameter)
	})

	//Register setting interface for module configuration
	registerSetting(settingModule{
		Name:     "Module List",
		Desc:     "A list of module currently loaded in the system",
		IconPath: "SystemAO/modules/img/small_icon.png",
		Group:    "Module",
		StartDir: "SystemAO/modules/moduleList.html",
	})

	registerSetting(settingModule{
		Name:     "Default Module",
		Desc:     "Default module use to open a file",
		IconPath: "SystemAO/modules/img/small_icon.png",
		Group:    "Module",
		StartDir: "SystemAO/modules/defaultOpener.html",
	})

	if !*disable_subservices {
		registerSetting(settingModule{
			Name:         "Subservices",
			Desc:         "Launch and kill subservices",
			IconPath:     "SystemAO/modules/img/small_icon.png",
			Group:        "Module",
			StartDir:     "SystemAO/modules/subservices.html",
			RequireAdmin: true,
		})
	}

	err := sysdb.NewTable("module")
	if err != nil {
		log.Fatal(err)
		os.Exit(0)
	}

}

/*
	Handle endpoint registry for Module installer

*/
func ModuleInstallerInit() {
	//Register module installation setting
	registerSetting(settingModule{
		Name:         "Add & Remove Module",
		Desc:         "Install & Remove Module to the system",
		IconPath:     "SystemAO/modules/img/small_icon.png",
		Group:        "Module",
		StartDir:     "SystemAO/modules/addAndRemove.html",
		RequireAdmin: true,
	})

	//Create new permission router
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		UserHandler: userHandler,
		AdminOnly:   true,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			errorHandlePermissionDenied(w, r)
		},
	})

	router.HandleFunc("/system/module/install", HandleModuleInstall)

}

//Handle module installation request
func HandleModuleInstall(w http.ResponseWriter, r *http.Request) {
	opr, _ := mv(r, "opr", true)

	if opr == "gitinstall" {
		//Get URL from request
		url, _ := mv(r, "url", true)
		if url == "" {
			sendErrorResponse(w, "Invalid URL")
			return
		}

		//Install the module using git
		err := moduleHandler.InstallModuleViaGit(url, AGIGateway)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}

		//Reply ok
		sendOK(w)
	} else if opr == "zipinstall" {

	} else if opr == "remove" {
		//Get the module name from list
		module, _ := mv(r, "module", true)
		if module == "" {
			sendErrorResponse(w, "Invalid Module Name")
			return
		}

		//Remove the module
		err := moduleHandler.UninstallModule(module)
		if err != nil {
			sendErrorResponse(w, err.Error())
			return
		}

		//Reply ok
		sendOK(w)

	} else {
		//List all the modules
		moduleHandler.HandleModuleInstallationListing(w, r)
	}
}
