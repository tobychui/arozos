package diskfs

import (
	"encoding/json"
	"fmt"
	"os/exec"
	"strings"
)

type BlockDeviceModelInfo struct {
	Name     string                 `json:"name"`
	Size     string                 `json:"size"`
	Model    string                 `json:"model"`
	Children []BlockDeviceModelInfo `json:"children"`
}

// Get disk model name by disk name (sdX, not /dev/sdX), return the model name (if any) and expected size (not actual)
// return device labeled size, model and error if any
func GetDiskModelByName(name string) (string, string, error) {
	cmd := exec.Command("sudo", "lsblk", "--json", "-o", "NAME,SIZE,MODEL")

	output, err := cmd.Output()
	if err != nil {
		return "", "", fmt.Errorf("error running lsblk: %v", err)
	}

	var blockDevices struct {
		BlockDevices []BlockDeviceModelInfo `json:"blockdevices"`
	}

	if err := json.Unmarshal(output, &blockDevices); err != nil {
		return "", "", fmt.Errorf("error parsing lsblk output: %v", err)
	}

	return findDiskInfo(blockDevices.BlockDevices, name)
}

func findDiskInfo(blockDevices []BlockDeviceModelInfo, name string) (string, string, error) {
	for _, device := range blockDevices {
		if device.Name == name {
			return device.Size, device.Model, nil
		}
		if strings.HasPrefix(name, device.Name) {
			return findDiskInfo(device.Children, name)
		}
	}
	return "", "", fmt.Errorf("disk not found: %s", name)
}
