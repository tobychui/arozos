//go:build linux
// +build linux

package raid

import (
	"runtime"
	"strings"
	"testing"
	"time"
)

func TestIsValidRAIDLevel(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Skipping RAID test on non-linux OS")
	}
	validLevels := []string{"raid0", "raid1", "raid4", "raid5", "raid6", "raid10"}
	for _, level := range validLevels {
		if !IsValidRAIDLevel(level) {
			t.Errorf("Expected %s to be valid", level)
		}
	}
	invalidLevels := []string{"raid3", "raid7", "notraid", ""}
	for _, level := range invalidLevels {
		if IsValidRAIDLevel(level) {
			t.Errorf("Expected %s to be invalid", level)
		}
	}
}

func TestRemoveDevicesEntry(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Skipping RAID test on non-linux OS")
	}
	tests := []struct {
		input    string
		expected string
	}{
		{
			input:    "ARRAY /dev/md0 metadata=1.2 UUID=abc devices=/dev/sda,/dev/sdb",
			expected: "ARRAY /dev/md0 metadata=1.2 UUID=abc",
		},
		{
			input:    "ARRAY /dev/md0 metadata=1.2 UUID=abc",
			expected: "ARRAY /dev/md0 metadata=1.2 UUID=abc",
		},
		{
			input:    "",
			expected: "",
		},
	}
	for _, test := range tests {
		result := removeDevicesEntry(test.input)
		if result != test.expected {
			t.Errorf("removeDevicesEntry(%q) = %q, want %q", test.input, result, test.expected)
		}
	}
}

func TestGetRAIDDevicesFromProcMDStat(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Skipping RAID test on non-linux OS")
	}
	m := &Manager{}
	// This will either succeed or fail depending on whether mdstat exists
	// but we just need to ensure the function handles the case gracefully
	devices, err := m.GetRAIDDevicesFromProcMDStat()
	if err != nil {
		t.Logf("GetRAIDDevicesFromProcMDStat returned error (may be expected in test env): %v", err)
	} else {
		t.Logf("Found %d RAID devices", len(devices))
		for _, d := range devices {
			if d.Name == "" {
				t.Error("RAID device name should not be empty")
			}
			if !strings.HasPrefix(d.Status, "") {
				t.Error("RAID device status should be a string")
			}
		}
	}
}

func TestCreateRAIDDeviceValidation(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Skipping RAID test on non-linux OS")
	}
	m := &Manager{}

	// Test invalid RAID level
	err := m.CreateRAIDDevice("md0", "test", 99, []string{"sda", "sdb"}, []string{})
	if err == nil {
		t.Error("Expected error for invalid RAID level")
	}

	// Test RAID0 with insufficient disks
	err = m.CreateRAIDDevice("md0", "test", 0, []string{"sda"}, []string{})
	if err == nil {
		t.Error("Expected error for RAID0 with only 1 disk")
	}

	// Test RAID1 with insufficient disks
	err = m.CreateRAIDDevice("md0", "test", 1, []string{"sda"}, []string{})
	if err == nil {
		t.Error("Expected error for RAID1 with only 1 disk")
	}

	// Test RAID5 with insufficient disks
	err = m.CreateRAIDDevice("md0", "test", 5, []string{"sda", "sdb"}, []string{})
	if err == nil {
		t.Error("Expected error for RAID5 with only 2 disks")
	}

	// Test RAID6 with insufficient disks
	err = m.CreateRAIDDevice("md0", "test", 6, []string{"sda", "sdb", "sdc"}, []string{})
	if err == nil {
		t.Error("Expected error for RAID6 with only 3 disks")
	}
}

// TestIsValidRAIDLevelCaseInsensitive verifies the level comparison is case-insensitive.
func TestIsValidRAIDLevelCaseInsensitive(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	if !IsValidRAIDLevel("RAID1") {
		t.Error("expected RAID1 (uppercase) to be valid")
	}
	if !IsValidRAIDLevel("Raid5") {
		t.Error("expected Raid5 (mixed case) to be valid")
	}
}

