package setupwizard

/*
	Setup Wizard disk inspection

	The first-run Setup Wizard lists the disks of the host so a beginner can
	add one as storage. This file holds the platform independent part: parsing
	the lsblk listing, deciding what each disk and partition is used for and
	building the format command. Running lsblk, mkfs and preparing the mount
	point is in disks_linux.go; other platforms report that disks cannot be
	managed here (disks_other.go).

	Formatting is only offered for a disk that nothing uses: no partition of it
	is mounted, holds swap, RAID, LVM or encryption, or backs an ArozOS drive.
	The check is repeated on a fresh listing right before mkfs runs.
*/

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// Reasons a disk or partition is in use. The wizard translates them.
const (
	UseSystem    = "system"    //Holds the operating system (/, /boot, swap of the root disk)
	UseMounted   = "mounted"   //Mounted somewhere by the host
	UseDrive     = "drive"     //Backs an ArozOS drive
	UseSwap      = "swap"      //Swap space
	UseRAID      = "raid"      //Member of a software RAID array
	UseLVM       = "lvm"       //LVM physical volume
	UseEncrypted = "encrypted" //LUKS container
	UseHolder    = "holder"    //Another device is built on top of it
)

// Ways a partition can become an ArozOS drive
const (
	AddMount  = "mount"  //ArozOS mounts it under the media folder at every start
	AddFolder = "folder" //Already mounted by the host, used as a plain folder
)

// ErrUnsupported is returned by the disk functions on platforms other than Linux
var ErrUnsupported = errors.New("Disks can only be listed, formatted and mounted on Linux")

// FormatTypes are the file systems the wizard can create, in the order offered
var FormatTypes = []string{"ext4", "ntfs", "vfat"}

// mountableTypes are the local file systems an ArozOS drive can mount
var mountableTypes = map[string]bool{"ext4": true, "ext3": true, "ext2": true, "vfat": true, "fat": true, "ntfs": true}

// systemMounts are the mount points of the running system
var systemMounts = map[string]bool{
	"/": true, "/boot": true, "/boot/efi": true, "/boot/firmware": true,
	"/usr": true, "/var": true, "/home": true, "/opt": true, "/srv": true, "[SWAP]": true,
}

// Disk is one physical disk and its partitions
type Disk struct {
	Name       string      `json:"name"`
	Path       string      `json:"path"`
	Model      string      `json:"model"`
	Size       int64       `json:"size"`
	Removable  bool        `json:"removable"`
	Whole      bool        `json:"whole"`           //No partition table: its only entry is the disk itself
	InUse      string      `json:"inUse,omitempty"` //Why nothing on this disk may be formatted
	Partitions []Partition `json:"partitions"`
}

// Partition is one partition, or the whole disk when it has no partitions
type Partition struct {
	Name       string `json:"name"`
	Path       string `json:"path"`
	Fstype     string `json:"fstype"`
	UUID       string `json:"uuid"`
	Label      string `json:"label"`
	Size       int64  `json:"size"`
	Mountpoint string `json:"mountpoint"`
	DriveID    string `json:"driveId,omitempty"` //ArozOS drive already using it
	InUse      string `json:"inUse,omitempty"`
	CanFormat  bool   `json:"canFormat"`
	CanAdd     bool   `json:"canAdd"`
	AddMode    string `json:"addMode,omitempty"`
}

// UsedDrive is an ArozOS drive, used to spot the partitions already in use
type UsedDrive struct {
	ID       string
	Mountdev string //e.g. /dev/sda1
	DiskUUID string //Partition UUID
	Path     string //Folder the drive serves
}

// lsblkDevice is one entry of `lsblk -b -J -o NAME,TYPE,SIZE,FSTYPE,UUID,LABEL,MOUNTPOINT,MODEL,RM`.
// Old lsblk versions print numbers and booleans as strings, so most fields
// are decoded loosely.
type lsblkDevice struct {
	Name       string          `json:"name"`
	Type       string          `json:"type"`
	Size       json.RawMessage `json:"size"`
	Fstype     *string         `json:"fstype"`
	UUID       *string         `json:"uuid"`
	Label      *string         `json:"label"`
	Mountpoint *string         `json:"mountpoint"`
	Model      *string         `json:"model"`
	Rm         json.RawMessage `json:"rm"`
	Children   []lsblkDevice   `json:"children"`
}

