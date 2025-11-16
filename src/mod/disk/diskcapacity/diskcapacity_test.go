package diskcapacity

import (
	"testing"
)

func TestNewCapacityResolver(t *testing.T) {
	// Test case 1: Create with nil user handler
	resolver := NewCapacityResolver(nil)
	if resolver == nil {
		t.Error("Test case 1 failed. Resolver should not be nil")
	}
	if resolver.UserHandler != nil {
		t.Error("Test case 1 failed. User handler should be nil")
	}
}

func TestCapacityInfoStruct(t *testing.T) {
	// Test case 1: Create and verify CapacityInfo structure
	info := CapacityInfo{
		PhysicalDevice:    "/dev/sda1",
		FileSystemType:    "ext4",
		MountingHierarchy: "/home",
		Used:              1024000,
		Available:         2048000,
		Total:             3072000,
	}

	if info.PhysicalDevice != "/dev/sda1" {
		t.Error("Test case 1 failed. Physical device mismatch")
	}
	if info.FileSystemType != "ext4" {
		t.Error("Test case 1 failed. File system type mismatch")
	}
	if info.Used+info.Available != info.Total {
		t.Error("Test case 1 failed. Used + Available should equal Total")
	}
}
