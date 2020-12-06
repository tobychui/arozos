package main

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"

	prout "imuslab.com/arozos/mod/prouter"
	ftp "imuslab.com/arozos/mod/storage/ftp"
)

/*
	FTP Server related handlers
*/

var (
	ftpServer *ftp.Handler
)

//Handle init of the FTP server endpoints
func storageFTPServerInit() {
	//Register FTP Endpoints
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			errorHandlePermissionDenied(w, r)
		},
	})

	//Create database related tables
	sysdb.NewTable("ftp")
	defaultEnable := false
	if sysdb.KeyExists("ftp", "default") {
		sysdb.Read("ftp", "default", &defaultEnable)
	} else {
		sysdb.Write("ftp", "default", false)
	}

	//Enable this service
	if defaultEnable {
		storageFTPServerStart()
	}

	adminRouter.HandleFunc("/system/storage/ftp/start", storageHandleFTPServerStart)
	adminRouter.HandleFunc("/system/storage/ftp/stop", storageHandleFTPServerStop)
	adminRouter.HandleFunc("/system/storage/ftp/upnp", storageHandleFTPuPnP)
	adminRouter.HandleFunc("/system/storage/ftp/status", storageHandleFTPServerStatus)
	adminRouter.HandleFunc("/system/storage/ftp/updateGroups", storageHandleFTPAccessUpdate)
	adminRouter.HandleFunc("/system/storage/ftp/setPort", storageHandleFTPSetPort)
}

//Start the FTP Server by request
func storageHandleFTPServerStart(w http.ResponseWriter, r *http.Request) {
	err := storageFTPServerStart()
	if err != nil {
		sendErrorResponse(w, err.Error())
	}

	//Remember the FTP server status
	sysdb.Write("ftp", "default", true)
	sendOK(w)
}

//Stop the FTP server by request
func storageHandleFTPServerStop(w http.ResponseWriter, r *http.Request) {
	if ftpServer != nil {
		ftpServer.Close()
	}
	sysdb.Write("ftp", "default", false)
	log.Println("FTP Server Stopped")
	sendOK(w)
}

//Update UPnP setting on FTP server
func storageHandleFTPuPnP(w http.ResponseWriter, r *http.Request) {
	enable, _ := mv(r, "enable", false)
	if enable == "true" {
		log.Println("Enabling UPnP on FTP Server Port")
		sysdb.Write("ftp", "upnp", true)
	} else {
		log.Println("Disabling UPnP on FTP Server Port")
		sysdb.Write("ftp", "upnp", false)
	}

	//Restart FTP Server if server is running
	if ftpServer != nil && ftpServer.ServerRunning {
		storageFTPServerStart()
	}

	sendOK(w)
}

//Update access permission on FTP server
func storageHandleFTPAccessUpdate(w http.ResponseWriter, r *http.Request) {
	//Get groups paramter from post req
	groupString, err := mv(r, "groups", true)
	if err != nil {
		sendErrorResponse(w, "groups not defined")
		return
	}

	//Prase it
	groups := []string{}
	err = json.Unmarshal([]byte(groupString), &groups)
	if err != nil {
		sendErrorResponse(w, "Unable to parse groups")
		return
	}

	log.Println("Updating FTP Access group to: ", groups)
	//Set the accessable group
	ftp.UpdateAccessableGroups(sysdb, groups)

	sendOK(w)
}

func storageHandleFTPSetPort(w http.ResponseWriter, r *http.Request) {
	port, err := mv(r, "port", true)
	if err != nil {
		sendErrorResponse(w, "Port not defined")
		return
	}

	//Try parse the port into int
	portInt, err := strconv.Atoi(port)
	if err != nil {
		sendErrorResponse(w, "Invalid port number")
		return
	}

	//Update the database port configuration
	sysdb.Write("ftp", "port", portInt)

	//Restart the FTP server
	storageFTPServerStart()

	sendOK(w)
}

func storageHandleFTPServerStatus(w http.ResponseWriter, r *http.Request) {
	type ServerStatus struct {
		Enabled     bool
		Port        int
		AllowUPNP   bool
		UPNPEnabled bool
		UserGroups  []string
	}

	enabled := false
	if ftpServer != nil && ftpServer.ServerRunning {
		enabled = true
	}

	serverPort := 21
	if sysdb.KeyExists("ftp", "port") {
		sysdb.Read("ftp", "port", &serverPort)
	}

	enableUPnP := false
	if sysdb.KeyExists("ftp", "upnp") {
		sysdb.Read("ftp", "upnp", &enableUPnP)
	}

	userGroups := []string{}
	if sysdb.KeyExists("ftp", "groups") {
		sysdb.Read("ftp", "groups", &userGroups)
	}

	jsonString, _ := json.Marshal(ServerStatus{
		Enabled:     enabled,
		Port:        serverPort,
		AllowUPNP:   *allow_upnp,
		UPNPEnabled: enableUPnP,
		UserGroups:  userGroups,
	})
	sendJSONResponse(w, string(jsonString))
}

func storageFTPServerStart() error {
	if ftpServer != nil {
		//If the previous ftp server is not closed, close it and open a new one
		if ftpServer.UPNPEnabled && UPNP != nil {
			UPNP.ClosePort(ftpServer.Port)
		}
		ftpServer.Close()
	}

	//Load new server config from database
	serverPort := int(21)
	if sysdb.KeyExists("ftp", "port") {
		sysdb.Read("ftp", "port", &serverPort)
	}

	enableUPnP := false
	if sysdb.KeyExists("ftp", "upnp") {
		sysdb.Read("ftp", "upnp", &enableUPnP)
	}

	//Create a new FTP Handler
	h, err := ftp.NewFTPHandler(userHandler, *host_name, serverPort, *tmp_directory)
	if err != nil {
		return err
	}
	h.Start()
	ftpServer = h

	if *allow_upnp {
		if enableUPnP {
			if UPNP == nil {
				return errors.New("UPnP did not started correctly on this host. Ignore this option")
			} else {
				//Forward the port
				UPNP.ForwardPort(ftpServer.Port, *host_name+" FTP Server")
				ftpServer.UPNPEnabled = true
			}

		} else {
			//UPNP disabled
			if UPNP == nil {
				return errors.New("UPnP did not started correctly on this host. Ignore this option")
			} else {
				UPNP.ClosePort(ftpServer.Port)
				ftpServer.UPNPEnabled = false
			}
		}
	}

	return nil
}
