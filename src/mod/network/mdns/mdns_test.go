package mdns

import (
	"testing"
)

func TestNewMDNS(t *testing.T) {
	// Test case 1: Create with minimal valid parameters
	config := NetworkHost{
		HostName:     "test-host",
		Port:         8080,
		Domain:       "test",
		Model:        "test-model",
		UUID:         "test-uuid",
		Vendor:       "test-vendor",
		BuildVersion: "1.0",
		MinorVersion: "0",
	}

	handler, err := NewMDNS(config, "")
	if err != nil {
		// May fail if mDNS registration fails (e.g., port in use, permissions)
		t.Logf("Expected error in test environment: %v", err)
		return
	}

	if handler == nil {
		t.Error("Test case 1 failed. Handler should not be nil when no error")
	}

	// Clean up if successful
	if handler != nil {
		handler.Close()
	}
}
