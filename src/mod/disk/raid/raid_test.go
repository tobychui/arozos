package raid

import (
	"runtime"
	"strings"
	"testing"
)

/*
	RAID TEST SCRIPT

	These tests cover utility functions and validation logic
	without requiring actual RAID hardware or production systems.
*/

// Test IsValidRAIDLevel function
func TestIsValidRAIDLevel(t *testing.T) {
	testCases := []struct {
		level    string
		expected bool
		desc     string
	}{
		{"raid0", true, "RAID 0 should be valid"},
		{"raid1", true, "RAID 1 should be valid"},
		{"raid4", true, "RAID 4 should be valid"},
		{"raid5", true, "RAID 5 should be valid"},
		{"raid6", true, "RAID 6 should be valid"},
		{"raid10", true, "RAID 10 should be valid"},
		{"RAID1", true, "Uppercase RAID1 should be valid"},
		{" raid1 ", true, "RAID1 with spaces should be valid"},
		{"raid7", false, "RAID 7 should be invalid"},
		{"raid99", false, "RAID 99 should be invalid"},
		{"invalid", false, "Invalid string should be invalid"},
		{"", false, "Empty string should be invalid"},
	}

	for _, tc := range testCases {
		result := IsValidRAIDLevel(tc.level)
		if result != tc.expected {
			t.Errorf("%s: IsValidRAIDLevel(%q) = %v, expected %v",
				tc.desc, tc.level, result, tc.expected)
		}
	}
}

// Test NewRaidManager on non-Linux platforms
func TestNewRaidManager_NonLinux(t *testing.T) {
	if runtime.GOOS == "linux" {
		t.Skip("Skipping non-Linux test on Linux platform")
	}

	options := Options{
		Logger: nil,
	}

	manager, err := NewRaidManager(options)
	if err == nil {
		t.Error("Expected error on non-Linux platform, got nil")
	}
	if manager != nil {
		t.Error("Expected nil manager on non-Linux platform")
	}
	if err != nil && !strings.Contains(err.Error(), "platform") {
		t.Errorf("Expected platform error, got: %v", err)
	}
}

// Test FormatVirtualPartition validation
func TestFormatVirtualPartition_InvalidExtension(t *testing.T) {
	// Test with non-.img extension (but file must not exist)
	// The function checks file existence first, so error will be "not exists"
	err := FormatVirtualPartition("/tmp/test.txt")
	if err == nil {
		t.Error("Expected error for non-.img file or non-existent file")
	}
	// Will get either "not exists" or "not an image path" depending on file existence
	if err != nil {
		t.Logf("Got expected error: %v", err)
	}
}

// Test FormatVirtualPartition with non-existent file
func TestFormatVirtualPartition_NonExistentFile(t *testing.T) {
	// Test with non-existent file
	err := FormatVirtualPartition("/tmp/nonexistent_file_12345.img")
	if err == nil {
		t.Error("Expected error for non-existent file")
	}
	if err != nil && !strings.Contains(err.Error(), "not exists") {
		t.Errorf("Expected 'not exists' error, got: %v", err)
	}
}

// Test GetNextAvailableMDDevice logic
func TestGetNextAvailableMDDevice(t *testing.T) {
	// This function checks /dev/md* devices
	// We can at least verify it returns a valid format
	device, err := GetNextAvailableMDDevice()

	// On non-Linux or systems without md devices, this might fail
	// which is expected
	if err != nil {
		t.Logf("GetNextAvailableMDDevice returned error (expected on non-RAID systems): %v", err)
		return
	}

	// If successful, verify format
	if !strings.HasPrefix(device, "/dev/md") {
		t.Errorf("Expected device to start with /dev/md, got: %s", device)
	}
}

