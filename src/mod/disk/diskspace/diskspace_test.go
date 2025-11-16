package diskspace

import (
	"testing"
)

func TestGetDiskUsage(t *testing.T) {
	// Test that function doesn't panic
	usage, err := GetDiskUsage("/")
	if err != nil {
		t.Logf("Expected error for root path: %v", err)
	} else {
		t.Logf("Disk usage: %+v", usage)
	}
}
