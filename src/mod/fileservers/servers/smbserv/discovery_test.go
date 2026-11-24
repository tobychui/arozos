package smbserv

import (
	"net"
	"testing"
)

// TestMDNSHostName checks the host name announced over Bonjour: macOS
// reports "name.local", which zeroconf would turn into "name.local.local.".
func TestMDNSHostName(t *testing.T) {
	tests := []struct {
		in      string
		want    string
		trimmed bool
	}{
		{"TobydeMacBook-Pro.local", "TobydeMacBook-Pro", true},
		{"nas.local.", "nas", true},
		{"NAS.LOCAL", "NAS", true},
		{"raspberrypi", "raspberrypi", false},
		{"server.example.com", "server.example.com", false},
		{"local", "local", false},
		{".local", ".local", false},
		{"mylocal", "mylocal", false},
	}
	for _, tt := range tests {
		got, trimmed := mdnsHostName(tt.in)
		if got != tt.want || trimmed != tt.trimmed {
			t.Errorf("mdnsHostName(%q) = %q, %v; want %q, %v", tt.in, got, trimmed, tt.want, tt.trimmed)
		}
	}
}

// TestInterfaceIPs checks that only usable addresses are announced.
func TestInterfaceIPs(t *testing.T) {
	for _, s := range interfaceIPs() {
		ip := net.ParseIP(s)
		if ip == nil {
			t.Errorf("%q is not an address", s)
			continue
		}
		if ip.IsLoopback() || ip.IsUnspecified() || ip.IsMulticast() {
			t.Errorf("%s must not be announced", s)
		}
	}
}
