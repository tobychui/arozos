package raid

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"

	"imuslab.com/arozos/mod/apt"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

/*
	RAID management package for handling RAID and Virtual Image Creation
	for Linux with mdadm installed
*/

type Options struct {
	Logger *logger.Logger
}

type Manager struct {
	Options *Options
}

// Create a new raid manager
func NewRaidManager(options Options) (out0 *Manager, out1 error) {
	defer logger.Out2(logger.In1("disk/raid", "NewRaidManager", "&options", &options), &out0, &out1)
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
func CreateVirtualPartition(imagePath string, totalSize int64) (out0 error) {
	defer logger.Out1(logger.In2("disk/raid", "CreateVirtualPartition", "imagePath", imagePath, "totalSize", totalSize), &out0)
	cmd := exec.Command("sudo", "dd", "if=/dev/zero", "of="+imagePath, "bs=4M", "count="+fmt.Sprintf("%dM", totalSize/(4*1024*1024)))

	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr

	err := cmd.Run()
	if err != nil {
		logger.DebugErr("disk/raid", err)
		return fmt.Errorf("dd error: %v", err)
	}

	return nil
}

// Format the given image file
func FormatVirtualPartition(imagePath string) (out0 error) {
	defer logger.Out1(logger.In1("disk/raid", "FormatVirtualPartition", "imagePath", imagePath), &out0)
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
		logger.DebugErr("disk/raid", err)
		return fmt.Errorf("error running mkfs.ext4 command: %v", err)
	}

	return nil
}
