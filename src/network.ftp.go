package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/common"
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
func FTPServerInit() {
	//Register FTP Server Setting page
	registerSetting(settingModule{
		Name:         "FTP Server",
		Desc:         "File Transfer Protocol Server",
		IconPath:     "SystemAO/disk/smart/img/small_icon.png",
		Group:        "Network",
		StartDir:     "SystemAO/disk/ftp.html",
		RequireAdmin: true,
	})

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
	adminRouter.HandleFunc("/system/storage/ftp/passivemode", storageHandleFTPPassiveModeSettings)
}

/*
	Handle the settings for passive mode related files

	Example set commands
	set=ip&ip=123.456.789.1
	set=mode&passive=true
*/
func storageHandleFTPPassiveModeSettings(w http.ResponseWriter, r *http.Request) {
	set, err := common.Mv(r, "set", true)
	if err != nil {
		common.SendErrorResponse(w, "Invalid set type")
		return
	}

	if set == "ip" {
		//Updat the public up addr
		ip, err := common.Mv(r, "ip", true)
		if err != nil {
			common.SendErrorResponse(w, "Invalid ip given")
			return
		}

		sysdb.Write("ftp", "publicip", ip)

	} else if set == "mode" {
		//Update the passive mode setting
		passive, err := common.Mv(r, "passive", true)
		if err != nil {
			common.SendErrorResponse(w, "Invalid passive option (true/false)")
			return
		}

		systemWideLogger.PrintAndLog("FTP", "Updating FTP Server PassiveMode to"+passive, nil)
		if passive == "true" {
			sysdb.Write("ftp", "passive", true)
		} else {
			sysdb.Write("ftp", "passive", false)
		}
	} else {
		common.SendErrorResponse(w, "Unknown setting filed")
		return
	}

	//Restart the FTP server if it is running now
	if ftpServer != nil && ftpServer.ServerRunning {
		storageFTPServerStart()
	}

}

//Start the FTP Server by request
func storageHandleFTPServerStart(w http.ResponseWriter, r *http.Request) {
	err := storageFTPServerStart()
	if err != nil {
		common.SendErrorResponse(w, err.Error())
	}

	//Remember the FTP server status
	sysdb.Write("ftp", "default", true)
	common.SendOK(w)
}

//Stop the FTP server by request
func storageHandleFTPServerStop(w http.ResponseWriter, r *http.Request) {
	if ftpServer != nil {
		ftpServer.Close()
	}
	sysdb.Write("ftp", "default", false)
	systemWideLogger.PrintAndLog("FTP", "FTP Server Stopped", nil)
	common.SendOK(w)
}

//Update UPnP setting on FTP server
func storageHandleFTPuPnP(w http.ResponseWriter, r *http.Request) {
	enable, _ := common.Mv(r, "enable", false)
	if enable == "true" {
		systemWideLogger.PrintAndLog("FTP", "Enabling UPnP on FTP Server Port", nil)
		sysdb.Write("ftp", "upnp", true)
	} else {
		systemWideLogger.PrintAndLog("FTP", "Disabling UPnP on FTP Server Port", nil)
		sysdb.Write("ftp", "upnp", false)
	}

	//Restart FTP Server if server is running
	if ftpServer != nil && ftpServer.ServerRunning {
		storageFTPServerStart()
	}

	common.SendOK(w)
}

//Update access permission on FTP server
func storageHandleFTPAccessUpdate(w http.ResponseWriter, r *http.Request) {
	//Get groups paramter from post req
	groupString, err := common.Mv(r, "groups", true)
	if err != nil {
		common.SendErrorResponse(w, "groups not defined")
		return
	}

	//Prase it
	groups := []string{}
	err = json.Unmarshal([]byte(groupString), &groups)
	if err != nil {
		common.SendErrorResponse(w, "Unable to parse groups")
		return
	}

	systemWideLogger.PrintAndLog("FTP", "Updating FTP Access group to: "+strings.Join(groups, ","), nil)
	//Set the accessable group
	ftp.UpdateAccessableGroups(sysdb, groups)

	common.SendOK(w)
}

