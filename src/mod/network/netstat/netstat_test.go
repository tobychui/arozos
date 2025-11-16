package netstat

import (
	"testing"
)

func TestGetNetworkConnections(t *testing.T) {
	// Test that function doesn't panic
	connections := GetConnections()
	t.Logf("Found %d connections", len(connections))
}
