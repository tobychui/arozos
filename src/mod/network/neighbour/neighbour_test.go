package neighbour

import (
	"testing"
)

func TestNewNeighbourDiscovery(t *testing.T) {
	discovery := NewNeighbourDiscovery(nil, "")
	if discovery == nil {
		t.Error("Discovery should not be nil")
	}
}