type lsblkOutput struct {
	Blockdevices []lsblkDevice `json:"blockdevices"`
}

// Virtual or boot-area block devices that are never storage disks
var ignoredDiskName = regexp.MustCompile(`^(zram|ram|loop|sr|fd)\d*|^mmcblk\d+(boot\d+|rpmb)$`)

// ParseDisks turns an lsblk JSON listing into the disks the wizard shows
func ParseDisks(lsblkJSON []byte, used []UsedDrive) ([]Disk, error) {
	var out lsblkOutput
	if err := json.Unmarshal(lsblkJSON, &out); err != nil {
		return nil, fmt.Errorf("could not read the disk list: %v", err)
	}
	disks := []Disk{}
	for _, dev := range out.Blockdevices {
		if dev.Type != "disk" || ignoredDiskName.MatchString(dev.Name) {
			continue
		}
		size := looseInt(dev.Size)
		if size <= 0 {
			//An empty card reader slot
			continue
		}
		disk := Disk{
			Name:       dev.Name,
			Path:       "/dev/" + dev.Name,
			Model:      strings.TrimSpace(str(dev.Model)),
			Size:       size,
			Removable:  looseBool(dev.Rm),
			Partitions: []Partition{},
		}

		parts := []lsblkDevice{}
		for _, child := range dev.Children {
			if child.Type == "part" {
				parts = append(parts, child)
			}
		}
		if len(parts) == 0 {
			//No partition table: the disk itself is the only thing to use
			disk.Whole = true
			disk.Partitions = append(disk.Partitions, analysePartition(dev, used))
		} else {
			for _, part := range parts {
				disk.Partitions = append(disk.Partitions, analysePartition(part, used))
			}
		}
		disk.InUse = diskUse(disk.Partitions)
		for i := range disk.Partitions {
			disk.Partitions[i].CanFormat = disk.InUse == ""
		}
		disks = append(disks, disk)
	}
	return disks, nil
}

// analysePartition works out what a partition is used for and how it could
// become a drive
func analysePartition(dev lsblkDevice, used []UsedDrive) Partition {
	p := Partition{
		Name:       dev.Name,
		Path:       "/dev/" + dev.Name,
		Fstype:     strings.ToLower(str(dev.Fstype)),
		UUID:       str(dev.UUID),
		Label:      str(dev.Label),
		Size:       looseInt(dev.Size),
		Mountpoint: str(dev.Mountpoint),
	}
	p.DriveID = driveUsing(p, used)

	switch {
	case p.Fstype == "swap" || p.Mountpoint == "[SWAP]":
		p.InUse = UseSwap
	case systemMounts[p.Mountpoint]:
		p.InUse = UseSystem
	case p.Fstype == "linux_raid_member":
		p.InUse = UseRAID
	case p.Fstype == "lvm2_member":
		p.InUse = UseLVM
	case p.Fstype == "crypto_luks":
		p.InUse = UseEncrypted
	case p.DriveID != "":
		p.InUse = UseDrive
	case p.Mountpoint != "":
		p.InUse = UseMounted
	}
	if p.InUse == "" {
		for _, holder := range dev.Children {
			p.InUse = holderUse(holder.Type)
			break
		}
	}

	//A drive can be made of a supported file system nothing else claims
	if p.DriveID == "" && mountableTypes[p.Fstype] {
		switch p.InUse {
		case "":
			p.CanAdd = true
			p.AddMode = AddMount
		case UseMounted:
			p.CanAdd = true
			p.AddMode = AddFolder
		}
	}
	return p
}

func holderUse(deviceType string) string {
	switch {
	case strings.HasPrefix(deviceType, "raid"):
		return UseRAID
	case deviceType == "lvm":
		return UseLVM
	case deviceType == "crypt":
		return UseEncrypted
	}
	return UseHolder
}

// drivePath trims the slash a drive path ends with, but keeps the root
func drivePath(path string) string {
	path = strings.TrimSpace(path)
	if len(path) > 1 {
		path = strings.TrimRight(path, "/")
	}
	return path
}

// drivesUsingPath reports whether a drive serves a folder of this mount point
func drivesUsingPath(mountpoint string, drive UsedDrive) bool {
	if mountpoint == "" || systemMounts[mountpoint] {
		//Every folder is "inside" the root file system, that tells nothing
		return false
	}
	path := drivePath(drive.Path)
	return path == mountpoint || strings.HasPrefix(path, mountpoint+"/")
}