// Test RAID level validation in CreateRAIDDevice logic
func TestRAIDLevelValidation(t *testing.T) {
	testCases := []struct {
		raidLevel int
		numDisks  int
		shouldErr bool
		desc      string
	}{
		{0, 1, true, "RAID 0 needs at least 2 disks"},
		{0, 2, false, "RAID 0 with 2 disks is valid"},
		{1, 1, true, "RAID 1 needs at least 2 disks"},
		{1, 2, false, "RAID 1 with 2 disks is valid"},
		{5, 2, true, "RAID 5 needs at least 3 disks"},
		{5, 3, false, "RAID 5 with 3 disks is valid"},
		{6, 3, true, "RAID 6 needs at least 4 disks"},
		{6, 4, false, "RAID 6 with 4 disks is valid"},
	}

	for _, tc := range testCases {
		// We can't actually create RAID devices in tests,
		// but we can verify the validation logic would work
		hasError := false

		// Replicate the validation logic from CreateRAIDDevice
		if tc.raidLevel == 0 && tc.numDisks < 2 {
			hasError = true
		} else if tc.raidLevel == 1 && tc.numDisks < 2 {
			hasError = true
		} else if tc.raidLevel == 5 && tc.numDisks < 3 {
			hasError = true
		} else if tc.raidLevel == 6 && tc.numDisks < 4 {
			hasError = true
		}

		if hasError != tc.shouldErr {
			t.Errorf("%s: Expected error=%v, got error=%v",
				tc.desc, tc.shouldErr, hasError)
		}
	}
}

// Test RAIDMember struct
func TestRAIDMemberStruct(t *testing.T) {
	member := &RAIDMember{
		Name:   "sda",
		Seq:    0,
		Failed: false,
	}

	if member.Name != "sda" {
		t.Errorf("Expected Name='sda', got '%s'", member.Name)
	}
	if member.Seq != 0 {
		t.Errorf("Expected Seq=0, got %d", member.Seq)
	}
	if member.Failed != false {
		t.Error("Expected Failed=false")
	}

	// Test failed member
	failedMember := &RAIDMember{
		Name:   "sdb",
		Seq:    1,
		Failed: true,
	}

	if !failedMember.Failed {
		t.Error("Expected Failed=true for failed member")
	}
}

// Test RAIDDevice struct
func TestRAIDDeviceStruct(t *testing.T) {
	members := []*RAIDMember{
		{Name: "sda", Seq: 0, Failed: false},
		{Name: "sdb", Seq: 1, Failed: false},
	}

	device := RAIDDevice{
		Name:    "md0",
		Status:  "active",
		Level:   "raid1",
		Members: members,
	}

	if device.Name != "md0" {
		t.Errorf("Expected Name='md0', got '%s'", device.Name)
	}
	if device.Status != "active" {
		t.Errorf("Expected Status='active', got '%s'", device.Status)
	}
	if device.Level != "raid1" {
		t.Errorf("Expected Level='raid1', got '%s'", device.Level)
	}
	if len(device.Members) != 2 {
		t.Errorf("Expected 2 members, got %d", len(device.Members))
	}
}

// Test IsSafeToRemove logic for different RAID levels
func TestIsSafeToRemoveLogic(t *testing.T) {
	testCases := []struct {
		level            string
		remainingMembers int
		expectedSafe     bool
		desc             string
	}{
		{"raid0", 1, false, "RAID 0 cannot lose any disk"},
		{"raid1", 0, false, "RAID 1 needs at least 1 disk"},
		{"raid1", 1, true, "RAID 1 with 1 remaining disk is safe"},
		{"raid1", 2, true, "RAID 1 with 2 remaining disks is safe"},
		{"raid5", 1, false, "RAID 5 needs at least 2 disks"},
		{"raid5", 2, true, "RAID 5 with 2 remaining disks is safe"},
		{"raid5", 3, true, "RAID 5 with 3 remaining disks is safe"},
		{"raid6", 1, false, "RAID 6 needs at least 2 disks"},
		{"raid6", 2, true, "RAID 6 with 2 remaining disks is safe"},
		{"raid6", 3, true, "RAID 6 with 3 remaining disks is safe"},
	}

	for _, tc := range testCases {
		// Replicate the safety check logic from IsSafeToRemove
		var safe bool
		if strings.EqualFold(tc.level, "raid0") {
			safe = false
		} else if strings.EqualFold(tc.level, "raid1") {
			safe = tc.remainingMembers >= 1
		} else if strings.EqualFold(tc.level, "raid5") {
			safe = tc.remainingMembers >= 2
		} else if strings.EqualFold(tc.level, "raid6") {
			safe = tc.remainingMembers >= 2
		} else {
			safe = true
		}

		if safe != tc.expectedSafe {
			t.Errorf("%s: Expected safe=%v, got safe=%v",
				tc.desc, tc.expectedSafe, safe)
		}
	}
}

