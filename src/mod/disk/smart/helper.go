package smart

import (
	"fmt"
	"os/exec"
	"runtime"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

func execCommand(executable string, args ...string) string {
	shell := exec.Command(executable, args...) // Run command
	output, err := shell.CombinedOutput()      // Response from cmdline
	if err != nil && string(output) == "" {    // If done w/ errors then
		logger.PrintAndLog("Smart", fmt.Sprint(err), nil)
		return ""
	}

	return string(output)
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
// Modern Windows 11 no longer ships `wmic.exe` by default.
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
		if info := cimGetinfo(wmicName, itemName); len(info) > 0 {
			return info
		}
		if info := legacyWmicGetinfo(wmicName, itemName); len(info) > 0 {
			return info
		}
	}
	return []string{"Undefined"}
}
