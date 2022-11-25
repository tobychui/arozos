package main

import (
	"net/http"
	"strconv"

	"imuslab.com/arozos/mod/common"
	network "imuslab.com/arozos/mod/network"
	mdns "imuslab.com/arozos/mod/network/mdns"
	"imuslab.com/arozos/mod/network/netstat"
	ssdp "imuslab.com/arozos/mod/network/ssdp"
	upnp "imuslab.com/arozos/mod/network/upnp"
	"imuslab.com/arozos/mod/network/websocket"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/www"
)

var (
	MDNS            *mdns.MDNSHost
	UPNP            *upnp.UPnPClient
	SSDP            *ssdp.SSDPHost
	WebSocketRouter *websocket.Router
)

func NetworkServiceInit() {
	systemWideLogger.PrintAndLog("Network", "Starting ArOZ Network Services", nil)

	//Create a router that allow users with System Setting access to access these api endpoints
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			common.SendErrorResponse(w, "Permission Denied")
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
			Desc:     "System Information",
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
			common.SendErrorResponse(w, "Permission Denied")
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
		})

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
