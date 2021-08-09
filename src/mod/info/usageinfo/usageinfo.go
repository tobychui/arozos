package usageinfo

import (
	"math"
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

const query_cpuproc_command = "ps -eo pcpu,pid,user,args | sort -k 1 -r | head -10"
const query_freemem_command = "top -d1 | sed '4q;d' | awk '{print $(NF-1)}'"
const query_phymem_command = "sysctl hw.physmem | awk '{print $NF}'"

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
	} else if runtime.GOOS == "linux" || runtime.GOOS == "freebsd" {
		//Get CPU first 10 processes uses most CPU resources
		cmd := exec.Command("bash", "-c", query_cpuproc_command)
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

		// Prepare queryNCPUCommnad for core count query
		queryNCPUCommand := ""
		if runtime.GOOS == "linux" {
			queryNCPUCommand = "nproc"
		} else if runtime.GOOS == "freebsd" {
			queryNCPUCommand = "sysctl hw.ncpu | awk '{print $NF}'"
		}

		// Get CPU core count
		cmd = exec.Command(queryNCPUCommand)
		out, err = cmd.CombinedOutput()
		if err != nil {
			return usageCounter
		}

		// Divide total CPU usage by processes by total CPU core count
		coreCount, err := strconv.Atoi(string(out))
		if err != nil {
			coreCount = 1
		}

		usage = usageCounter / float64(coreCount)
		if usage > float64(100) {
			usage = 100
		}

	} else {
		// CPU Usage Not supported on this platform
	}

	return usage
}

//Get RAM Usage in Numeric values
func GetNumericRAMUsage() (int64, int64) {
	usedRam := int64(-1)
	totalRam := int64(-1)
	if runtime.GOOS == "windows" {
		cmd := exec.Command("system/hardware/windows/RAMUsage.exe")
		out, err := cmd.CombinedOutput()
		if err != nil {
			return -1, -1
		}
		raminfo := strings.Split(strings.TrimSpace(string(out)), ",")
		if len(raminfo) == 3 {

			//The returned value is something like this
			//7639 MB,16315 MB,0.468219429972418
			tmp := strings.Split(raminfo[0], " ")[0]
			used, err := strconv.ParseInt(tmp, 10, 64)
			if err != nil {
				return -1, -1
			}

			tmp = strings.Split(raminfo[1], " ")[0]
			total, err := strconv.ParseInt(tmp, 10, 64)
			if err != nil {
				return -1, -1
			}

			usedRam = used * 1024 * 1024   //From MB to Bytes
			totalRam = total * 1024 * 1024 //From MB to Bytes

			return usedRam, totalRam
		} else {
			return -1, -1
		}

	} else if runtime.GOOS == "linux" {
		cmd := exec.Command("bash", "-c", "free -m | grep Mem:")
		out, err := cmd.CombinedOutput()
		if err != nil {
			return usedRam, totalRam
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
			used, err := strconv.ParseInt(data[2], 10, 64)
			if err != nil {
				return -1, -1
			}

			total, err := strconv.ParseInt(data[1], 10, 64)
			if err != nil {
				return -1, -1
			}

			usedRam = used * 1024 * 1024
			totalRam = total * 1024 * 1024

			return usedRam, totalRam
		}

	} else if runtime.GOOS == "freebsd" {

		// Get usused memory size (free)
		cmd := exec.Command("bash", "-c", query_freemem_command)
		freeMemByteArr, err := cmd.CombinedOutput()
		if err != nil {
			return usedRam, totalRam
		}
		freeMemStr := string(freeMemByteArr)
		freeMemStr = strings.ReplaceAll(freeMemStr, "\n", "")
		freeMemSize, err := strconv.ParseFloat(strings.ReplaceAll(string(freeMemStr), "M", ""), 10)

		// Get phy memory size
		cmd = exec.Command("bash", "-c", query_phymem_command)
		phyMemByteArr, err := cmd.CombinedOutput()
		if err != nil {
			return usedRam, totalRam
		}

		phyMemStr := string(phyMemByteArr)
		phyMemStr = strings.ReplaceAll(phyMemStr, "\n", "")

		// phyMemSize in MB
		phyMemSizeFloat, err := strconv.ParseFloat(phyMemStr, 10)
		phyMemSizeFloat = math.Floor(phyMemSizeFloat)
		total := phyMemSizeFloat

		// Used memory
		usedRAMSizeFloat := phyMemSizeFloat - freeMemSize
		usedRAMSizeFloat = math.Floor(usedRAMSizeFloat)
		used := usedRAMSizeFloat

		totalRam = int64(total)
		usedRam = int64(used)

		return usedRam, totalRam
	}
	return -1, -1
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

	} else if runtime.GOOS == "freebsd" {

		// Get usused memory size (free)
		cmd := exec.Command("bash", "-c", query_freemem_command)
		freeMemByteArr, err := cmd.CombinedOutput()
		if err != nil {
			return usedRam, totalRam, usedPercentage
		}
		freeMemStr := string(freeMemByteArr)
		freeMemStr = strings.ReplaceAll(freeMemStr, "\n", "")
		freeMemSize, err := strconv.ParseFloat(strings.ReplaceAll(string(freeMemStr), "M", ""), 10)

		// Get phy memory size
		cmd = exec.Command("bash", "-c", query_phymem_command)
		phyMemByteArr, err := cmd.CombinedOutput()
		if err != nil {
			return usedRam, totalRam, usedPercentage
		}

		phyMemStr := string(phyMemByteArr)
		phyMemStr = strings.ReplaceAll(phyMemStr, "\n", "")

		// phyMemSize in MB
		phyMemSizeFloat, err := strconv.ParseFloat(phyMemStr, 10)
		phyMemSizeFloat = phyMemSizeFloat / 1048576
		phyMemSizeFloat = math.Floor(phyMemSizeFloat)
		totalRam = strconv.FormatFloat(phyMemSizeFloat, 'f', -1, 64) + "MB"

		// Used memory
		usedRAMSizeFloat := phyMemSizeFloat - freeMemSize
		usedRAMSizeFloat = math.Floor(usedRAMSizeFloat)
		usedRam = strconv.FormatFloat(usedRAMSizeFloat, 'f', -1, 64) + "MB"

		usedPercentage = usedRAMSizeFloat / phyMemSizeFloat * 100

		return usedRam, totalRam, usedPercentage
	}

	return usedRam, totalRam, usedPercentage
}
