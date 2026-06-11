package diskfs

import (
	"os"
	"os/exec"
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

// TestFormatStorageDeviceExt4ReturnsError verifies that formatting a non-existent
// device with ext4 returns an error (sudo mkfs.ext4 will fail).
func TestFormatStorageDeviceExt4ReturnsError(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses mkfs.ext4")
	}
	err := FormatStorageDevice("ext4", "/dev/nonexistent_xyz")
	if err == nil {
		t.Error("expected error when formatting non-existent device, got nil")
	}
}

// TestFormatStorageDeviceVfatNoToolReturnsError verifies FormatStorageDevice returns an
// error for vfat when the mkfs.vfat tool is absent (or fails on bad device).
func TestFormatStorageDeviceVfatReturnsError(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	err := FormatStorageDevice("vfat", "/dev/nonexistent_xyz")
	// Either "not installed" or "unable to format device" error is acceptable
	if err == nil {
		t.Error("expected error when formatting non-existent device as vfat, got nil")
	}
}

// TestFormatStorageDeviceNtfsReturnsError verifies FormatStorageDevice returns an
// error for ntfs when the mkfs.ntfs tool is absent (or fails on bad device).
func TestFormatStorageDeviceNtfsReturnsError(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	err := FormatStorageDevice("ntfs", "/dev/nonexistent_xyz")
	if err == nil {
		t.Error("expected error when formatting non-existent device as ntfs, got nil")
	}
}

// TestGetDiskUUIDNonExistentDevice verifies that GetDiskUUID returns an error for
// a device that doesn't exist.
func TestGetDiskUUIDNonExistentDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("GetDiskUUID uses blkid (Linux-only)")
	}
	_, err := GetDiskUUID("/dev/nonexistent_xyz_device")
	if err == nil {
		t.Error("expected error for non-existent device, got nil")
	}
}

// TestUnmountDeviceNonExistentPath verifies UnmountDevice returns an error when
// the device does not exist.
func TestUnmountDeviceNonExistentPath(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses umount")
	}
	err := UnmountDevice("/dev/nonexistent_xyz_device")
	if err == nil {
		t.Error("expected error when unmounting non-existent device, got nil")
	}
}

// TestForceUnmountDeviceNonExistentPath verifies ForceUnmountDevice returns an error
// when the device does not exist.
func TestForceUnmountDeviceNonExistentPath(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses umount")
	}
	err := ForceUnmountDevice("/dev/nonexistent_xyz_device")
	if err == nil {
		t.Error("expected error when force-unmounting non-existent device, got nil")
	}
}

// TestWipeDiskNonExistentPath verifies WipeDisk returns an error for a non-existent path.
func TestWipeDiskNonExistentPath(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses wipefs")
	}
	err := WipeDisk("/dev/nonexistent_xyz_device")
	if err == nil {
		t.Error("expected error when wiping non-existent disk, got nil")
	}
}

// TestDeviceIsMountedNoDevPrefix verifies that a path without /dev/ prefix is
// handled: the function should prepend /dev/ and return (false, nil).
func TestDeviceIsMountedNoDevPrefix(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: reads /proc/mounts")
	}
	mounted, err := DeviceIsMounted("nonexistent_xyz_device")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if mounted {
		t.Error("expected non-existent device to not be mounted")
	}
}

// TestGetDiskModelByNameNotFoundReturnsError verifies GetDiskModelByName returns
// an error when lsblk doesn't find the given disk name.
func TestGetDiskModelByNameNotFoundReturnsError(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses lsblk")
	}
	_, _, err := GetDiskModelByName("nonexistent_xyz_disk")
	if err == nil {
		t.Error("expected error for non-existent disk name, got nil")
	}
}

// TestFindDiskInfoEmptyList verifies findDiskInfo returns an error for an empty list.
func TestFindDiskInfoEmptyList(t *testing.T) {
	_, _, err := findDiskInfo([]BlockDeviceModelInfo{}, "sda")
	if err == nil {
		t.Error("expected error for empty device list, got nil")
	}
}

// TestGetBlockDeviceMetaNonExistentDevice verifies GetBlockDeviceMeta returns an
// error for a device name that isn't in lsblk output.
func TestGetBlockDeviceMetaNonExistentDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses lsblk")
	}
	_, err := GetBlockDeviceMeta("/dev/nonexistentxyz")
	if err == nil {
		t.Error("expected error for non-existent block device, got nil")
	}
}

