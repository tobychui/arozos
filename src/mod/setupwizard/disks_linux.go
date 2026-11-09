//go:build linux

package setupwizard

import (
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// Supported reports whether this platform can list, format and mount disks
const Supported = true

// mediaRoot is where the wizard mounts the disks it adds
const mediaRoot = "/media"

// formatTimeout bounds one mkfs run. A quick format takes seconds, but a
// large vfat disk can take a while.
const formatTimeout = 30 * time.Minute

var formatLock sync.Mutex

// ListDisks lists the disks of this host
func ListDisks(used []UsedDrive) ([]Disk, error) {
	out, err := exec.Command("lsblk", "-b", "-J", "-o", "NAME,TYPE,SIZE,FSTYPE,UUID,LABEL,MOUNTPOINT,MODEL,RM").Output()
	if err != nil {
		return nil, fmt.Errorf("lsblk failed: %v", err)
	}
	return ParseDisks(out, used)
}

// Format creates a file system on a partition, or on a disk with no
// partitions, after checking on a fresh listing that nothing uses the disk
func Format(device string, fstype string, label string, used []UsedDrive) error {
	if !formatLock.TryLock() {
		return errors.New("Another disk is being formatted, please wait")
	}
	defer formatLock.Unlock()

	disks, err := ListDisks(used)
	if err != nil {
		return err
	}
	if _, err := CheckFormat(disks, device); err != nil {
		return err
	}
	bin, args, err := FormatCommand(fstype, label, device)
	if err != nil {
		return err
	}
	binPath, err := exec.LookPath(bin)
	if err != nil {
		return fmt.Errorf("%s is not installed on this server", bin)
	}

	ctx, cancel := context.WithTimeout(context.Background(), formatTimeout)
	defer cancel()
	out, err := exec.CommandContext(ctx, binPath, args...).CombinedOutput()
	if err != nil {
		message := strings.TrimSpace(string(out))
		if message == "" {
			message = err.Error()
		}
		return errors.New("Format failed: " + message)
	}

	//Wait for udev to publish the new file system and its UUID
	if settle, err := exec.LookPath("udevadm"); err == nil {
		exec.Command(settle, "settle", "--timeout=10").Run()
	}
	return nil
}

// PrepareMountPoint returns an empty folder to mount a new drive on
func PrepareMountPoint(id string) (string, error) {
	if !ValidDriveID(id) {
		return "", errors.New("A drive id can only contain letters, numbers, - and _")
	}
	mountpoint := filepath.Join(mediaRoot, id)
	info, err := os.Stat(mountpoint)
	if err == nil {
		if !info.IsDir() {
			return "", errors.New(mountpoint + " already exists and is not a folder")
		}
		entries, err := os.ReadDir(mountpoint)
		if err != nil {
			return "", err
		}
		if len(entries) > 0 {
			return "", errors.New(mountpoint + " is not empty. Choose another drive ID")
		}
		return mountpoint, nil
	}
	if !errors.Is(err, os.ErrNotExist) {
		return "", err
	}
	return mountpoint, os.MkdirAll(mountpoint, 0755)
}
