package diskmg

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"strings"
	"time"

	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

type Lsblk struct {
	Blockdevices []struct {
		Name       string      `json:"name"`
		MajMin     string      `json:"maj:min"`
		Rm         bool        `json:"rm"`
		Size       int64       `json:"size"`
		Ro         bool        `json:"ro"`
		Type       string      `json:"type"`
		Mountpoint interface{} `json:"mountpoint"`
		Children   []struct {
			Name       string `json:"name"`
			MajMin     string `json:"maj:min"`
			Rm         bool   `json:"rm"`
			Size       int64  `json:"size"`
			Ro         bool   `json:"ro"`
			Type       string `json:"type"`
			Mountpoint string `json:"mountpoint"`
		} `json:"children"`
	} `json:"blockdevices"`
}

type LsblkF struct {
	Blockdevices []struct {
		Name       string      `json:"name"`
		Fstype     interface{} `json:"fstype"`
		Label      interface{} `json:"label"`
		UUID       interface{} `json:"uuid"`
		Fsavail    interface{} `json:"fsavail"`
		Fsuse      interface{} `json:"fsuse%"`
		Mountpoint interface{} `json:"mountpoint"`
		Children   []struct {
			Name       string      `json:"name"`
			Fstype     string      `json:"fstype"`
			Label      interface{} `json:"label"`
			UUID       string      `json:"uuid"`
			Fsavail    int64       `json:"fsavail"`
			Fsuse      string      `json:"fsuse%"`
			Mountpoint string      `json:"mountpoint"`
		} `json:"children"`
	} `json:"blockdevices"`
}

var (
	supportedFormats = []string{"ntfs", "vfat", "ext4", "ext3", "btrfs"}
)

/*
Diskmg View Generator
This section of the code is a direct translation of the original
AOB's diskmg.php and diskmgWin.php.

If you find any bugs in these code, just remember they are legacy
code and rewriting the whole thing will save you a lot more time.
*/
func HandleView(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS == "darwin" {
		handleViewDarwin(w, r)
		return
	}

	partition, _ := utils.GetPara(r, "partition")
	detailMode := (partition != "")
	if runtime.GOOS == "windows" {
		//Windows. Use DiskmgWin binary
		if utils.FileExists("./system/disk/diskmg/DiskmgWin.exe") {
			out := ""
			if detailMode {
				cmd := exec.Command("./system/disk/diskmg/DiskmgWin.exe", "-d")
				o, err := cmd.CombinedOutput()
				if err != nil {
					utils.SendErrorResponse(w, "Permission Denied")
					return
				}
				out = string(o)
			} else {
				cmd := exec.Command("./system/disk/diskmg/DiskmgWin.exe")
				o, err := cmd.CombinedOutput()
				if err != nil {
					utils.SendErrorResponse(w, "Permission Denied")
					return
				}
				out = string(o)
			}

			out = strings.TrimSpace(out)
			lines := strings.Split(out, ";")

			results := [][]string{}
			for _, line := range lines {
				data := strings.Split(line, ",")
				if len(data) > 0 && data[0] != "" {
					results = append(results, data)
				}

			}

			js, _ := json.Marshal(results)
			utils.SendJSONResponse(w, string(js))

		} else {
			logger.PrintAndLog("Diskmg", "system/disk/diskmg/DiskmgWin.exe NOT FOUND. Unable to load Window's disk information", nil)
			utils.SendErrorResponse(w, "DiskmgWin.exe not found")
			return
		}

	} else {
		//Linux. Use lsblk and df to check volume info
		partition := new(Lsblk)
		format := new(LsblkF)
		df := ""

		//Get partition information
		cmd := exec.Command("lsblk", "-b", "--json")
		o, err := cmd.CombinedOutput()
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		err = json.Unmarshal(o, &partition)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		//Get format info
		cmd = exec.Command("lsblk", "-f", "-b", "--json")
		o, err = cmd.CombinedOutput()
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		err = json.Unmarshal(o, &format)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		//Get df info
		cmd = exec.Command("df")
		o, err = cmd.CombinedOutput()
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		df = string(o)

		//Filter the df information
		for strings.Contains(df, "  ") {
			df = strings.ReplaceAll(df, "  ", " ")
		}

		dflines := strings.Split(df, "\n")
		parsedDf := [][]string{}
		for _, line := range dflines {
			linedata := strings.Split(line, " ")
			parsedDf = append(parsedDf, linedata)
		}

		//Throw away the table header
		parsedDf = parsedDf[1:]

		js, _ := json.Marshal([]interface{}{
			partition,
			format,
			parsedDf,
		})

		utils.SendJSONResponse(w, string(js))
	}
}

