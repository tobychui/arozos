package hardwareinfo

import (
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"strings"

	"imuslab.com/arozos/mod/utils"
)

/*
	Hardware Info
	author: tobychui

	This module is a migrated module from the original system.info.go script

*/

type CPUInfo struct {
	Model       string
	Freq        string
	Instruction string
	Hardware    string
	Revision    string
}

type LogicalDisk struct {
	DriveLetter string
	FileSystem  string
	FreeSpace   string
}

type ArOZInfo struct {
	BuildVersion string
	DeviceVendor string
	DeviceModel  string
	VendorIcon   string
	SN           string
	HostOS       string
	CPUArch      string
	HostName     string
}

type Server struct {
	hostInfo ArOZInfo
}

func NewInfoServer(a ArOZInfo) *Server {
	return &Server{
		hostInfo: a,
	}
}

/*
	PrintSystemHardwareDebugMessage print system information on Windows.
	Which is lagging but helpful for debugging wmic on Windows
*/
func PrintSystemHardwareDebugMessage() {
	log.Println("Windows Version: " + wmicGetinfo("os", "Caption")[0])
	log.Println("Total Memory: " + wmicGetinfo("ComputerSystem", "TotalPhysicalMemory")[0] + "B")
	log.Println("Processor: " + wmicGetinfo("cpu", "Name")[0])
	log.Println("Following disk was detected:")
	for _, info := range wmicGetinfo("diskdrive", "Model") {
		log.Println(info)
	}
}

func (s *Server) GetArOZInfo(w http.ResponseWriter, r *http.Request) {
	var jsonData []byte
	jsonData, err := json.Marshal(s.hostInfo)
	if err != nil {
		log.Println(err)
	}

	utils.SendJSONResponse(w, string(jsonData))
}

func wmicGetinfo(wmicName string, itemName string) []string {
	//get systeminfo
	var InfoStorage []string

	cmd := exec.Command("chcp", "65001")

	cmd = exec.Command("wmic", wmicName, "list", "full", "/format:list")
	if wmicName == "os" {
		cmd = exec.Command("wmic", wmicName, "get", "*", "/format:list")
	}

	if len(wmicName) > 6 {
		if wmicName[0:6] == "Win32_" {
			cmd = exec.Command("wmic", "path", wmicName, "get", "*", "/format:list")
		}
	}
	out, _ := cmd.CombinedOutput()
	strOut := string(out)

	strSplitedOut := strings.Split(strOut, "\n")
	for _, strConfig := range strSplitedOut {
		if strings.Contains(strConfig, "=") {
			strSplitedConfig := strings.SplitN(strConfig, "=", 2)
			if strSplitedConfig[0] == itemName {
				strSplitedConfigReplaced := strings.Replace(strSplitedConfig[1], "\r", "", -1)
				InfoStorage = append(InfoStorage, strSplitedConfigReplaced)
			}
		}

	}
	if len(InfoStorage) == 0 {
		InfoStorage = append(InfoStorage, "Undefined")
	}
	return InfoStorage
}

func filterGrepResults(result string, sep string) string {
	if strings.Contains(result, sep) == false {
		return result
	}
	tmp := strings.Split(result, sep)
	resultString := tmp[1]
	return strings.TrimSpace(resultString)
}
