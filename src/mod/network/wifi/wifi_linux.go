// +build linux

package wifi

import (
	"errors"
	"io/ioutil"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/valyala/fasttemplate"
)

//Toggle WiFi On Off. Only allow on sudo mode
func (w *WiFiManager) SetInterfacePower(wlanInterface string, on bool) error {
	status := "up"
	if on == false {
		status = "down"
	}
	cmd := exec.Command("ifconfig", wlanInterface, status)
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Println("*WiFi* WiFi toggle failed: ", string(out))
		return err
	}

	//OK
	return nil
}

func (w *WiFiManager) GetInterfacePowerStatuts(wlanInterface string) (bool, error) {
	//Check if interface is in list
	interfaceList, err := w.GetWirelessInterfaces()
	if err != nil {
		return false, err
	}
	interfaceExists := false
	for _, localInterface := range interfaceList {
		if localInterface == wlanInterface {
			interfaceExists = true
		}
	}

	if !interfaceExists {
		return false, errors.New("wlan Interface not exists")
	}

	//Check if the interface appears in ifconfig. If yes, this interface is online
	cmd := exec.Command("bash", "-c", "ifconfig | grep "+wlanInterface)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return false, errors.New(string(out))
	}

	if strings.TrimSpace(string(out)) != "" {
		//Interface exists in ifconfig. Report it as powered on
		return true, nil
	} else {
		return false, nil
	}

}

