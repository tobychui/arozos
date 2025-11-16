package raid

import (
	"errors"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/utils"
)

/*
	mdadm manager

	This script handles the interaction with mdadm
*/

// RAIDDevice represents information about a RAID device.
type RAIDMember struct {
	Name   string //sdX
	Seq    int    //Sequence in RAID arary
	Failed bool   //If details output with (F) tag this will set to true
}

type RAIDDevice struct {
	Name    string
	Status  string
	Level   string
	Members []*RAIDMember
}

// Return the uuid of the disk by its path name (e.g. /dev/sda)
func (m *Manager) GetDiskUUIDByPath(devicePath string) (string, error) {
	cmd := exec.Command("sudo", "blkid", devicePath)

	output, err := cmd.CombinedOutput()
	if err != nil {
		return "", fmt.Errorf("blkid error: %v", err)
	}

	// Parse the output to extract the UUID
	fields := strings.Fields(string(output))
	for _, field := range fields {
		if strings.HasPrefix(field, "UUID=") {
			uuid := strings.TrimPrefix(field, "UUID=\"")
			uuid = strings.TrimSuffix(uuid, "\"")
			return uuid, nil
		}
	}

	return "", fmt.Errorf("UUID not found for device %s", devicePath)
}

// CreateRAIDDevice creates a RAID device using the mdadm command.
func (m *Manager) CreateRAIDDevice(devName string, raidName string, raidLevel int, raidDeviceIds []string, spareDeviceIds []string) error {
	//Calculate the size of the raid devices
	raidDev := len(raidDeviceIds)
	spareDevice := len(spareDeviceIds)

	//Validate if raid level
	if !IsValidRAIDLevel("raid" + strconv.Itoa(raidLevel)) {
		return fmt.Errorf("invalid or unsupported raid level given: raid%d", raidLevel)
	}

	//Validate the number of disk is enough for the raid
	if raidLevel == 0 && raidDev < 2 {
		return fmt.Errorf("not enough disks for raid0")
	} else if raidLevel == 1 && raidDev < 2 {
		return fmt.Errorf("not enough disks for raid1")
	} else if raidLevel == 5 && raidDev < 3 {
		return fmt.Errorf("not enough disk for raid5")
	} else if raidLevel == 6 && raidDev < 4 {
		return fmt.Errorf("not enough disk for raid6")
	}

	//Append /dev to the name if missing
	if !strings.HasPrefix(devName, "/dev/") {
		devName = "/dev/" + devName
	}

	if utils.FileExists(devName) {
		//RAID device already exists
		return errors.New(devName + " already been used")
	}

	//Append /dev to the name of the raid device ids and spare device ids if missing
	for i, raidDev := range raidDeviceIds {
		if !strings.HasPrefix(raidDev, "/dev/") {
			raidDeviceIds[i] = filepath.Join("/dev/", raidDev)
		}
	}
	for i, spareDev := range spareDeviceIds {
		if !strings.HasPrefix(spareDev, "/dev/") {
			spareDeviceIds[i] = filepath.Join("/dev/", spareDev)
		}
	}

	// Concatenate RAID and spare device arrays
	allDeviceIds := append(raidDeviceIds, spareDeviceIds...)

	// Build the mdadm command
	mdadmCommand := fmt.Sprintf("yes | sudo mdadm --create %s --name %s --level=%d --raid-devices=%d --spare-devices=%d %s", devName, raidName, raidLevel, raidDev, spareDevice, strings.Join(allDeviceIds, " "))
	if raidLevel == 0 {
		//raid0 cannot use --spare-device command as there is no failover
		mdadmCommand = fmt.Sprintf("yes | sudo mdadm --create %s --name %s --level=%d --raid-devices=%d %s", devName, raidName, raidLevel, raidDev, strings.Join(allDeviceIds, " "))
	}
	cmd := exec.Command("bash", "-c", mdadmCommand)

	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("error running mdadm command: %v", err)
	}

	return nil
}

