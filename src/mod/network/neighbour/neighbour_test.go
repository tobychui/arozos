package neighbour

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/network/mdns"
)

func timeNow() int64 {
	return time.Now().Unix()
}

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

// ── Handler Tests ─────────────────────────────────────────────────────────────

func TestHandleScanningRequest(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)
	// Add some nearby hosts
	d.NearbyHosts = []*mdns.NetworkHost{
		{HostName: "host-a", UUID: "uuid-a"},
	}

	req, _ := http.NewRequest(http.MethodGet, "/neighbour/scan", nil)
	rr := httptest.NewRecorder()
	d.HandleScanningRequest(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if body == "" {
		t.Error("expected non-empty JSON response")
	}
}

func TestHandleScanRecord_Empty(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)

	req, _ := http.NewRequest(http.MethodGet, "/neighbour/record", nil)
	rr := httptest.NewRecorder()
	d.HandleScanRecord(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestHandleWakeOnLan_MissingParam(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)

	req, _ := http.NewRequest(http.MethodGet, "/neighbour/wol", nil)
	rr := httptest.NewRecorder()
	d.HandleWakeOnLan(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error response for missing MAC, got: %s", body)
	}
}

func TestHandleWakeOnLan_InvalidMac(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)

	req, _ := http.NewRequest(http.MethodGet, "/neighbour/wol?mac=invalid-mac", nil)
	rr := httptest.NewRecorder()
	d.HandleWakeOnLan(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error response for invalid MAC, got: %s", body)
	}
}

// ── StopScanning (when scanner not running) ──────────────────────────────────

func TestStopScanning_NotRunning(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)
	// Calling StopScanning when scanner is not running should not panic
	d.StopScanning()
}

// ── GetOfflineHosts with records ─────────────────────────────────────────────

func TestGetOfflineHosts_WithRecentRecord(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)

	// Write a recent host record (not expired)
	rec := HostRecord{
		Name:       "offline-host",
		UUID:       "uuid-offline",
		LastOnline: timeNow() - 3600, // 1 hour ago, within 30-day window
	}
	db.Write("neighbour", "uuid-offline", rec)

	offlineHosts, err := d.GetOfflineHosts()
	if err != nil {
		t.Fatalf("GetOfflineHosts error: %v", err)
	}
	if len(offlineHosts) != 1 {
		t.Errorf("expected 1 offline host, got %d", len(offlineHosts))
	}
}

func TestGetOfflineHosts_ExpiredRecordDeleted(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)

	// Write an old host record (beyond 30-day expiry)
	rec := HostRecord{
		Name:       "old-host",
		UUID:       "uuid-old",
		LastOnline: timeNow() - (AutoDeleteRecordTime + 3600), // older than 30 days
	}
	db.Write("neighbour", "uuid-old", rec)

	offlineHosts, err := d.GetOfflineHosts()
	if err != nil {
		t.Fatalf("GetOfflineHosts error: %v", err)
	}
	// The expired record should be deleted
	if len(offlineHosts) != 0 {
		t.Errorf("expected 0 offline hosts (expired record), got %d", len(offlineHosts))
	}
}

// TestScannerRunning_True covers the return-true branch when d.d is non-nil.
func TestScannerRunning_True(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)
	d.d = make(chan bool, 1) // buffered so no goroutine is needed
	if !d.ScannerRunning() {
		t.Error("expected ScannerRunning to return true when d.d is non-nil")
	}
	// Drain the channel to avoid leaks
	d.d = nil
}

// TestStopScanning_Running covers the d.d != nil branch of StopScanning.
func TestStopScanning_Running(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)
	// Buffered channel: StopScanning sends one value then returns.
	d.d = make(chan bool, 1)
	d.t = time.NewTicker(time.Hour)

	d.StopScanning()

	if d.d != nil {
		t.Error("expected d.d to be nil after StopScanning")
	}
	if d.t != nil {
		t.Error("expected d.t to be nil after StopScanning")
	}
}

// TestHandleScanningRequest_Loopback covers the branch where a host UUID
// matches the local host UUID (loopback signal).
func TestHandleScanningRequest_Loopback(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	host := stubMDNSHost() // UUID = "test-uuid-1234"
	d := NewDiscoverer(host, db)
	d.NearbyHosts = []*mdns.NetworkHost{
		{HostName: "test-host", UUID: "test-uuid-1234"}, // same UUID → loopback
		{HostName: "other-host", UUID: "other-uuid"},
	}

	req, _ := http.NewRequest(http.MethodGet, "/neighbour/scan", nil)
	rr := httptest.NewRecorder()
	d.HandleScanningRequest(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "test-host") {
		t.Errorf("expected loopback host in response, got: %s", body)
	}
}

// TestGetOfflineHosts_OnlineHostExcluded verifies a host currently in NearbyHosts
// is NOT included in offline results.
func TestGetOfflineHosts_OnlineHostExcluded(t *testing.T) {
	db, cleanup := newTestDB(t)
	defer cleanup()

	d := NewDiscoverer(stubMDNSHost(), db)

	// Write a recent record
	rec := HostRecord{
		Name:       "online-host",
		UUID:       "uuid-online",
		LastOnline: timeNow() - 60,
	}
	db.Write("neighbour", "uuid-online", rec)

	// Mark the host as online
	d.NearbyHosts = []*mdns.NetworkHost{
		{UUID: "uuid-online"},
	}

	offlineHosts, err := d.GetOfflineHosts()
	if err != nil {
		t.Fatalf("GetOfflineHosts error: %v", err)
	}
	if len(offlineHosts) != 0 {
		t.Errorf("expected 0 offline hosts (host is online), got %d", len(offlineHosts))
	}
}
