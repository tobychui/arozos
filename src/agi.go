package main

import (
	"log"
	"net/http"

	agi "imuslab.com/arozos/mod/agi"
)

var (
	AGIGateway *agi.Gateway
)

func AGIInit() {
	//Create new AGI Gateway object
	gw, err := agi.NewGateway(agi.AgiSysInfo{
		BuildVersion:         build_version,
		InternalVersion:      internal_version,
		LoadedModule:         moduleHandler.GetModuleNameList(),
		ReservedTables:       []string{"auth", "permisson", "register", "desktop"},
		ModuleRegisterParser: moduleHandler.RegisterModuleFromAGI,
		PackageManager:       packageManager,
		UserHandler:          userHandler,
		StartupRoot:          "./web",
		ActivateScope:        []string{"./web", "./subservice"},
		FileSystemRender:     thumbRenderHandler,
		ShareManager:         shareManager,
		NightlyManager:       nightlyManager,
	})
	if err != nil {
		log.Println("AGI Gateway Initialization Failed")
	}

	//Register user request handler endpoint
	http.HandleFunc("/system/ajgi/interface", func(w http.ResponseWriter, r *http.Request) {
		//Require login check
		authAgent.HandleCheckAuth(w, r, func(w http.ResponseWriter, r *http.Request) {
			//API Call from actual human users
			thisuser, _ := gw.Option.UserHandler.GetUserInfoFromRequest(w, r)
			gw.InterfaceHandler(w, r, thisuser)
		})
	})

	//Register external API request handler endpoint
	http.HandleFunc("/api/ajgi/interface", func(w http.ResponseWriter, r *http.Request) {
		//Check if token exists
		token, err := mv(r, "token", true)
		if err != nil {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte("401 - Unauthorized (token is empty)"))
			return
		}

		//Validate Token
		if authAgent.TokenValid(token) == true {
			//Valid
			thisUsername, err := gw.Option.UserHandler.GetAuthAgent().GetTokenOwner(token)
			if err != nil {
				log.Println(err)
				w.WriteHeader(http.StatusInternalServerError)
				w.Write([]byte("500 - Internal Server Error"))
				return
			}
			thisuser, _ := gw.Option.UserHandler.GetUserInfoFromUsername(thisUsername)
			gw.APIHandler(w, r, thisuser)
		} else {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte("401 - Unauthorized (Invalid / expired token)"))
			return
		}

	})

	http.HandleFunc("/api/ajgi/exec", gw.HandleAgiExecutionRequestWithToken)

	AGIGateway = gw
}