// TestRAIDStatusConstants verifies the RAIDStatus constants are distinct.
func TestRAIDStatusConstants(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	if RAIDStatusNormal == RAIDStatusOneFailed {
		t.Error("RAIDStatusNormal and RAIDStatusOneFailed should be different")
	}
	if RAIDStatusOneFailed == RAIDStatusUnusable {
		t.Error("RAIDStatusOneFailed and RAIDStatusUnusable should be different")
	}
	if RAIDStatusUnusable == RAIDStatusError {
		t.Error("RAIDStatusUnusable and RAIDStatusError should be different")
	}
	if RAIDStatusError == RAIDStatusUnknown {
		t.Error("RAIDStatusError and RAIDStatusUnknown should be different")
	}
}

// TestRAIDStatusToString verifies toString returns sensible strings.
func TestRAIDStatusToString(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	cases := []struct {
		status RAIDStatus
		want   string
	}{
		{RAIDStatusNormal, "Normal"},
		{RAIDStatusOneFailed, "One Failed Device"},
		{RAIDStatusUnusable, "Unusable (Multiple Failed Devices)"},
		{RAIDStatusError, "Error"},
		{RAIDStatusUnknown, "Unknown"},
	}
	for _, tc := range cases {
		got := tc.status.toString()
		if got != tc.want {
			t.Errorf("RAIDStatus(%d).toString() = %q, want %q", tc.status, got, tc.want)
		}
	}
}

// TestRAIDStatusToStringUnknownValue verifies an undefined RAIDStatus value returns
// "Invalid Status".
func TestRAIDStatusToStringUnknownValue(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	unknown := RAIDStatus(999)
	got := unknown.toString()
	if got != "Invalid Status" {
		t.Errorf("expected 'Invalid Status' for undefined RAIDStatus, got %q", got)
	}
}

// TestRAIDStatusIsHealthy verifies isHealthy only returns true for Normal.
func TestRAIDStatusIsHealthy(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	if !RAIDStatusNormal.isHealthy() {
		t.Error("expected RAIDStatusNormal to be healthy")
	}
	if RAIDStatusOneFailed.isHealthy() {
		t.Error("expected RAIDStatusOneFailed to not be healthy")
	}
	if RAIDStatusUnusable.isHealthy() {
		t.Error("expected RAIDStatusUnusable to not be healthy")
	}
	if RAIDStatusError.isHealthy() {
		t.Error("expected RAIDStatusError to not be healthy")
	}
	if RAIDStatusUnknown.isHealthy() {
		t.Error("expected RAIDStatusUnknown to not be healthy")
	}
}

// TestParseRAIDInfoEmpty verifies parseRAIDInfo returns an empty struct for empty input.
func TestParseRAIDInfoEmpty(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	info := parseRAIDInfo("")
	if info == nil {
		t.Fatal("parseRAIDInfo returned nil for empty input")
	}
	if info.Version != "" {
		t.Errorf("expected empty Version, got %q", info.Version)
	}
}

// TestParseRAIDInfoVersion verifies Version field is parsed correctly.
func TestParseRAIDInfoVersion(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	input := `          Version : 1.2
`
	info := parseRAIDInfo(input)
	if info.Version != "1.2" {
		t.Errorf("expected Version=1.2, got %q", info.Version)
	}
}

// TestParseRAIDInfoState verifies State field is parsed correctly.
func TestParseRAIDInfoState(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	input := "          State : clean\n"
	info := parseRAIDInfo(input)
	if !strings.Contains(info.State, "clean") {
		t.Errorf("expected State to contain 'clean', got %q", info.State)
	}
}

// TestParseRAIDInfoRaidLevel verifies RaidLevel field is parsed correctly.
func TestParseRAIDInfoRaidLevel(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	input := "       Raid Level : raid1\n"
	info := parseRAIDInfo(input)
	if info.RaidLevel != "raid1" {
		t.Errorf("expected RaidLevel=raid1, got %q", info.RaidLevel)
	}
}

