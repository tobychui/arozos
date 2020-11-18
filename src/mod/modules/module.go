package modules

import (
	"net/http"
	"encoding/json"
	"strings"
	"sort"

	user "imuslab.com/arozos/mod/user"
)

type ModuleInfo struct{
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

type ModuleHandler struct{
	LoadedModule []ModuleInfo
	userHandler *user.UserHandler
}

func NewModuleHandler(userHandler *user.UserHandler) *ModuleHandler{
	return &ModuleHandler{
		LoadedModule: []ModuleInfo{},
		userHandler: userHandler,
	}
}

//Register endpoint. Provide moduleInfo datastructure or unparsed json
func (m *ModuleHandler)RegisterModule(module ModuleInfo){
	m.LoadedModule = append(m.LoadedModule, module);
}

//Sort the module list
func (m *ModuleHandler)ModuleSortList(){
	sort.Slice(m.LoadedModule, func(i, j int) bool {
		return m.LoadedModule[i].Name < m.LoadedModule[j].Name
	})
}

//Register a module from JSON string
func (m *ModuleHandler)RegisterModuleFromJSON(jsonstring string) error{
	var thisModuleInfo ModuleInfo
	err := json.Unmarshal([]byte(jsonstring), &thisModuleInfo)
	if err != nil{
		return err
	}
	m.RegisterModule(thisModuleInfo)
	return nil
}

//Get a list of module names
func (m *ModuleHandler)GetModuleNameList() []string{
	result := []string{}
	for _, module := range m.LoadedModule{
		result = append(result, module.Name)
	}
	return result;
}

//Handle Default Launcher
func (m *ModuleHandler)HandleDefaultLauncher(w http.ResponseWriter, r *http.Request){
	username, _ := m.userHandler.GetAuthAgent().GetUserName(w,r);
	opr, _ := mv(r, "opr", false) //Operation, accept {get, set, launch}
	ext, _ := mv(r, "ext", false)
	moduleName, _ := mv(r, "module", false)

	//Check if the default folder exists.
	if (opr == "get"){
		//Get the opener for this file type
		value := ""
		err := m.userHandler.GetDatabase().Read("module", "default/" + username + "/" + ext, &value)
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
		err := m.userHandler.GetDatabase().Read("module", "default/" + username + "/" + ext, &value)
		if (err != nil){
			sendErrorResponse(w, "No default opener")
			return;
		}
		//Get the launch paramter of this module
		var modInfo ModuleInfo;
		modExists := false
		for _, mod := range m.LoadedModule{
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
		for _, mod := range m.LoadedModule{
			if (mod.Name == moduleName){
				moduleValid = true;
			}
		}
		if (moduleValid){
			m.userHandler.GetDatabase().Write("module", "default/" + username + "/" + ext, moduleName );
			sendJSONResponse(w,"\"OK\"")
		}else{
			sendErrorResponse(w, "Given module not exists.")
		}
		
	}else if (opr == "list"){
		//List all the values that belongs to default opener
		dbDump, _ := m.userHandler.GetDatabase().ListTable("module")
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

func (m *ModuleHandler)ListLoadedModules(w http.ResponseWriter, r *http.Request){
	userinfo, _ := m.userHandler.GetUserInfoFromRequest(w,r)

	///Parse a list of modules where the user has permission to access
	userAccessableModules := []ModuleInfo{}
	for _, thisModule := range m.LoadedModule{
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

func (m *ModuleHandler)GetModuleInfoByID(moduleid string) *ModuleInfo{
	for _, module := range m.LoadedModule{
		if (module.Name == moduleid){
			return &module
		}
	}
	return nil
}

func (m *ModuleHandler)GetLaunchParameter(w http.ResponseWriter, r *http.Request){
	moduleName,_ := mv(r, "module", false)
	if (moduleName == ""){
		sendErrorResponse(w, "Missing paramter 'module'.")
		return
	}

	//Loop through the modules and see if the module exists.
	var targetLaunchInfo ModuleInfo
	found := false;
	for _, module := range m.LoadedModule{
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