//Scan Nearby WiFi
func (w *WiFiManager) ScanNearbyWiFi(interfaceName string) ([]WiFiInfo, error) {
	rcmd := `iwlist ` + interfaceName + ` scan`
	if w.sudo_mode {
		rcmd = "sudo " + rcmd
	}
	cmd := exec.Command("bash", "-c", rcmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		//Scan failed, the following code is used to handle edge case on some SBC that only nmcli works but not iwlist
		/*
			If the interface is not supported, something like this will show up:

			wlan0     Interface doesn't support scanning.
		*/
		if strings.Contains(string(out), "Interface doesn't support scanning") {
			//Try nmcli instead if exists
			if pkg_exists("nmcli") {
				log.Println("*WiFi* Running WiFi scan in nmcli compatibility mode")
				cmd := exec.Command("bash", "-c", "nmcli d wifi list")
				out, err := cmd.CombinedOutput()
				if err != nil {
					return []WiFiInfo{}, err
				}

				//Parse the nmcli output
				lines := strings.Split(string(out), "\n")
				if len(lines) > 1 {
					//Remove the header
					lines = lines[1:]
				}

				results := []WiFiInfo{}
				//Prase the wifi information
				for _, line := range lines {
					//Replace all double space as split sign
					line = strings.TrimSpace(line)
					for strings.Contains(line, "  ") {
						line = strings.ReplaceAll(line, "  ", "$")
					}

					for strings.Contains(line, "$$") {
						line = strings.ReplaceAll(line, "$$", "$")
					}

					//Process the wifi info chunk
					wifiInfoSlice := strings.Split(line, "$")

					thisWifiInfo := new(WiFiInfo)
					if len(wifiInfoSlice) == 7 {
						//This is a valid entry

						thisWifiInfo.ESSID = strings.TrimSpace(wifiInfoSlice[0])
						thisWifiInfo.Quality = wifiInfoSlice[4] + "/100"
						thisWifiInfo.Frequency = wifiInfoSlice[3]
						channel, _ := strconv.Atoi(wifiInfoSlice[2])
						thisWifiInfo.Channel = channel
						thisWifiInfo.SignalLevel = w.getSignalLevelEstimation(wifiInfoSlice[5])
						//Check connect before
						if w.database.KeyExists("wifi", thisWifiInfo.ESSID) {
							thisWifiInfo.ConnectedBefore = true
						} else {
							thisWifiInfo.ConnectedBefore = false
						}

					} else if len(wifiInfoSlice) == 8 {
						//Entry with inuse * at front
						thisWifiInfo.ESSID = strings.TrimSpace(wifiInfoSlice[1])
						thisWifiInfo.Quality = wifiInfoSlice[5] + "/100"
						thisWifiInfo.Frequency = wifiInfoSlice[4]
						channel, _ := strconv.Atoi(wifiInfoSlice[2])
						thisWifiInfo.Channel = channel
						thisWifiInfo.SignalLevel = w.getSignalLevelEstimation(wifiInfoSlice[6])
						thisWifiInfo.ConnectedBefore = true //It is connected
					} else {
						//Line not valid. Skip this line
						continue
					}

					results = append(results, *thisWifiInfo)
				}

				return results, nil
			} else {
				log.Println("*WiFi* Scan Failed: ", err.Error())
				return []WiFiInfo{}, errors.New("Interface doesn't support scanning")
			}
		}
		return []WiFiInfo{}, err
	}

	//parse the output of the WiFi Scan
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	for i, thisline := range lines {
		lines[i] = strings.TrimSpace(thisline)
	}

	//Ignore first line if it contains "Scan completed"
	if strings.Contains(lines[0], "Scan completed") {
		lines = lines[1:]
	}

	var results = []WiFiInfo{}
	//Loop through each line and construct the WiFi Info slice

	processingWiFiNode := new(WiFiInfo)
	for _, line := range lines {
		if strings.Contains(line, "Address: ") {
			//Push the previous results into results and create a new Node
			if processingWiFiNode.Address != "" {
				//Check if the ESSID already exists
				if pkg_exists("nmcli") {
					//Make use of nmcli storage
					if w.database.KeyExists("wifi", processingWiFiNode.ESSID) {
						processingWiFiNode.ConnectedBefore = true
					} else {
						processingWiFiNode.ConnectedBefore = false
					}
				} else {
					//Direct access to wpa_supplicant
					if fileExists("./system/network/wifi/ap/" + processingWiFiNode.ESSID + ".config") {
						processingWiFiNode.ConnectedBefore = true
					} else {
						processingWiFiNode.ConnectedBefore = false
					}

				}
				results = append(results, *processingWiFiNode)
				processingWiFiNode = new(WiFiInfo)
			}
			//Analysis this node
			datachunk := strings.Split(line, " ")
			if len(datachunk) > 0 {
				processingWiFiNode.Address = datachunk[len(datachunk)-1]
			}
		} else if strings.Contains(line, "Channel") && strings.Contains(line, "Frequency") == false {
			datachunk := strings.Split(line, ":")
			if len(datachunk) > 0 {
				channel, err := strconv.Atoi(datachunk[len(datachunk)-1])
				if err != nil {
					channel = -1
				}
				processingWiFiNode.Channel = channel

			}

		} else if strings.Contains(line, "Frequency") {
			tmp := strings.Split(line, ":")
			if len(tmp) > 0 {
				frequencyData := tmp[len(tmp)-1]
				frequencyDataChunk := strings.Split(frequencyData, " ")
				if len(frequencyDataChunk) > 1 {
					frequencyString := frequencyDataChunk[:2]
					processingWiFiNode.Frequency = strings.Join(frequencyString, " ")
				}

			}
		} else if strings.Contains(line, "Quality=") {
			//Need to seperate quality data from signal level. Example source: Quality=70/70  Signal level=-40 dBm
			analysisItem := strings.Split(line, "  ")
			if len(analysisItem) == 2 {
				//Get the quality of connections
				processingWiFiNode.Quality = analysisItem[0][8:]

				//Get the signal level of the connections
				processingWiFiNode.SignalLevel = analysisItem[1][13:]
			}

		} else if strings.Contains(line, "Encryption key") {
			ek := strings.Split(line, ":")
			if len(ek) > 0 {
				status := ek[1]
				if status == "on" {
					processingWiFiNode.EncryptionKey = true
				} else {
					processingWiFiNode.EncryptionKey = false
				}
			}
		} else if strings.Contains(line, "ESSID") {
			iddata := strings.Split(line, ":")
			if len(iddata) > 0 {
				ESSID := iddata[1]
				ESSID = strings.ReplaceAll(ESSID, "\"", "")
				if ESSID == "" {
					ESSID = "Hidden Network"
				}
				processingWiFiNode.ESSID = ESSID
			}
		}
	}

	return results, nil
}

