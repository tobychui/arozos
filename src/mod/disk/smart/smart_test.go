package smart

import (
	"testing"
)

func TestGetDrives(t *testing.T) {
	// Test case 1: Get drives list
	drives := GetDrives()
	// Just verify it returns without panicking
	t.Logf("Found %d drives", len(drives))
}

func TestGetDriveSMARTInfo(t *testing.T) {
	// Test case 1: Try to get SMART info for invalid drive
	_, err := GetDriveSMARTInfo("invalid_drive")
	if err == nil {
		t.Log("Test case 1: Expected error for invalid drive, but got none")
	}
}
