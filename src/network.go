package main

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/fileservers/servers/dirserv"
	"imuslab.com/arozos/mod/fileservers/servers/ftpserv"
	"imuslab.com/arozos/mod/fileservers/servers/samba"
	"imuslab.com/arozos/mod/fileservers/servers/sftpserv"
	"imuslab.com/arozos/mod/fileservers/servers/webdavserv"
	network "imuslab.com/arozos/mod/network"
	mdns "imuslab.com/arozos/mod/network/mdns"
	"imuslab.com/arozos/mod/network/netstat"
	ssdp "imuslab.com/arozos/mod/network/ssdp"
	upnp "imuslab.com/arozos/mod/network/upnp"
	"imuslab.com/arozos/mod/network/websocket"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/utils"
	"imuslab.com/arozos/mod/www"
)

var (
	//Network Services Managers
	MDNS            *mdns.MDNSHost
	UPNP            *upnp.UPnPClient
	SSDP            *ssdp.SSDPHost
	WebSocketRouter *websocket.Router

	//File Server Managers
	FTPManager        *ftpserv.Manager
	WebDAVManager     *webdavserv.Manager
	SFTPManager       *sftpserv.Manager
	SambaShareManager *samba.ShareManager
	DirListManager    *dirserv.Manager
)

func NetworkServiceInit() {
	systemWideLogger.PrintAndLog("Network", "Starting ArOZ Network Services", nil)

	//Create a router that allow users with System Setting access to access these api endpoints
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	/*
		Standard Network Utilties
	*/

	//Register handler endpoints
	if *allow_hardware_management {
		router.HandleFunc("/system/network/getNICinfo", network.GetNICInfo)
		router.HandleFunc("/system/network/getPing", network.GetPing)

		//Register as a system setting
		registerSetting(settingModule{
			Name:     "Network Info",
			Desc:     "Network Information",
			IconPath: "SystemAO/network/img/ethernet.png",
			Group:    "Network",
			StartDir: "SystemAO/network/hardware.html",
		})
	}

	router.HandleFunc("/system/network/getNICUsage", netstat.HandleGetNetworkInterfaceStats)

	//Start the services that depends on network interface
	StartNetworkServices()

	//Start the port forward configuration interface
	portForwardInit()

	//Start userhomepage if enabled
	//Handle user webroot routings if homepage is enabled
	if *allow_homepage {
		userWwwHandler = www.NewWebRootHandler(www.Options{
			UserHandler: userHandler,
			Database:    sysdb,
			AgiGateway:  AGIGateway,
		})

		router.HandleFunc("/system/network/www/toggle", userWwwHandler.HandleToggleHomepage)
		router.HandleFunc("/system/network/www/webRoot", userWwwHandler.HandleSetWebRoot)

		//Register as a system setting
		registerSetting(settingModule{
			Name:     "Personal Page",
			Desc:     "Personal Web Page",
			IconPath: "SystemAO/www/img/homepage.png",
			Group:    "Network",
			StartDir: "SystemAO/www/config.html",
		})

	}

	userRouter := prout.NewModuleRouter(prout.RouterOption{
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	WebSocketRouter = websocket.NewRouter()
	userRouter.HandleFunc("/system/ws", WebSocketRouter.HandleWebSocketRouting)

}

func StartNetworkServices() {

	/*
		MDNS Services
	*/
	if *allow_mdns {
		m, err := mdns.NewMDNS(mdns.NetworkHost{
			HostName:     *host_name + "_" + deviceUUID, //To handle more than one identical model within the same network, this must be unique
			Port:         *listen_port,
			Domain:       "arozos.com",
			Model:        deviceModel,
			UUID:         deviceUUID,
			Vendor:       deviceVendor,
			BuildVersion: build_version,
			MinorVersion: internal_version,
		}, *force_mac)

		if err != nil {
			systemWideLogger.PrintAndLog("Network", "MDNS Startup Failed. Running in Offline Mode.", err)
		} else {
			MDNS = m
		}

	}

	/*
		SSDP Discovery Services
	*/
	if *allow_ssdp {
		//Get outbound ip
		obip, err := network.GetOutboundIP()
		if err != nil {
			systemWideLogger.PrintAndLog("Network", "SSDP Startup Failed. Running in Offline Mode.", err)
		} else {
			thisIp := obip.String()
			adv, err := ssdp.NewSSDPHost(thisIp, *listen_port, "system/ssdp.xml", ssdp.SSDPOption{
				URLBase:   "http://" + thisIp + ":" + strconv.Itoa(*listen_port), //This must be http if used as local hosting devices
				Hostname:  *host_name,
				Vendor:    deviceVendor,
				VendorURL: deviceVendorURL,
				ModelName: deviceModel,
				ModelDesc: deviceModelDesc,
				UUID:      deviceUUID,
				Serial:    "generic",
			})

			if err != nil {
				systemWideLogger.PrintAndLog("Network", "SSDP Startup Failed. Running in Offline Mode.", err)
			} else {
				//OK! Start SSDP Service
				SSDP = adv
				SSDP.Start()
			}
		}

	}

	/*
		UPNP / Setup automatic port forwarding
	*/
	if *allow_upnp {
		var u *upnp.UPnPClient
		var err error = nil
		if *use_tls {
			u, err = upnp.NewUPNPClient(*tls_listen_port, *host_name+"-https")
		} else {
			u, err = upnp.NewUPNPClient(*listen_port, *host_name+"-http")
		}

		if err != nil {
			systemWideLogger.PrintAndLog("Network", "UPnP Startup Failed: "+err.Error(), err)
		} else {

			//Bind the http port if running in https and http server is not disabled
			if *use_tls && !*disable_http {
				u.ForwardPort(*listen_port, *host_name+"-http")
			}

			UPNP = u

			//Register nightly listener for upnp renew
			nightlyManager.RegisterNightlyTask(func() {
				UPNP.RenewForwardRules()
			})

			//Show a tip for success port forward
			connectionEndpoint := UPNP.ExternalIP + ":" + strconv.Itoa(*listen_port)
			obip, err := network.GetOutboundIP()
			obipstring := "[Outbound IP]"
			if err != nil {

			} else {
				obipstring = obip.String()
			}

			localEndpoint := obipstring + ":" + strconv.Itoa(*listen_port)
			systemWideLogger.PrintAndLog("Network", "Automatic Port Forwarding Completed. Forwarding all request from "+connectionEndpoint+" to "+localEndpoint, nil)

		}

	}
}

func StopNetworkServices() {
	//systemWideLogger.PrintAndLog("Shutting Down Network Services...",nil)
	//Shutdown uPNP service if enabled
	if *allow_upnp {
		systemWideLogger.PrintAndLog("System", "<!> Shutting down uPNP service", nil)
		UPNP.Close()
	}

	//Shutdown SSDP service if enabled
	if *allow_ssdp {
		systemWideLogger.PrintAndLog("System", "<!> Shutting down SSDP service", nil)
		SSDP.Close()
	}

	//Shutdown MDNS if enabled
	if *allow_mdns {
		systemWideLogger.PrintAndLog("System", "<!> Shutting down MDNS service", nil)
		MDNS.Close()
	}
}

/*

	File Server Services

*/

var networkFileServerDaemon []*fileservers.Server = []*fileservers.Server{}

// Initiate all File Server services
func FileServerInit() {
	//Register System Setting
	registerSetting(settingModule{
		Name:         "File Servers",
		Desc:         "Network File Transfer Servers",
		IconPath:     "SystemAO/disk/smart/img/small_icon.png",
		Group:        "Network",
		StartDir:     "SystemAO/disk/services.html",
		RequireAdmin: false,
	})

	//Create request routers
	adminRouter := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			errorHandlePermissionDenied(w, r)
		},
	})

	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			utils.SendErrorResponse(w, "Permission Denied")
		},
	})

	/* Create File Server Managers */
	//WebDAV
	webdavPort := *listen_port
	if *use_tls {
		webdavPort = *tls_listen_port
	}
	WebDAVManager = webdavserv.NewWebDAVManager(&webdavserv.ManagerOption{
		Sysdb:       sysdb,
		Hostname:    *host_name,
		TmpDir:      *tmp_directory,
		Port:        webdavPort,
		UseTls:      *use_tls,
		UserHandler: userHandler,
	})

	//FTP
	FTPManager = ftpserv.NewFTPManager(&ftpserv.ManagerOption{
		Hostname:    *host_name,
		TmpFolder:   *tmp_directory,
		Logger:      systemWideLogger,
		UserManager: userHandler,
		FtpServer:   nil,
		Sysdb:       sysdb,
		Upnp:        UPNP,
		AllowUpnp:   *allow_upnp,
	})

	//SFTP
	SFTPManager = sftpserv.NewSFTPServer(&sftpserv.ManagerOption{
		Hostname:    *host_name,
		Upnp:        UPNP,
		UserManager: userHandler,
		KeyFile:     "system/auth/id_rsa.key",
		Logger:      systemWideLogger,
		Sysdb:       sysdb,
	})

	listeningPort := *listen_port
	if *use_tls {
		listeningPort = *tls_listen_port
	}
	DirListManager = dirserv.NewDirectoryServer(&dirserv.Option{
		Sysdb:       sysdb,
		ServerPort:  listeningPort,
		UserManager: userHandler,
		ServerUUID:  deviceUUID,
	})

	//Samba
	var err error
	SambaShareManager, err = samba.NewSambaShareManager(userHandler)
	if err != nil {
		//Disable samba if not installed or platform not supported
		log.Println("[INFO] Samba Share Manager Disabled: " + err.Error())
	}

	//Register Endpoints
	//WebDAV
	http.HandleFunc("/system/network/webdav/list", WebDAVManager.HandleConnectionList)
	router.HandleFunc("/system/network/webdav/edit", WebDAVManager.HandlePermissionEdit)
	router.HandleFunc("/system/network/webdav/clear", WebDAVManager.HandleClearAllPending)
	router.HandleFunc("/system/network/webdav/status", WebDAVManager.HandleStatusChange)

	//SFTP
	adminRouter.HandleFunc("/system/storage/sftp/port", SFTPManager.HandleListeningPort)
	adminRouter.HandleFunc("/system/storage/sftp/upnp", SFTPManager.HandleToogleUPnP)
	adminRouter.HandleFunc("/system/storage/sftp/users", SFTPManager.HandleGetConnectedClients)

	//FTP
	//adminRouter.HandleFunc("/system/storage/ftp/start", FTPManager.HandleFTPServerStart)
	//adminRouter.HandleFunc("/system/storage/ftp/stop", FTPManager.HandleFTPServerStop)
	adminRouter.HandleFunc("/system/storage/ftp/upnp", FTPManager.HandleFTPUPnP)
	adminRouter.HandleFunc("/system/storage/ftp/status", FTPManager.HandleFTPServerStatus)
	adminRouter.HandleFunc("/system/storage/ftp/updateGroups", FTPManager.HandleFTPAccessUpdate)
	adminRouter.HandleFunc("/system/storage/ftp/setPort", FTPManager.HandleFTPSetPort)
	adminRouter.HandleFunc("/system/storage/ftp/passivemode", FTPManager.HandleFTPPassiveModeSettings)

	//Samba Shares (Optional)
	if SambaShareManager != nil {
		//Activate and Deactivate are functions all users can use if admin enabled smbd service
		router.HandleFunc("/system/storage/samba/activate", func(w http.ResponseWriter, r *http.Request) {
			if !AuthValidateSecureRequest(w, r, false) {
				return
			}

			if !SambaShareManager.IsEnabled() {
				utils.SendErrorResponse(w, "smbd is not enabled on this server")
				return
			}
			password, _ := utils.PostPara(r, "password")
			SambaShareManager.ActivateUserAccount(w, r, password)
		})
		adminRouter.HandleFunc("/system/storage/samba/deactivate", SambaShareManager.DeactiveUserAccount)
		adminRouter.HandleFunc("/system/storage/samba/myshare", SambaShareManager.HandleUserSmbStatusList)
		//adminRouter.HandleFunc("/system/storage/samba/myshare/delete", SambaShareManager.DelUserSambaShare)
		adminRouter.HandleFunc("/system/storage/samba/status", SambaShareManager.SmbdStates)
		adminRouter.HandleFunc("/system/storage/samba/list", SambaShareManager.ListSambaShares)
		adminRouter.HandleFunc("/system/storage/samba/add", SambaShareManager.AddSambaShare)
		adminRouter.HandleFunc("/system/storage/samba/editPath", SambaShareManager.HandleSharePathChange)
		adminRouter.HandleFunc("/system/storage/samba/remove", SambaShareManager.DelSambaShare)
		adminRouter.HandleFunc("/system/storage/samba/addUser", SambaShareManager.NewSambaUser)
		adminRouter.HandleFunc("/system/storage/samba/delUser", SambaShareManager.DelSambaUser)
		adminRouter.HandleFunc("/system/storage/samba/listUsers", SambaShareManager.ListSambaUsers)
		adminRouter.HandleFunc("/system/storage/samba/updateShareUsers", SambaShareManager.HandleAccessUserUpdate)
	}

	networkFileServerDaemon = append(networkFileServerDaemon, &fileservers.Server{
		ID:                "webdav",
		Name:              "WebDAV",
		Desc:              "WebDAV Server",
		IconPath:          "img/system/network-folder-blue.svg",
		DefaultPorts:      []int{},
		Ports:             []int{},
		ForwardPortIfUpnp: false,
		ConnInstrPage:     "SystemAO/disk/instr/webdav.html",
		ConfigPage:        "SystemAO/disk/webdav.html",
		EnableCheck:       WebDAVManager.GetWebDavEnabled,
		ToggleFunc:        WebDAVManager.WebDavToogle,
		GetEndpoints:      WebDAVManager.WebDavGetEndpoints,
	})

	networkFileServerDaemon = append(networkFileServerDaemon, &fileservers.Server{
		ID:                "sftp",
		Name:              "SFTP",
		Desc:              "SSH File Transfer Protocol Server",
		IconPath:          "img/system/network-folder-sftp.svg",
		DefaultPorts:      []int{2022},
		Ports:             []int{},
		ForwardPortIfUpnp: true,
		ConnInstrPage:     "SystemAO/disk/instr/sftp.html",
		ConfigPage:        "SystemAO/disk/sftp.html",
		EnableCheck:       SFTPManager.IsEnabled,
		ToggleFunc:        SFTPManager.ServerToggle,
		GetEndpoints:      SFTPManager.GetEndpoints,
	})

	networkFileServerDaemon = append(networkFileServerDaemon, &fileservers.Server{
		ID:                "ftp",
		Name:              "FTP",
		Desc:              "File Transfer Protocol Server",
		IconPath:          "img/system/network-folder.svg",
		DefaultPorts:      []int{21, 22, 23},
		Ports:             []int{},
		ForwardPortIfUpnp: true,
		ConnInstrPage:     "SystemAO/disk/instr/ftp.html",
		ConfigPage:        "SystemAO/disk/ftp.html",
		EnableCheck:       FTPManager.IsFtpServerEnabled,
		ToggleFunc:        FTPManager.FTPServerToggle,
		GetEndpoints:      FTPManager.FTPGetEndpoints,
	})

	networkFileServerDaemon = append(networkFileServerDaemon, &fileservers.Server{
		ID:                "dirserv",
		Name:              "Directory Server",
		Desc:              "Web file viewer for legacy devices",
		IconPath:          "img/system/network-dirserv.svg",
		DefaultPorts:      []int{},
		Ports:             []int{},
		ForwardPortIfUpnp: false,
		ConnInstrPage:     "SystemAO/disk/instr/dirserv.html",
		ConfigPage:        "SystemAO/disk/dirserv.html",
		EnableCheck:       DirListManager.DirServerEnabled,
		ToggleFunc:        DirListManager.Toggle,
		GetEndpoints:      DirListManager.ListEndpoints,
	})

	if SambaShareManager != nil {
		//Samba is external and might not exists on this host
		networkFileServerDaemon = append(networkFileServerDaemon, &fileservers.Server{
			ID:                "smbd",
			Name:              "Samba Shares",
			Desc:              "Share local files via SMB using Samba",
			IconPath:          "img/system/network-samba.svg",
			DefaultPorts:      []int{},
			Ports:             []int{},
			ForwardPortIfUpnp: false,
			ConnInstrPage:     "SystemAO/disk/instr/samba.html",
			ConfigPage:        "SystemAO/disk/samba.html",
			EnableCheck:       SambaShareManager.IsEnabled,
			ToggleFunc:        SambaShareManager.ServerToggle,
			GetEndpoints:      SambaShareManager.GetEndpoints,
		})
	}

	router.HandleFunc("/system/network/server/list", NetworkHandleGetFileServerServiceList)
	router.HandleFunc("/system/network/server/endpoints", NetworkHandleGetFileServerEndpoints)
	router.HandleFunc("/system/network/server/status", NetworkHandleGetFileServerStatus)
	adminRouter.HandleFunc("/system/network/server/toggle", NetworkHandleFileServerToggle)
}