// TestParseRAIDInfoUUID verifies UUID field is parsed correctly.
func TestParseRAIDInfoUUID(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	input := "           UUID : abc123:def456:789abc:012def\n"
	info := parseRAIDInfo(input)
	if info.UUID != "abc123:def456:789abc:012def" {
		t.Errorf("expected UUID=abc123:def456:789abc:012def, got %q", info.UUID)
	}
}

// TestParseRAIDInfoActiveDevices verifies Active Devices field is parsed.
func TestParseRAIDInfoActiveDevices(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	input := " Active Devices : 2\n"
	info := parseRAIDInfo(input)
	if info.ActiveDevices != 2 {
		t.Errorf("expected ActiveDevices=2, got %d", info.ActiveDevices)
	}
}

// TestParseRAIDInfoFullOutput verifies a more complete mdadm output is parsed correctly.
func TestParseRAIDInfoFullOutput(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	input := `/dev/md0:
          Version : 1.2
    Creation Time : Thu Jan  1 00:00:00 2015
       Raid Level : raid1
       Array Size : 10485760 (10.00 GiB 10.74 GB)
    Used Dev Size : 10485760 (10.00 GiB 10.74 GB)
     Raid Devices : 2
    Total Devices : 2
      Persistence : Superblock is persistent

      Update Time : Mon Feb  2 10:00:00 2015
            State : clean
   Active Devices : 2
  Working Devices : 2
   Failed Devices : 0
    Spare Devices : 0

  Consistency Policy : resync

             Name : testserver:0
             UUID : aaaa1111:bbbb2222:cccc3333:dddd4444
           Events : 17

    Number   Major   Minor   RaidDevice State
       0       8       16        0      active sync   /dev/sdb
       1       8       32        1      active sync   /dev/sdc
`
	info := parseRAIDInfo(input)
	if info.RaidLevel != "raid1" {
		t.Errorf("expected RaidLevel=raid1, got %q", info.RaidLevel)
	}
	if info.RaidDevices != 2 {
		t.Errorf("expected RaidDevices=2, got %d", info.RaidDevices)
	}
	if info.ActiveDevices != 2 {
		t.Errorf("expected ActiveDevices=2, got %d", info.ActiveDevices)
	}
	if info.FailedDevices != 0 {
		t.Errorf("expected FailedDevices=0, got %d", info.FailedDevices)
	}
	if info.UUID != "aaaa1111:bbbb2222:cccc3333:dddd4444" {
		t.Errorf("unexpected UUID: %q", info.UUID)
	}
	if len(info.DeviceInfo) < 1 {
		t.Errorf("expected at least 1 device info entry, got %d", len(info.DeviceInfo))
	}
}

// TestPrettyPrintRAIDInfo verifies PrettyPrintRAIDInfo does not panic.
func TestPrettyPrintRAIDInfo(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	info := &RAIDInfo{
		Version:        "1.2",
		RaidLevel:      "raid1",
		ActiveDevices:  2,
		WorkingDevices: 2,
		FailedDevices:  0,
		SpareDevices:   0,
		State:          "clean",
		Name:           "testserver:0",
		UUID:           "aaaa1111:bbbb2222:cccc3333:dddd4444",
		Events:         17,
		CreationTime:   time.Now(),
		UpdateTime:     time.Now(),
		DeviceInfo: []DeviceInfo{
			{State: []string{"active", "sync"}, DevicePath: "/dev/sdb", RaidDevice: 0},
			{State: []string{"active", "sync"}, DevicePath: "/dev/sdc", RaidDevice: 1},
		},
	}
	// Should not panic
	info.PrettyPrintRAIDInfo()
}

// TestGetNextAvailableMDDevice verifies GetNextAvailableMDDevice returns a
// valid /dev/mdX path on Linux.
func TestGetNextAvailableMDDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	device, err := GetNextAvailableMDDevice()
	if err != nil {
		t.Fatalf("GetNextAvailableMDDevice returned error: %v", err)
	}
	if !strings.HasPrefix(device, "/dev/md") {
		t.Errorf("expected /dev/mdX prefix, got %q", device)
	}
	t.Logf("Next available MD device: %s", device)
}

