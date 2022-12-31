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
	"strconv"
	"strings"

	//"os/exec"
	"errors"
	"runtime"

	"imuslab.com/arozos/mod/utils"
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

	if !(utils.FileExists(smartExec)) {
		return &SMARTListener{}, errors.New("smartctl not found")
	}

	driveList := scanAvailableDevices(smartExec)
	readSMARTDevices(smartExec, &driveList)
	fillHealthyStatus(&driveList)
	fillCapacity(&driveList)
	return &SMARTListener{
		SystemSmartExecutable: smartExec,
		DriveList:             driveList,
	}, nil
}

//this function used for fetch available devices by using smartctl
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

//this function used for merge SMART Information into devicesList
func readSMARTDevices(smartExec string, devicesList *DevicesList) {
	for i, device := range devicesList.Devices {
		rawInfo := execCommand(smartExec, device.Name, "--info", "--all", "--json=c")
		deviceSMART := new(DeviceSMART)
		json.Unmarshal([]byte(rawInfo), &deviceSMART)
		devicesList.Devices[i].Smart = *deviceSMART
	}
}

//used for fill the healthy status to the array
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

//fill the capacity if windows
func fillCapacity(devicesList *DevicesList) {
	if runtime.GOOS == "windows" {
		DiskNames := wmicGetinfo("diskdrive", "Model")
		DiskSizes := wmicGetinfo("diskdrive", "Size")
		for i, device := range devicesList.Devices {
			for j := range DiskNames {
				//since Intel driver will alter drive name to "XXXX SCSI Disk Device"
				//so remove the string to increase the match probability
				DiskNames[j] = strings.ReplaceAll(DiskNames[j], " SCSI Disk Device", "")
				//if the name match && capacity == 0
				if device.Smart.ModelName == DiskNames[j] && devicesList.Devices[i].Smart.UserCapacity.Bytes == 0 {
					capacity, _ := strconv.ParseInt(DiskSizes[j], 10, 64)
					devicesList.Devices[i].Smart.UserCapacity.Bytes = capacity
				}
			}
		}
	}
}

func (s *SMARTListener) GetSMART(w http.ResponseWriter, r *http.Request) {
	jsonText, _ := json.Marshal(s.DriveList)
	utils.SendJSONResponse(w, string(jsonText))
}

func getBinary() string {
	if runtime.GOOS == "windows" {
		return ".\\system\\disk\\smart\\win\\smartctl.exe"
	} else if runtime.GOOS == "linux" {
		if runtime.GOARCH == "arm" {
			return "./system/disk/smart/linux/smartctl_armv6"
		}
		if runtime.GOARCH == "arm64" {
			return "./system/disk/smart/linux/smartctl_arm64"
		}
		if runtime.GOARCH == "386" || runtime.GOARCH == "amd64" {
			return "./system/disk/smart/linux/smartctl_i386"
		}
	}
	return ""
}
