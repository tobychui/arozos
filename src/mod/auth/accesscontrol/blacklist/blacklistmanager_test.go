package blacklist

import (
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/database"
)

// setupTest creates an isolated database in a temp dir and returns
// the BlackList and a teardown function.
func setupTest(t *testing.T) (*BlackList, func()) {
	t.Helper()
	tmpDir := t.TempDir()
	dbPath := filepath.Join(tmpDir, "testdb.db")

	db, err := database.NewDatabase(dbPath, false)
	if err != nil {
		t.Fatalf("Failed to create a new database: %v", err)
	}

	bl := NewBlacklistManager(db)
	bl.SetBlacklistEnabled(true)

	teardown := func() {
		db.Close()
		// t.TempDir() is cleaned up automatically by the testing framework
	}
	return bl, teardown
}

func TestBlackList_IsBanned(t *testing.T) {
	bl, teardown := setupTest(t)
	defer teardown()

	// Test case 1: IP is not banned
	if bl.IsBanned("192.168.1.1") {
		t.Error("Expected IP to not be banned")
	}

	// Test case 2: IP is banned
	bl.Ban("192.168.1.1")
	if !bl.IsBanned("192.168.1.1") {
		t.Error("Expected IP to be banned")
	}

	// Test case 3: IP range is banned
	bl.Ban("192.168.2.1-192.168.2.254")
	if !bl.IsBanned("192.168.2.5") {
		t.Error("Expected IP range to be banned")
	}

	// Test case 4: IP range is not banned
	if bl.IsBanned("10.0.0.1") {
		t.Error("Expected IP range to not be banned")
	}
}

func TestBlackList_ListBannedIpRanges(t *testing.T) {
	bl, teardown := setupTest(t)
	defer teardown()

	// Test case 1: No banned IP ranges
	if len(bl.ListBannedIpRanges()) != 0 {
		t.Error("Expected no banned IP ranges")
	}

	// Test case 2: Banned IP ranges exist
	bl.Ban("192.168.1.1")
	bl.Ban("192.168.2.1-192.168.2.254")

	bannedRanges := bl.ListBannedIpRanges()
	if len(bannedRanges) != 2 {
		t.Errorf("Expected 2 banned IP ranges, got %d", len(bannedRanges))
	}
}

func TestBlackList_Ban_UnBan(t *testing.T) {
	bl, teardown := setupTest(t)
	defer teardown()

	// Test case 1: Ban an IP
	bl.Ban("192.168.1.1")
	if !bl.IsBanned("192.168.1.1") {
		t.Error("Expected IP to be banned")
	}

	// Test case 2: Ban an IP range
	bl.Ban("192.168.2.1-192.168.2.254")
	if !bl.IsBanned("192.168.2.5") {
		t.Error("Expected IP range to be banned")
	}

	// Test case 3: Unban an IP
	bl.UnBan("192.168.1.1")
	if bl.IsBanned("192.168.1.1") {
		t.Error("Expected IP to be unbanned")
	}

	// Test case 4: Unban an IP range
	bl.UnBan("192.168.2.1-192.168.2.254")
	if bl.IsBanned("192.168.2.5") {
		t.Error("Expected IP range to be unbanned")
	}
}

func TestBlackList_InvalidIpRange(t *testing.T) {
	bl, teardown := setupTest(t)
	defer teardown()

	// Test case 1: Ban with invalid IP range
	err := bl.Ban("invalid-ip-range")
	if err == nil {
		t.Error("Expected error for invalid IP range")
	}

	// Test case 2: Unban with invalid IP range
	err = bl.UnBan("invalid-ip-range")
	if err == nil {
		t.Error("Expected error for invalid IP range")
	}
}