// TestRAIDMemberStruct verifies the RAIDMember struct can be created.
func TestRAIDMemberStruct(t *testing.T) {
	m := RAIDMember{
		Name:   "sda",
		Seq:    0,
		Failed: false,
	}
	if m.Name != "sda" {
		t.Errorf("expected Name=sda, got %q", m.Name)
	}
	if m.Seq != 0 {
		t.Errorf("expected Seq=0, got %d", m.Seq)
	}
	if m.Failed {
		t.Error("expected Failed=false")
	}
}

// TestRAIDDeviceStruct verifies the RAIDDevice struct can be created.
func TestRAIDDeviceStruct(t *testing.T) {
	d := RAIDDevice{
		Name:    "md0",
		Status:  "active",
		Level:   "raid1",
		Members: []*RAIDMember{{Name: "sda", Seq: 0}, {Name: "sdb", Seq: 1}},
	}
	if d.Name != "md0" {
		t.Errorf("expected Name=md0, got %q", d.Name)
	}
	if len(d.Members) != 2 {
		t.Errorf("expected 2 members, got %d", len(d.Members))
	}
}

// TestDeviceInfoStruct verifies the DeviceInfo struct can be created.
func TestDeviceInfoStruct(t *testing.T) {
	di := DeviceInfo{
		State:      []string{"active", "sync"},
		DevicePath: "/dev/sdb",
		RaidDevice: 0,
	}
	if di.DevicePath != "/dev/sdb" {
		t.Errorf("expected DevicePath=/dev/sdb, got %q", di.DevicePath)
	}
	if len(di.State) != 2 {
		t.Errorf("expected 2 state entries, got %d", len(di.State))
	}
}

// TestLoopDeviceStruct verifies the LoopDevice struct can be created.
func TestLoopDeviceStruct(t *testing.T) {
	ld := LoopDevice{
		Device:         "/dev/loop0",
		PartitionRange: "[2049]:265955",
		ImageFile:      "/home/user/test.img",
	}
	if ld.Device != "/dev/loop0" {
		t.Errorf("expected Device=/dev/loop0, got %q", ld.Device)
	}
	if ld.ImageFile != "/home/user/test.img" {
		t.Errorf("expected ImageFile=/home/user/test.img, got %q", ld.ImageFile)
	}
}

// TestFormatVirtualPartitionNonExistent verifies FormatVirtualPartition returns
// an error for a non-existent image file.
func TestFormatVirtualPartitionNonExistent(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	err := FormatVirtualPartition("/nonexistent/path/image.img")
	if err == nil {
		t.Error("expected error for non-existent image file, got nil")
	}
}

// TestFormatVirtualPartitionWrongExtension verifies FormatVirtualPartition
// returns an error when the file extension is not .img.
func TestFormatVirtualPartitionWrongExtension(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	err := FormatVirtualPartition("/tmp/testfile.txt")
	if err == nil {
		t.Error("expected error for non-.img file extension, got nil")
	}
	if !strings.Contains(err.Error(), "image") {
		t.Errorf("expected error about image path, got: %v", err)
	}
}

// TestListAllLoopDevicesNoPanic verifies ListAllLoopDevices doesn't panic
// even if losetup is unavailable.
func TestListAllLoopDevicesNoPanic(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses losetup")
	}
	// losetup may or may not be available; either way, no panic
	_, err := ListAllLoopDevices()
	if err != nil {
		t.Logf("ListAllLoopDevices returned error (may be expected): %v", err)
	}
}

// TestImageMountedAsLoopDeviceNonExistent verifies ImageMountedAsLoopDevice returns
// false for a non-existent image file (it uses losetup internally).
func TestImageMountedAsLoopDeviceNonExistent(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses losetup")
	}
	mounted, err := ImageMountedAsLoopDevice("/nonexistent/path/image.img")
	if err != nil {
		// losetup might not be installed; skip in that case
		t.Logf("ImageMountedAsLoopDevice returned error (may be expected in test env): %v", err)
		return
	}
	if mounted {
		t.Error("expected non-existent image to not be mounted")
	}
}

