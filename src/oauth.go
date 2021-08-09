package main

import (
	"net/http"

	oauth "imuslab.com/arozos/mod/auth/oauth2"
	prout "imuslab.com/arozos/mod/prouter"
)

func OAuthInit() {
	oAuthHandler := oauth.NewOauthHandler(authAgent, registerHandler, sysdb)

	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			errorHandlePermissionDenied(w, r)
		},
	})

	http.HandleFunc("/system/auth/oauth/login", oAuthHandler.HandleLogin)
	http.HandleFunc("/system/auth/oauth/authorize", oAuthHandler.HandleAuthorize)
	http.HandleFunc("/system/auth/oauth/checkoauth", oAuthHandler.CheckOAuth)
	adminRouter.HandleFunc("/system/auth/oauth/config/read", oAuthHandler.ReadConfig)
	adminRouter.HandleFunc("/system/auth/oauth/config/write", oAuthHandler.WriteConfig)

	registerSetting(settingModule{
		Name:         "OAuth",
		Desc:         "Allows external account access to system",
		IconPath:     "SystemAO/advance/img/small_icon.png",
		Group:        "Security",
		StartDir:     "SystemAO/advance/oauth.html",
		RequireAdmin: true,
	})
}
