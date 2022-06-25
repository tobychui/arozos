package main

import (
	"encoding/json"
	"fmt"
	"net/http"

	reg "imuslab.com/arozos/mod/auth/register"
	"imuslab.com/arozos/mod/common"
	prout "imuslab.com/arozos/mod/prouter"
)

var (
	registerHandler *reg.RegisterHandler
)

func RegisterSystemInit() {
	//Register the endpoints for public registration
	rh := reg.NewRegisterHandler(sysdb, authAgent, permissionHandler, reg.RegisterOptions{
		Hostname:   *host_name,
		VendorIcon: "web/" + iconVendor,
	})

	registerHandler = rh

	//Set the allow registry states
	if *allow_public_registry {
		registerHandler.AllowRegistry = true
	} else {
		registerHandler.AllowRegistry = false
	}

	http.HandleFunc("/public/register/register.system", registerHandler.HandleRegisterInterface)
	http.HandleFunc("/public/register/handleRegister.system", registerHandler.HandleRegisterRequest)
	http.HandleFunc("/public/register/checkPublicRegister", registerHandler.HandleRegisterCheck)

	//General user functions
	router := prout.NewModuleRouter(prout.RouterOption{
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			common.SendErrorResponse(w, "Permission Denied")
		},
	})

	router.HandleFunc("/system/register/email", registerHandler.HandleEmailChange)

	//Register settings
	registerSetting(settingModule{
		Name:         "Public Registry",
		Desc:         "Allow public users to create account in this host",
		IconPath:     "SystemAO/users/img/small_icon.png",
		Group:        "Users",
		StartDir:     "SystemAO/users/pubreg.html",
		RequireAdmin: true,
	})

	//Register Setting Interface for setting interfaces

	adminrouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			common.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Handle updates of the default group
	adminrouter.HandleFunc("/system/register/setDefaultGroup", register_handleSetDefaultGroup)

	//Handle if the current handler allow registry
	adminrouter.HandleFunc("/system/register/getAllowRegistry", register_handleGetAllowRegistry)

	//Handle toggle
	adminrouter.HandleFunc("/system/register/setAllowRegistry", register_handleToggleRegistry)

	//Get a list of email registered in the system
	adminrouter.HandleFunc("/system/register/listUserEmails", register_handleEmailListing)

	//Clear User record that has no longer use this service
	adminrouter.HandleFunc("/system/register/cleanUserRegisterInfo", register_handleRegisterCleaning)
}

func register_handleRegisterCleaning(w http.ResponseWriter, r *http.Request) {
	//Get all user emails from the registerHandler
	registerHandler.CleanRegisters()
	common.SendOK(w)
}

func register_handleEmailListing(w http.ResponseWriter, r *http.Request) {
	//Get all user emails from the registerHandler
	userRegisterInfos := registerHandler.ListAllUserEmails()

	useCSV, _ := common.Mv(r, "csv", false)
	if useCSV == "true" {
		//Prase as csv
		csvString := "Username,Email,Still Registered\n"
		for _, v := range userRegisterInfos {
			registered := "false"
			s, _ := v[2].(bool)
			if s == true {
				registered = "true"
			}
			csvString += fmt.Sprintf("%v", v[0]) + "," + fmt.Sprintf("%v", v[1]) + "," + registered + "\n"
		}

		w.Header().Set("Content-Disposition", "attachment; filename=registerInfo.csv")
		w.Header().Set("Content-Type", "text/csv")
		w.Write([]byte(csvString))
	} else {
		//Prase as json
		jsonString, _ := json.Marshal(userRegisterInfos)
		common.SendJSONResponse(w, string(jsonString))
	}

}

func register_handleSetDefaultGroup(w http.ResponseWriter, r *http.Request) {
	getDefaultGroup, _ := common.Mv(r, "get", true)
	if getDefaultGroup == "true" {
		jsonString, _ := json.Marshal(registerHandler.DefaultUserGroup)
		common.SendJSONResponse(w, string(jsonString))
		return
	}
	newDefaultGroup, err := common.Mv(r, "defaultGroup", true)
	if err != nil {
		common.SendErrorResponse(w, "defaultGroup not defined")
		return
	}
	err = registerHandler.SetDefaultUserGroup(newDefaultGroup)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	common.SendOK(w)
}

func register_handleGetAllowRegistry(w http.ResponseWriter, r *http.Request) {
	jsonString, _ := json.Marshal(registerHandler.AllowRegistry)
	common.SendJSONResponse(w, string(jsonString))
}

func register_handleToggleRegistry(w http.ResponseWriter, r *http.Request) {
	allowReg, err := common.Mv(r, "allow", true)
	if err != nil {
		allowReg = "false"
	}
	registerHandler.SetAllowRegistry(allowReg == "true")
	common.SendOK(w)
}
