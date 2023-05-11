package main

import (
	"crypto/rand"
	"net/http"

	auth "imuslab.com/arozos/mod/auth"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
)

func AuthInit() {
	//Generate session key for authentication module if empty
	sysdb.NewTable("auth")
	if *session_key == "" {
		//Check if the key was generated already. If not, generate a new one
		if !sysdb.KeyExists("auth", "sessionkey") {
			key := make([]byte, 32)
			rand.Read(key)
			newSessionKey := string(key)
			sysdb.Write("auth", "sessionkey", newSessionKey)
			systemWideLogger.PrintAndLog("Auth", "New authentication session key generated", nil)
		} else {
			systemWideLogger.PrintAndLog("Auth", "Authentication session key loaded from database", nil)

		}
		skeyString := ""
		sysdb.Read("auth", "sessionkey", &skeyString)
		session_key = &skeyString
	}

	//Create an Authentication Agent
	authAgent = auth.NewAuthenticationAgent("ao_auth", []byte(*session_key), sysdb, *allow_public_registry, func(w http.ResponseWriter, r *http.Request) {
		//Login Redirection Handler, redirect it login.system
		w.Header().Set("Cache-Control", "no-cache, no-store, no-transform, must-revalidate, private, max-age=0")
		http.Redirect(w, r, utils.ConstructRelativePathFromRequestURL(r.RequestURI, "login.system")+"?redirect="+r.URL.Path, http.StatusTemporaryRedirect)
	})

	if *allow_autologin {
		authAgent.AllowAutoLogin = true
	} else {
		//Default is false. But just in case
		authAgent.AllowAutoLogin = false
	}

	//Register the API endpoints for the authentication UI
	http.HandleFunc("/system/auth/login", authAgent.HandleLogin)
	http.HandleFunc("/system/auth/logout", authAgent.HandleLogout)
	http.HandleFunc("/system/auth/register", authAgent.HandleRegister)
	http.HandleFunc("/system/auth/checkLogin", authAgent.CheckLogin)
	http.HandleFunc("/api/auth/login", authAgent.HandleAutologinTokenLogin)

	authAgent.LoadAutologinTokenFromDB()
}

func AuthSettingsInit() {
	//Authentication related settings
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Handle additional batch operations
	adminRouter.HandleFunc("/system/auth/csvimport", authAgent.HandleCreateUserAccountsFromCSV)
	adminRouter.HandleFunc("/system/auth/groupdel", authAgent.HandleUserDeleteByGroup)

	//System for logging and displaying login user information
	registerSetting(settingModule{
		Name:         "Connection Log",
		Desc:         "Logs for login attempts",
		IconPath:     "SystemAO/security/img/small_icon.png",
		Group:        "Security",
		StartDir:     "SystemAO/security/connlog.html",
		RequireAdmin: true,
	})

	adminRouter.HandleFunc("/system/auth/logger/index", authAgent.Logger.HandleIndexListing)
	adminRouter.HandleFunc("/system/auth/logger/list", authAgent.Logger.HandleTableListing)

	//Blacklist Management
	registerSetting(settingModule{
		Name:         "Access Control",
		Desc:         "Prevent / Allow certain IP ranges from logging in",
		IconPath:     "SystemAO/security/img/small_icon.png",
		Group:        "Security",
		StartDir:     "SystemAO/security/accesscontrol.html",
		RequireAdmin: true,
	})

	//Whitelist API
	adminRouter.HandleFunc("/system/auth/whitelist/enable", authAgent.WhitelistManager.HandleSetWhitelistEnable)
	adminRouter.HandleFunc("/system/auth/whitelist/list", authAgent.WhitelistManager.HandleListWhitelistedIPs)
	adminRouter.HandleFunc("/system/auth/whitelist/set", authAgent.WhitelistManager.HandleAddWhitelistedIP)
	adminRouter.HandleFunc("/system/auth/whitelist/unset", authAgent.WhitelistManager.HandleRemoveWhitelistedIP)

	//Blacklist API
	adminRouter.HandleFunc("/system/auth/blacklist/enable", authAgent.BlacklistManager.HandleSetBlacklistEnable)
	adminRouter.HandleFunc("/system/auth/blacklist/list", authAgent.BlacklistManager.HandleListBannedIPs)
	adminRouter.HandleFunc("/system/auth/blacklist/ban", authAgent.BlacklistManager.HandleAddBannedIP)
	adminRouter.HandleFunc("/system/auth/blacklist/unban", authAgent.BlacklistManager.HandleRemoveBannedIP)

	//Register nightly task for clearup all user retry counter
	nightlyManager.RegisterNightlyTask(authAgent.ExpDelayHandler.ResetAllUserRetryCounter)
}
