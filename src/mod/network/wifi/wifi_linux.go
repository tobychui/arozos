//go:build linux
// +build linux

package wifi

import (
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

// Toggle WiFi On Off. Only allow on sudo mode
func (w *WiFiManager) SetInterfacePower(wlanInterface string, on bool) error {
	status := "up"
	if on == false {
		status = "down"
	}
	cmd := exec.Command("ifconfig", wlanInterface, status)
	out, err := cmd.CombinedOutput()
	if err != nil {
		logger.PrintAndLog("Wifi", fmt.Sprint("*WiFi* WiFi toggle failed: ", string(out)), nil)
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

// Scan Nearby WiFi
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
				logger.PrintAndLog("Wifi", "*WiFi* Running WiFi scan in nmcli compatibility mode", nil)
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

					thisWifiInfo.Interface = interfaceName
					normalizeWiFiInfo(thisWifiInfo)
					results = append(results, *thisWifiInfo)
				}

				markConnectedBSS(results, interfaceName)
				return results, nil
			} else {
				logger.PrintAndLog("Wifi", fmt.Sprint("*WiFi* Scan Failed: ", err.Error()), nil)
				return []WiFiInfo{}, errors.New("Interface doesn't support scanning")
			}
		}
		return []WiFiInfo{}, err
	}

	//parse the output of the WiFi Scan
	results := parseIwlistScan(string(out))
	useNmcliStore := pkg_exists("nmcli")
	for i := range results {
		results[i].Interface = interfaceName
		if useNmcliStore {
			//Make use of nmcli storage
			results[i].ConnectedBefore = w.database.KeyExists("wifi", results[i].ESSID)
		} else {
			//Direct access to wpa_supplicant
			results[i].ConnectedBefore = fileExists("./system/network/wifi/ap/" + results[i].ESSID + ".config")
		}
	}
	markConnectedBSS(results, interfaceName)
	return results, nil
}

// markConnectedBSS flags the scan result the interface is associated with
func markConnectedBSS(results []WiFiInfo, interfaceName string) {
	link, err := readIwLink(interfaceName)
	if err != nil || !link.Connected {
		return
	}
	for i := range results {
		if strings.EqualFold(results[i].Address, link.BSSID) {
			results[i].Connected = true
		}
	}
}

// readIwLink runs "iw dev <interface> link"
func readIwLink(interfaceName string) (iwLinkInfo, error) {
	if interfaceName == "" || strings.ContainsAny(interfaceName, " /\\") {
		return iwLinkInfo{}, errors.New("invalid interface name")
	}
	out, err := exec.Command("iw", "dev", interfaceName, "link").CombinedOutput()
	if err != nil {
		return iwLinkInfo{}, errors.New(string(out))
	}
	return parseIwLink(string(out)), nil
}

// Hack the signal level out of the nmcli bars
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

