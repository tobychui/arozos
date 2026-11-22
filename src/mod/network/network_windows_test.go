//go:build windows

package network

import (
	"net"
	"testing"
)

// nicExtraAll answers for every interface Go lists, with the state names the
// network page uses on all platforms
func TestNicExtraAllWindows(t *testing.T) {
	ifaces, err := net.Interfaces()
	if err != nil {
		t.Fatalf("net.Interfaces: %v", err)
	}
	extras := nicExtraAll(ifaces)
	valid := map[string]bool{"up": true, "down": true, "dormant": true, "testing": true, "unknown": true}
	for _, iface := range ifaces {
		extra, ok := extras[iface.Name]
		if !ok {
			t.Errorf("no details for interface %q", iface.Name)
			continue
		}
		if !valid[extra.OperState] {
			t.Errorf("%q OperState = %q", iface.Name, extra.OperState)
		}
		if extra.Speed == "" || extra.Duplex == "" {
			t.Errorf("%q has an empty speed or duplex: %+v", iface.Name, extra)
		}
	}
}
