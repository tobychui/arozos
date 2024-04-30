package raid

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

/*
	losetup.go

	This script handle losetup loopback interface setup and listing
*/

type LoopDevice struct {
	Device         string
	PartitionRange string
	ImageFile      string
}

// List all the loop devices
func ListAllLoopDevices() ([]*LoopDevice, error) {
	cmd := exec.Command("sudo", "losetup", "-a")

	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("error running losetup -a command: %v", err)
	}

	//Example of returned values
	// /dev/loop0: [2049]:265955 (/home/aroz/test/sdX.img)

	// Split the output into lines and extract device names
	lines := strings.Split(string(output), "\n")
	var devices []*LoopDevice = []*LoopDevice{}
	for _, line := range lines {
		fields := strings.Fields(line)
		if len(fields) >= 3 {
			//As the image name contains a bracket, that needs to be trimmed off
			imageName := strings.TrimPrefix(strings.TrimSpace(fields[2]), "(")
			imageName = strings.TrimSuffix(imageName, ")")
			devices = append(devices, &LoopDevice{
				Device:         strings.TrimSuffix(fields[0], ":"),
				PartitionRange: fields[1],
				ImageFile:      imageName,
			})
		}
	}

	return devices, nil
}

// Mount an given image path as loopback device
func MountImageAsLoopDevice(imagePath string) error {
	cmd := exec.Command("sudo", "losetup", "-f", imagePath)

	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("creating loopback device failed: %v", err)
	}

	return nil
}

// Unmount a loop device by the image path
func UnmountLoopDeviceByImagePath(imagePath string) error {
	imagePathIsMounted, err := ImageMountedAsLoopDevice(imagePath)
	if err != nil {
		return err
	}

	if !imagePathIsMounted {
		//Image already unmounted. No need to unmount
		return nil
	}

	loopDriveID, err := GetLoopDriveIDFromImagePath(imagePath)
	if err != nil {
		return err
	}

	//As we checked for mounted above, no need to check if loopDriveID is empty string
	return UnmountLoopDeviceByID(loopDriveID)
}

// Unmount the loop device by id e.g. /dev/loop1
func UnmountLoopDeviceByID(loopDevId string) error {
	cmd := exec.Command("sudo", "losetup", "-d", loopDevId)

	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("delete loopback device failed: %v", err)
	}

	return nil
}

// Get loopdrive ID (/dev/loop1) by the image path, return empty string if not found error if load failed
func GetLoopDriveIDFromImagePath(imagePath string) (string, error) {
	absPath, err := filepath.Abs(imagePath)
	if err != nil {
		return "", err
	}

	devs, err := ListAllLoopDevices()
	if err != nil {
		return "", err
	}

	for _, dev := range devs {
		if filepath.ToSlash(dev.ImageFile) == filepath.ToSlash(absPath) {
			//Found. already mounted
			return dev.Device, nil
		}
	}

	return "", nil
}

// Check if an image file is already mounted as loop drive
func ImageMountedAsLoopDevice(imagePath string) (bool, error) {
	loopDriveId, err := GetLoopDriveIDFromImagePath(imagePath)
	if err != nil {
		return false, err
	}
	return loopDriveId != "", nil
}
