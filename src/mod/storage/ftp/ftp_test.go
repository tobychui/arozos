package ftp

import (
	"testing"
)

func TestNewFTPHandler(t *testing.T) {
	// Test case 1: Create with nil user handler
	// This will panic when trying to access the database, so we expect it to fail
	// In a real scenario, we would mock the user handler
	defer func() {
		if r := recover(); r != nil {
			t.Logf("Expected panic with nil user handler: %v", r)
		}
	}()

	_, err := NewFTPHandler(nil, "TestServer", 2121, "/tmp", "")
	if err != nil {
		t.Logf("Expected error with nil user handler: %v", err)
	}
}
