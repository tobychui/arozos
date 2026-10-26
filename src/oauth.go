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

	// Public endpoints (called before the user is authenticated)
	http.HandleFunc("/system/auth/oauth/login", oAuthHandler.HandleLogin)
	http.HandleFunc("/system/auth/oauth/authorize", oAuthHandler.HandleAuthorize)
	http.HandleFunc("/system/auth/oauth/checkoauth", oAuthHandler.CheckOAuth)

	// Admin-only configuration endpoints
	adminRouter.HandleFunc("/system/auth/oauth/config/read", oAuthHandler.ReadConfig)
	adminRouter.HandleFunc("/system/auth/oauth/config/write", oAuthHandler.WriteConfig)
	adminRouter.HandleFunc("/system/auth/oauth/config/discover", oAuthHandler.HandleDiscover)

	registerSetting(settingModule{
		Name:         "OAuth",
		Desc:         "Sign in with any OIDC-compatible identity provider",
		IconPath:     "SystemAO/advance/img/small_icon.png",
		Group:        "Security",
		StartDir:     "SystemAO/advance/oauth.html",
		RequireAdmin: true,
	})
}
