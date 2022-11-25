package main

import (
	"encoding/json"
	"net/http"
	"strings"

	"imuslab.com/arozos/mod/common"
	wifi "imuslab.com/arozos/mod/network/wifi"
	prout "imuslab.com/arozos/mod/prouter"
)

/*
	Network WiFi Module

	This module handle wifi connections and scanning on the devices that support wpa_supplicant like the Raspberry Pi
	Require service launch with Dbus (Work well on stock Raspberry Pi OS)
*/

var (
	wifiManager *wifi.WiFiManager
)

func WiFiInit() {
	//Start the Wifi Manager
	wifiManager = wifi.NewWiFiManager(sysdb, sudo_mode, *wpa_supplicant_path, *wan_interface_name)

	//Only activate script on linux and if hardware management is enabled
	router := prout.NewModuleRouter(prout.RouterOption{
		ModuleName:  "System Setting",
		AdminOnly:   true,
		UserHandler: userHandler,
		DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
			common.SendErrorResponse(w, "Permission Denied")
		},
	})

	//Allow hardware management. Generate the endpoint for WiFi Control
	if *allow_hardware_management {

		//Register endpoints
		router.HandleFunc("/system/network/scanWifi", network_wifi_handleScan)
		router.HandleFunc("/system/network/connectWifi", network_wifi_handleConnect)
		router.HandleFunc("/system/network/removeWifi", network_wifi_handleWiFiRemove)
		router.HandleFunc("/system/network/wifiinfo", network_wifi_handleWiFiInfo)

		//Sudo mode only for wifi toggle
		if sudo_mode {
			router.HandleFunc("/system/network/power", network_wifi_handleWiFiPower)
		}

		//Register WiFi Settings if system have WiFi interface
		wlanInterfaces, _ := wifiManager.GetWirelessInterfaces()
		if len(wlanInterfaces) > 0 {
			//Contain at least 1 wireless interface Register System Settings
			registerSetting(settingModule{
				Name:     "WiFi Info",
				Desc:     "Current Connected WiFi Information",
				IconPath: "SystemAO/network/img/WiFi.png",
				Group:    "Network",
				StartDir: "SystemAO/network/wifiinfo.html",
			})
			registerSetting(settingModule{
				Name:         "WiFi Settings",
				Desc:         "Setup WiFi Conenctions",
				IconPath:     "SystemAO/network/img/WiFi.png",
				Group:        "Network",
				StartDir:     "SystemAO/network/wifi.html",
				RequireAdmin: true,
			})
		}
	}

}

func network_wifi_handleWiFiPower(w http.ResponseWriter, r *http.Request) {
	//Require admin permission to scan and connect wifi
	user, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "Internal Server Error")
		return
	}

	if !user.IsAdmin() {
		common.SendErrorResponse(w, "Permission Denied")
		return
	}

	status, _ := common.Mv(r, "status", true)
	if status == "" {
		//Show current power status
		infs, err := wifiManager.GetWirelessInterfaces()
		if err != nil {
			common.SendErrorResponse(w, err.Error())
			return
		}

		type WlanInterfaceStatus struct {
			Name    string
			Running bool
		}

		results := []WlanInterfaceStatus{}
		for _, inf := range infs {
			status, _ := wifiManager.GetInterfacePowerStatuts(strings.TrimSpace(inf))
			results = append(results, WlanInterfaceStatus{
				Name:    inf,
				Running: status,
			})
		}

		js, _ := json.Marshal(results)
		common.SendJSONResponse(w, string(js))

	} else {
		//Change current power status
		wlaninterface, err := common.Mv(r, "interface", true)
		if err != nil {
			common.SendErrorResponse(w, "Invalid interface")
			return
		}

		if status == "on" {
			err := wifiManager.SetInterfacePower(wlaninterface, true)
			if err != nil {
				common.SendErrorResponse(w, err.Error())
			} else {
				common.SendOK(w)
			}
		} else if status == "off" {
			err := wifiManager.SetInterfacePower(wlaninterface, false)
			if err != nil {
				common.SendErrorResponse(w, err.Error())
			} else {
				common.SendOK(w)
			}
		} else {
			common.SendErrorResponse(w, "Invalid status")
		}
	}

}

func network_wifi_handleScan(w http.ResponseWriter, r *http.Request) {
	//Require admin permission to scan and connect wifi
	user, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "Internal Server Error")
		return
	}

	if !user.IsAdmin() {
		common.SendErrorResponse(w, "Permission Denied")
		return
	}

	//Get a list of current on system wireless interface
	wirelessInterfaces, err := wifiManager.GetWirelessInterfaces()
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	if len(wirelessInterfaces) == 0 {
		//No wireless interface
		common.SendErrorResponse(w, "Wireless Interface Not Found")
		return
	}

	//Get the first ethernet interface and use it to scan nearby wifi
	scannedWiFiInfo, err := wifiManager.ScanNearbyWiFi(wirelessInterfaces[0])
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	jsonString, _ := json.Marshal(scannedWiFiInfo)
	common.SendJSONResponse(w, string(jsonString))
}

func network_wifi_handleConnect(w http.ResponseWriter, r *http.Request) {
	user, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "Internal Server Error")
		return
	}
	//Get information from client and create a new network config file
	if !user.IsAdmin() {
		common.SendErrorResponse(w, "Permission denied")
		return
	}

	ssid, err := common.Mv(r, "ESSID", true)
	if err != nil {
		common.SendErrorResponse(w, "ESSID not given")
		return
	}
	connType, _ := common.Mv(r, "ConnType", true)
	password, _ := common.Mv(r, "pwd", true)
	systemWideLogger.PrintAndLog("WiFi", "WiFi Switch Request Received. Genering Network Configuration...", nil)

	identity, err := common.Mv(r, "identity", true)
	if err != nil {
		identity = ""
	}

	result, err := wifiManager.ConnectWiFi(ssid, password, connType, identity)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	jsonString, err := json.Marshal(result)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	common.SendJSONResponse(w, string(jsonString))

	systemWideLogger.PrintAndLog("WiFi", "WiFi Connected", nil)

}

func network_wifi_handleWiFiRemove(w http.ResponseWriter, r *http.Request) {
	//Require admin permission to scan and connect wifi
	user, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		common.SendErrorResponse(w, "Internal Server Error")
		return
	}

	if !user.IsAdmin() {
		common.SendErrorResponse(w, "Permission Denied")
		return
	}

	//Get ESSID from post request
	ESSID, err := common.Mv(r, "ESSID", true)
	if err != nil {
		common.SendErrorResponse(w, "ESSID not given")
		return
	}

	err = wifiManager.RemoveWifi(ESSID)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
	}
	common.SendOK(w)
}

func network_wifi_handleWiFiInfo(w http.ResponseWriter, r *http.Request) {
	//Get and return the current conencted WiFi Information
	_, err := authAgent.GetUserName(w, r)
	if err != nil {
		common.SendErrorResponse(w, "User not logged in")
		return
	}

	ESSID, interfaceName, err := wifiManager.GetConnectedWiFi()
	if err != nil {
		common.SendErrorResponse(w, "Failed to retrieve WiFi Information")
		return
	}

	jsonString, _ := json.Marshal(map[string]string{
		"ESSID":     ESSID,
		"Interface": interfaceName,
	})
	common.SendJSONResponse(w, string(jsonString))
}