// Get all the network interfaces
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
				logger.PrintAndLog("Wifi", "*WiFi* Connecting previous SSID failed: "+string(out), nil)
				logger.PrintAndLog("Wifi", "*WiFi* Trying to connect new AP anyway", nil)
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
			logger.PrintAndLog("Wifi", "*WiFi* Connecting to SSID "+ssid+" failed: "+string(out), nil)
			return &WiFiConnectionResult{Success: false}, errors.New(string(out))
		}

		if connType != "switch" {
			//Save the ssid and password to database
			w.database.Write("wifi", ssid, password)
		}

		logger.PrintAndLog("Wifi", string(out), nil)
		//Check and return the current connection ssid
		//Wait until the WiFi is conencted
		rescanCount := 0
		connectedSSID, _, _ := w.GetConnectedWiFi()
		//Wait for 30 seconds
		for rescanCount < 10 && connectedSSID == "" {
			connectedSSID, _, _ = w.GetConnectedWiFi()
			logger.PrintAndLog("Wifi", fmt.Sprint(connectedSSID), nil)
			rescanCount = rescanCount + 1
			logger.PrintAndLog("Wifi", "*WiFi* Waiting WiFi Connection (Retry "+strconv.Itoa(rescanCount)+"/10)", nil)
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
		logger.PrintAndLog("Wifi", "*WiFi* Unsupported connection type", nil)
		return &WiFiConnectionResult{Success: false}, errors.New("Unsupported Connection Type")
	}

	//Generate new wpa_supplicant_conf from file
	if !fileExists("./system/network/wifi/ap") {
		os.MkdirAll("./system/network/wifi/ap", 0755)
	}

	if writeToConfig == true {
		logger.PrintAndLog("Wifi", "*WiFi* WiFi Config Generated. Writing to file...", nil)
		//Write config file to disk
		err := os.WriteFile("./system/network/wifi/ap/"+ssid+".config", []byte(networkConfigFile), 0755)
		if err != nil {
			logger.PrintAndLog("Wifi", err.Error(), nil)
			return &WiFiConnectionResult{Success: false}, err
		}
	} else {
		logger.PrintAndLog("Wifi", "*WiFi* Switching WiFi AP...", nil)
	}

	//Start creating the new wpa_supplicant file
	//Get header
	configHeader, err := os.ReadFile("./system/network/wifi/wpa_supplicant.conf_template.config")
	if err != nil {
		//Template header not found. Use default one from Raspberry Pi
		logger.PrintAndLog("Wifi", "*WiFi* Warning! wpa_supplicant template file not found. Using default template.", nil)
		configHeader = []byte(`ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
		update_config=1
		{{networks}}
		`)
	}

	//Build network informations
	networksConfigs, err := filepath.Glob("./system/network/wifi/ap/*.config")
	if err != nil {
		logger.PrintAndLog("Wifi", err.Error(), nil)
		return &WiFiConnectionResult{Success: false}, err
	}

	//Read each of the network and append it into a string slice
	networks := []string{}

	for _, configFile := range networksConfigs {
		thisNetworkConfig, err := os.ReadFile(configFile)
		if err != nil {
			logger.PrintAndLog("Wifi", "*WiFi* Failed to read Network Config File: "+configFile, nil)
			continue
		}

		if strings.TrimSuffix(filepath.Base(configFile), filepath.Ext(configFile)) == ssid {
			//The new SSID. Set this to higher priority
			networks = append(networks, utils.TemplateApply(string(thisNetworkConfig), map[string]string{
				"priority": strconv.Itoa(1),
			}))
		} else {
			//Old SSID. Use default priority
			networks = append(networks, utils.TemplateApply(string(thisNetworkConfig), map[string]string{
				"priority": strconv.Itoa(0),
			}))
		}

	}

	//Subsitute the results into the template
	networksConfigString := strings.Join(networks, "\n")
	newconfig := utils.TemplateApply(string(configHeader), map[string]string{
		"networks": networksConfigString,
	})

	//Try to write the new config to wpa_supplicant
	err = os.WriteFile(w.wpa_supplicant_path, []byte(newconfig), 0777)
	if err != nil {
		logger.PrintAndLog("Wifi", "*WiFi* Failed to update wpa_supplicant config, are you sure you have access permission to that file?", nil)
		return &WiFiConnectionResult{Success: false}, err
	}

	logger.PrintAndLog("Wifi", "*WiFi* WiFi Config Updated. Restarting Wireless Interfaces...", nil)

	//Restart network services
	cmd := exec.Command("wpa_cli", "-i", w.wan_interface_name, "reconfigure")
	out, err := cmd.CombinedOutput()
	if err != nil {
		//Maybe the user forgot to set the flag. Try auto detect.
		autoDetectedWIface, err := w.GetWirelessInterfaces()
		if err != nil || len(autoDetectedWIface) == 0 {
			logger.PrintAndLog("Wifi", "failed to restart network: "+string(out), nil)
			return &WiFiConnectionResult{Success: false}, err
		}

		firstWlanInterface := autoDetectedWIface[0]
		cmd := exec.Command("wpa_cli", "-i", firstWlanInterface, "reconfigure")
		out, err := cmd.CombinedOutput()
		if err != nil {
			//Really failed.
			logger.PrintAndLog("Wifi", "failed to restart network: "+string(out), nil)
			return &WiFiConnectionResult{Success: false}, err
		}

	}

	logger.PrintAndLog("Wifi", "*WiFi* Trying to connect new AP", nil)
	//Wait until the WiFi is conencted
	rescanCount := 0
	connectedSSID, _, _ := w.GetConnectedWiFi()
	//Wait for 30 seconds
	for rescanCount < 10 && connectedSSID == "" {
		connectedSSID, _, _ = w.GetConnectedWiFi()
		logger.PrintAndLog("Wifi", fmt.Sprint(connectedSSID), nil)
		rescanCount = rescanCount + 1
		logger.PrintAndLog("Wifi", "*WiFi* Waiting WiFi Connection (Retry "+strconv.Itoa(rescanCount)+"/10)", nil)
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

// Get the current connected wifi, return ESSID, wifi interface name and error if any
// Return ESSID, interface and error
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

// CanControlInterfacePower reports whether SetInterfacePower is supported
func (w *WiFiManager) CanControlInterfacePower() bool {
	return true
}

// CanConnect reports whether ConnectWiFi and RemoveWifi are supported
func (w *WiFiManager) CanConnect() bool {
	return true
}

// GetInterfaceStatus returns the live state of every wireless interface
func (w *WiFiManager) GetInterfaceStatus() ([]WiFiInterfaceStatus, error) {
	names, err := w.GetWirelessInterfaces()
	if err != nil {
		return []WiFiInterfaceStatus{}, err
	}
	results := []WiFiInterfaceStatus{}
	for _, name := range names {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		results = append(results, w.interfaceStatus(name))
	}
	return results, nil
}

func (w *WiFiManager) interfaceStatus(name string) WiFiInterfaceStatus {
	status := WiFiInterfaceStatus{
		Name:          name,
		State:         "disconnected",
		SoftwareRadio: "unknown",
		HardwareRadio: "unknown",
		SignalQuality: -1,
		IPv4:          []string{},
		IPv6:          []string{},
		Gateways:      []string{},
		DNS:           []string{},
	}

	sysDir := filepath.Join("/sys", "class", "net", name)
	if driver, err := filepath.EvalSymlinks(filepath.Join(sysDir, "device", "driver")); err == nil {
		status.Description = "Driver: " + filepath.Base(driver)
	}
	if blocked, ok := readRfkill(sysDir, "soft"); ok {
		status.SoftwareRadio = map[bool]string{true: "off", false: "on"}[blocked]
	}
	if blocked, ok := readRfkill(sysDir, "hard"); ok {
		status.HardwareRadio = map[bool]string{true: "off", false: "on"}[blocked]
	}

	if nic, err := net.InterfaceByName(name); err == nil {
		status.MAC = nic.HardwareAddr.String()
		status.MTU = nic.MTU
		if nic.Flags&net.FlagUp == 0 {
			status.State = "down"
		}
		if addrs, err := nic.Addrs(); err == nil {
			for _, addr := range addrs {
				ipnet, ok := addr.(*net.IPNet)
				if !ok {
					continue
				}
				if ipnet.IP.To4() != nil {
					status.IPv4 = append(status.IPv4, ipnet.String())
				} else {
					status.IPv6 = append(status.IPv6, ipnet.String())
				}
			}
		}
	}
	if routes, err := os.ReadFile(filepath.Join("/proc", "net", "route")); err == nil {
		status.Gateways = parseProcRoute(string(routes), name)
	}

	link, err := readIwLink(name)
	if err != nil {
		//No iw: fall back to the connected SSID from iwgetid / nmcli
		ssid, iface, err := w.GetConnectedWiFi()
		if err == nil && iface == name && ssid != "" && ssid != "OFFLINE" {
			status.SSID = ssid
			status.Connected = true
			status.State = "connected"
		}
		return status
	}
	if !link.Connected {
		return status
	}
	status.Connected = true
	status.State = "connected"
	status.SSID = link.SSID
	status.BSSID = link.BSSID
	status.BSSType = "Infrastructure"
	status.FrequencyMHz = link.FreqMHz
	status.Band = bandOfFrequency(link.FreqMHz)
	status.Channel = channelOfFrequency(link.FreqMHz)
	status.ChannelWidth = link.Width
	status.RSSI = link.SignalDBm
	status.SignalQuality = qualityFromRSSI(link.SignalDBm)
	status.RxRateMbps = link.RxRateMbps
	status.TxRateMbps = link.TxRateMbps
	status.PHYType = link.PHYType
	status.Generation = generationOfPHY(link.PHYType, status.Band)
	return status
}

// readRfkill reports whether any rfkill switch of the interface's PHY is
// blocked (kind is "soft" or "hard"). ok is false when there is no switch.
func readRfkill(sysDir string, kind string) (blocked bool, ok bool) {
	matches, err := filepath.Glob(filepath.Join(sysDir, "phy80211", "rfkill*", kind))
	if err != nil || len(matches) == 0 {
		return false, false
	}
	for _, m := range matches {
		content, err := os.ReadFile(m)
		if err != nil {
			continue
		}
		ok = true
		if strings.TrimSpace(string(content)) == "1" {
			blocked = true
		}
	}
	return blocked, ok
}

// Helper functions
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

func pkg_exists(pkgname string) bool {
	cmd := exec.Command("which", pkgname)
	out, _ := cmd.CombinedOutput()

	if len(string(out)) > 1 {
		return true
	} else {
		return false
	}
}