// GetRAIDDevicesFromProcMDStat retrieves information about RAID devices from /proc/mdstat.
// if your RAID array is in auto-read-only mode, it is (usually) brand new
func (m *Manager) GetRAIDDevicesFromProcMDStat() ([]RAIDDevice, error) {
	// Execute the cat command to read /proc/mdstat
	cmd := exec.Command("cat", "/proc/mdstat")

	// Run the command and capture its output
	output, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("error running cat command: %v", err)
	}

	// Convert the output to a string and split it into lines
	lines := strings.Split(string(output), "\n")

	// Initialize an empty slice to store RAID devices
	raidDevices := make([]RAIDDevice, 0)

	// Iterate over the lines, skipping the first line (Personalities)
	// Lines usually looks like this
	// md0 : active raid1 sdc[1] sdb[0]
	for _, line := range lines[1:] {
		// Skip empty lines
		if line == "" {
			continue
		}

		// Split the line by colon (:)
		parts := strings.SplitN(line, " : ", 2)
		if len(parts) != 2 {
			continue
		}

		// Extract device name and status
		deviceName := parts[0]

		// Split the members string by space to get individual member devices
		info := strings.Fields(parts[1])
		if len(info) < 2 {
			//Malform output
			continue
		}

		deviceStatus := info[0]

		//Raid level usually appears at position 1 - 2, check both
		raidLevel := ""
		if strings.HasPrefix(info[1], "raid") {
			raidLevel = info[1]
		} else if strings.HasPrefix(info[2], "raid") {
			raidLevel = info[2]
		}

		//Get the members (disks) of the array
		members := []*RAIDMember{}
		for _, disk := range info[2:] {
			if !strings.HasPrefix(disk, "sd") {
				//Probably not a storage device
				continue
			}

			//In sda[0] format, we need to split out the number from the disk seq
			tmp := strings.Split(disk, "[")
			if len(tmp) != 2 {
				continue
			}

			//Convert the sequence to id
			diskFailed := false
			if strings.HasSuffix(strings.TrimSpace(tmp[1]), "(F)") {
				//Trim off the Fail label
				diskFailed = true
				tmp[1] = strings.TrimSuffix(strings.TrimSpace(tmp[1]), "(F)")
			}
			seqInt, err := strconv.Atoi(strings.TrimSuffix(strings.TrimSpace(tmp[1]), "]"))
			if err != nil {
				//Not an integer?
				log.Println("[RAID] Unable to parse " + disk + " sequence ID")
				continue
			}
			member := RAIDMember{
				Name:   strings.TrimSpace(tmp[0]),
				Seq:    seqInt,
				Failed: diskFailed,
			}

			members = append(members, &member)
		}

		//Sort the member disks
		sort.Slice(members[:], func(i, j int) bool {
			return members[i].Seq < members[j].Seq
		})

		// Create a RAIDDevice struct and append it to the slice
		raidDevice := RAIDDevice{
			Name:    deviceName,
			Status:  deviceStatus,
			Level:   raidLevel,
			Members: members,
		}
		raidDevices = append(raidDevices, raidDevice)
	}

	return raidDevices, nil
}

// Check if a disk is failed in given array
func (m *Manager) DiskIsFailed(mdDevice, diskPath string) (bool, error) {
	raidDevices, err := m.GetRAIDDeviceByDevicePath(mdDevice)
	if err != nil {
		return false, err
	}

	diskName := filepath.Base(diskPath)

	for _, disk := range raidDevices.Members {
		if disk.Name == diskName {
			return disk.Failed, nil
		}
	}

	return false, errors.New("target disk not found in this array")
}

// FailDisk label a disk as failed
func (m *Manager) FailDisk(mdDevice, diskPath string) error {
	//mdadm commands require full path
	if !strings.HasPrefix(diskPath, "/dev/") {
		diskPath = filepath.Join("/dev/", diskPath)
	}
	if !strings.HasPrefix(mdDevice, "/dev/") {
		mdDevice = filepath.Join("/dev/", mdDevice)
	}

	cmd := exec.Command("sudo", "mdadm", mdDevice, "--fail", diskPath)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to fail disk: %v", err)
	}
	return nil
}

// RemoveDisk removes a failed disk from the specified RAID array using mdadm.
// must be failed before remove
func (m *Manager) RemoveDisk(mdDevice, diskPath string) error {
	//mdadm commands require full path
	if !strings.HasPrefix(diskPath, "/dev/") {
		diskPath = filepath.Join("/dev/", diskPath)
	}
	if !strings.HasPrefix(mdDevice, "/dev/") {
		mdDevice = filepath.Join("/dev/", mdDevice)
	}

	cmd := exec.Command("sudo", "mdadm", mdDevice, "--remove", diskPath)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to remove disk: %v", err)
	}
	return nil
}

// Add disk to a given RAID array, must be unmounted and not in-use
func (m *Manager) AddDisk(mdDevice, diskPath string) error {
	//mdadm commands require full path
	if !strings.HasPrefix(diskPath, "/dev/") {
		diskPath = filepath.Join("/dev/", diskPath)
	}
	if !strings.HasPrefix(mdDevice, "/dev/") {
		mdDevice = filepath.Join("/dev/", mdDevice)
	}

	cmd := exec.Command("sudo", "mdadm", mdDevice, "--add", diskPath)
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("failed to add disk: %v", err)
	}
	return nil
}

// GrowRAIDDevice grows the specified RAID device to its maximum size
func (m *Manager) GrowRAIDDevice(deviceName string) error {
	//Prevent anyone passing /dev/md0 into the deviceName field
	deviceName = strings.TrimPrefix(deviceName, "/dev/")

	// Construct the mdadm command
	cmd := exec.Command("sudo", "mdadm", "--grow", fmt.Sprintf("/dev/%s", deviceName), "--size=max")

	// Execute the command
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to grow RAID device: %v, output: %s", err, string(output))
	}

	fmt.Printf("[RAID] Successfully grew RAID device %s. Output: %s\n", deviceName, string(output))
	return nil
}
