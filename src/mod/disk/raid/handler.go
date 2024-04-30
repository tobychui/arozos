package raid

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/disk/diskfs"
	"imuslab.com/arozos/mod/utils"
)

/*
	Handler.go

	This module handle api call to the raid module
*/

// Handle stopping a RAID array for maintaince
func (m *Manager) HandleStopRAIDArray(w http.ResponseWriter, r *http.Request) {

}

// Handle remove a member disk (sdX) from RAID volume (mdX)
func (m *Manager) HandleRemoveDiskFromRAIDVol(w http.ResponseWriter, r *http.Request) {
	//mdadm --remove /dev/md0 /dev/sdb1
	mdDev, err := utils.PostPara(r, "raidDev")
	if err != nil {
		utils.SendErrorResponse(w, "invalid raid device given")
		return
	}

	sdXDev, err := utils.PostPara(r, "memDev")
	if err != nil {
		utils.SendErrorResponse(w, "invalid member device given")
		return
	}

	//Check if target array exists
	if !m.RAIDDeviceExists(mdDev) {
		utils.SendErrorResponse(w, "target RAID array not exists")
		return
	}

	//Check if this is the only disk in the array
	if !m.IsSafeToRemove(mdDev, sdXDev) {
		utils.SendErrorResponse(w, "removal of this device will cause data loss")
		return
	}

	//Check if the disk is already failed
	diskAlreadyFailed, err := m.DiskIsFailed(mdDev, sdXDev)
	if err != nil {
		log.Println("[RAID] Unable to validate if disk failed: " + err.Error())
		utils.SendErrorResponse(w, err.Error())
		return
	}
	//Disk not failed. Mark it as failed
	if !diskAlreadyFailed {
		err = m.FailDisk(mdDev, sdXDev)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
	}

	//Add some delay for OS level to handle IO closing
	time.Sleep(300 * time.Millisecond)

	//Done. Remove the device from array
	err = m.RemoveDisk(mdDev, sdXDev)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	log.Println("[RAID] Memeber disk " + sdXDev + " removed from RAID volume " + mdDev)
	utils.SendOK(w)
}

// Handle adding a disk (mdX) to RAID volume (mdX)
func (m *Manager) HandleAddDiskToRAIDVol(w http.ResponseWriter, r *http.Request) {
	//mdadm --add /dev/md0 /dev/sdb1
	mdDev, err := utils.PostPara(r, "raidDev")
	if err != nil {
		utils.SendErrorResponse(w, "invalid raid device given")
		return
	}

	sdXDev, err := utils.PostPara(r, "memDev")
	if err != nil {
		utils.SendErrorResponse(w, "invalid member device given")
		return
	}

	//Check if target array exists
	if !m.RAIDDeviceExists(mdDev) {
		utils.SendErrorResponse(w, "target RAID array not exists")
		return
	}

	//Check if disk already in another RAID array or mounted
	isMounted, err := diskfs.DeviceIsMounted(sdXDev)
	if err != nil {
		utils.SendErrorResponse(w, "unable to read device state")
		return
	}

	if isMounted {
		utils.SendErrorResponse(w, "target device is mounted")
		return
	}

	diskUsedByAnotherRAID, err := m.DiskIsUsedInAnotherRAIDVol(sdXDev)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
	}

	if diskUsedByAnotherRAID {
		utils.SendErrorResponse(w, "target device already been used by another RAID volume")
		return
	}

	isOSDisk, err := m.DiskIsRoot(sdXDev)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
	}

	if isOSDisk {
		utils.SendErrorResponse(w, "OS disk cannot be used as RAID member")
		return
	}

	//OK! Clear the disk
	err = m.ClearSuperblock(sdXDev)
	if err != nil {
		utils.SendErrorResponse(w, "unable to clear superblock of device")
		return
	}

	//Add it to the target RAID array
	err = m.AddDisk(mdDev, sdXDev)
	if err != nil {
		utils.SendErrorResponse(w, "adding disk to RAID volume failed")
		return
	}

	log.Println("[RAID] Device " + sdXDev + " added to RAID volume " + mdDev)

	utils.SendOK(w)
}

// Handle force flush reloading mdadm to solve the md0 become md127 problem
func (m *Manager) HandleMdadmFlushReload(w http.ResponseWriter, r *http.Request) {
	err := m.FlushReload()
	if err != nil {
		utils.SendErrorResponse(w, "reload failed: "+strings.ReplaceAll(err.Error(), "\n", " "))
		return
	}
	utils.SendOK(w)
}

