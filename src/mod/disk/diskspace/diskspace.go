package diskspace

import (
	"encoding/json"
	"net/http"
	"os/exec"
	"runtime"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/info/wininfo"
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
		disks, err := wininfo.LogicalDisks()
		if err != nil {
			logger.PrintAndLog("Diskspace", "Could not list the drives", err)
			return []LogicalDiskSpaceInfo{}
		}
		return logicalDiskSpace(disks)
	} else {
		//Get drive status using df command
		cmdin := `df -k | sed -e /Filesystem/d`
		cmd := exec.Command("bash", "-c", cmdin)
		dev, err := cmd.Output()
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
}

func stringToInt64(value string) (int64, error) {
	n, err := strconv.Atoi(value)
	return int64(n), err
}

// logicalDiskSpace words the Windows drive letters for the disk space page.
// A drive without a readable volume (an empty card reader) is "Not Mounted".
func logicalDiskSpace(disks []wininfo.LogicalDisk) []LogicalDiskSpaceInfo {
	results := []LogicalDiskSpaceInfo{}
	for _, disk := range disks {
		if !disk.Ready || disk.Size == 0 {
			results = append(results, LogicalDiskSpaceInfo{
				Device:         disk.Root,
				UsedPercentage: "Not Mounted",
				MountPoint:     disk.Root,
			})
			continue
		}
		used := disk.Size - disk.Free
		if disk.Free > disk.Size {
			used = 0
		}
		results = append(results, LogicalDiskSpaceInfo{
			Device:         disk.Root,
			Volume:         int64(disk.Size),
			Used:           int64(used),
			Available:      int64(disk.Free),
			UsedPercentage: strconv.Itoa(int(float64(used)/float64(disk.Size)*100)) + "%",
			MountPoint:     disk.Root,
		})
	}
	return results
}
