package hardwareinfo

import (
	"testing"
)

func TestNewInfoServer(t *testing.T) {
	arozInfo := ArOZInfo{
		BuildVersion: "1.0",
		DeviceVendor: "Test",
		DeviceModel:  "Test Model",
		HostOS:       "linux",
		CPUArch:      "amd64",
	}
	server := NewInfoServer(arozInfo)
	if server == nil {
		t.Error("Server should not be nil")
	}
}