//Hack the signal level out of the nmcli bars
func (w *WiFiManager) getSignalLevelEstimation(bar string) string {
	bar = strings.TrimSpace(bar)
	if bar == "▂▄▆█" {
		return "-45 dBm[Estimated]"
	} else if bar == "▂▄▆_" {
		return "-55 dBm[Estimated]"
	} else if bar == "▂▄__" {
		return "-75 dBm[Estimated]"
	} else if bar == "▂___" {
		return "-85 dBm[Estimated]"
	} else {
		return "-95 dBm[Estimated]"
	}
}

//Get all the network interfaces
func (w *WiFiManager) GetWirelessInterfaces() ([]string, error) {
	rcmd := `iw dev | awk '$1=="Interface"{print $2}'`
	cmd := exec.Command("bash", "-c", rcmd)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return []string{}, errors.New(string(out))
	}
	interfaces := strings.Split(strings.TrimSpace(string(out)), "\n")
	//sort.Strings(interfaces)
	sort.Sort(sort.StringSlice(interfaces))
	return interfaces, nil

}

func (w *WiFiManager) ConnectWiFi(ssid string, password string, connType string, identity string) (*WiFiConnectionResult, error) {
	//Build the network config file

	//Updates 21-10-2020, use nmcli if exists
	if pkg_exists("nmcli") {
		oldSSID, _, _ := w.GetConnectedWiFi()
		if ssid != "" {
			//There is an existing connection to another wifi AP. Disconnect it
			cmd := exec.Command("nmcli", "con", "down", oldSSID)
			out, err := cmd.CombinedOutput()
			if err != nil {
				log.Println("*WiFi* Disconencting previous SSID failed: " + string(out))
				log.Println("*WiFi* Trying to connect new AP anyway")
			}
		}

		if connType == "switch" {
			//Load ssid and password from database
			w.database.Write("wifi", ssid, &password)
		}

		//Try to connect the new AP
		cmd := exec.Command("nmcli", "device", "wifi", "connect", ssid, "password", password)
		out, err := cmd.CombinedOutput()
		if err != nil {
			log.Println("*WiFi* Conencting to SSID " + ssid + " failed: " + string(out))
			return &WiFiConnectionResult{Success: false}, errors.New(string(out))
		}

		if connType != "switch" {
			//Save the ssid and password to database
			w.database.Write("wifi", ssid, password)
		}

		log.Println(string(out))
		//Check and return the current connection ssid
		//Wait until the WiFi is conencted
		rescanCount := 0
		connectedSSID, _, _ := w.GetConnectedWiFi()
		//Wait for 30 seconds
		for rescanCount < 10 && connectedSSID == "" {
			connectedSSID, _, _ = w.GetConnectedWiFi()
			log.Println(connectedSSID)
			rescanCount = rescanCount + 1
			log.Println("*WiFi* Waiting WiFi Connection (Retry " + strconv.Itoa(rescanCount) + "/10)")
			time.Sleep(3 * time.Second)
		}

		return &WiFiConnectionResult{
			ConnectedSSID: connectedSSID,
			Success:       true,
		}, nil
	}
	//DO NOT TOUCH THE INDENTATION!! THEY MUST BE KEEP LIKE THIS
	writeToConfig := true
	networkConfigFile := ""
	if connType == "" {
		//Home use network / WPA2
		if password == "" {
			//No need password
			networkConfigFile = `network={
	ssid="` + ssid + `"
	key_mgmt=NONE
	priority={{priority}}
}`
		} else {
			networkConfigFile = `network={
	ssid="` + ssid + `"
	psk="` + password + `"
	priority={{priority}}
}`
		}
	} else if connType == "WPA-EAP" {
		if identity == "" {
			return &WiFiConnectionResult{Success: false}, errors.New("Identify not defined")
		}
		networkConfigFile = `network={
	ssid="` + ssid + `"
	key_mgmt=WPA-EAP
	identity="` + identity + `"
	password="` + password + `"
}`
	} else if connType == "switch" {
		//Special case, for handling WiFi Switching without retyping the password
		writeToConfig = false
	} else {
		log.Println("*WiFi* Unsupported connection type")
		return &WiFiConnectionResult{Success: false}, errors.New("Unsupported Connection Type")
	}

	//Generate new wpa_supplicant_conf from file
	if !fileExists("./system/network/wifi/ap") {
		os.MkdirAll("./system/network/wifi/ap", 0755)
	}

	if writeToConfig == true {
		log.Println("*WiFi* WiFi Config Generated. Writing to file...")
		//Write config file to disk
		err := ioutil.WriteFile("./system/network/wifi/ap/"+ssid+".config", []byte(networkConfigFile), 0755)
		if err != nil {
			log.Println(err.Error())
			return &WiFiConnectionResult{Success: false}, err
		}
	} else {
		log.Println("*WiFi* Switching WiFi AP...")
	}

	//Start creating the new wpa_supplicant file
	//Get header
	configHeader, err := ioutil.ReadFile("./system/network/wifi/wpa_supplicant.conf_template.config")
	if err != nil {
		//Template header not found. Use default one from Raspberry Pi
		log.Println("*WiFi* Warning! wpa_supplicant template file not found. Using default template.")
		configHeader = []byte(`ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
		update_config=1
		{{networks}}
		`)
	}

	//Build network informations
	networksConfigs, err := filepath.Glob("./system/network/wifi/ap/*.config")
	if err != nil {
		log.Println(err.Error())
		return &WiFiConnectionResult{Success: false}, err
	}

	//Read each of the network and append it into a string slice
	networks := []string{}

	for _, configFile := range networksConfigs {
		thisNetworkConfig, err := ioutil.ReadFile(configFile)
		if err != nil {
			log.Println("*WiFi* Failed to read Network Config File: " + configFile)
			continue
		}

		if strings.TrimSuffix(filepath.Base(configFile), filepath.Ext(configFile)) == ssid {
			//The new SSID. Set this to higher priority
			networks = append(networks, template_apply(string(thisNetworkConfig), map[string]interface{}{
				"priority": strconv.Itoa(1),
			}))
		} else {
			//Old SSID. Use default priority
			networks = append(networks, template_apply(string(thisNetworkConfig), map[string]interface{}{
				"priority": strconv.Itoa(0),
			}))
		}

	}

	//Subsitute the results into the template
	networksConfigString := strings.Join(networks, "\n")
	newconfig := template_apply(string(configHeader), map[string]interface{}{
		"networks": networksConfigString,
	})

	//Try to write the new config to wpa_supplicant
	err = ioutil.WriteFile(w.wpa_supplicant_path, []byte(newconfig), 0777)
	if err != nil {
		log.Println("*WiFi* Failed to update wpa_supplicant config, are you sure you have access permission to that file?")
		return &WiFiConnectionResult{Success: false}, err
	}

	log.Println("*WiFi* WiFi Config Updated. Restarting Wireless Interfaces...")

	//Restart network services
	cmd := exec.Command("wpa_cli", "-i", w.wan_interface_name, "reconfigure")
	out, err := cmd.CombinedOutput()
	if err != nil {
		log.Println("failed to restart network: " + string(out))
		return &WiFiConnectionResult{Success: false}, err
	}

	log.Println("*WiFi* Trying to connect new AP")
	//Wait until the WiFi is conencted
	rescanCount := 0
	connectedSSID, _, _ := w.GetConnectedWiFi()
	//Wait for 30 seconds
	for rescanCount < 10 && connectedSSID == "" {
		connectedSSID, _, _ = w.GetConnectedWiFi()
		log.Println(connectedSSID)
		rescanCount = rescanCount + 1
		log.Println("*WiFi* Waiting WiFi Connection (Retry " + strconv.Itoa(rescanCount) + "/10)")
		time.Sleep(3 * time.Second)
	}

	result := new(WiFiConnectionResult)
	if (rescanCount) >= 10 {
		result.Success = false
	} else {
		result.ConnectedSSID = connectedSSID
		result.Success = true
	}

	return result, nil

}

