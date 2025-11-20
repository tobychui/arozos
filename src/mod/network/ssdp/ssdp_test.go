package ssdp

import (
	"testing"
)

func TestNewSSDPHost(t *testing.T) {
	option := SSDPOption{
		URLBase:   "http://localhost:8080",
		Hostname:  "test-host",
		Vendor:    "Test Vendor",
		VendorURL: "http://example.com",
		ModelName: "Test Model",
		ModelDesc: "Test Description",
		Serial:    "12345",
		UUID:      "test-uuid-1234",
	}
	host, err := NewSSDPHost("127.0.0.1", 8080, "test.xml", option)
	if err != nil {
		t.Logf("SSDP initialization error (may be expected): %v", err)
	}
	if host == nil {
		t.Error("Host should not be nil even on error")
	}
}
