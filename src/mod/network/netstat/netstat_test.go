package netstat

import (
	"testing"
)

func TestGetNetworkInterfaceStats(t *testing.T) {
	// Test that function doesn't panic
	rx, tx, err := GetNetworkInterfaceStats()
	if err != nil {
		t.Logf("Error getting network stats (may be expected): %v", err)
	} else {
		t.Logf("Network stats - RX: %d, TX: %d", rx, tx)
	}
}
