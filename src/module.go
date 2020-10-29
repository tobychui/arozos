package main

import (
	"net/http"
	"encoding/json"
	"strings"
	//"path/filepath"
	"log"
	"sort"
	"os"
)

/*
	AO Module (Server Side Wrapepr)
	This is the module handler for module registry and more.

*/

//Struct for storing module information
type moduleInfo struct{
	Name string				//Name of this module. e.g. "Audio"
	Desc string				//Description for this module
	Group string			//Group of the module, e.g. "system" / "media" etc
	IconPath string			//Module icon image path e.g. "Audio/img/function_icon.png"
	Version string			//Version of the module. Format: [0-9]*.[0-9][0-9].[0-9]
	StartDir string 		//Default starting dir, e.g. "Audio/index.html"
	SupportFW bool 			//Support floatWindow. If yes, floatWindow dir will be loaded
	LaunchFWDir string 		//This link will be launched instead of 'StartDir' if fw mode
	SupportEmb bool			//Support embedded mode
	LaunchEmb string 		//This link will be launched instead of StartDir / Fw if a file is opened with this module
	InitFWSize []int 		//Floatwindow init size. [0] => Width, [1] => Height
	InitEmbSize []int		//Embedded mode init size. [0] => Width, [1] => Height
	SupportedExt []string 	//Supported File Extensions. e.g. ".mp3", ".flac", ".wav"
}

//Register endpoint. Provide moduleInfo datastructure or unparsed json
func registerModule(module moduleInfo){
	loadedModule = append(loadedModule, module);
}

func ModuleSortList(){
	sort.Slice(loadedModule, func(i, j int) bool {
		return loadedModule[i].Name < loadedModule[j].Name
	})
}

func registerModuleFromJSON(jsonstring string) error{
	var thisModuleInfo moduleInfo
	err := json.Unmarshal([]byte(jsonstring), &thisModuleInfo)
	if err != nil{
		return err
	}
	registerModule(thisModuleInfo)
	return nil
}

func ModuleServiceInit(){
	//Pass through the endpoint to authAgent
	http.HandleFunc("/system/modules/list", func(w http.ResponseWriter, r *http.Request){
		authAgent.HandleCheckAuth(w,r,system_module_listLoadedModules)
	})
	http.HandleFunc("/system/modules/getDefault", func(w http.ResponseWriter, r *http.Request){
		authAgent.HandleCheckAuth(w,r,system_module_handleDefaultLauncher)
	})
	http.HandleFunc("/system/modules/getLaunchPara", func(w http.ResponseWriter, r *http.Request){
		authAgent.HandleCheckAuth(w,r,system_module_getLaunchParameter)
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
	
	system_module_createDBTable();
}

func system_module_createDBTable(){
	err := sysdb.NewTable("module")
	if (err != nil){
		log.Fatal(err);
		os.Exit(0);
	}
}

func system_module_getModuleNameList() []string{
	result := []string{}
	for _, module := range loadedModule{
		result = append(result, module.Name)
	}
	return result;
}

func system_module_getLaunchParameter(w http.ResponseWriter, r *http.Request){
	moduleName,_ := mv(r, "module", false)
	if (moduleName == ""){
		sendErrorResponse(w, "Missing paramter 'module'.")
		return
	}

	//Loop through the modules and see if the module exists.
	var targetLaunchInfo moduleInfo
	found := false;
	for _, module := range loadedModule{
		thisModuleName := module.Name;
		if (thisModuleName == moduleName){
			targetLaunchInfo = module
			found = true
		}
	}

	if (found){
		jsonString, _ := json.Marshal(targetLaunchInfo);
		sendJSONResponse(w, string(jsonString))
		return;
	}else{
		sendErrorResponse(w, "Given module not exists.")
		return;
	}

}

func system_module_handleDefaultLauncher(w http.ResponseWriter, r *http.Request){
	username, _ := authAgent.GetUserName(w,r);
	opr, _ := mv(r, "opr", false) //Operation, accept {get, set, launch}
	ext, _ := mv(r, "ext", false)
	moduleName, _ := mv (r, "module", false)

	//Check if the default folder exists.
	if (opr == "get"){
		//Get the opener for this file type
		value := ""
		err := sysdb.Read("module", "default/" + username + "/" + ext, &value)
		if (err != nil){
			sendErrorResponse(w, "No default opener")
			return;
		}
		js, _ := json.Marshal(value);
		sendJSONResponse(w, string(js))
		return;
	}else if (opr == "launch"){
		//Get launch paramter for this extension
		value := ""
		err := sysdb.Read("module", "default/" + username + "/" + ext, &value)
		if (err != nil){
			sendErrorResponse(w, "No default opener")
			return;
		}
		//Get the launch paramter of this module
		var modInfo  moduleInfo;
		modExists := false
		for _, mod := range loadedModule{
			if (mod.Name == value){
				modInfo = mod
				modExists = true
			}
		}

		if (!modExists){
			//This module has been removed or not exists anymore
			sendErrorResponse(w, "Default opener no longer exists.")
			return;
		}else{
			//Return launch inforamtion
			jsonString, _ := json.Marshal(modInfo)
			sendJSONResponse(w, string(jsonString))
		}


	}else if (opr == "set"){
		//Set the opener for this filetype
		if (moduleName == ""){
			sendErrorResponse(w, "Missing paratmer 'module'")
			return;
		}

		//Check if module name exists
		moduleValid := false;
		for _, mod := range loadedModule{
			if (mod.Name == moduleName){
				moduleValid = true;
			}
		}
		if (moduleValid){
			sysdb.Write("module", "default/" + username + "/" + ext, moduleName );
			sendJSONResponse(w,"\"OK\"")
		}else{
			sendErrorResponse(w, "Given module not exists.")
		}
		
	}else if (opr == "list"){
		//List all the values that belongs to default opener
		dbDump, _ := sysdb.ListTable("module")
		results := [][]string{}
		for _, entry := range dbDump{
			key := string(entry[0]);
			if (strings.Contains(key,"default/" + username + "/")){
				//This is a correct matched entry
				extInfo := strings.Split(key,"/")
				ext := extInfo[len(extInfo) - 1:]
				moduleName := "";
				json.Unmarshal(entry[1], &moduleName )
				results = append(results, []string{ext[0], moduleName});
			}
		}

		jsonString, _ := json.Marshal(results)
		sendJSONResponse(w, string(jsonString))
		return;
	}
	




}

func system_module_listLoadedModules(w http.ResponseWriter, r *http.Request){
	userinfo, _ := userHandler.GetUserInfoFromRequest(w,r)

	///Parse a list of modules where the user has permission to access
	userAccessableModules := []moduleInfo{}
	for _, thisModule := range loadedModule{
		thisModuleName := thisModule.Name
		if (userinfo.GetModuleAccessPermission(thisModuleName)){
			userAccessableModules = append(userAccessableModules, thisModule)
		}else if (thisModule.Group == "Utilities"){
			//Always allow utilties to be loaded
			userAccessableModules = append(userAccessableModules, thisModule)
		}
	}
	//Return the loaded modules as a list of JSON string
	jsonString, _ := json.Marshal(userAccessableModules)
	sendJSONResponse(w,string(jsonString));
}

func system_module_getModuleInfoByID(moduleid string) *moduleInfo{
	for _, module := range loadedModule{
		if (module.Name == moduleid){
			return &module
		}
	}
	return nil
}