/*
Mounting a given partition or devices
Manual translated from mountTool.php

Require GET parameter: dev / format / mnt
*/
func HandleMount(w http.ResponseWriter, r *http.Request, fsHandlers []*fs.FileSystemHandler) {
	if runtime.GOOS == "darwin" {
		handleMountDarwin(w, r)
		return
	}
	if runtime.GOOS == "linux" {
		targetDev, _ := utils.GetPara(r, "dev")
		format, err := utils.GetPara(r, "format")
		if err != nil {
			utils.SendErrorResponse(w, "format not defined")
			return
		}
		mountPt, err := utils.GetPara(r, "mnt")
		if err != nil {
			utils.SendErrorResponse(w, "Mount Point not defined")
			return
		}

		//Check if device is valid
		ok, devID := checkDeviceValid(targetDev)
		if !ok {
			utils.SendErrorResponse(w, "Device name is not valid")
			return
		}

		//Check if the given format is supported
		mountingTool := ""
		if format == "ntfs" {
			mountingTool = "ntfs-3g"
		} else if format == "ext4" {
			mountingTool = "ext4"
		} else if format == "vfat" {
			mountingTool = "vfat"
		} else if format == "brtfs" {
			mountingTool = "brtfs"
		} else {
			utils.SendErrorResponse(w, "Format not supported")
			return
		}

		//Check if mount point exists, only support /medoa/*
		safeMountPoint := filepath.Clean(strings.ReplaceAll(mountPt, "../", ""))
		if !utils.FileExists(safeMountPoint) {
			utils.SendErrorResponse(w, "Mount point not exists, given: "+safeMountPoint)
			return
		}

		//Check if action is mount or umount
		umount, _ := utils.GetPara(r, "umount")
		if umount == "true" {
			//Unmount the given mountpoint
			output, err := Unmount(safeMountPoint, fsHandlers)
			if err != nil {
				utils.SendErrorResponse(w, output)
				return
			}
			utils.SendTextResponse(w, output)

		} else {
			o, err := Mount(devID, safeMountPoint, mountingTool, fsHandlers)
			if err != nil {
				utils.SendErrorResponse(w, o)
				return
			}
			utils.SendTextResponse(w, o)
		}

	} else {
		utils.SendErrorResponse(w, "Platform not supported: "+runtime.GOOS)
		return
	}
}

/*
Format Tool
Manual translation from AOB's formatTool.php
*/
func HandleFormat(w http.ResponseWriter, r *http.Request, fsHandlers []*fs.FileSystemHandler) {
	dev, err := utils.PostPara(r, "dev")
	if err != nil {
		utils.SendErrorResponse(w, "dev not defined")
		return
	}

	format, err := utils.PostPara(r, "format")
	if err != nil {
		utils.SendErrorResponse(w, "format not defined")
		return
	}

	if runtime.GOOS == "windows" {
		utils.SendErrorResponse(w, "This function is Linux Only")
		return
	}

	//Check if format is supported
	if !utils.StringInArray(supportedFormats, format) {
		utils.SendErrorResponse(w, "Format not supported")
		return
	}

	//Check if device is valid
	ok, devID := checkDeviceValid(dev)
	if !ok {
		utils.SendErrorResponse(w, "Device name is not valid")
		return
	}

	//Check if it is mounted. If yes, umount it
	mounted, err := checkDeviceMounted(devID)
	if err != nil {
		//Fail to check if disk mounted
		logger.PrintAndLog("Diskmg", err.Error(), nil)
		utils.SendErrorResponse(w, "Failed to check disk mount status")
		return
	}

	//This drive is still mounted. Unmount it
	if mounted {
		//Close all the fsHandler related to this disk
		mountpt, err := getDeviceMountPoint(devID)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		logger.PrintAndLog("Diskmg", "Unmounting "+mountpt+" for format", nil)
		//Unmount the devices
		out, err := Unmount(mountpt, fsHandlers)
		if err != nil {
			utils.SendErrorResponse(w, out)
			return
		}
	}

	//Format the drive
	var cmd *exec.Cmd
	if format == "ntfs" {
		cmd = exec.Command("mkfs.ntfs", "-f", "/dev/"+devID)
	} else if format == "vfat" {
		cmd = exec.Command("mkfs.vfat", "/dev/"+devID)
	} else if format == "ext4" {
		cmd = exec.Command("mkfs.ext4", "-F", "/dev/"+devID)
	} else if format == "ext3" {
		utils.SendErrorResponse(w, "Format to ext3 is Work In Progress")
	} else if format == "btrfs" {
		utils.SendErrorResponse(w, "Format to btrfs is Work In Progress")
	} else {
		utils.SendErrorResponse(w, "Format tyoe not supported")
	}

	//Execute format comamnd
	logger.PrintAndLog("Diskmg", "Formatting of "+"/dev/"+devID+" Started", nil)
	output, err := cmd.CombinedOutput()
	if err != nil {
		logger.PrintAndLog("Diskmg", "Format failed: "+string(output), nil)
		utils.SendErrorResponse(w, string(output))
		return
	}

	//Reply ok
	logger.PrintAndLog("Diskmg", string(output), nil)

	//Let the system to reload the disk
	time.Sleep(2 * time.Second)
	utils.SendOK(w)

}

