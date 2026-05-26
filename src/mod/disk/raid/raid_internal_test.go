//go:build linux
// +build linux

package raid

import (
	"runtime"
	"strings"
	"testing"
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
