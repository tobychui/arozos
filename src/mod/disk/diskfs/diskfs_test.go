package diskfs

import (
	"runtime"
	"strings"
	"testing"
)

// TestDeviceIsMountedRootLinux verifies that "/" is not treated as a /dev/
// device path and therefore is not found in /proc/mounts as a device entry.
// On Linux, "/" is a mount *point*, not a device name like /dev/sda1.
func TestDeviceIsMountedRootLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("DeviceIsMounted reads /proc/mounts which is Linux-only")
	}
	// "/" is a mount point, not a device path — DeviceIsMounted looks for a
	// device path in column 0 of /proc/mounts, so "/" should return false.
	mounted, err := DeviceIsMounted("/")
	if err != nil {
		t.Fatalf("DeviceIsMounted('/') returned unexpected error: %v", err)
	}
	// "/" is not a device node, so it must not be reported as mounted.
	if mounted {
		t.Error("DeviceIsMounted('/') should be false — '/' is a mount point, not a device")
	}
}

// TestDeviceIsMountedNonExistentDevice verifies that a bogus device path
// returns (false, nil) — i.e. not mounted, no error.
func TestDeviceIsMountedNonExistentDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("DeviceIsMounted reads /proc/mounts which is Linux-only")
	}
	mounted, err := DeviceIsMounted("/dev/nonexistent_xyz_device")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mounted {
		t.Error("expected non-existent device to not be mounted")
	}
}

// TestDeviceIsMountedEmptyPath verifies that an empty path does not panic and
// returns (false, nil).
func TestDeviceIsMountedEmptyPath(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("DeviceIsMounted reads /proc/mounts which is Linux-only")
	}
	mounted, err := DeviceIsMounted("")
	if err != nil {
		t.Fatalf("unexpected error for empty path: %v", err)
	}
	if mounted {
		t.Error("expected empty path to not be reported as mounted")
	}
}

// TestListAllStorageDevicesLinux verifies that ListAllStorageDevices returns
// a non-nil result on Linux (it needs sudo lsblk; skip if lsblk is absent).
func TestListAllStorageDevicesLinux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("ListAllStorageDevices is Linux-only (uses lsblk)")
	}
	devices, err := ListAllStorageDevices()
	if err != nil {
		// lsblk may not be available in all CI environments; treat as a skip
		t.Skipf("ListAllStorageDevices returned error (lsblk may be absent): %v", err)
	}
	if devices == nil {
		t.Fatal("expected non-nil StorageDevicesMeta")
	}
}

// TestFormatPackageInstalledKnownAbsent verifies FormatPackageInstalled returns
// false for a filesystem type that is certainly not installed.
func TestFormatPackageInstalledKnownAbsent(t *testing.T) {
	// "zzzunknown" is guaranteed to not have mkfs.zzzunknown under /sbin
	if FormatPackageInstalled("zzzunknown") {
		t.Error("expected FormatPackageInstalled to return false for unknown fs type")
	}
}

// TestGetBlockDeviceMetaInvalidPath verifies that an empty device path returns
// an error.
func TestGetBlockDeviceMetaInvalidPath(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("GetBlockDeviceMeta requires lsblk (Linux-only)")
	}
	_, err := GetBlockDeviceMeta("/dev/")
	if err == nil {
		t.Error("expected error for empty device name, got nil")
	}
}

// TestGetBlockDeviceMetaPartitionPath verifies that a partition path (e.g.
// /dev/sda1) is rejected because it contains a digit.
func TestGetBlockDeviceMetaPartitionPath(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("GetBlockDeviceMeta requires lsblk (Linux-only)")
	}
	_, err := GetBlockDeviceMeta("/dev/sda1")
	if err == nil {
		t.Error("expected error for partition path passed to GetBlockDeviceMeta, got nil")
	}
}

