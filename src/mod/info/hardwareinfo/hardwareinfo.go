package hardwareinfo

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/info/wininfo"
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
PrintSystemHardwareDebugMessage logs the Windows version, memory, processor
and disks, read through the Win32 API (mod/info/wininfo). Other platforms
log "Undefined".
*/
func PrintSystemHardwareDebugMessage() {
	osName, _ := wininfo.OSName()
	memory := "Undefined"
	if m, err := wininfo.MemoryStatus(); err == nil {
		memory = fmt.Sprint(m.Total) + "B"
	}
	processor, _ := wininfo.ProcessorInfo()
	logger.PrintAndLog("Hardwareinfo", "Windows Version: "+orUndefined(osName), nil)
	logger.PrintAndLog("Hardwareinfo", "Total Memory: "+memory, nil)
	logger.PrintAndLog("Hardwareinfo", "Processor: "+orUndefined(processor.Name), nil)
	logger.PrintAndLog("Hardwareinfo", "Following disk was detected:", nil)
	disks, _ := wininfo.PhysicalDisks()
	for _, disk := range disks {
		logger.PrintAndLog("Hardwareinfo", orUndefined(disk.Model), nil)
	}
}

// orUndefined is how the hardware pages show a value Windows did not report
func orUndefined(value string) string {
	if strings.TrimSpace(value) == "" {
		return "Undefined"
	}
	return value
}

func (s *Server) GetArOZInfo(w http.ResponseWriter, r *http.Request) {
	var jsonData []byte
	jsonData, err := json.Marshal(s.hostInfo)
	if err != nil {
		logger.PrintAndLog("Hardwareinfo", fmt.Sprint(err), nil)
		return
	}

	loadImage, _ := utils.GetPara(r, "icon")
	if loadImage != "true" {
		t := ArOZInfo{}
		json.Unmarshal(jsonData, &t)
		t.VendorIcon = ""
		jsonData, _ = json.Marshal(t)
	}

	utils.SendJSONResponse(w, string(jsonData))
}

func filterGrepResults(result string, sep string) string {
	if strings.Contains(result, sep) == false {
		return result
	}
	tmp := strings.Split(result, sep)
	resultString := tmp[1]
	return strings.TrimSpace(resultString)
}
