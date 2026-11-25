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
	"fmt"
	"net/http"
	"os"
	"strings"

	"errors"
	"os/exec"
	"runtime"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/info/wininfo"
	"imuslab.com/arozos/mod/utils"
	//"time"
)

type SMARTListener struct {
	SystemSmartExecutable string
	DriveList             DevicesList `json:"driveList"`
}

// DiskSmartInit Desktop script initiation
func NewSmartListener() (out0 *SMARTListener, out1 error) {
	defer logger.Out2(logger.In0("disk/smart", "NewSmartListener"), &out0, &out1)
	smartExec := getBinary()

	logger.PrintAndLog("Smart", "Starting SMART mointoring", nil)

	if smartExec == "" {
		return &SMARTListener{}, errors.New("not supported platform")
	}

	if !(utils.FileExists(smartExec)) {
		return &SMARTListener{}, errors.New("smartctl not found")
	}

	//Updated 5 June 2023: Try to chmod it if it is on linux so that
	//broken permissions still works in sudo mode.
	//Only chmod the bundled binary; leave system-installed smartctl alone.
	if runtime.GOOS == "linux" && strings.Contains(smartExec, "system/disk/smart") {
		os.Chmod(smartExec, 0777)
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

// this function used for fetch available devices by using smartctl
func scanAvailableDevices(smartExec string) (out0 DevicesList) {
	defer logger.Out1(logger.In1("disk/smart", "scanAvailableDevices", "smartExec", smartExec), &out0)
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

// this function used for merge SMART Information into devicesList
func readSMARTDevices(smartExec string, devicesList *DevicesList) {
	defer logger.Out0(logger.In2("disk/smart", "readSMARTDevices", "smartExec", smartExec, "devicesList", devicesList))
	for i, device := range devicesList.Devices {
		rawInfo := execCommand(smartExec, device.Name, "--info", "--all", "--json=c")
		deviceSMART := new(DeviceSMART)
		json.Unmarshal([]byte(rawInfo), &deviceSMART)
		devicesList.Devices[i].Smart = *deviceSMART
	}
}

// used for fill the healthy status to the array
func fillHealthyStatus(devicesList *DevicesList) {
	defer logger.Out0(logger.In1("disk/smart", "fillHealthyStatus", "devicesList", devicesList))
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

// fillCapacity fills the capacity smartctl left at zero on Windows from the
// disk drives Windows reports (mod/info/wininfo, no wmic or PowerShell)
func fillCapacity(devicesList *DevicesList) {
	defer logger.Out0(logger.In1("disk/smart", "fillCapacity", "devicesList", devicesList))
	if runtime.GOOS != "windows" {
		return
	}
	disks, err := wininfo.PhysicalDisks()
	if err != nil {
		logger.DebugErr("disk/smart", err)
		return
	}
	applyDiskCapacities(devicesList, disks)
}

// applyDiskCapacities gives each device without a capacity the size of the
// disk with the same model name
func applyDiskCapacities(devicesList *DevicesList, disks []wininfo.PhysicalDisk) {
	defer logger.Out0(logger.In2("disk/smart", "applyDiskCapacities", "devicesList", devicesList, "disks", disks))
	for i, device := range devicesList.Devices {
		if device.Smart.UserCapacity.Bytes != 0 {
			continue
		}
		for _, disk := range disks {
			//Intel drivers rename drives to "XXXX SCSI Disk Device", which
			//smartctl does not report
			model := strings.ReplaceAll(disk.Model, " SCSI Disk Device", "")
			if disk.Size > 0 && model != "" && device.Smart.ModelName == model {
				devicesList.Devices[i].Smart.UserCapacity.Bytes = int64(disk.Size)
				break
			}
		}
	}
}

func (s *SMARTListener) GetSMART(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("disk/smart", "SMARTListener.GetSMART", "s", s, "r", r))
	jsonText, _ := json.Marshal(s.DriveList)
	utils.SendJSONResponse(w, string(jsonText))
}

func getBinary() (out0 string) {
	defer logger.Out1(logger.In0("disk/smart", "getBinary"), &out0)
	// Prefer system-installed smartctl (more up-to-date, supports newer drives).
	if path, err := exec.LookPath("smartctl"); err == nil {
		logger.PrintAndLog("Smart", fmt.Sprint("[SMART] Using system-installed smartctl:", path), nil)
		return path
	}

	// Fall back to the pre-built binary bundled with arozos.
	logger.PrintAndLog("Smart", "[SMART] System smartctl not found, falling back to bundled binary", nil)
	switch runtime.GOOS {
	case "windows":
		return ".\\system\\disk\\smart\\win\\smartctl.exe"
	case "linux":
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