//Get the current connected wifi, return ESSID, wifi interface name and error if any
//Return ESSID, interface and error
func (w *WiFiManager) GetConnectedWiFi() (string, string, error) {
	cmd := exec.Command("iwgetid")
	out, err := cmd.CombinedOutput()
	if err != nil {
		//Check nmcli working or not
		if pkg_exists("nmcli") {
			//Try nmcli method instead
			cmd := exec.Command("nmcli", "-t", "-f", "NAME,DEVICE", "connection", "show", "--active")
			out, err := cmd.CombinedOutput()
			if err != nil {
				return "", "", errors.New(string(out))
			}

			//nmcli return something. Use the first one
			outString := strings.TrimSpace(string(out))
			currentSSIDInfo := ""
			if strings.Contains(outString, "\n") {
				connectedIds := strings.Split(outString, "\n")
				for _, conn := range connectedIds {
					if !strings.Contains(conn, "Wired") {
						//The first connection that is not wired
						currentSSIDInfo = conn
						break
					}
				}

			} else {
				currentSSIDInfo = outString
			}

			if strings.Contains(currentSSIDInfo, "Wired") {
				//This is an ethernet port?
				//Nothing connected
				return "OFFLINE", "N/A", nil
			}

			if currentSSIDInfo == "" {
				//No connection to any interface, which is strange?
				return "", "", errors.New("No established connection")
			}

			//Split the information
			SSIDinfoChunk := strings.Split(currentSSIDInfo, ":")
			currentSSID := SSIDinfoChunk[0]
			interfaceName := SSIDinfoChunk[1]

			return currentSSID, interfaceName, nil

		} else {
			return "", "", errors.New(string(out))
		}
		return "", "", errors.New(string(out))
	}
	if len(string(out)) == 0 {
		return "OFFLINE", "N/A", nil
	}

	//Try to parse the data
	trimmedData := string(out)
	for strings.Contains(trimmedData, "  ") {
		trimmedData = strings.ReplaceAll(trimmedData, "  ", " ")
	}

	dc := strings.Split(trimmedData, " ")
	if len(dc) == 0 {
		return "", "", errors.New("No valid wlan Interface Found")
	}

	wlanInterface := dc[0]
	ESSID := strings.Join(dc[1:], " ")[7:]
	ESSID = strings.TrimSpace(ESSID)
	ESSID = ESSID[:len(ESSID)-1]
	if strings.TrimSpace(ESSID) == "\"" {
		ESSID = ""
	}
	return ESSID, wlanInterface, nil
}

