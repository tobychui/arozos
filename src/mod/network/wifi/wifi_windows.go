// +build windows
package wifi

/*
	WiFi connection module for Windows
	author: tobychui

*/

import (
	"errors"
	"log"
	"os/exec"
	"strconv"
	"strings"
)

func (w *WiFiManager) ScanNearbyWiFi(interfaceName string) ([]WiFiInfo, error) {
	cmd := exec.Command("cmd", "/c", "chcp 65001 && netsh WLAN show networks mode=bssid")
	out, err := cmd.CombinedOutput()
	if err != nil {
		//No interface found on the system
		log.Println(string(out))
		return []WiFiInfo{}, errors.New(string(out))
	}

	//Filter the output
	output := string(out)
	results := []WiFiInfo{}
	var currentWiFiInfo *WiFiInfo = nil
	for _, line := range strings.Split(output, "\r\n") {
		line = strings.TrimSpace(line)
		for strings.Contains(line, "  ") {
			line = strings.ReplaceAll(line, "  ", "")
		}

		line = strings.TrimSpace(line)
		if len(line) == 0 {
			//This is an empty line
			continue
		}

		if line[:4] == "SSID" {
			//Starting a new WiFi Info
			if currentWiFiInfo != nil {
				currentWiFiInfo.Quality = "-"
				results = append(results, *currentWiFiInfo)
			}

			essid := ""
			tmp := strings.Split(line, ":")
			if len(tmp) > 1 {
				essid = tmp[1]
			}
			currentWiFiInfo = &WiFiInfo{
				ESSID: strings.TrimSpace(essid),
			}
		} else if line[:5] == "BSSID" {
			bssid := ""
			tmp := strings.Split(line, ":")
			if len(tmp) > 1 {
				tmp = tmp[1:]
				bssid = strings.Join(tmp, ":")
			}
			currentWiFiInfo.Address = strings.TrimSpace(bssid)

		} else if line[:7] == "Channel" {
			channel := ""
			tmp := strings.Split(line, ":")
			if len(tmp) > 1 {
				channel = tmp[1]
			}
			channel = strings.TrimSpace(channel)
			channelInt, err := strconv.Atoi(channel)
			if err != nil {
				channelInt = -1
			}
			currentWiFiInfo.Channel = channelInt
		} else if line[:6] == "Signal" {
			signal := ""
			tmp := strings.Split(line, ":")
			if len(tmp) > 1 {
				signal = tmp[1]
			}

			signal = strings.TrimSpace(signal)
			currentWiFiInfo.SignalLevel = signal
		} else if line[:10] == "Encryption" {
			encryp := ""
			tmp := strings.Split(line, ":")
			if len(tmp) > 1 {
				encryp = tmp[1]
			}

			encryp = strings.TrimSpace(encryp)

			if encryp == "CCMO" || encryp == "TKIP" {
				currentWiFiInfo.EncryptionKey = true
			} else {
				currentWiFiInfo.EncryptionKey = false
			}
		} else if line[:10] == "Radio type" {
			radtype := ""
			tmp := strings.Split(line, ":")
			if len(tmp) > 1 {
				radtype = tmp[1]
			}

			radtype = strings.TrimSpace(radtype)
			currentWiFiInfo.Frequency = radtype
		}

	}

	return results, nil
}

func (w *WiFiManager) GetWirelessInterfaces() ([]string, error) {
	//Try to get wireless interface info from cmd
	cmd := exec.Command("cmd", "/c", "chcp 65001 && netsh WLAN show drivers")
	out, err := cmd.CombinedOutput()
	if err != nil {
		//No interface found on the system
		log.Println(string(out))
		return []string{}, err
	}
	output := string(out)
	wlanInterfaces := []string{}
	for _, line := range strings.Split(output, "\r\n") {
		line = strings.TrimSpace(line)
		for strings.Contains(line, "  ") {
			line = strings.ReplaceAll(line, "  ", "")
		}

		if strings.Contains(line, "Interface name: ") {
			tmp := strings.Split(line, ":")
			if len(tmp) > 1 {
				thisInterfaceName := tmp[1]
				wlanInterfaces = append(wlanInterfaces, thisInterfaceName)
			}
		}
	}
	return wlanInterfaces, nil
}

func (w *WiFiManager) ConnectWiFi(ssid string, password string, connType string, identity string) (*WiFiConnectionResult, error) {
	return &WiFiConnectionResult{}, errors.New("Windows WiFi function is currently readonly")
}

//Get connected wifi ssid, interface name and error if any
func (w *WiFiManager) GetConnectedWiFi() (string, string, error) {
	cmd := exec.Command("cmd", "/c", "chcp 65001 && netsh WLAN show interface")
	out, err := cmd.CombinedOutput()
	if err != nil {
		//No interface found on the system
		log.Println(string(out))
		return "", "", nil
	}
	output := string(out)

	//Things to be returned
	interfaceName := ""
	connectedSSID := ""

	for _, line := range strings.Split(output, "\r\n") {
		line = strings.TrimSpace(line)
		for strings.Contains(line, "  ") {
			line = strings.ReplaceAll(line, "  ", "")
		}

		if len(line) > 4 && line[:4] == "Name" {
			tmp := strings.Split(line, ":")
			if len(tmp) > 1 {
				interfaceName = tmp[1]
			}
		} else if len(line) > 4 && line[:4] == "SSID" {
			tmp := strings.Split(line, ":")
			if len(tmp) > 1 {
				connectedSSID = tmp[1]
			}
		}
	}

	return connectedSSID, interfaceName, nil
}

func (w *WiFiManager) RemoveWifi(ssid string) error {
	return errors.New("Windows WiFi function is currently readonly")
}
