package diskmg

import (
	"testing"
)

func TestCheckDeviceValid(t *testing.T) {
	// Test device validation function
	valid, devID := checkDeviceValid("sda1")
	t.Logf("Device validation result: %v, ID: %s", valid, devID)
}
