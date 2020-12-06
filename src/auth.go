package main

import (
	"net/http"

	auth "imuslab.com/arozos/mod/auth"
	prout "imuslab.com/arozos/mod/prouter"
)

func AuthInit() {
	authAgent = auth.NewAuthenticationAgent("ao_auth", []byte(*session_key), sysdb, *allow_public_registry, func(w http.ResponseWriter, r *http.Request) {
		//Login Redirection Handler, redirect it login.system
		w.Header().Set("Cache-Control", "no-cache, no-store, no-transform, must-revalidate, private, max-age=0")
		http.Redirect(w, r, "/login.system?redirect="+r.URL.Path, 307)
	})

	if *allow_autologin == true {
		authAgent.AllowAutoLogin = true
	} else {
		//Default is false. But just in case
		authAgent.AllowAutoLogin = false
	}

	//Register the API endpoints for the authentication UI
	authAgent.RegisterPublicAPIs(auth.AuthEndpoints{
		Login:         "/system/auth/login",
		Logout:        "/system/auth/logout",
		Register:      "/system/auth/register",
		CheckLoggedIn: "/system/auth/checkLogin",
		Autologin:     "/api/auth/login",
	})

	authAgent.LoadAutologinTokenFromDB()

}

func AuthSettingsInit() {
	//Authentication related settings
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			sendErrorResponse(w, "Permission Denied")
		},
	})

	//Handle additional batch operations
	adminRouter.HandleFunc("/system/auth/csvimport", authAgent.HandleCreateUserAccountsFromCSV)
	adminRouter.HandleFunc("/system/auth/groupdel", authAgent.HandleUserDeleteByGroup)
}
