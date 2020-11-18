package main

import (
	"encoding/json"
	"log"
	"net/http"

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
			sendErrorResponse(w, "Permission Denied")
		},
	})

	//Register endpoints
	router.HandleFunc("/system/network/scanWifi", network_wifi_handleScan)
	router.HandleFunc("/system/network/connectWifi", network_wifi_handleConnect)
	router.HandleFunc("/system/network/removeWifi", network_wifi_handleWiFiRemove)
	router.HandleFunc("/system/network/wifiinfo", network_wifi_handleWiFiInfo)

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

func network_wifi_handleScan(w http.ResponseWriter, r *http.Request) {
	//Require admin permission to scan and connect wifi
	user, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "Internal Server Error")
		return
	}

	if !user.IsAdmin() {
		sendErrorResponse(w, "Permission Denied")
		return
	}

	//Get a list of current on system wireless interface
	wirelessInterfaces, err := wifiManager.GetWirelessInterfaces()
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	if len(wirelessInterfaces) == 0 {
		//No wireless interface
		sendErrorResponse(w, "Wireless Interface Not Found")
		return
	}

	//Get the first ethernet interface and use it to scan nearby wifi
	scannedWiFiInfo, err := wifiManager.ScanNearbyWiFi(wirelessInterfaces[0])
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}
	jsonString, _ := json.Marshal(scannedWiFiInfo)
	sendJSONResponse(w, string(jsonString))
}

func network_wifi_handleConnect(w http.ResponseWriter, r *http.Request) {
	user, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "Internal Server Error")
		return
	}
	//Get information from client and create a new network config file
	if !user.IsAdmin() {
		sendErrorResponse(w, "Permission denied")
		return
	}

	ssid, err := mv(r, "ESSID", true)
	if err != nil {
		sendErrorResponse(w, "ESSID not given")
		return
	}
	connType, _ := mv(r, "ConnType", true)
	password, _ := mv(r, "pwd", true)
	log.Println("WiFi Switch Request Received. Genering Network Configuration...")

	identity, err := mv(r, "identity", true)
	if err != nil {
		identity = ""
	}

	result, err := wifiManager.ConnectWiFi(ssid, password, connType, identity)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}
	jsonString, err := json.Marshal(result)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}
	sendJSONResponse(w, string(jsonString))

	log.Println("WiFi Connected")

}

func network_wifi_handleWiFiRemove(w http.ResponseWriter, r *http.Request) {
	//Require admin permission to scan and connect wifi
	user, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		sendErrorResponse(w, "Internal Server Error")
		return
	}

	if !user.IsAdmin() {
		sendErrorResponse(w, "Permission Denied")
		return
	}

	//Get ESSID from post request
	ESSID, err := mv(r, "ESSID", true)
	if err != nil {
		sendErrorResponse(w, "ESSID not given")
		return
	}

	err = wifiManager.RemoveWifi(ESSID)
	if err != nil {
		sendErrorResponse(w, err.Error())
	}
	sendOK(w)
}

func network_wifi_handleWiFiInfo(w http.ResponseWriter, r *http.Request) {
	//Get and return the current conencted WiFi Information
	_, err := authAgent.GetUserName(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	ESSID, interfaceName, err := wifiManager.GetConnectedWiFi()
	if err != nil {
		sendErrorResponse(w, "Failed to retrieve WiFi Information")
		return
	}

	jsonString, _ := json.Marshal(map[string]string{
		"ESSID":     ESSID,
		"Interface": interfaceName,
	})
	sendJSONResponse(w, string(jsonString))
}