func storageHandleFTPSetPort(w http.ResponseWriter, r *http.Request) {
	port, err := common.Mv(r, "port", true)
	if err != nil {
		common.SendErrorResponse(w, "Port not defined")
		return
	}

	//Try parse the port into int
	portInt, err := strconv.Atoi(port)
	if err != nil {
		common.SendErrorResponse(w, "Invalid port number")
		return
	}

	//Update the database port configuration
	sysdb.Write("ftp", "port", portInt)

	//Restart the FTP server
	storageFTPServerStart()

	common.SendOK(w)
}

func storageHandleFTPServerStatus(w http.ResponseWriter, r *http.Request) {
	type ServerStatus struct {
		Enabled        bool
		Port           int
		AllowUPNP      bool
		UPNPEnabled    bool
		FTPUpnpEnabled bool
		PublicAddr     string
		PassiveMode    bool
		UserGroups     []string
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

	ftpUpnp := false
	if ftpServer != nil && ftpServer.UPNPEnabled {
		ftpUpnp = true
	}

	publicAddr := ""
	if UPNP != nil && UPNP.ExternalIP != "" && ftpUpnp == true {
		publicAddr = UPNP.ExternalIP
	} else {
		manualPublicIpEntry := ""
		if sysdb.KeyExists("ftp", "publicip") {
			sysdb.Read("ftp", "publicip", &manualPublicIpEntry)
		}

		publicAddr = manualPublicIpEntry
	}

	forcePassiveMode := false
	if ftpUpnp == true {
		forcePassiveMode = true
	} else {
		if sysdb.KeyExists("ftp", "passive") {
			sysdb.Read("ftp", "passive", &forcePassiveMode)
		}

		if forcePassiveMode {
			//Read the ip setting from database
			manualPublicIpEntry := ""
			if sysdb.KeyExists("ftp", "publicip") {
				sysdb.Read("ftp", "publicip", &manualPublicIpEntry)
			}

			publicAddr = manualPublicIpEntry
		}
	}

	jsonString, _ := json.Marshal(ServerStatus{
		Enabled:        enabled,
		Port:           serverPort,
		AllowUPNP:      *allow_upnp,
		UPNPEnabled:    enableUPnP,
		FTPUpnpEnabled: ftpUpnp,
		PublicAddr:     publicAddr,
		UserGroups:     userGroups,
		PassiveMode:    forcePassiveMode,
	})
	common.SendJSONResponse(w, string(jsonString))
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

	forcePassiveMode := false
	sysdb.Read("ftp", "passive", &forcePassiveMode)

	//Create a new FTP Handler
	passiveModeIP := ""
	if *allow_upnp && enableUPnP {
		//Using External IP address from the UPnP router reply
		externalIP := UPNP.ExternalIP
		if externalIP != "" {
			passiveModeIP = externalIP
		}
	} else if forcePassiveMode {
		//Not allowing upnp but still use passive mode (aka manual port forward)
		externalIP := ""
		if sysdb.KeyExists("ftp", "publicip") {
			sysdb.Read("ftp", "publicip", &externalIP)
		}
		passiveModeIP = externalIP
	}

	h, err := ftp.NewFTPHandler(userHandler, *host_name, serverPort, *tmp_directory, passiveModeIP)
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
				err := UPNP.ForwardPort(ftpServer.Port, *host_name+" FTP Server")
				if err != nil {
					systemWideLogger.PrintAndLog("FTP", "Failed to start FTP Server UPnP ", err)
					ftpServer.UPNPEnabled = false
					return err
				} else {
					//Forward other data ports
					UPNP.ForwardPort(ftpServer.Port+1, *host_name+" FTP Data 1")
					UPNP.ForwardPort(ftpServer.Port+2, *host_name+" FTP Data 2")
					ftpServer.UPNPEnabled = true
				}
				return nil
			}

		} else {
			//UPNP disabled
			if UPNP == nil {
				return errors.New("UPnP did not started correctly on this host. Ignore this option")
			} else {
				UPNP.ClosePort(ftpServer.Port)
				UPNP.ClosePort(ftpServer.Port + 1)
				UPNP.ClosePort(ftpServer.Port + 2)

				ftpServer.UPNPEnabled = false
			}
		}
	}

	return nil
}
