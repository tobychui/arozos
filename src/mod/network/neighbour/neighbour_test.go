package neighbour

import (
	"os"
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/network/mdns"
)

// newTestDB creates a temporary BoltDB database for testing.
func newTestDB(t *testing.T) (*database.Database, func()) {
	t.Helper()
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := database.NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}
	return db, func() {
		db.Close()
		os.Remove(dbPath)
	}
}

// stubMDNSHost returns a minimal MDNSHost with no real server.
// NewMDNS requires network access (zeroconf registration), so we build a
// value directly to avoid external dependencies.
func stubMDNSHost() *mdns.MDNSHost {
	return &mdns.MDNSHost{
		Host: &mdns.NetworkHost{
			HostName: "test-host",
			UUID:     "test-uuid-1234",
			Domain:   "arozos",
		},
	}
}

func TestNewDiscoverer(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	host := stubMDNSHost()
	d := NewDiscoverer(host, db)

	if d.Host != host {
		t.Error("expected Host to be the provided mdns host")
	}
	if d.Database != db {
		t.Error("expected Database to be the provided database")
	}
	if d.LastScanningTime != -1 {
		t.Errorf("expected LastScanningTime to be -1, got %d", d.LastScanningTime)
	}
	if d.NearbyHosts == nil {
		t.Error("expected NearbyHosts to be initialised (non-nil slice)")
	}
	if len(d.NearbyHosts) != 0 {
		t.Errorf("expected NearbyHosts to be empty, got %d entries", len(d.NearbyHosts))
	}
}

func TestScannerRunning_InitiallyFalse(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)
	if d.ScannerRunning() {
		t.Error("expected ScannerRunning to return false on a fresh Discoverer")
	}
}

func TestGetNearbyHosts_EmptyByDefault(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)
	hosts := d.GetNearbyHosts()
	if len(hosts) != 0 {
		t.Errorf("expected 0 nearby hosts, got %d", len(hosts))
	}
}

func TestGetNearbyHosts_ReturnsCopy(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)
	d.NearbyHosts = []*mdns.NetworkHost{
		{HostName: "host-a", UUID: "uuid-a"},
		{HostName: "host-b", UUID: "uuid-b"},
	}

	hosts := d.GetNearbyHosts()
	if len(hosts) != 2 {
		t.Fatalf("expected 2 nearby hosts, got %d", len(hosts))
	}
	if hosts[0].HostName != "host-a" {
		t.Errorf("unexpected host name: %s", hosts[0].HostName)
	}
}

func TestGetOfflineHosts_EmptyWhenNoRecords(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)
	offlineHosts, err := d.GetOfflineHosts()
	if err != nil {
		t.Fatalf("unexpected error from GetOfflineHosts: %v", err)
	}
	if len(offlineHosts) != 0 {
		t.Errorf("expected 0 offline hosts on empty database, got %d", len(offlineHosts))
	}
}

func TestSendWakeOnLan_InvalidMacReturnsError(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)
	// An obviously invalid MAC address should produce an error.
	err := d.SendWakeOnLan("not-a-valid-mac")
	if err == nil {
		t.Error("expected an error for invalid MAC address, got nil")
	}
}

func TestHostRecord_Fields(t *testing.T) {
	rec := HostRecord{
		Name:       "my-host",
		Model:      "Pi4",
		Version:    "2.0",
		UUID:       "abcd-1234",
		LastSeenIP: []string{"192.168.1.10"},
		MacAddr:    []string{"aa:bb:cc:dd:ee:ff"},
		LastOnline: 1234567890,
	}

	if rec.Name != "my-host" {
		t.Errorf("unexpected Name: %s", rec.Name)
	}
	if rec.UUID != "abcd-1234" {
		t.Errorf("unexpected UUID: %s", rec.UUID)
	}
	if len(rec.LastSeenIP) != 1 || rec.LastSeenIP[0] != "192.168.1.10" {
		t.Error("unexpected LastSeenIP")
	}
}

func TestAutoDeleteRecordTime_Value(t *testing.T) {
	// 30 days = 2592000 seconds
	const expectedSeconds = int64(30 * 24 * 60 * 60)
	if AutoDeleteRecordTime != expectedSeconds {
		t.Errorf("AutoDeleteRecordTime = %d, want %d", AutoDeleteRecordTime, expectedSeconds)
	}
}
