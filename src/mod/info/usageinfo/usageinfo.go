package usageinfo

import (
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

/*
	Usage Info (CPU / RAM)
	author: tobychui

	This module get the CPU information on different platform using
	native terminal commands
*/

//Get CPU Usage in percentage
func GetCPUUsage() float64 {
	usage := float64(0)
	if runtime.GOOS == "windows" {
		cmd := exec.Command("system/hardware/windows/getCPUload.exe")
		out, err := cmd.CombinedOutput()
		if err != nil {
			usage = 0
		}
		percentageOnly := strings.Split(string(out), " ")[0]
		s, err := strconv.ParseFloat(percentageOnly, 64)
		if err != nil {
			usage = 0
		}
		usage = s
	} else if runtime.GOOS == "linux" {
		//Get CPU processes
		cmd := exec.Command("bash", "-c", "ps -eo pcpu,pid,user,args | sort -k 1 -r | head -10")
		out, err := cmd.CombinedOutput()
		if err != nil {
			usage = 0
		}
		usageCounter := float64(0)
		usageInfo := strings.Split(string(out), "\n")
		for _, info := range usageInfo {
			if strings.Contains(info, "%CPU") == false {
				dataChunk := strings.Split(strings.TrimSpace(info), " ")
				if len(dataChunk) > 0 {
					s, err := strconv.ParseFloat(dataChunk[0], 64)
					if err == nil {
						usageCounter += s
					}
				}

			}
		}

		//Get CPU Core Counts
		cmd = exec.Command("nproc")
		out, err = cmd.CombinedOutput()
		if err != nil {
			return usageCounter
		}

		//Divide the process usage by core count
		coreCount, err := strconv.Atoi(string(out))
		if err != nil {
			coreCount = 1
		}

		usage = usageCounter / float64(coreCount)
		if usage > float64(100) {
			usage = 100
		}
	} else {
		//Not supported

	}

	return usage
}

//Get RAM usage, return used / total / used percentage
func GetRAMUsage() (string, string, float64) {
	usedRam := "Unknown"
	totalRam := "Unknown"
	usedPercentage := float64(0)
	if runtime.GOOS == "windows" {
		cmd := exec.Command("system/hardware/windows/RAMUsage.exe")
		out, err := cmd.CombinedOutput()
		if err != nil {
			return usedRam, totalRam, usedPercentage
		}
		raminfo := strings.Split(strings.TrimSpace(string(out)), ",")
		if len(raminfo) == 3 {
			usedRam = raminfo[0]
			totalRam = raminfo[1]
			s, err := strconv.ParseFloat(raminfo[2], 64)
			if err != nil {
				return usedRam, totalRam, usedPercentage
			}
			usedPercentage = s * float64(100)
		} else {
			return usedRam, totalRam, usedPercentage
		}

		return usedRam, totalRam, usedPercentage
	} else if runtime.GOOS == "linux" {
		cmd := exec.Command("bash", "-c", "free -m | grep Mem:")
		out, err := cmd.CombinedOutput()
		if err != nil {
			return usedRam, totalRam, usedPercentage
		}

		//If the output contain more than one Memory info, only use the first one
		if strings.Contains(string(out), "\n") {
			out = []byte(strings.Split(string(out), "\n")[0])
		}

		//Trim of double space to space
		for strings.Contains(string(out), "  ") {
			out = []byte(strings.ReplaceAll(string(out), "  ", " "))
		}

		data := strings.Split(string(out), " ")
		if len(data) > 3 {
			usedRam = data[2] + " MB"
			totalRam = data[1] + " MB"

			//Calculate used memory
			usedFloat, err := strconv.ParseFloat(data[2], 64)
			if err != nil {
				return usedRam, totalRam, usedPercentage
			}

			totalFloat, err := strconv.ParseFloat(data[1], 64)
			if err != nil {
				return usedRam, totalRam, usedPercentage
			}

			usedPercentage = usedFloat / totalFloat * 100

			return usedRam, totalRam, usedPercentage
		}

	}

	return usedRam, totalRam, usedPercentage
}