// Handle resolving the disk model label, might return null
func (m *Manager) HandleResolveDiskModelLabel(w http.ResponseWriter, r *http.Request) {
	devName, err := utils.GetPara(r, "devName")
	if err != nil {
		utils.SendErrorResponse(w, "invalid device name given")
		return
	}

	//Function only accept sdX not /dev/sdX
	devName = filepath.Base(devName)

	labelSize, labelModel, err := diskfs.GetDiskModelByName(devName)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	js, _ := json.Marshal([]string{labelModel, labelSize})
	utils.SendJSONResponse(w, string(js))
}

// Handle force flush reloading mdadm to solve the md0 become md127 problem
func (m *Manager) HandlListChildrenDeviceInfo(w http.ResponseWriter, r *http.Request) {
	devName, err := utils.GetPara(r, "devName")
	if err != nil {
		utils.SendErrorResponse(w, "invalid device name given")
		return
	}

	if !strings.HasPrefix(devName, "/dev/") {
		devName = "/dev/" + devName
	}

	//Get the children devices for this RAID
	raidDevice, err := m.GetRAIDDeviceByDevicePath(devName)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Merge the child devices info into one array
	results := map[string]*diskfs.BlockDeviceMeta{}
	for _, blockdevice := range raidDevice.Members {
		bdm, err := diskfs.GetBlockDeviceMeta("/dev/" + blockdevice.Name)
		if err != nil {
			log.Println("[RAID] Unable to load block device info: " + err.Error())
			results[blockdevice.Name] = &diskfs.BlockDeviceMeta{
				Name: blockdevice.Name,
				Size: -1,
			}

			continue
		}

		results[blockdevice.Name] = bdm
	}

	js, _ := json.Marshal(results)
	utils.SendJSONResponse(w, string(js))
}

// Handle list all the disks that is usable
func (m *Manager) HandleListUsableDevices(w http.ResponseWriter, r *http.Request) {
	storageDevices, err := diskfs.ListAllStorageDevices()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Filter out the block devices that are disks
	usableDisks := []diskfs.BlockDeviceMeta{}
	for _, device := range storageDevices.Blockdevices {
		if device.Type == "disk" {
			usableDisks = append(usableDisks, device)
		}
	}

	js, _ := json.Marshal(usableDisks)
	utils.SendJSONResponse(w, string(js))

}

// Handle loading the detail of a given RAID array
func (m *Manager) HandleLoadArrayDetail(w http.ResponseWriter, r *http.Request) {
	devName, err := utils.GetPara(r, "devName")
	if err != nil {
		utils.SendErrorResponse(w, "invalid device name given")
		return
	}

	if !strings.HasPrefix(devName, "/dev/") {
		devName = "/dev/" + devName
	}

	//Check device exists
	if !utils.FileExists(devName) {
		utils.SendErrorResponse(w, "target device not exists")
		return
	}

	//Get status of the array
	targetRAIDInfo, err := m.GetRAIDInfo(devName)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	js, _ := json.Marshal(targetRAIDInfo)
	utils.SendJSONResponse(w, string(js))
}