func Mount(devID string, mountpt string, mountingTool string, fsHandlers []*fs.FileSystemHandler) (string, error) {
	//Loop each fsHandler. If exists one that fits and Closed, reopen it
	for _, fsh := range fsHandlers {
		if strings.Contains(filepath.ToSlash(fsh.Path), filepath.ToSlash(mountpt)) {
			//Re-open the file system and set its flag to Open
			fsh.Closed = false
		}
	}

	logger.PrintAndLog("Diskmg", fmt.Sprint("Executing Mount Command: ", "mount", "-t", mountingTool, "/dev/"+devID, mountpt), nil)
	cmd := exec.Command("mount", "-t", mountingTool, "/dev/"+devID, mountpt)
	o, err := cmd.CombinedOutput()
	if err != nil {
		logger.PrintAndLog("Diskmg", fmt.Sprint("Failed to mount "+devID, string(o)), nil)
	}
	return string(o), err
}

// Unmount a given mountpoint
func Unmount(mountpt string, fsHandlers []*fs.FileSystemHandler) (string, error) {
	//Unmount the fsHandlers that related to this mountpt
	for _, fsh := range fsHandlers {
		if strings.Contains(filepath.ToSlash(fsh.Path), filepath.ToSlash(mountpt)) {
			//Close this file system handler
			fsh.Closed = true
		}
	}
	logger.PrintAndLog("Diskmg", fmt.Sprint("Executing Umount Command: ", "umount", mountpt), nil)
	cmd := exec.Command("umount", mountpt)
	o, err := cmd.CombinedOutput()
	return string(o), err
}

// Return a list of mountable directory
func HandleListMountPoints(w http.ResponseWriter, r *http.Request) {
	mp, _ := filepath.Glob("/media/*")
	js, _ := json.Marshal(mp)
	utils.SendJSONResponse(w, string(js))
}

// Check if the device is mounted
func checkDeviceMounted(devname string) (bool, error) {
	cmd := exec.Command("bash", "-c", "lsblk -f -b --json | grep "+devname)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return false, err
	}

	//Convert the json map to generic string interface map
	jsonMap := make(map[string]interface{})
	err = json.Unmarshal(output, &jsonMap)
	if err != nil {
		return false, err
	}

	if jsonMap["mountpoint"] != nil {
		return true, nil
	} else {
		return false, nil
	}

}

func getDeviceMountPoint(devname string) (string, error) {
	cmd := exec.Command("bash", "-c", "lsblk -f -b --json | grep "+devname)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", errors.New("Device not mounted")
	}

	//Convert the json map to generic string interface map
	jsonMap := make(map[string]interface{})
	err = json.Unmarshal(output, &jsonMap)
	if err != nil {
		return "", errors.New("Pharse mountpoint error")
	}

	if jsonMap["mountpoint"] != nil {
		return jsonMap["mountpoint"].(string), nil
	} else {
		return "", errors.New("Unable to get mountpoint from lsblk")
	}
}

// Check device valid, only usable in linux
func checkDeviceValid(devname string) (bool, string) {
	//Check if the device name is valid
	match, _ := regexp.MatchString("sd[a-z][1-9]", devname)
	if !match {
		return false, ""
	}

	//Extract the device name from string
	re := regexp.MustCompile(`sd[a-z][1-9]`)
	devID := re.FindString(devname)
	if !utils.FileExists("/dev/" + devID) {
		return false, ""
	}

	return true, devID
}