// TestGetPartitionMetaBlockDevicePath verifies that a block device path (no
// digit suffix) is rejected by GetPartitionMeta.
func TestGetPartitionMetaBlockDevicePath(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("GetPartitionMeta requires lsblk (Linux-only)")
	}
	_, err := GetPartitionMeta("/dev/sda")
	if err == nil {
		t.Error("expected error for block device path passed to GetPartitionMeta, got nil")
	}
}

// TestGetPartitionMetaEmptyPath verifies an empty partition path returns an error.
func TestGetPartitionMetaEmptyPath(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("GetPartitionMeta requires lsblk (Linux-only)")
	}
	_, err := GetPartitionMeta("/dev/")
	if err == nil {
		t.Error("expected error for empty partition path, got nil")
	}
}

// TestFormatStorageDeviceUnsupported verifies that an unsupported filesystem
// type returns an error containing "unsupported".
func TestFormatStorageDeviceUnsupported(t *testing.T) {
	err := FormatStorageDevice("reiserfs", "/dev/null")
	if err == nil {
		t.Fatal("expected error for unsupported filesystem type, got nil")
	}
	if !strings.Contains(err.Error(), "unsupported") {
		t.Errorf("expected 'unsupported' in error message, got: %v", err)
	}
}

// TestBlockDeviceMetaStruct verifies the struct can be instantiated.
func TestBlockDeviceMetaStruct(t *testing.T) {
	bm := BlockDeviceMeta{
		Name: "sda",
		Size: 1000000000,
		Type: "disk",
	}
	if bm.Name != "sda" {
		t.Errorf("expected Name=sda, got %q", bm.Name)
	}
}

// TestPartitionMetaStruct verifies the struct can be instantiated.
func TestPartitionMetaStruct(t *testing.T) {
	pm := PartitionMeta{
		Name:       "sda1",
		Mountpoint: "/mnt/data",
	}
	if pm.Mountpoint != "/mnt/data" {
		t.Errorf("expected Mountpoint=/mnt/data, got %q", pm.Mountpoint)
	}
}

// TestStorageDevicesMetaStruct verifies the collection struct can be
// instantiated.
func TestStorageDevicesMetaStruct(t *testing.T) {
	sm := StorageDevicesMeta{}
	sm.Blockdevices = append(sm.Blockdevices, BlockDeviceMeta{Name: "sda"})
	if len(sm.Blockdevices) != 1 {
		t.Errorf("expected 1 block device, got %d", len(sm.Blockdevices))
	}
}

// TestFindDiskInfoNotFound verifies findDiskInfo returns an error when the
// disk name is not present.
func TestFindDiskInfoNotFound(t *testing.T) {
	devices := []BlockDeviceModelInfo{
		{Name: "sda", Size: "500G", Model: "Some Disk"},
	}
	_, _, err := findDiskInfo(devices, "sdb")
	if err == nil {
		t.Error("expected error for missing disk name, got nil")
	}
	if !strings.Contains(err.Error(), "sdb") {
		t.Errorf("expected error message to mention 'sdb', got: %v", err)
	}
}

// TestFindDiskInfoFound verifies findDiskInfo returns the correct size and
// model when the disk is present.
func TestFindDiskInfoFound(t *testing.T) {
	devices := []BlockDeviceModelInfo{
		{Name: "sda", Size: "500G", Model: "WD Blue"},
	}
	size, model, err := findDiskInfo(devices, "sda")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if size != "500G" {
		t.Errorf("expected size=500G, got %q", size)
	}
	if model != "WD Blue" {
		t.Errorf("expected model=WD Blue, got %q", model)
	}
}

// TestFindDiskInfoChildSearch verifies findDiskInfo recurses into Children.
func TestFindDiskInfoChildSearch(t *testing.T) {
	devices := []BlockDeviceModelInfo{
		{
			Name:  "sda",
			Size:  "500G",
			Model: "WD Blue",
			Children: []BlockDeviceModelInfo{
				{Name: "sda1", Size: "499G", Model: ""},
			},
		},
	}
	size, _, err := findDiskInfo(devices, "sda1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if size != "499G" {
		t.Errorf("expected size=499G for child partition, got %q", size)
	}
}
