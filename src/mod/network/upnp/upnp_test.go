package upnp

import (
	"testing"
)

// TestNewUPNPClient_SkipAlways skips the UPnP discovery test unconditionally
// because upnp.Discover() performs a blocking network scan with no built-in
// timeout and will hang indefinitely in environments without a UPnP-capable
// router (e.g. CI). The constructor itself is trivially thin; the real
// coverage lives in the unit tests below.
func TestNewUPNPClient_SkipAlways(t *testing.T) {
	t.Skip("skipping UPnP constructor test: requires a live UPnP router and blocks indefinitely without one")
}

// TestForwardPort_DuplicateDetection verifies that ForwardPort returns an
// error when the same port is registered twice.
// This does not require a live UPnP device – it exercises only the
// in-memory duplicate-detection logic.
func TestForwardPort_DuplicateDetection(t *testing.T) {
	client := &UPnPClient{
		RequiredPorts: []int{},
	}

	// Pre-populate the port as if it had already been forwarded.
	client.PolicyNames.Store(9090, "existing-service")

	err := client.ForwardPort(9090, "duplicate-service")
	if err == nil {
		t.Error("expected an error when forwarding an already-forwarded port, got nil")
	}
}

// TestClosePort_UnknownPort verifies that ClosePort on a port that was never
// forwarded is a no-op (returns nil).
func TestClosePort_UnknownPort(t *testing.T) {
	client := &UPnPClient{
		RequiredPorts: []int{},
	}

	err := client.ClosePort(7777)
	if err != nil {
		t.Errorf("expected no error when closing an unknown port, got: %v", err)
	}
}

// TestUPnPClient_Close_NilSafe verifies that calling Close on a nil client
// does not panic.
func TestUPnPClient_Close_NilSafe(t *testing.T) {
	defer func() {
		if r := recover(); r != nil {
			t.Errorf("Close on nil UPnPClient panicked: %v", r)
		}
	}()

	var client *UPnPClient
	client.Close()
}
