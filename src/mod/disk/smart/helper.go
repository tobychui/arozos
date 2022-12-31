package smart

import (
	"log"
	"os/exec"
	"strings"
)

func execCommand(executable string, args ...string) string {
	shell := exec.Command(executable, args...) // Run command
	output, err := shell.CombinedOutput()      // Response from cmdline
	if err != nil && string(output) == "" {    // If done w/ errors then
		log.Println(err)
		return ""
	}

	return string(output)
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
