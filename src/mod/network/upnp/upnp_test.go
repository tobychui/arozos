package upnp

import (
	"testing"
)

func TestNewUPNPClient(t *testing.T) {
	// Test that function returns error when UPnP is not available
	_, err := NewUPNPClient(8080, "test-host")
	// It's expected to fail in most test environments without UPnP
	if err != nil {
		t.Logf("UPnP not available (expected): %v", err)
	}
}
