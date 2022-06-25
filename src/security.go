package main

import (
	"net/http"
	"time"

	"imuslab.com/arozos/mod/common"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/security/csrf"
)

/*
	Security.go
	Author: tobychui

	This module handles the system security related functions.
	If you are looking for authentication or login related features, see auth.go
*/

var (
	CSRFTokenManager  *csrf.TokenManager
	tokenExpireTime   int64 = 10                        //Token expire in 10 seconds
	tokenCleaningTime int   = int(tokenExpireTime) * 12 //Tokens are cleared every 12 x tokenExpireTime
)

//Initiation function
func security_init() {
	//Create a default permission router accessable by everyone
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			common.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Creat a new CSRF Token Manager and token expire in 30 seconds
	CSRFTokenManager = csrf.NewTokenManager(userHandler, tokenExpireTime)

	//Register functions related to CSRF Tokens
	router.HandleFunc("/system/csrf/new", CSRFTokenManager.HandleNewToken)

	//Create a timer to clear expired tokens
	ticker := time.NewTicker(time.Duration(tokenCleaningTime) * time.Second)
	go func() {
		for {
			select {
			case <-ticker.C:
				CSRFTokenManager.ClearExpiredTokens()
			}
		}
	}()

}
