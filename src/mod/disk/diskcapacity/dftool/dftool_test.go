package dftool

import (
	"testing"
)

func TestGetDiskUsage(t *testing.T) {
	// Test basic functionality
	usage, err := GetDiskUsage(".")
	if err != nil {
		t.Logf("Error getting disk usage: %v", err)
	} else {
		t.Logf("Disk usage: %+v", usage)
	}
}