// Handle formating a device
func (m *Manager) HandleFormatRaidDevice(w http.ResponseWriter, r *http.Request) {
	devName, err := utils.GetPara(r, "devName")
	if err != nil {
		utils.SendErrorResponse(w, "invalid device name given")
		return
	}

	format, err := utils.GetPara(r, "format")
	if err != nil {
		utils.SendErrorResponse(w, "invalid device name given")
		return
	}

	if !strings.HasPrefix(devName, "/dev/") {
		devName = "/dev/" + devName
	}

	//Check if the target device exists
	if !m.RAIDDeviceExists(devName) {
		utils.SendErrorResponse(w, "target not exists or not a valid RAID device")
		return
	}

	//Format the drive
	err = diskfs.FormatStorageDevice(format, devName)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

// List all the raid device in this system
func (m *Manager) HandleListRaidDevices(w http.ResponseWriter, r *http.Request) {
	rdevs, err := m.GetRAIDDevicesFromProcMDStat()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	results := []*RAIDInfo{}
	for _, rdev := range rdevs {
		arrayInfo, err := m.GetRAIDInfo("/dev/" + rdev.Name)
		if err != nil {
			continue
		}

		results = append(results, arrayInfo)
	}

	js, _ := json.Marshal(results)
	utils.SendJSONResponse(w, string(js))
}

// Create a RAID storage pool
func (m *Manager) HandleCreateRAIDDevice(w http.ResponseWriter, r *http.Request) {
	//TODO: Change GetPara to Post
	devName, err := utils.GetPara(r, "devName")
	if err != nil || devName == "" {
		//Use auto generated one
		devName, err = GetNextAvailableMDDevice()
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
	}
	raidName, err := utils.GetPara(r, "raidName")
	if err != nil {
		utils.SendErrorResponse(w, "invalid raid storage name given")
		return
	}
	raidLevelStr, err := utils.GetPara(r, "level")
	if err != nil {
		utils.SendErrorResponse(w, "invalid raid level given")
		return
	}

	raidDevicesJSON, err := utils.GetPara(r, "raidDev")
	if err != nil {
		utils.SendErrorResponse(w, "invalid raid device array given")
		return
	}

	spareDevicesJSON, err := utils.GetPara(r, "spareDev")
	if err != nil {
		utils.SendErrorResponse(w, "invalid spare device array given")
		return
	}

	//Convert raidDevices and spareDevices ID into string slice
	raidDevices := []string{}
	spareDevices := []string{}

	err = json.Unmarshal([]byte(raidDevicesJSON), &raidDevices)
	if err != nil {
		utils.SendErrorResponse(w, "unable to parse raid device into array")
		return
	}

	err = json.Unmarshal([]byte(spareDevicesJSON), &spareDevices)
	if err != nil {
		utils.SendErrorResponse(w, "unable to parse spare devices into array")
		return
	}

	//Make sure RAID Name do not contain spaces or werid charcters
	if strings.Contains(raidName, " ") {
		utils.SendErrorResponse(w, "raid name cannot contain space")
		return
	}

	//Convert raidLevel to int
	raidLevel, err := strconv.Atoi(raidLevelStr)
	if err != nil {
		utils.SendErrorResponse(w, "invalid raid level given")
		return
	}

	//Create the RAID device
	err = m.CreateRAIDDevice(devName, raidName, raidLevel, raidDevices, spareDevices)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Update the mdadm config
	err = m.UpdateMDADMConfig()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

// Request to reload the RAID manager and scan new / fix missing raid pools
func (m *Manager) HandleRaidDevicesAssemble(w http.ResponseWriter, r *http.Request) {
	err := m.RestartRAIDService()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

// Remove a given raid device with its name, USE WITH CAUTION
func (m *Manager) HandleRemoveRaideDevice(w http.ResponseWriter, r *http.Request) {
	//TODO: Add protection and switch to POST
	targetDevice, err := utils.PostPara(r, "raidDev")
	if err != nil {
		utils.SendErrorResponse(w, "target device not given")
		return
	}

	//Check if the raid device exists
	if !m.RAIDDeviceExists(targetDevice) {
		utils.SendErrorResponse(w, "target device not exists")
		return
	}

	//Get the RAID device memeber disks
	targetRAIDDevice, err := m.GetRAIDDeviceByDevicePath(targetDevice)
	if err != nil {
		utils.SendErrorResponse(w, "error occured when trying to load target RAID device info")
		return
	}

	//Check if it is mounted. If yes, unmount it
	if !strings.HasPrefix(targetDevice, "/dev/") {
		targetDevice = filepath.Join("/dev/", targetDevice)
	}

	mounted, err := diskfs.DeviceIsMounted(targetDevice)
	if err != nil {
		log.Println("[RAID] Unmount failed: " + err.Error())
		utils.SendErrorResponse(w, err.Error())
		return
	}

	fmt.Println(mounted)

	if mounted {
		log.Println("[RAID] " + targetDevice + " is mounted. Trying to unmount...")
		err = diskfs.UnmountDevice(targetDevice)
		if err != nil {
			log.Println("[RAID] Unmount failed: " + err.Error())
			utils.SendErrorResponse(w, err.Error())
			return
		}

		//Wait for 3 seconds to check if it is still mounted
		counter := 0
		for counter < 3 {
			mounted, _ := diskfs.DeviceIsMounted(targetDevice)
			if mounted {
				//Still not unmounted. Wait for it
				log.Println("[RAID] Device still mounted. Retrying in 1 second")
				counter++
				time.Sleep(1 * time.Second)
			} else {
				break
			}
		}

		//Check if it is still mounted
		mounted, _ = diskfs.DeviceIsMounted(targetDevice)
		if mounted {
			utils.SendErrorResponse(w, "unmount RAID partition failed: device is busy")
			return
		}
	}

	//Give it some time for the raid device to finish umount
	time.Sleep(300 * time.Millisecond)

	//Stop & Remove RAID service on the target device
	err = m.StopRAIDDevice(targetDevice)
	if err != nil {
		log.Println("[RAID] Stop RAID partition failed: " + err.Error())
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Zeroblock the RAID device member disks
	for _, memberDisk := range targetRAIDDevice.Members {
		//Member disk name do not contain full path
		name := memberDisk.Name
		if !strings.HasPrefix(name, "/dev/") {
			name = filepath.Join("/dev/", name)
		}

		err = m.ClearSuperblock(name)
		if err != nil {
			log.Println("[RAID] Unable to clear superblock on device " + name)
			continue
		}
	}

	//Update the mdadm config
	err = m.UpdateMDADMConfig()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Done
	utils.SendOK(w)
}