func HandlePlatform(w http.ResponseWriter, r *http.Request) {
	js, _ := json.Marshal(runtime.GOOS)
	utils.SendJSONResponse(w, string(js))
}

/*
HandleListDevicesWithInfo returns all block devices with their partitions,
partition UUID (from blkid / lsblk -f), filesystem type, size and mount point.
Used by the storage pool editor UI so the user can pick a partition by name
instead of having to know the raw /dev path.

GET /system/disk/diskmg/devices
*/

// lsblkFull is used to parse a single lsblk -b --json -o NAME,SIZE,TYPE,FSTYPE,UUID,LABEL,MOUNTPOINT,MODEL call.
type lsblkFull struct {
	Blockdevices []lsblkFullDev `json:"blockdevices"`
}

type lsblkFullDev struct {
	Name       string         `json:"name"`
	Size       int64          `json:"size"`
	Type       string         `json:"type"`
	Fstype     interface{}    `json:"fstype"`
	UUID       interface{}    `json:"uuid"`
	Label      interface{}    `json:"label"`
	Mountpoint interface{}    `json:"mountpoint"`
	Model      interface{}    `json:"model"`
	Children   []lsblkFullDev `json:"children"`
}

// PartitionDeviceInfo is the per-partition record returned to the frontend.
type PartitionDeviceInfo struct {
	Name       string `json:"name"`
	DevPath    string `json:"devpath"`
	Fstype     string `json:"fstype"`
	UUID       string `json:"uuid"`
	Label      string `json:"label"`
	Size       int64  `json:"size"`
	Mountpoint string `json:"mountpoint"`
}

// BlockDeviceInfo is the per-disk record returned to the frontend.
type BlockDeviceInfo struct {
	Name       string                `json:"name"`
	Model      string                `json:"model"`
	Size       int64                 `json:"size"`
	Partitions []PartitionDeviceInfo `json:"partitions"`
}

func HandleListDevicesWithInfo(w http.ResponseWriter, r *http.Request) {
	if runtime.GOOS != "linux" {
		utils.SendErrorResponse(w, "This function is Linux only")
		return
	}

	cmd := exec.Command("lsblk", "-b", "--json", "-o", "NAME,SIZE,TYPE,FSTYPE,UUID,LABEL,MOUNTPOINT,MODEL")
	o, err := cmd.CombinedOutput()
	if err != nil {
		utils.SendErrorResponse(w, "lsblk error: "+err.Error())
		return
	}

	var raw lsblkFull
	if err := json.Unmarshal(o, &raw); err != nil {
		utils.SendErrorResponse(w, "parse error: "+err.Error())
		return
	}

	// helper: safely convert interface{} to string
	ifaceStr := func(v interface{}) string {
		if v == nil {
			return ""
		}
		return strings.TrimSpace(fmt.Sprintf("%v", v))
	}

	result := []BlockDeviceInfo{}
	for _, dev := range raw.Blockdevices {
		// Only show disk/loop/md types; skip rom, etc.
		if dev.Type != "disk" && dev.Type != "md" && dev.Type != "loop" {
			continue
		}

		diskInfo := BlockDeviceInfo{
			Name:       dev.Name,
			Model:      ifaceStr(dev.Model),
			Size:       dev.Size,
			Partitions: []PartitionDeviceInfo{},
		}

		for _, part := range dev.Children {
			partInfo := PartitionDeviceInfo{
				Name:       part.Name,
				DevPath:    "/dev/" + part.Name,
				Fstype:     ifaceStr(part.Fstype),
				UUID:       ifaceStr(part.UUID),
				Label:      ifaceStr(part.Label),
				Size:       part.Size,
				Mountpoint: ifaceStr(part.Mountpoint),
			}
			diskInfo.Partitions = append(diskInfo.Partitions, partInfo)
		}

		// If a disk has no children (e.g. unpartitioned), expose the disk itself as
		// a single entry so it can still be selected.
		if len(diskInfo.Partitions) == 0 {
			diskInfo.Partitions = append(diskInfo.Partitions, PartitionDeviceInfo{
				Name:       dev.Name,
				DevPath:    "/dev/" + dev.Name,
				Fstype:     ifaceStr(dev.Fstype),
				UUID:       ifaceStr(dev.UUID),
				Label:      ifaceStr(dev.Label),
				Size:       dev.Size,
				Mountpoint: ifaceStr(dev.Mountpoint),
			})
		}

		result = append(result, diskInfo)
	}

	js, _ := json.Marshal(result)
	utils.SendJSONResponse(w, string(js))
}
