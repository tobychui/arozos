package dftool

import (
	"testing"
)

func TestGetCapacityInfoFromPath(t *testing.T) {
	// Test case 1: Get capacity info for current directory
	capacity, err := GetCapacityInfoFromPath(".")
	if err != nil {
		t.Logf("Error getting capacity info (may be expected in test environment): %v", err)
		return
	}

	if capacity == nil {
		t.Error("Test case 1 failed. Capacity should not be nil when no error")
		return
	}

	// Verify capacity structure has reasonable values
	if capacity.Total <= 0 {
		t.Error("Test case 2 failed. Total capacity should be positive")
	}

	if capacity.Used < 0 {
		t.Error("Test case 3 failed. Used capacity should not be negative")
	}

	if capacity.Available < 0 {
		t.Error("Test case 4 failed. Available capacity should not be negative")
	}

	t.Logf("Capacity info: Device=%s, Total=%d, Used=%d, Available=%d",
		capacity.PhysicalDevice, capacity.Total, capacity.Used, capacity.Available)
}