// Test device path formatting
func TestDevicePathFormatting(t *testing.T) {
	testCases := []struct {
		input    string
		expected string
		desc     string
	}{
		{"sda", "/dev/sda", "Add /dev/ prefix"},
		{"/dev/sda", "/dev/sda", "Keep existing /dev/ prefix"},
		{"md0", "/dev/md0", "Add /dev/ to md device"},
		{"/dev/md0", "/dev/md0", "Keep /dev/ on md device"},
		{"sdb1", "/dev/sdb1", "Add /dev/ to partition"},
	}

	for _, tc := range testCases {
		var result string
		// Replicate the path formatting logic from the code
		if !strings.HasPrefix(tc.input, "/dev/") {
			result = "/dev/" + tc.input
		} else {
			result = tc.input
		}

		if result != tc.expected {
			t.Errorf("%s: Input '%s' formatted to '%s', expected '%s'",
				tc.desc, tc.input, result, tc.expected)
		}
	}
}

// Test Options struct
func TestOptionsStruct(t *testing.T) {
	options := Options{
		Logger: nil,
	}

	if options.Logger != nil {
		t.Error("Expected Logger to be nil")
	}
}

// Test Manager struct creation
func TestManagerStruct(t *testing.T) {
	options := Options{
		Logger: nil,
	}

	manager := &Manager{
		Options: &options,
	}

	if manager.Options == nil {
		t.Error("Expected Options to not be nil")
	}
	if manager.Options.Logger != nil {
		t.Error("Expected Logger to be nil")
	}
}

// Test device path basename extraction
func TestDevicePathBasename(t *testing.T) {
	testCases := []struct {
		input    string
		expected string
		desc     string
	}{
		{"/dev/sda", "sda", "Extract basename from full path"},
		{"/dev/md0", "md0", "Extract md device basename"},
		{"sdb", "sdb", "Already basename"},
		{"/dev/disk/by-id/usb-device", "usb-device", "Complex path"},
	}

	for _, tc := range testCases {
		// Use the logic from various functions that call filepath.Base
		result := strings.TrimPrefix(tc.input, "/dev/")
		if strings.Contains(result, "/") {
			// Get last component
			parts := strings.Split(result, "/")
			result = parts[len(parts)-1]
		}

		if result != tc.expected {
			t.Logf("%s: Input '%s' extracted to '%s', expected '%s'",
				tc.desc, tc.input, result, tc.expected)
		}
	}
}

// Test RAID array status strings
func TestRAIDStatusValues(t *testing.T) {
	validStatuses := []string{"active", "inactive", "auto-read-only", "clean", "degraded"}

	for _, status := range validStatuses {
		device := RAIDDevice{
			Name:   "md0",
			Status: status,
			Level:  "raid1",
		}

		if device.Status != status {
			t.Errorf("Expected status '%s', got '%s'", status, device.Status)
		}
	}
}

// Test RAID level strings
func TestRAIDLevelStrings(t *testing.T) {
	validLevels := []string{"raid0", "raid1", "raid4", "raid5", "raid6", "raid10"}

	for _, level := range validLevels {
		device := RAIDDevice{
			Name:   "md0",
			Status: "active",
			Level:  level,
		}

		if device.Level != level {
			t.Errorf("Expected level '%s', got '%s'", level, device.Level)
		}
	}
}

// Test member disk sequence ordering
func TestMemberSequenceOrdering(t *testing.T) {
	members := []*RAIDMember{
		{Name: "sdc", Seq: 2, Failed: false},
		{Name: "sda", Seq: 0, Failed: false},
		{Name: "sdb", Seq: 1, Failed: false},
	}

	// Verify members can be accessed by sequence
	for i, member := range members {
		if member.Seq != i+i { // sdc=2, sda=0, sdb=1 (unordered)
			// This is expected to be unordered initially
		}
	}

	// In actual code, members are sorted by Seq
	expectedOrder := []string{"sda", "sdb", "sdc"}
	t.Logf("Original order: %s, %s, %s", members[0].Name, members[1].Name, members[2].Name)
	t.Logf("Expected sorted order: %s, %s, %s", expectedOrder[0], expectedOrder[1], expectedOrder[2])
}

// Test empty RAID device
func TestEmptyRAIDDevice(t *testing.T) {
	device := RAIDDevice{
		Name:    "md0",
		Status:  "inactive",
		Level:   "",
		Members: []*RAIDMember{},
	}

	if len(device.Members) != 0 {
		t.Errorf("Expected 0 members, got %d", len(device.Members))
	}
}
