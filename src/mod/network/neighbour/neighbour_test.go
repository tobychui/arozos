package neighbour

import (
	"testing"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/network/mdns"
)

func TestNewDiscoverer(t *testing.T) {
	// Create mock objects (will be nil in test, which is fine for structure testing)
	var mdnsHost *mdns.MDNSHost
	db, _ := database.NewDatabase("./test.db", false)
	defer db.Close()

	discoverer := NewDiscoverer(mdnsHost, db)
	if discoverer.Database == nil {
		t.Error("Database should not be nil")
	}
}
