//go:build windows
// +build windows

package hardwareinfo

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

func GetCPUInfo(w http.ResponseWriter, r *http.Request) {

	CPUInfo := CPUInfo{
		Freq:        wmicGetinfo("cpu", "CurrentClockSpeed")[0],
		Hardware:    "unknown",
		Instruction: wmicGetinfo("cpu", "Caption")[0],
		Model:       wmicGetinfo("cpu", "Name")[0],
		Revision:    "unknown",
	}

	var jsonData []byte
	jsonData, err := json.Marshal(CPUInfo)
	if err != nil {
		logger.PrintAndLog("Hardwareinfo", fmt.Sprint(err), nil)
	}
	utils.SendTextResponse(w, string(jsonData))
}

func Ifconfig(w http.ResponseWriter, r *http.Request) {
	var arr []string
	for _, info := range wmicGetinfo("nic", "ProductName") {
		arr = append(arr, info)
	}

	var jsonData []byte
	jsonData, err := json.Marshal(arr)
	if err != nil {
		logger.PrintAndLog("Hardwareinfo", fmt.Sprint(err), nil)
	}
	utils.SendTextResponse(w, string(jsonData))
}

func GetDriveStat(w http.ResponseWriter, r *http.Request) {

	//Query all three properties in one go, otherwise a drive appearing or
	//disappearing (e.g. an USB drive being unplugged) in between the queries
	//would misalign the results
	var arr []LogicalDisk
	for _, disk := range wmicGetinfoRows("logicaldisk", "DeviceID", "FileSystem", "FreeSpace") {
		if disk[0] == "" {
			//Drive without a device id, skip it
			continue
		}
		LogicalDisk := LogicalDisk{
			DriveLetter: disk[0],
			FileSystem:  disk[1],
			FreeSpace:   disk[2],
		}
		arr = append(arr, LogicalDisk)
	}

	var jsonData []byte
	jsonData, err := json.Marshal(arr)
	if err != nil {
		logger.PrintAndLog("Hardwareinfo", fmt.Sprint(err), nil)
	}
	utils.SendTextResponse(w, string(jsonData))
}

func GetUSB(w http.ResponseWriter, r *http.Request) {
	var arr []string
	for _, info := range wmicGetinfo("Win32_USBHub", "Description") {
		arr = append(arr, info)
	}

	var jsonData []byte
	jsonData, err := json.Marshal(arr)
	if err != nil {
		logger.PrintAndLog("Hardwareinfo", fmt.Sprint(err), nil)
	}
	utils.SendTextResponse(w, string(jsonData))
}

func GetRamInfo(w http.ResponseWriter, r *http.Request) {
	var RAMsize int = 0
	for _, info := range wmicGetinfo("memorychip", "Capacity") {
		DIMMCapacity, _ := strconv.Atoi(info)
		RAMsize += DIMMCapacity
	}

	var jsonData []byte
	jsonData, err := json.Marshal(RAMsize)
	if err != nil {
		logger.PrintAndLog("Hardwareinfo", fmt.Sprint(err), nil)
	}
	utils.SendTextResponse(w, string(jsonData))
}