// driveUsing returns the id of the ArozOS drive on this partition, if any
func driveUsing(p Partition, used []UsedDrive) string {
	for _, drive := range used {
		switch {
		case drive.Mountdev != "" && drive.Mountdev == p.Path:
			return drive.ID
		case drive.DiskUUID != "" && strings.EqualFold(drive.DiskUUID, p.UUID):
			return drive.ID
		case drivesUsingPath(p.Mountpoint, drive):
			return drive.ID
		}
	}
	return ""
}

// diskUse is why a disk may not be formatted: a system partition wins over
// any other use, so the root disk always says "system"
func diskUse(parts []Partition) string {
	reason := ""
	for _, p := range parts {
		if p.InUse == UseSystem {
			return UseSystem
		}
		if reason == "" {
			reason = p.InUse
		}
	}
	return reason
}

// FindPartition returns the partition with this device path (e.g. /dev/sdb1)
func FindPartition(disks []Disk, device string) (*Disk, *Partition, error) {
	for i := range disks {
		for j := range disks[i].Partitions {
			if disks[i].Partitions[j].Path == device {
				return &disks[i], &disks[i].Partitions[j], nil
			}
		}
	}
	return nil, nil, errors.New("Disk not found: " + device)
}

// labelChars are the characters a volume label may hold in the wizard
var labelChars = regexp.MustCompile(`[^A-Za-z0-9 _-]`)

// CleanLabel makes a volume label safe for the given file system
func CleanLabel(fstype string, label string) string {
	label = strings.TrimSpace(labelChars.ReplaceAllString(label, ""))
	limit := 16
	switch fstype {
	case "vfat":
		limit = 11
		label = strings.ToUpper(label)
	case "ntfs":
		limit = 32
	}
	if len(label) > limit {
		label = strings.TrimSpace(label[:limit])
	}
	return label
}

// FormatCommand returns the program and arguments that create the file
// system. The device is always the last argument and never passes a shell.
func FormatCommand(fstype string, label string, device string) (string, []string, error) {
	if !strings.HasPrefix(device, "/dev/") || strings.ContainsAny(device[5:], "/ ") || len(device) <= 5 {
		return "", nil, errors.New("Invalid device: " + device)
	}
	label = CleanLabel(fstype, label)
	switch fstype {
	case "ext4":
		args := []string{"-F"}
		if label != "" {
			args = append(args, "-L", label)
		}
		return "mkfs.ext4", append(args, device), nil
	case "ntfs":
		//Quick format: a full one writes zeros over the whole disk
		args := []string{"-f"}
		if label != "" {
			args = append(args, "-L", label)
		}
		return "mkfs.ntfs", append(args, device), nil
	case "vfat":
		args := []string{}
		if label != "" {
			args = append(args, "-n", label)
		}
		return "mkfs.vfat", append(args, device), nil
	}
	return "", nil, errors.New("File system not supported: " + fstype)
}

// CheckFormat makes sure a device on a fresh listing may be formatted
func CheckFormat(disks []Disk, device string) (*Partition, error) {
	disk, part, err := FindPartition(disks, device)
	if err != nil {
		return nil, err
	}
	if disk.InUse != "" || !part.CanFormat {
		reason := disk.InUse
		if reason == "" {
			reason = part.InUse
		}
		return nil, errors.New("This disk is in use (" + reason + ") and cannot be formatted")
	}
	return part, nil
}

// driveIDFormat matches the drive ids the storage pools accept
var driveIDFormat = regexp.MustCompile(`^[A-Za-z0-9_-]{1,64}$`)

// ValidDriveID reports whether a drive id is safe to use as a folder name
func ValidDriveID(id string) bool {
	return driveIDFormat.MatchString(id)
}

func str(s *string) string {
	if s == nil {
		return ""
	}
	return strings.TrimSpace(*s)
}

// looseInt reads a JSON number that may also be written as a string
func looseInt(raw json.RawMessage) int64 {
	var n int64
	if json.Unmarshal(raw, &n) == nil {
		return n
	}
	var s string
	if json.Unmarshal(raw, &s) == nil {
		fmt.Sscan(s, &n)
	}
	return n
}

// looseBool reads true, 1 or "1"
func looseBool(raw json.RawMessage) bool {
	var b bool
	if json.Unmarshal(raw, &b) == nil {
		return b
	}
	return looseInt(raw) == 1
}
