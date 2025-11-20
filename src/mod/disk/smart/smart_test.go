package smart

import (
	"testing"
)

func TestNewSmartListener(t *testing.T) {
	// Test case 1: Try to create a new SMART listener
	// This may fail if smartctl is not installed or platform not supported
	listener, err := NewSmartListener()
	if err != nil {
		// Expected on systems without smartctl or unsupported platforms
		t.Logf("Expected error without smartctl or on unsupported platform: %v", err)
		return
	}

	// If successful, verify the listener was created
	if listener == nil {
		t.Error("Test case 1 failed. Listener should not be nil when no error")
	}

	// Log drive count if available
	t.Logf("Found %d drives", len(listener.DriveList.Devices))
}
