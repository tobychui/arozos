package hardwareinfo

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os/exec"
	"runtime"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
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
	logger.PrintAndLog("Hardwareinfo", "Windows Version: "+wmicGetinfo("os", "Caption")[0], nil)
	logger.PrintAndLog("Hardwareinfo", "Total Memory: "+wmicGetinfo("ComputerSystem", "TotalPhysicalMemory")[0]+"B", nil)
	logger.PrintAndLog("Hardwareinfo", "Processor: "+wmicGetinfo("cpu", "Name")[0], nil)
	logger.PrintAndLog("Hardwareinfo", "Following disk was detected:", nil)
	for _, info := range wmicGetinfo("diskdrive", "Model") {
		logger.PrintAndLog("Hardwareinfo", fmt.Sprint(info), nil)
	}
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

// wmicClassName maps classic `wmic` aliases to CIM / Win32 class names.
func wmicClassName(wmicName string) string {
	if len(wmicName) > 6 && wmicName[0:6] == "Win32_" {
		return wmicName
	}
	switch strings.ToLower(wmicName) {
	case "cpu":
		return "Win32_Processor"
	case "os":
		return "Win32_OperatingSystem"
	case "computersystem":
		return "Win32_ComputerSystem"
	case "diskdrive":
		return "Win32_DiskDrive"
	case "nic":
		return "Win32_NetworkAdapter"
	case "logicaldisk":
		return "Win32_LogicalDisk"
	case "memorychip":
		return "Win32_PhysicalMemory"
	default:
		return "Win32_" + wmicName
	}
}

// cimGetinfo reads a WMI property via PowerShell Get-CimInstance.
// Modern Windows 11 (24H2+) no longer ships `wmic.exe` by default; CIM is the
// supported replacement and exposes the same Win32_* properties.
func cimGetinfo(wmicName string, itemName string) []string {
	className := wmicClassName(wmicName)
	psClass := strings.ReplaceAll(className, "'", "''")
	psItem := strings.ReplaceAll(itemName, "'", "''")
	script := fmt.Sprintf(
		"Get-CimInstance -ClassName '%s' | ForEach-Object { $p = $_.PSObject.Properties['%s']; if ($null -ne $p -and $null -ne $p.Value) { [string]$p.Value } }",
		psClass, psItem,
	)
	cmd := exec.Command("powershell.exe",
		"-NoProfile",
		"-NonInteractive",
		"-WindowStyle", "Hidden",
		"-ExecutionPolicy", "Bypass",
		"-Command", script,
	)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil
	}
	var info []string
	for _, line := range strings.Split(string(out), "\n") {
		line = strings.TrimSpace(strings.ReplaceAll(line, "\r", ""))
		if line != "" {
			info = append(info, line)
		}
	}
	return info
}

// legacyWmicGetinfo keeps the original `wmic` path for older Windows hosts
// that still ship the binary (pre-removal / optional Feature on Demand).
func legacyWmicGetinfo(wmicName string, itemName string) []string {
	var info []string

	cmd := exec.Command("wmic", wmicName, "list", "full", "/format:list")
	if wmicName == "os" {
		cmd = exec.Command("wmic", wmicName, "get", "*", "/format:list")
	}
	if len(wmicName) > 6 && wmicName[0:6] == "Win32_" {
		cmd = exec.Command("wmic", "path", wmicName, "get", "*", "/format:list")
	}
	out, _ := cmd.CombinedOutput()
	for _, strConfig := range strings.Split(string(out), "\n") {
		if strings.Contains(strConfig, "=") {
			parts := strings.SplitN(strConfig, "=", 2)
			if parts[0] == itemName {
				info = append(info, strings.Replace(parts[1], "\r", "", -1))
			}
		}
	}
	return info
}

func wmicGetinfo(wmicName string, itemName string) []string {
	if runtime.GOOS == "windows" {
		// Prefer CIM: wmic.exe was removed from many Windows 11 installs.
		if info := cimGetinfo(wmicName, itemName); len(info) > 0 {
			return info
		}
		if info := legacyWmicGetinfo(wmicName, itemName); len(info) > 0 {
			return info
		}
	}
	return []string{"Undefined"}
}

func filterGrepResults(result string, sep string) string {
	if strings.Contains(result, sep) == false {
		return result
	}
	tmp := strings.Split(result, sep)
	resultString := tmp[1]
	return strings.TrimSpace(resultString)
}