func (w *WiFiManager) CheckInterfaceIsAP(wlanInterfaceName string) (bool, error) {
	cmd := exec.Command("bash", "-c", "iwconfig wlan1 | grep Mode")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return false, err
	}
	if len(string(out)) == 0 {
		return false, errors.New("Missing iwconfig package")
	}

	//Check if the output contains Mode:Master
	if strings.Contains(string(out), "Mode:Master") {
		return true, nil
	} else {
		return false, nil
	}
}

func (w *WiFiManager) RemoveWifi(ssid string) error {

	if pkg_exists("nmcli") {
		//Make use of nmcli storage
		if w.database.KeyExists("wifi", ssid) {
			w.database.Delete("wifi", ssid)
		}
	} else {
		//Fall back to systemctl
		if !fileInDir("./system/network/wifi/ap/"+ssid+".config", "./system/network/wifi/ap/") {
			return errors.New("Invalid SSID")
		}

		if fileExists("./system/network/wifi/ap/" + ssid + ".config") {
			os.Remove("./system/network/wifi/ap/" + ssid + ".config")
		} else {
			return errors.New("Record not found")
		}
	}

	return nil
}

//Helper functions
func fileInDir(filesourcepath string, directory string) bool {
	filepathAbs, err := filepath.Abs(filesourcepath)
	if err != nil {
		return false
	}

	directoryAbs, err := filepath.Abs(directory)
	if err != nil {
		return false
	}

	//Check if the filepathabs contain directoryAbs
	if strings.Contains(filepathAbs, directoryAbs) {
		return true
	} else {
		return false
	}

}

func fileExists(filename string) bool {
	_, err := os.Stat(filename)
	if os.IsNotExist(err) {
		return false
	}
	return true
}

func template_apply(templateString string, replacement map[string]interface{}) string {
	t := fasttemplate.New(templateString, "{{", "}}")
	s := t.ExecuteString(replacement)
	return string(s)
}

func pkg_exists(pkgname string) bool {
	cmd := exec.Command("whereis", pkgname)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return false
	}

	packageInfo := strings.Split(strings.TrimSpace(string(out)), ":")
	//log.Println(packageInfo)
	if len(packageInfo) > 1 && packageInfo[1] != "" {
		return true
	} else {
		return false
	}
}
