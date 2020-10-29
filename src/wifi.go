package main

import (
	"runtime"
	"net/http"
	"encoding/json"
	"os/exec"
	"io/ioutil"
	"errors"
	"sort"
	"time"
	"log"
	"os"
	"strings"
	"path/filepath"

	prout "imuslab.com/aroz_online/mod/prouter"
)

/*
	Network WiFi Module

	This module handle wifi connections and scanning on the devices that support wpa_supplicant like the Raspberry Pi
	Require service launch with Dbus (Work well on stock Raspberry Pi OS)
*/

type WiFiInfo struct{
	Address string
	Channel int
	Frequency string
	Quality string
	SignalLevel string
	EncryptionKey bool
	ESSID string
	ConnectedBefore bool
}

func WiFiInit(){
	//Only activate script on linux and if hardware management is enabled
	if runtime.GOOS == "linux"  && *allow_hardware_management == true{

		router := prout.NewModuleRouter(prout.RouterOption{
			ModuleName: "System Setting", 
			AdminOnly: true, 
			UserHandler: userHandler, 
			DeniedHandler: func(w http.ResponseWriter, r *http.Request){
				sendErrorResponse(w, "Permission Denied");
			},
		});

		//Register endpoints
		router.HandleFunc("/system/network/scanWifi", network_wifi_handleScan)
		router.HandleFunc("/system/network/connectWifi", network_wifi_handleConnect)
		router.HandleFunc("/system/network/removeWifi", network_wifi_handleWiFiRemove)
		router.HandleFunc("/system/network/wifiinfo", network_wifi_handleWiFiInfo)

		//Register WiFi Settings if system have WiFi interface
		wlanInterfaces, _ := network_wifi_getWirelessInterfaces()
		if len(wlanInterfaces) > 0 {
			//Contain at least 1 wireless interface Register System Settings
			registerSetting(settingModule{
				Name:         "WiFi Info",
				Desc:         "Current Connected WiFi Information",
				IconPath:     "SystemAO/network/img/WiFi.png",
				Group:        "Network",
				StartDir:     "SystemAO/network/wifiinfo.html",
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

func network_wifi_handleScan(w http.ResponseWriter, r *http.Request){
	//Require admin permission to scan and connect wifi
	user, err := userHandler.GetUserInfoFromRequest(w,r)
	if err != nil{
		sendErrorResponse(w, "Internal Server Error")
		return
	}

	if !user.IsAdmin(){
		sendErrorResponse(w, "Permission Denied")
		return
	}
	
	//Get a list of current on system wireless interface
	wirelessInterfaces, err := network_wifi_getWirelessInterfaces()
	if err != nil{
		sendErrorResponse(w, err.Error())
		return
	}

	if len(wirelessInterfaces) == 0{
		//No wireless interface
		sendErrorResponse(w, "Wireless Interface Not Found")
		return
	}

	//Get the first ethernet interface and use it to scan nearby wifi
	scannedWiFiInfo, err := network_wifi_scanNearbyWifi(wirelessInterfaces[0]);
	if err != nil{
		sendErrorResponse(w, err.Error())
		return
	}
	jsonString, _ := json.Marshal(scannedWiFiInfo)
	sendJSONResponse(w, string(jsonString))
}

//Scan all nearby WiFi 
func network_wifi_scanNearbyWifi(interfaceName string) ([]WiFiInfo, error){
	rcmd := `iwlist ` + interfaceName + ` scan`
	if sudo_mode {
		rcmd = "sudo " + rcmd
	}
	cmd := exec.Command("bash", "-c", rcmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		
		return []WiFiInfo{}, err
	}

	//parse the output of the WiFi Scan
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for i, thisline := range lines{
		lines[i] = strings.TrimSpace(thisline)
	}

	//Ignore first line if it contains "Scan completed"
	if strings.Contains(lines[0], "Scan completed"){
		lines = lines[1:]
	}

	var results = []WiFiInfo{}
	//Loop through each line and construct the WiFi Info slice
	
	processingWiFiNode := new(WiFiInfo)
	for _, line := range lines{
		if strings.Contains(line, "Address: "){
			//Push the previous results into results and create a new Node
			if processingWiFiNode.Address != ""{
				//Check if the ESSID already exists
				if (fileExists("./system/network/wifi/ap/" + processingWiFiNode.ESSID + ".config")){
					processingWiFiNode.ConnectedBefore = true
				}else{
					processingWiFiNode.ConnectedBefore = false
				}
				results = append(results, *processingWiFiNode)
				processingWiFiNode = new(WiFiInfo)
			}
			//Analysis this node
			datachunk := strings.Split(line, " ")
			if len(datachunk) > 0{
				processingWiFiNode.Address = datachunk[len(datachunk)-1]
			}
		}else if strings.Contains(line, "Channel") && strings.Contains(line, "Frequency") == false{
			datachunk := strings.Split(line, ":")
			if len(datachunk) > 0{
				channel, err := StringToInt(datachunk[len(datachunk)-1])
				if (err != nil){
					channel = -1;
				}
				processingWiFiNode.Channel = channel
				
			}
			
		}else if strings.Contains(line, "Frequency"){
			tmp := strings.Split(line, ":")
			if len(tmp) > 0{
				frequencyData := tmp[len(tmp) - 1]
				frequencyDataChunk := strings.Split(frequencyData, " ")
				if len(frequencyDataChunk) > 1{
					frequencyString := frequencyDataChunk[:2]
					processingWiFiNode.Frequency = strings.Join(frequencyString, " ")
				}
			
			}
		}else if strings.Contains(line, "Quality="){
			//Need to seperate quality data from signal level. Example source: Quality=70/70  Signal level=-40 dBm
			analysisItem := strings.Split(line, "  ")
			if (len(analysisItem) == 2){
				//Get the quality of connections
				processingWiFiNode.Quality = analysisItem[0][8:]

				//Get the signal level of the connections
				processingWiFiNode.SignalLevel = analysisItem[1][13:]
			}
			
		}else if strings.Contains(line, "Encryption key"){
			ek := strings.Split(line, ":")
			if len(ek) > 0{
				status := ek[1]
				if status == "on"{
					processingWiFiNode.EncryptionKey = true
				}else{
					processingWiFiNode.EncryptionKey = false
				}
			}
		}else if strings.Contains(line, "ESSID"){
			iddata := strings.Split(line, ":")
			if len(iddata) > 0{
				ESSID := iddata[1]
				ESSID = strings.ReplaceAll(ESSID, "\"","")
				if ESSID == ""{
					ESSID = "Hidden Network"
				}
				processingWiFiNode.ESSID = ESSID
			}
		}
	}

	return results, nil
}

func network_wifi_getWirelessInterfaces() ([]string, error){
	//Get all the network interfaces
	rcmd := `iw dev | awk '$1=="Interface"{print $2}'`
	cmd := exec.Command("bash", "-c", rcmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Println(string(out))
		return []string{}, errors.New(string(out))
	}
	interfaces := strings.Split(strings.TrimSpace(string(out)), "\n")
	sort.Strings(interfaces)
	return interfaces, nil
}

func network_wifi_handleConnect(w http.ResponseWriter, r *http.Request){
	user, err := userHandler.GetUserInfoFromRequest(w,r)
	if err != nil{
		sendErrorResponse(w, "Internal Server Error")
		return
	}
	//Get information from client and create a new network config file
    if !user.IsAdmin(){
        sendErrorResponse(w, "Permission denied")
        return
    }

	ssid, err := mv(r, "ESSID", true)
	if err != nil{
		sendErrorResponse(w, "ESSID not given")
		return
	}
	connType, _ := mv(r, "ConnType", true)
	password, _ := mv(r, "pwd", true)
	log.Println("WiFi Switch Request Received. Genering Network Configuration...")

	//Build the network config file
	//DO NOT TOUCH THE INDENTATION!! THEY MUST BE KEEP LIKE THIS
	writeToConfig := true
	networkConfigFile := ""
	if (connType == ""){
		//Home use network / WPA2
		if password == ""{
			//No need password
			networkConfigFile = `network={
	ssid="`+ ssid + `"
	key_mgmt=NONE
	priority={{priority}}
}`
		}else{
			networkConfigFile = `network={
	ssid="` + ssid + `"
	psk="` + password + `"
	priority={{priority}}
}`
		}
	}else if (connType == "WPA-EAP"){
		identity, err := mv(r, "identity", true)
		if err != nil{
			sendErrorResponse(w, "Identity not defined")
			return
		}
		networkConfigFile = `network={
	ssid="` + ssid + `"
	key_mgmt=WPA-EAP
	identity="` + identity + `"
	password="` + password + `"
}`;
	}else if (connType == "switch"){
		//Special case, for handling WiFi Switching without retyping the password
		writeToConfig = false
	}else{
		sendErrorResponse(w, "Unsupported Connection Type")
		return
	}
	
	//Generate new wpa_supplicant_conf from file
	if !fileExists("./system/network/wifi/ap"){
		os.MkdirAll("./system/network/wifi/ap", 0755)
	}

	if writeToConfig == true{
		log.Println("WiFi Config Generated. Writing to file...")
		//Write config file to disk
		err = ioutil.WriteFile("./system/network/wifi/ap/" + ssid + ".config", []byte(networkConfigFile), 0755)
		if err != nil{
			sendErrorResponse(w, err.Error())
			return
		}
	}else{
		log.Println("Switching WiFi AP...")
	}

	//Start creating the new wpa_supplicant file
	//Get header
	configHeader, err := ioutil.ReadFile("./system/network/wifi/wpa_supplicant.conf_template.config")
	if err != nil{
		//Template header not found. Use default one from Raspberry Pi
		log.Println("Warning! wpa_supplicant template file not found. Using default template.")
		configHeader = []byte(`ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
		update_config=1
		{{networks}}
		`);
	}

	//Build network informations
	networksConfigs, err := filepath.Glob("./system/network/wifi/ap/*.config")
	if err != nil{
		sendErrorResponse(w, err.Error())
		return
	}

	//Read each of the network and append it into a string slice
	networks := []string{}

	for _, configFile := range networksConfigs{
		thisNetworkConfig, err := ioutil.ReadFile(configFile)
		if err != nil{
			log.Println("Failed to read Network Config File: " + configFile)
			continue;
		}

		if (strings.TrimSuffix(filepath.Base(configFile), filepath.Ext(configFile)) == ssid){
			//The new SSID. Set this to higher priority
			networks = append(networks, template_apply(string(thisNetworkConfig),map[string]interface{}{
				"priority": IntToString(1),
			}))
		}else{
			//Old SSID. Use default priority
			networks = append(networks, template_apply(string(thisNetworkConfig),map[string]interface{}{
				"priority": IntToString(0),
			}))
		}
	
	}

	//Subsitute the results into the template
	networksConfigString := strings.Join(networks, "\n")
	newconfig := template_apply(string(configHeader), map[string]interface{}{
		"networks": networksConfigString,
	})

	//Try to write the new config to wpa_supplicant
	err = ioutil.WriteFile(*wpa_supplicant_path, []byte(newconfig), 0777)
	if err != nil{
		log.Println("Failed to update wpa_supplicant config, are you sure you have access permission to that file?")
		sendErrorResponse(w, err.Error())
	}

	log.Println("WiFi Config Updated. Restarting Wireless Interfaces...")

	//Restart network services
	cmd := exec.Command("wpa_cli", "-i", *wan_interface_name, "reconfigure")
	out, err := cmd.CombinedOutput()
	if err != nil {
		sendErrorResponse(w,string(out))
		return
	}

	log.Println("Trying to connect new AP")
	//Wait until the WiFi is conencted
	rescanCount := 0
	connectedSSID, _, _:= network_wifi_getConnectedWiFi()
	//Wait for 30 seconds
	for rescanCount < 10 && connectedSSID == ""{
		connectedSSID, _, _ = network_wifi_getConnectedWiFi()
		log.Println(connectedSSID)
		rescanCount = rescanCount + 1
		log.Println("Waiting WiFi Connection (Retry " + IntToString(rescanCount) + "/10)")
		time.Sleep(3 * time.Second)
	}

	type conenctionResult struct{
		ConnectedSSID string
		Success bool
	}

	result := new(conenctionResult)
	if (rescanCount) >= 10{
		result.Success = false
	}else{
		result.ConnectedSSID = connectedSSID
		result.Success = true
	}

	jsonString, err := json.Marshal(result)
	if err != nil{
		sendErrorResponse(w, err.Error())
		return
	}
	sendJSONResponse(w, string(jsonString))
	
	log.Println("WiFi Connected")

	//Restart network services
	RestartNetworkServices();
}

//Get the current connected WiFi SSID and interface
func network_wifi_getConnectedWiFi()(string, string, error){
	cmd := exec.Command("iwgetid")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return "","",errors.New(string(out))
	}
	if len(string(out)) == 0{
		return "","",nil
	}

	//Try to parse the data
	trimmedData := string(out)
	for strings.Contains(trimmedData, "  "){
		trimmedData = strings.ReplaceAll(trimmedData, "  "," ")
	}

	dc := strings.Split(trimmedData, " ")
	wlanInterface := dc[0]
	

	ESSID := strings.Join(dc[1:]," ")[7:]
	ESSID = strings.TrimSpace(ESSID)
	ESSID = ESSID[:len(ESSID) - 1]
	if strings.TrimSpace(ESSID) == "\""{
		ESSID = ""
	}
	return ESSID, wlanInterface, nil
}

func network_wifi_handleWiFiRemove(w http.ResponseWriter, r *http.Request){
	//Require admin permission to scan and connect wifi
	user, err := userHandler.GetUserInfoFromRequest(w,r)
	if err != nil{
		sendErrorResponse(w, "Internal Server Error")
		return
	}

	if !user.IsAdmin(){
		sendErrorResponse(w, "Permission Denied")
		return
	}

	//Get ESSID from post request
	ESSID, err := mv(r, "ESSID", true)
	if err != nil{
		sendErrorResponse(w, "ESSID not given")
		return
	}

	//Check if the ESSID entry exists
	//Check the path for safty
	if !system_fs_checkFileInDirectory("./system/network/wifi/ap/" + ESSID + ".config", "./system/network/wifi/ap/"){
		sendErrorResponse(w, "Invalid ESSID")
		return
	}

	if fileExists("./system/network/wifi/ap/" + ESSID + ".config"){
		os.Remove("./system/network/wifi/ap/" + ESSID + ".config")
	}else{
		sendErrorResponse(w, "Record not found")
		return
	}

	sendOK(w)
}

func network_wifi_handleWiFiInfo(w http.ResponseWriter, r *http.Request){
	//Get and return the current conencted WiFi Information
	_, err := authAgent.GetUserName(w, r)
	if err != nil {
		sendErrorResponse(w, "User not logged in")
		return
	}

	ESSID, interfaceName, err := network_wifi_getConnectedWiFi()
	if err != nil{
		sendErrorResponse(w, "Failed to retrieve WiFi Information");
		return
	}

	jsonString, _ := json.Marshal(map[string]string{
		"ESSID" : ESSID,
		"Interface": interfaceName,
	})
	sendJSONResponse(w, string(jsonString))
}