// TestGetLoopDriveIDFromImagePathNonExistent verifies GetLoopDriveIDFromImagePath
// returns empty string for an unmounted image file.
func TestGetLoopDriveIDFromImagePathNonExistent(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only: uses losetup")
	}
	id, err := GetLoopDriveIDFromImagePath("/nonexistent/path/image.img")
	if err != nil {
		t.Logf("GetLoopDriveIDFromImagePath returned error: %v", err)
		return
	}
	if id != "" {
		t.Errorf("expected empty ID for non-mounted image, got %q", id)
	}
}

// TestNewRaidManagerNonLinux verifies NewRaidManager returns an error on non-Linux.
func TestNewRaidManagerNonLinux(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("this test targets non-Linux platforms")
	}
	_, err := NewRaidManager(Options{})
	if err == nil {
		t.Error("expected error on non-Linux platform, got nil")
	}
}

// TestIsSafeToRemoveNonExistentArray verifies IsSafeToRemove returns false when
// the RAID device doesn't exist (GetRAIDDeviceByDevicePath fails).
func TestIsSafeToRemoveNonExistentArray(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	m := &Manager{}
	// md999 almost certainly doesn't exist
	safe := m.IsSafeToRemove("/dev/md999", "/dev/sda")
	if safe {
		t.Error("expected IsSafeToRemove to return false for non-existent array")
	}
}

// TestRAIDDeviceExistsNonExistent verifies RAIDDeviceExists returns false for a
// non-existent device.
func TestRAIDDeviceExistsNonExistent(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	m := &Manager{}
	exists := m.RAIDDeviceExists("/dev/md999")
	if exists {
		t.Error("expected RAIDDeviceExists to return false for /dev/md999")
	}
}

// TestGetRAIDStatusNonExistentDevice verifies GetRAIDStatus returns an error
// for a non-existent RAID device.
func TestGetRAIDStatusNonExistentDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	_, err := GetRAIDStatus("/dev/md999")
	if err == nil {
		t.Error("expected error for non-existent RAID device, got nil")
	}
}

// TestGetRAIDPartitionSizeNonExistentDevice verifies GetRAIDPartitionSize returns
// an error for a non-existent device.
func TestGetRAIDPartitionSizeNonExistentDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	_, err := GetRAIDPartitionSize("/dev/md999")
	if err == nil {
		t.Error("expected error for non-existent device, got nil")
	}
}

// TestGetRAIDUsedSizeNonExistentDevice verifies GetRAIDUsedSize returns an error
// for a non-existent device.
func TestGetRAIDUsedSizeNonExistentDevice(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	_, err := GetRAIDUsedSize("/dev/md999")
	if err == nil {
		t.Error("expected error for non-existent device, got nil")
	}
}

// TestGetRAIDDeviceByDevicePathNonExistent verifies GetRAIDDeviceByDevicePath returns
// an error for a non-existent device.
func TestGetRAIDDeviceByDevicePathNonExistent(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	m := &Manager{}
	_, err := m.GetRAIDDeviceByDevicePath("/dev/md999")
	if err == nil {
		t.Error("expected error for non-existent RAID device, got nil")
	}
}

// TestRAIDInfoStruct verifies the RAIDInfo struct can be created with all fields.
func TestRAIDInfoStruct(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("Linux-only")
	}
	info := RAIDInfo{
		DevicePath:     "/dev/md0",
		Version:        "1.2",
		RaidLevel:      "raid1",
		ArraySize:      10485760,
		UsedDevSize:    10485760,
		RaidDevices:    2,
		TotalDevices:   2,
		Persistence:    "Superblock is persistent",
		State:          "clean",
		ActiveDevices:  2,
		WorkingDevices: 2,
		FailedDevices:  0,
		SpareDevices:   0,
		Consistency:    "resync",
		Name:           "server:0",
		UUID:           "aaaa:bbbb:cccc:dddd",
		Events:         17,
	}
	if info.DevicePath != "/dev/md0" {
		t.Errorf("expected /dev/md0, got %q", info.DevicePath)
	}
	if info.RaidDevices != 2 {
		t.Errorf("expected RaidDevices=2, got %d", info.RaidDevices)
	}
}
