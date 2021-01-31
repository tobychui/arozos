package main

/*
	WebDAV Entry point
	author: tobychui

*/

import (
	"encoding/json"
	"net/http"

	prout "imuslab.com/arozos/mod/prouter"
	awebdav "imuslab.com/arozos/mod/storage/webdav"
)

var (
	WebDavHandler *awebdav.Server
)

func WebDAVInit() {
	//Create a database table for webdav service
	sysdb.NewTable("webdav")

	//Create a new webdav server
	newserver := awebdav.NewServer(*host_name, "/webdav", *tmp_directory, *use_tls, userHandler)
	WebDavHandler = newserver

	//Check the webdav default state
	enabled := false
	if sysdb.KeyExists("webdav", "enabled") {
		sysdb.Read("webdav", "enabled", &enabled)
	}

	WebDavHandler.Enabled = enabled

	/*
		http.HandleFunc("/webdav", func(w http.ResponseWriter, r *http.Request) {
			WebDavHandler.HandleRequest(w, r)
		})
	*/

	http.HandleFunc("/system/network/webdav/list", WebDavHandler.HandleConnectionList)

	//Handle setting related functions
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "File Manager",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			sendErrorResponse(w, "Permission Denied")
		},
	})

	router.HandleFunc("/system/network/webdav/edit", WebDavHandler.HandlePermissionEdit)
	router.HandleFunc("/system/network/webdav/clear", WebDavHandler.HandleClearAllPending)

	router.HandleFunc("/system/network/webdav/status", func(w http.ResponseWriter, r *http.Request) {
		//Show status for every user, only allow change if admin
		userinfo, _ := userHandler.GetUserInfoFromRequest(w, r)
		isAdmin := userinfo.IsAdmin()

		set, _ := mv(r, "set", false)
		if set == "" {
			//Return the current status
			results := []bool{WebDavHandler.Enabled, isAdmin}
			js, _ := json.Marshal(results)
			sendJSONResponse(w, string(js))
		} else if isAdmin && set == "disable" {
			WebDavHandler.Enabled = false
			sysdb.Write("webdav", "enabled", false)
			sendOK(w)
		} else if isAdmin && set == "enable" {
			WebDavHandler.Enabled = true
			sysdb.Write("webdav", "enabled", true)
			sendOK(w)
		} else {
			sendErrorResponse(w, "Permission Denied")
		}
	})

	//Register settings
	registerSetting(settingModule{
		Name:     "WebDAV Server",
		Desc:     "WebDAV Server",
		IconPath: "SystemAO/info/img/small_icon.png",
		Group:    "Network",
		StartDir: "SystemAO/disk/webdav.html",
	})

}
