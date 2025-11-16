package storage

import (
	"os"
	"runtime"
	"testing"
)

func TestGetDriveCapacity(t *testing.T) {
	// Test case 1: Get capacity for current working directory
	cwd, err := os.Getwd()
	if err != nil {
		t.Fatalf("Failed to get current working directory: %v", err)
	}

	free, total, available := GetDriveCapacity(cwd)

	// Validate that values are non-negative
	if free < 0 {
		t.Errorf("Test case 1 failed. Free space should not be negative, got %d", free)
	}
	if total < 0 {
		t.Errorf("Test case 1 failed. Total space should not be negative, got %d", total)
	}
	if available < 0 {
		t.Errorf("Test case 1 failed. Available space should not be negative, got %d", available)
	}

	// Test case 2: Free space should not exceed total space
	if free > total {
		t.Errorf("Test case 2 failed. Free space (%d) should not exceed total space (%d)", free, total)
	}

	// Test case 3: Available space should not exceed total space
	if available > total {
		t.Errorf("Test case 3 failed. Available space (%d) should not exceed total space (%d)", available, total)
	}

	// Test case 4: Test with root directory (OS-specific)
	var rootPath string
	switch runtime.GOOS {
	case "windows":
		rootPath = "C:\\"
	default:
		rootPath = "/"
	}

	free2, total2, available2 := GetDriveCapacity(rootPath)

	if free2 < 0 {
		t.Errorf("Test case 4 failed. Root free space should not be negative, got %d", free2)
	}
	if total2 < 0 {
		t.Errorf("Test case 4 failed. Root total space should not be negative, got %d", total2)
	}
	if available2 < 0 {
		t.Errorf("Test case 4 failed. Root available space should not be negative, got %d", available2)
	}

	// Test case 5: Consistency check - same path should give consistent results
	free3, total3, available3 := GetDriveCapacity(cwd)

	// Total space should be exactly the same
	if total != total3 {
		t.Errorf("Test case 5 failed. Total space should be consistent, got %d and %d", total, total3)
	}

	// Free and available should be close (within reasonable bounds)
	// They might differ slightly due to disk activity
	freeDiff := int64(free) - int64(free3)
	if freeDiff < 0 {
		freeDiff = -freeDiff
	}
	// Allow for up to 100MB difference due to disk activity
	if freeDiff > 100*1024*1024 {
		t.Logf("Warning: Free space changed by more than 100MB between calls: %d vs %d", free, free3)
	}

	// Test case 6: Test with temporary directory
	tempDir := os.TempDir()
	free4, total4, available4 := GetDriveCapacity(tempDir)

	if free4 < 0 {
		t.Errorf("Test case 6 failed. Temp dir free space should not be negative, got %d", free4)
	}
	if total4 < 0 {
		t.Errorf("Test case 6 failed. Temp dir total space should not be negative, got %d", total4)
	}
	if available4 < 0 {
		t.Errorf("Test case 6 failed. Temp dir available space should not be negative, got %d", available4)
	}

	// Test case 7: Validate relationship between free and available
	// On most systems, available should be less than or equal to free
	// (some space might be reserved for root/system)
	if available > free {
		t.Logf("Note: Available space (%d) is greater than free space (%d), which is unusual but not necessarily an error", available, free)
	}

	// Test case 8: Test with non-existent path (should still return values, possibly zeros)
	free5, total5, available5 := GetDriveCapacity("/nonexistent/path/that/does/not/exist")

	// The function should still return without panicking
	// Values might be 0 or might fall back to current directory
	t.Logf("Non-existent path returned: free=%d, total=%d, available=%d", free5, total5, available5)

	// Test case 9: Test with home directory
	homeDir, err := os.UserHomeDir()
	if err == nil {
		free6, total6, available6 := GetDriveCapacity(homeDir)

		if free6 < 0 {
			t.Errorf("Test case 9 failed. Home dir free space should not be negative, got %d", free6)
		}
		if total6 <= 0 {
			t.Errorf("Test case 9 failed. Home dir total space should be positive, got %d", total6)
		}
		if available6 < 0 {
			t.Errorf("Test case 9 failed. Home dir available space should not be negative, got %d", available6)
		}
	}

	// Test case 10: Validate that total space is reasonable (not zero for valid paths)
	if total == 0 {
		t.Errorf("Test case 10 failed. Total space should not be zero for working directory")
	}

	// Test case 11: Used space calculation makes sense
	used := total - free
	if used < 0 {
		t.Errorf("Test case 11 failed. Used space (total - free = %d) should not be negative", used)
	}

	// Test case 12: Empty string path
	free7, total7, available7 := GetDriveCapacity("")
	t.Logf("Empty path returned: free=%d, total=%d, available=%d", free7, total7, available7)

	// Should handle gracefully, not panic
	if total7 < 0 {
		t.Errorf("Test case 12 failed. Total should not be negative for empty path, got %d", total7)
	}
}
