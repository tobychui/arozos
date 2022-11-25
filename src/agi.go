package main

import (
	"net/http"

	agi "imuslab.com/arozos/mod/agi"
	"imuslab.com/arozos/mod/common"
	prout "imuslab.com/arozos/mod/prouter"
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
		TempFolderPath:       *tmp_directory,
	})
	if err != nil {
		systemWideLogger.PrintAndLog("AGI", "AGI Gateway Initialization Failed", err)
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
		token, err := common.Mv(r, "token", true)
		if err != nil {
			w.WriteHeader(http.StatusUnauthorized)
			w.Write([]byte("401 - Unauthorized (token is empty)"))
			return
		}

		//Validate Token
		if authAgent.TokenValid(token) {
			//Valid
			thisUsername, err := gw.Option.UserHandler.GetAuthAgent().GetTokenOwner(token)
			if err != nil {
				systemWideLogger.PrintAndLog("AGI", "Unable to validate token owner", err)
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

	// external AGI related function
	externalAGIRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "ARZ Serverless",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			errorHandlePermissionDenied(w, r)
		},
	})
	externalAGIRouter.HandleFunc("/api/ajgi/listExt", gw.ListExternalEndpoint)
	externalAGIRouter.HandleFunc("/api/ajgi/addExt", gw.AddExternalEndPoint)
	externalAGIRouter.HandleFunc("/api/ajgi/rmExt", gw.RemoveExternalEndPoint)

	AGIGateway = gw
}