// Toggle the target File Server Services
func NetworkHandleFileServerToggle(w http.ResponseWriter, r *http.Request) {
	servid, err := utils.PostPara(r, "id")
	if err != nil {
		utils.SendErrorResponse(w, "invalid service id given")
		return
	}

	newState, err := utils.PostPara(r, "enable")
	if err != nil {
		utils.SendErrorResponse(w, "undefined enable state")
		return
	}

	targetfserv := fileservers.GetFileServerById(networkFileServerDaemon, servid)
	if targetfserv == nil {
		utils.SendErrorResponse(w, "target service not exists")
		return
	}

	if newState == "true" {
		//Start up the target service
		err = targetfserv.ToggleFunc(true)
		if err != nil {
			utils.SendErrorResponse(w, "startup failed: "+err.Error())
			return
		}
	} else if newState == "false" {
		err = targetfserv.ToggleFunc(false)
		if err != nil {
			utils.SendErrorResponse(w, "shutdown failed: "+err.Error())
			return
		}
	} else {
		utils.SendErrorResponse(w, "unknown state keyword")
		return
	}

}

// Return a list of supported File Server Services
func NetworkHandleGetFileServerServiceList(w http.ResponseWriter, r *http.Request) {
	js, _ := json.Marshal(networkFileServerDaemon)
	utils.SendJSONResponse(w, string(js))
}

