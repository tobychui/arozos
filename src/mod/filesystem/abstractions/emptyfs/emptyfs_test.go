package emptyfs

import (
	"testing"
)

func TestNewEmptyFileSystemAbstraction(t *testing.T) {
	// Test case 1: Create empty file system abstraction
	fs := NewEmptyFileSystemAbstraction()

	// Verify basic operations return expected errors
	if fs.Name() != "" {
		t.Error("Test case 1 failed. Empty FS name should be empty")
	}

	// Test that all operations return appropriate errors
	if fs.FileExists("/test") != false {
		t.Error("Test case 2 failed. FileExists should always return false")
	}

	if fs.IsDir("/test") != false {
		t.Error("Test case 3 failed. IsDir should always return false")
	}
}
