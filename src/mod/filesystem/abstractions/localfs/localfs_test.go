package localfs

import (
	"testing"
)

func TestNewLocalFileSystemAbstraction(t *testing.T) {
	// Test case 1: Create local file system abstraction
	fs := NewLocalFileSystemAbstraction("test-uuid", "/tmp", "test-hierarchy", false)

	if fs.UUID != "test-uuid" {
		t.Errorf("Test case 1 failed. UUID should be 'test-uuid', got '%s'", fs.UUID)
	}

	if fs.Rootpath != "/tmp" {
		t.Errorf("Test case 2 failed. Rootpath should be '/tmp', got '%s'", fs.Rootpath)
	}

	if fs.Hierarchy != "test-hierarchy" {
		t.Errorf("Test case 3 failed. Hierarchy should be 'test-hierarchy', got '%s'", fs.Hierarchy)
	}

	if fs.ReadOnly != false {
		t.Error("Test case 4 failed. ReadOnly should be false")
	}

	// Test case 5: Create read-only file system
	readOnlyFS := NewLocalFileSystemAbstraction("ro-uuid", "/", "root", true)
	if !readOnlyFS.ReadOnly {
		t.Error("Test case 5 failed. ReadOnly should be true")
	}
}
