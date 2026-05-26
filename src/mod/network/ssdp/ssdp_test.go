package ssdp

import (
	"runtime"
	"testing"
)

// TestSSDPOption_Fields verifies that an SSDPOption struct can be created with
// the expected fields.
func TestSSDPOption_Fields(t *testing.T) {
	opt := SSDPOption{
		URLBase:   "http://192.168.1.1:8080",
		Hostname:  "my-host",
		Vendor:    "AcmeCorp",
		VendorURL: "http://acme.example.com",
		ModelName: "ArozOS",
		ModelDesc: "ArOZ Online System",
		Serial:    "SN-12345",
		UUID:      "uuid-abcd-1234",
	}

	if opt.URLBase != "http://192.168.1.1:8080" {
		t.Errorf("unexpected URLBase: %s", opt.URLBase)
	}
	if opt.UUID != "uuid-abcd-1234" {
		t.Errorf("unexpected UUID: %s", opt.UUID)
	}
	if opt.Vendor != "AcmeCorp" {
		t.Errorf("unexpected Vendor: %s", opt.Vendor)
	}
}

// TestPkgExists_Which verifies that pkg_exists returns true for 'which' (a
// standard POSIX tool always present in the test environment) and false for a
// non-existent program.
func TestPkgExists_Which(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("pkg_exists behaviour only tested on Linux")
	}
	if !pkg_exists("which") {
		t.Error("expected pkg_exists('which') to return true")
	}
	if pkg_exists("this_program_definitely_does_not_exist_xyzzy") {
		t.Error("expected pkg_exists to return false for a non-existent program")
	}
}

// TestGetFirstNetworkInterfaceName_Linux runs only on Linux and checks that
// the function either returns a non-empty interface name or a non-nil error.
func TestGetFirstNetworkInterfaceName_Linux(t *testing.T) {
	if runtime.GOOS != "linux" {
		t.Skip("getFirstNetworkInterfaceName is only implemented for Linux")
	}
	name, err := getFirstNetworkInterfaceName()
	if err != nil {
		// No default route configured in this environment – that's acceptable.
		t.Logf("getFirstNetworkInterfaceName returned error (may be expected): %v", err)
		return
	}
	if name == "" {
		t.Error("expected a non-empty interface name when err == nil")
	}
}

// TestNewSSDPHost_SkipIfNoNetwork tries to create an SSDP host and skips the
// test if the environment does not support it (e.g. no network or multicast).
func TestNewSSDPHost_SkipIfNoNetwork(t *testing.T) {
	opt := SSDPOption{
		URLBase:   "http://127.0.0.1:18080",
		Hostname:  "test-host",
		Vendor:    "TestVendor",
		VendorURL: "http://example.com",
		ModelName: "TestModel",
		ModelDesc: "Test Description",
		Serial:    "SN-0001",
		UUID:      "test-uuid-ssdp-0001",
	}

	host, err := NewSSDPHost("127.0.0.1", 18080, "/nonexistent/template.xml", opt)
	if err != nil {
		t.Skipf("skipping SSDP constructor test (network unavailable): %v", err)
	}
	// Tidy up: close the advertiser without starting it.
	host.Close()

	if host.Option == nil {
		t.Error("expected Option to be non-nil after successful NewSSDPHost")
	}
	if host.Option.UUID != "test-uuid-ssdp-0001" {
		t.Errorf("unexpected UUID: %s", host.Option.UUID)
	}
	if host.advStarted {
		t.Error("expected advStarted to be false before Start() is called")
	}
}
