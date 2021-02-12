package diskspace

import (
	"encoding/json"
	"log"
	"net/http"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
)

/*
	Disk Space Services

	Return the disk information of the system.
	The most basic task of all
*/

type LogicalDiskSpaceInfo struct {
	Device         string
	Volume         int64
	Used           int64
	Available      int64
	UsedPercentage string
	MountPoint     string
}

func HandleDiskSpaceList(w http.ResponseWriter, r *http.Request) {
	allDisksVolume := GetAllLogicDiskInfo()
	jsonString, _ := json.Marshal(allDisksVolume)
	w.Header().Set("Content-Type", "application/json")
	w.Write(jsonString)
}

func GetAllLogicDiskInfo() []LogicalDiskSpaceInfo {
	if runtime.GOOS == "windows" {
		//Check window disk info, wip
		cmd := exec.Command("wmic", "logicaldisk", "get", "caption,size,freespace")
		out, err := cmd.CombinedOutput()
		if err != nil {
			log.Println("wmic not supported.")
			return []LogicalDiskSpaceInfo{}
		}
		lines := strings.Split(string(out), "\n")
		var results []LogicalDiskSpaceInfo
		for _, line := range lines {
			if strings.Contains(line, ":") {
				//This is a valid drive

				line = strings.TrimSpace(line)
				//Tidy the line
				for strings.Contains(line, "  ") {
					line = strings.Replace(line, "  ", " ", -1)
				}

				//Split by space
				infoChunk := strings.Split(line, " ")
				if len(infoChunk) == 1 {
					//Drive reserved and not mounted, like SD card adapters
					results = append(results, LogicalDiskSpaceInfo{
						Device:         infoChunk[0],
						Volume:         0,
						Used:           0,
						Available:      0,
						UsedPercentage: "Not Mounted",
						MountPoint:     infoChunk[0],
					})
				} else if len(infoChunk) > 2 {
					size, err := stringToInt64(infoChunk[2])
					if err != nil {
						size = 0
					}
					freespace, err := stringToInt64(infoChunk[1])
					if err != nil {
						size = 0
					}
					usedSpace := size - freespace
					percentage := int64(float64(usedSpace) / float64(size) * 100)

					results = append(results, LogicalDiskSpaceInfo{
						Device:         infoChunk[0],
						Volume:         size,
						Used:           usedSpace,
						Available:      freespace,
						UsedPercentage: strconv.Itoa(int(percentage)) + "%",
						MountPoint:     infoChunk[0],
					})
				}
			}
		}

		return results
	} else {
		//Get drive status using df command
		cmdin := `df -k | sed -e /Filesystem/d`
		cmd := exec.Command("bash", "-c", cmdin)
		dev, err := cmd.CombinedOutput()
		if err != nil {
			dev = []byte{}
		}

		drives := strings.Split(string(dev), "\n")

		if len(drives) == 0 {
			return []LogicalDiskSpaceInfo{}
		}

		var arr []LogicalDiskSpaceInfo
		for _, driveInfo := range drives {
			if driveInfo == "" {
				continue
			}
			for strings.Contains(driveInfo, "  ") {
				driveInfo = strings.Replace(driveInfo, "  ", " ", -1)
			}
			driveInfoChunk := strings.Split(driveInfo, " ")
			volume, _ := stringToInt64(driveInfoChunk[1])
			usedSpace, _ := stringToInt64(driveInfoChunk[2])
			freespaceInByte, _ := stringToInt64(driveInfoChunk[3])

			LogicalDisk := LogicalDiskSpaceInfo{
				Device:         driveInfoChunk[0],
				Volume:         volume * 1024,
				Used:           usedSpace * 1024,
				Available:      freespaceInByte * 1024,
				UsedPercentage: driveInfoChunk[4],
				MountPoint:     driveInfoChunk[5],
			}
			//Mountpoint fixes for macOS
			//tested on Darwin 11.1
			if runtime.GOOS == "darwin" {
				if LogicalDisk.Device == "map" {
					LogicalDisk.Device = driveInfoChunk[1]
					LogicalDisk.MountPoint = driveInfoChunk[9]
				} else {
					LogicalDisk.MountPoint = driveInfoChunk[8]
				}
			}
			arr = append(arr, LogicalDisk)
		}

		return arr
	}

	return []LogicalDiskSpaceInfo{}
}

func stringToInt64(value string) (int64, error) {
	n, err := strconv.Atoi(value)
	return int64(n), err
}
