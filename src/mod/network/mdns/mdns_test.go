package mdns

import (
	"testing"
)

// TestStringInSlice_Found verifies that stringInSlice returns true when the
// target string exists in the list.
func TestStringInSlice_Found(t *testing.T) {
	list := []string{"alpha", "beta", "gamma"}
	if !stringInSlice("beta", list) {
		t.Error("expected stringInSlice to return true for 'beta'")
	}
}

// TestStringInSlice_NotFound verifies that stringInSlice returns false when the
// target string is absent.
func TestStringInSlice_NotFound(t *testing.T) {
	list := []string{"alpha", "beta", "gamma"}
	if stringInSlice("delta", list) {
		t.Error("expected stringInSlice to return false for 'delta'")
	}
}

// TestStringInSlice_Empty verifies that an empty list always returns false.
func TestStringInSlice_Empty(t *testing.T) {
	if stringInSlice("x", []string{}) {
		t.Error("expected stringInSlice to return false on an empty list")
	}
}

// TestStringInSlice_EmptyString ensures the empty string matches correctly.
func TestStringInSlice_EmptyString(t *testing.T) {
	list := []string{"", "a"}
	if !stringInSlice("", list) {
		t.Error("expected stringInSlice to return true for empty string when it is in the list")
	}
}

// TestGetMacAddr_DoesNotError verifies that getMacAddr can execute without
// crashing in a standard test environment (network interfaces are available).
func TestGetMacAddr_DoesNotError(t *testing.T) {
	addrs, err := getMacAddr()
	if err != nil {
		t.Fatalf("getMacAddr returned unexpected error: %v", err)
	}
	// We cannot assert specific MAC addresses, but the function must return a
	// slice (possibly empty when no physical interfaces exist).
	_ = addrs
}

// TestNetworkHost_Fields verifies that a NetworkHost struct can be populated and
// read back correctly.
func TestNetworkHost_Fields(t *testing.T) {
	host := NetworkHost{
		HostName:     "test-device",
		Port:         8080,
		Domain:       "arozos",
		Model:        "Pi4",
		UUID:         "uuid-9999",
		Vendor:       "Acme",
		BuildVersion: "build-42",
		MinorVersion: "1.0",
		MacAddr:      []string{"aa:bb:cc:dd:ee:ff"},
		Online:       true,
	}

	if host.HostName != "test-device" {
		t.Errorf("unexpected HostName: %s", host.HostName)
	}
	if host.Port != 8080 {
		t.Errorf("unexpected Port: %d", host.Port)
	}
	if host.UUID != "uuid-9999" {
		t.Errorf("unexpected UUID: %s", host.UUID)
	}
	if !host.Online {
		t.Error("expected Online to be true")
	}
	if len(host.MacAddr) != 1 || host.MacAddr[0] != "aa:bb:cc:dd:ee:ff" {
		t.Error("unexpected MacAddr")
	}
}

// TestNewMDNS_SkipIfNoNetwork attempts to create an MDNSHost and skips the
// test if the environment does not support mDNS registration (e.g. no
// multicast-capable interface).
func TestNewMDNS_SkipIfNoNetwork(t *testing.T) {
	config := NetworkHost{
		HostName:     "test-node",
		Port:         18080,
		Domain:       "arozos",
		Model:        "test",
		UUID:         "test-uuid-mdns",
		Vendor:       "test-vendor",
		BuildVersion: "0",
		MinorVersion: "0",
	}

	host, err := NewMDNS(config, "")
	if err != nil {
		t.Skipf("skipping mDNS constructor test (network unavailable): %v", err)
	}
	defer host.Close()

	if host.Host == nil {
		t.Error("expected Host to be non-nil after successful NewMDNS")
	}
	if host.MDNS == nil {
		t.Error("expected MDNS server to be non-nil after successful NewMDNS")
	}
}
