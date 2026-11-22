//go:build windows
// +build windows

package hardwareinfo

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/info/wininfo"
	"imuslab.com/arozos/mod/utils"
)

/*
	Host information on Windows

	Read through the Win32 API (mod/info/wininfo). These handlers used to ask
	PowerShell or wmic, and a console program started by ArozOS shares its
	console: PowerShell's -WindowStyle Hidden hid the window ArozOS was started
	from. No child process is started here.
*/

func sendJSON(w http.ResponseWriter, value interface{}) {
	jsonData, err := json.Marshal(value)
	if err != nil {
		logger.PrintAndLog("Hardwareinfo", fmt.Sprint(err), nil)
	}
	utils.SendTextResponse(w, string(jsonData))
}

func GetCPUInfo(w http.ResponseWriter, r *http.Request) {
	info := CPUInfo{
		Freq:        "Undefined",
		Hardware:    "unknown",
		Instruction: "Undefined",
		Model:       "Undefined",
		Revision:    "unknown",
	}
	if p, err := wininfo.ProcessorInfo(); err == nil {
		info.Model = orUndefined(p.Name)
		info.Instruction = orUndefined(p.Identifier)
		if p.MHz > 0 {
			info.Freq = strconv.FormatUint(uint64(p.MHz), 10)
		}
	}
	sendJSON(w, info)
}

// Ifconfig lists the product names of the network adapters
func Ifconfig(w http.ResponseWriter, r *http.Request) {
	names := []string{}
	adapters, _ := wininfo.NetAdapters()
	for _, adapter := range adapters {
		if !adapter.Loopback && adapter.Description != "" {
			names = append(names, adapter.Description)
		}
	}
	sendJSON(w, names)
}

// GetDriveStat lists the drive letters; a drive without a readable volume
// has an empty file system and free space
func GetDriveStat(w http.ResponseWriter, r *http.Request) {
	drives := []LogicalDisk{}
	disks, _ := wininfo.LogicalDisks()
	for _, disk := range disks {
		drive := LogicalDisk{DriveLetter: disk.Root, FileSystem: disk.FileSystem}
		if disk.Ready {
			drive.FreeSpace = strconv.FormatUint(disk.Free, 10)
		}
		drives = append(drives, drive)
	}
	sendJSON(w, drives)
}

func GetUSB(w http.ResponseWriter, r *http.Request) {
	devices, err := wininfo.USBDevices()
	if err != nil || devices == nil {
		devices = []string{}
	}
	sendJSON(w, devices)
}

// GetRamInfo is the installed memory in bytes
func GetRamInfo(w http.ResponseWriter, r *http.Request) {
	installed, err := wininfo.InstalledMemory()
	if err != nil {
		installed = 0
	}
	sendJSON(w, int64(installed))
}
