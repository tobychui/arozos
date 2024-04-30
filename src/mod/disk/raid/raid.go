package raid

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"imuslab.com/arozos/mod/apt"
	"imuslab.com/arozos/mod/utils"
)

/*
	RAID management package for handling RAID and Virtual Image Creation
	for Linux with mdadm installed
*/

type Options struct {
}

type Manager struct {
	Options *Options
}

// Create a new raid manager
func NewRaidManager(options Options) (*Manager, error) {
	//Check if platform is supported
	if runtime.GOOS != "linux" {
		return nil, errors.New("ArozOS do not support RAID management on this platform")
	}

	//Check if mdadm exists
	mdadmExists, err := apt.PackageExists("mdadm")
	if err != nil || !mdadmExists {
		return nil, errors.New("mdadm not installed on this host")
	}
	return &Manager{
		Options: &options,
	}, nil
}

// Create a virtual image partition at given path with given size
func CreateVirtualPartition(imagePath string, totalSize int64) error {
	cmd := exec.Command("sudo", "dd", "if=/dev/zero", "of="+imagePath, "bs=4M", "count="+fmt.Sprintf("%dM", totalSize/(4*1024*1024)))

	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("dd error: %v", err)
	}

	return nil
}

// Format the given image file
func FormatVirtualPartition(imagePath string) error {
	//Check if image actually exists
	if !utils.FileExists(imagePath) {
		return errors.New("image file not exists")
	}

	if filepath.Ext(imagePath) != ".img" {
		return errors.New("given file is not an image path")
	}

	cmd := exec.Command("sudo", "mkfs.ext4", imagePath)

	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("error running mkfs.ext4 command: %v", err)
	}

	return nil
}
