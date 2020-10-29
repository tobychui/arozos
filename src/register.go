package main

import (
	"net/http"
	"encoding/json"

	reg "imuslab.com/aroz_online/mod/auth/register"
	prout "imuslab.com/aroz_online/mod/prouter"
)

var (
	registerHandler *reg.RegisterHandler
)

func RegisterSystemInit(){
	//Register the endpoints for public registration
	rh := reg.NewRegisterHandler(sysdb, authAgent, permissionHandler, reg.RegisterOptions{
		Hostname: *host_name,
		VendorIcon: "web/" + iconVendor,
	});

	registerHandler = rh

	//Set the allow registry states
	if (*allow_public_registry){
		registerHandler.AllowRegistry = true
	}else{
		registerHandler.AllowRegistry = false
	}

	http.HandleFunc("/public/register/register.system",registerHandler.HandleRegisterInterface);
	http.HandleFunc("/public/register/handleRegister.system",registerHandler.HandleRegisterRequest);
	http.HandleFunc("/public/register/checkPublicRegister",registerHandler.HandleRegisterCheck);

	//Register settings
	registerSetting(settingModule{
		Name:     "Public Registry",
		Desc:     "Allow public users to create account in this host",
		IconPath: "SystemAO/users/img/small_icon.png",
		Group: "Users",
		StartDir: "SystemAO/users/pubreg.html",
		RequireAdmin: true,
	})

	//Register Setting Interface for setting interfaces
	
	adminrouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName: "System Setting", 
		AdminOnly: true, 
		UserHandler: userHandler, 
		DeniedHandler: func(w http.ResponseWriter, r *http.Request){
			sendErrorResponse(w, "Permission Denied");
		},
	});
	
	//Handle updates of the default group
	adminrouter.HandleFunc("/system/register/setDefaultGroup", register_handleSetDefaultGroup);

	//Handle if the current handler allow registry
	adminrouter.HandleFunc("/system/register/getAllowRegistry",register_handleGetAllowRegistry)
	
	//Handle toggle
	adminrouter.HandleFunc("/system/register/setAllowRegistry",register_handleToggleRegistry);

}

func register_handleSetDefaultGroup(w http.ResponseWriter, r *http.Request){
	getDefaultGroup, _ := mv(r, "get",true)
		if (getDefaultGroup == "true"){
			jsonString, _ := json.Marshal(registerHandler.DefaultUserGroup)
			sendJSONResponse(w,string(jsonString));
			return
		}
		newDefaultGroup, err := mv(r, "defaultGroup",true)
		if err != nil{
			sendErrorResponse(w, "defaultGroup not defined")
			return
		}
		err = registerHandler.SetDefaultUserGroup(newDefaultGroup);
		if err != nil{
			sendErrorResponse(w, err.Error())
			return
		}
		sendOK(w);
}

func register_handleGetAllowRegistry(w http.ResponseWriter, r *http.Request){
	jsonString, _ := json.Marshal(registerHandler.AllowRegistry)
	sendJSONResponse(w, string(jsonString))
}

func register_handleToggleRegistry(w http.ResponseWriter, r *http.Request){
	allowReg, err := mv(r, "allow",true)
	if err != nil{
		allowReg = "false"
	}
	registerHandler.SetAllowRegistry(allowReg == "true");
	sendOK(w);
}
