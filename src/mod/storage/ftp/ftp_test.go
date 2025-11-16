package ftp

import (
	"testing"
)

func TestNewFTPServer(t *testing.T) {
	// Test case 1: Create with nil parameters
	server := NewFTPServer(nil, nil, 0, "")
	if server == nil {
		t.Error("Test case 1 failed. Server should not be nil")
	}
}