// Get the status of a file server type.
func NetworkHandleGetFileServerStatus(w http.ResponseWriter, r *http.Request) {
	servid, _ := utils.GetPara(r, "id")
	if servid == "" {
		//List all state in map
		result := map[string]bool{}
		for _, fserv := range networkFileServerDaemon {
			result[fserv.ID] = fserv.EnableCheck()
		}

		js, _ := json.Marshal(result)
		utils.SendJSONResponse(w, string(js))
	} else {
		//ID is defined. Get the target server and return its status
		targetfserv := fileservers.GetFileServerById(networkFileServerDaemon, servid)
		if targetfserv == nil {
			utils.SendErrorResponse(w, "target file server type not found")
			return
		}

		js, _ := json.Marshal(targetfserv.EnableCheck())
		utils.SendJSONResponse(w, string(js))
	}
}

// Get a list of endpoint usable by this service
func NetworkHandleGetFileServerEndpoints(w http.ResponseWriter, r *http.Request) {
	userinfo, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "user not logged in")
		return
	}

	targetServerTypeID, _ := utils.GetPara(r, "fserv")
	targetServerTypeID = strings.TrimSpace(targetServerTypeID)

	if targetServerTypeID == "" {
		//List all the endpoints
		results := map[string][]*fileservers.Endpoint{}
		for _, fser := range networkFileServerDaemon {
			if fser.GetEndpoints == nil {
				results[fser.ID] = []*fileservers.Endpoint{}
				continue
			}
			thisEndpoints := fser.GetEndpoints(userinfo)
			results[fser.ID] = thisEndpoints
		}

		js, _ := json.Marshal(results)
		utils.SendJSONResponse(w, string(js))
	} else {
		//List the target endpoint
		for _, fser := range networkFileServerDaemon {
			if targetServerTypeID == fser.ID {
				thisEndpoints := fser.GetEndpoints(userinfo)
				js, _ := json.Marshal(thisEndpoints)
				utils.SendJSONResponse(w, string(js))
				return
			}
		}

		utils.SendErrorResponse(w, "target service not found")
	}

}
