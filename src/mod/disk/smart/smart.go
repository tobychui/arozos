package smart

/*
	DISK SMART Service Listener
	Original author: alanyeung
	Rewritten by tobychui in Oct 2020 for system arch upgrade

	This module is not the core part of aroz online system.
	If you want to remove disk smart handler (e.g. running in VM?)
	remove the corrisponding code in disk.go
*/

import (
	"encoding/json"
	"log"
	"net/http"
	"strings"

	//"os/exec"
	"errors"
	"runtime"
	//"time"
)

type SMARTListener struct {
	SystemSmartExecutable string
	DriveList             DevicesList `json:"driveList"`
}

// DiskSmartInit Desktop script initiation
func NewSmartListener() (*SMARTListener, error) {
	smartExec := getBinary()

	log.Println("Starting SMART mointoring")

	if smartExec == "" {
		return &SMARTListener{}, errors.New("not supported platform")
	}

	if !(fileExists(smartExec)) {
		return &SMARTListener{}, errors.New("smartctl not found")
	}

	driveList := scanAvailableDevices(smartExec)
	readSMARTDevices(smartExec, &driveList)
	fillHealthyStatus(&driveList)
	return &SMARTListener{
		SystemSmartExecutable: smartExec,
		DriveList:             driveList,
	}, nil
}

func scanAvailableDevices(smartExec string) DevicesList {
	rawInfo := execCommand(smartExec, "--scan", "--json=c")
	devicesList := new(DevicesList)
	json.Unmarshal([]byte(rawInfo), &devicesList)
	//used to remove csmi devices (Intel RAID Devices)
	numOfRemoved := 0
	for i, device := range devicesList.Devices {
		if strings.Contains(device.Name, "/dev/csmi") {
			devicesList.Devices = append(devicesList.Devices[:i-numOfRemoved], devicesList.Devices[i+1-numOfRemoved:]...)
			numOfRemoved++
		}
	}
	return *devicesList
}

func readSMARTDevices(smartExec string, devicesList *DevicesList) {
	for i, device := range devicesList.Devices {
		rawInfo := execCommand(smartExec, device.Name, "--info", "--all", "--json=c")
		deviceSMART := new(DeviceSMART)
		json.Unmarshal([]byte(rawInfo), &deviceSMART)
		devicesList.Devices[i].Smart = *deviceSMART
	}
}

func fillHealthyStatus(devicesList *DevicesList) {
	devicesList.Healthy = "Normal"
	for i, device := range devicesList.Devices {
		for j, smartTableElement := range device.Smart.AtaSmartAttributes.Table {
			devicesList.Devices[i].Smart.Healthy = "Normal"
			devicesList.Devices[i].Smart.AtaSmartAttributes.Table[j].Healthy = "Normal"
			if smartTableElement.WhenFailed == "FAILING_NOW" {
				devicesList.Devices[i].Smart.AtaSmartAttributes.Table[j].Healthy = "Failing"
				devicesList.Devices[i].Smart.Healthy = "Failing"
				devicesList.Healthy = "Failing"
				break
			}
			if smartTableElement.WhenFailed == "In_the_past" {
				devicesList.Devices[i].Smart.AtaSmartAttributes.Table[j].Healthy = "Attention"
				devicesList.Devices[i].Smart.Healthy = "Attention"
				devicesList.Healthy = "Attention"
				break
			}
		}
	}
}

func (s *SMARTListener) GetSMART(w http.ResponseWriter, r *http.Request) {
	jsonText, _ := json.Marshal(s.DriveList)
	sendJSONResponse(w, string(jsonText))
}

func getBinary() string {
	if runtime.GOOS == "windows" {
		return ".\\system\\disk\\smart\\win\\smartctl.exe"
	} else if runtime.GOOS == "linux" {
		if runtime.GOARCH == "arm" || runtime.GOARCH == "arm64" {
			return "./system/disk/smart/linux/smartctl_armv6"
		}
		if runtime.GOARCH == "386" || runtime.GOARCH == "amd64" {
			return "./system/disk/smart/linux/smartctl_i386"
		}
	}
	return ""
}