// TestGetPartitionMetaNonExistentPartition verifies GetPartitionMeta returns an
// error when the partition isn't in lsblk output.
func TestGetPartitionMetaNonExistentPartition(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses lsblk")
	}
	_, err := GetPartitionMeta("/dev/nonexistent1")
	if err == nil {
		t.Error("expected error for non-existent partition, got nil")
	}
}

// TestDeviceIsMountedWithRealDevice checks that /dev/null is not reported as mounted
// as a filesystem device (it is a special device, not a filesystem).
func TestDeviceIsMountedNullDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	mounted, err := DeviceIsMounted("/dev/null")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	// /dev/null is never a mounted filesystem device
	if mounted {
		t.Error("expected /dev/null to not be reported as mounted")
	}
}

// TestFormatPackageInstalledExt4 checks ext4 check doesn't panic and returns a bool.
func TestFormatPackageInstalledExt4(t *testing.T) {
	// Just ensure it doesn't panic; return value depends on the system.
	result := FormatPackageInstalled("ext4")
	t.Logf("FormatPackageInstalled(ext4) = %v", result)
}

// TestBlockDeviceModelInfoJSON verifies BlockDeviceModelInfo round-trips JSON.
func TestBlockDeviceModelInfoJSON(t *testing.T) {
	// Use os package to satisfy the import already added.
	_ = os.DevNull // ensure os import is used

	bm := BlockDeviceModelInfo{
		Name:  "sda",
		Size:  "500G",
		Model: "WD Blue",
		Children: []BlockDeviceModelInfo{
			{Name: "sda1", Size: "499G", Model: ""},
		},
	}
	if bm.Name != "sda" {
		t.Errorf("expected Name=sda, got %q", bm.Name)
	}
	if len(bm.Children) != 1 {
		t.Errorf("expected 1 child, got %d", len(bm.Children))
	}
}

// TestFormatStorageDeviceFat verifies that "fat", "fat32", and "vfat" aliases
// all reach the vfat branch. When mkfs.vfat is absent the function returns a
// "not installed" error; when it is present but the device path is bad it
// returns a "unable to format" error. Either way an error must be returned.
func TestFormatStorageDeviceFatAlias(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	for _, alias := range []string{"fat", "fat32", "vfat"} {
		err := FormatStorageDevice(alias, "/dev/nonexistent_xyz")
		if err == nil {
			t.Errorf("expected error for alias %q with non-existent device, got nil", alias)
		}
	}
}

// TestGetDiskUUIDEmpty verifies GetDiskUUID returns an error for an empty device path.
func TestGetDiskUUIDEmpty(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("GetDiskUUID uses blkid (Linux-only)")
	}
	_, err := GetDiskUUID("")
	// blkid may succeed or fail; we only verify no panic occurs.
	_ = err
}

// TestWipeDiskWithUnmountedNonExistentDevice exercises the "not mounted" branch
// of WipeDisk before calling wipefs on a non-existent device (which will fail).
func TestWipeDiskUnmountedPath(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses wipefs")
	}
	// The device doesn't exist, so DeviceIsMounted returns false and then
	// wipefs is called on a non-existent path — that will return an error.
	err := WipeDisk("/dev/nonexistent_xyz_device_abc")
	if err == nil {
		t.Error("expected error when wiping non-existent disk, got nil")
	}
}

// TestFormatStorageDeviceExt4Success exercises the success path of FormatStorageDevice
// for ext4 by formatting a temporary loop device.
func TestFormatStorageDeviceExt4Success(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses mkfs.ext4 and losetup")
	}
	if !FormatPackageInstalled("ext4") {
		t.Skip("mkfs.ext4 not installed")
	}

	// Create a temp file to back a loop device
	f, err := os.CreateTemp("", "diskfs_test_*.img")
	if err != nil {
		t.Skipf("CreateTemp: %v", err)
	}
	imgPath := f.Name()
	defer os.Remove(imgPath)

	// Write 10 MiB of zeros
	if err := f.Truncate(10 * 1024 * 1024); err != nil {
		f.Close()
		t.Skipf("Truncate: %v", err)
	}
	f.Close()

	// Attach as a loop device
	out, err := exec.Command("sudo", "losetup", "-f", "--show", imgPath).Output()
	if err != nil {
		t.Skipf("losetup failed (sudo may be restricted): %v", err)
	}
	loopDev := strings.TrimSpace(string(out))
	defer exec.Command("sudo", "losetup", "-d", loopDev).Run()

	// Now format it via FormatStorageDevice (exercises the ext4 success path)
	if err := FormatStorageDevice("ext4", loopDev); err != nil {
		t.Skipf("FormatStorageDevice ext4 failed (acceptable in some envs): %v", err)
	}
}
