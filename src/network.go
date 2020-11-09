package main

import (
	"log"
	"net/http"
	"strconv"

	network "imuslab.com/aroz_online/mod/network"
	mdns "imuslab.com/aroz_online/mod/network/mdns"
	ssdp "imuslab.com/aroz_online/mod/network/ssdp"
	upnp "imuslab.com/aroz_online/mod/network/upnp"
	prout "imuslab.com/aroz_online/mod/prouter"
)

var (
	MDNS *mdns.MDNSHost
	UPNP *upnp.UPnPClient
	SSDP *ssdp.SSDPHost
)

func NetworkServiceInit() {
	log.Println("Starting ArOZ Network Services")

	//Create a router that allow users with System Setting access to access these api endpoints
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   false,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			sendErrorResponse(w, "Permission Denied")
		},
	})

	/*
		Standard Network Utilties
	*/

	//Register handler endpoints
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

	/*
		registerSetting(settingModule{
			Name:     "Ping test",
			Desc:     "System Information",
			IconPath: "SystemAO/network/img/ethernet.png",
			Group:    "Network",
			StartDir: "SystemAO/network/ping.html",
		})
	*/

	//Start the services that depends on network interface
	StartNetworkServices()
}

func StartNetworkServices() {

	/*
		MDNS Services
	*/
	if *allow_mdns {
		m, err := mdns.NewMDNS(mdns.NetworkHost{
			HostName:     *host_name + "_" + deviceUUID, //To handle more than one identical model within the same network, this must be unique
			Port:         *listen_port,
			Domain:       "aroz.online",
			Model:        deviceModel,
			UUID:         deviceUUID,
			Vendor:       deviceVendor,
			BuildVersion: build_version,
			MinorVersion: internal_version,
		})

		if err != nil {
			log.Println("MDNS Startup Failed: " + err.Error() + ". Running in Offline Mode.")
		} else {
			MDNS = m

			//Testing function to show nearby Arozs
			go func(MDNS *mdns.MDNSHost) {
				nearbyAroz := MDNS.Scan(5)
				log.Println(nearbyAroz)
			}(MDNS)
		}

	}

	/*
		SSDP Discovery Services
	*/
	if *allow_ssdp {
		//Get outbound ip
		obip, err := network.GetOutboundIP()
		if err != nil {
			log.Println("SSDP Startup Failed: " + err.Error() + ". Running in Offline Mode.")
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
				log.Println("SSDP Startup Failed: " + err.Error() + ". Running in Offline Mode.")
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
		u, err := upnp.NewUPNPClient(*listen_port, *host_name)
		if err != nil {
			log.Println("UPnP Startup Failed: " + err.Error())
		} else {
			UPNP = u

			//Show a tip for success port forward
			connectionEndpoint := UPNP.ExternalIP + ":" + strconv.Itoa(*listen_port)
			obip, err := network.GetOutboundIP()
			obipstring := "[Outbound IP]"
			if err != nil {

			} else {
				obipstring = obip.String()
			}

			localEndpoint := obipstring + ":" + strconv.Itoa(*listen_port)
			log.Println("Automatic Port Forwarding Completed. Forwarding all request from " + connectionEndpoint + " to " + localEndpoint)

		}

	}
}

func StopNetworkServices() {
	log.Println("Restarting Network Services...")
	//Shutdown uPNP service if enabled
	if *allow_upnp {
		log.Println("\r- Shutting down uPNP service")
		UPNP.Close()
	}

	//Shutdown SSDP service if enabled
	if *allow_ssdp {
		log.Println("\r- Shutting down SSDP service")
		SSDP.Close()
	}

	//Shutdown MDNS if enabled
	if *allow_mdns {
		log.Println("\r- Shutting down MDNS service")
		MDNS.Close()
	}
}
