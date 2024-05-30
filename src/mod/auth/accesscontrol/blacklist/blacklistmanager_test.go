package blacklist

import (
	"os"
	"testing"

	"imuslab.com/arozos/mod/database"
)

var dbFilePath = "../../../../test/"
var dbFileName = "testdb.db"
var sysDb *database.Database

func setupSuite(t *testing.T) func(t *testing.T) {
	//t.Log("Setting up database env")

	os.Mkdir(dbFilePath, 0777)
	file, err := os.Create(dbFilePath + dbFileName)
	if err != nil {
		t.Fatalf("Failed to create file: %v", err)
	}
	file.Close()

	// Return a function to teardown the test
	return func(t *testing.T) {
		//t.Log("Cleaning up")
		sysDb.Close()
		//time.Sleep(5 * time.Second)
		err := os.RemoveAll(dbFilePath)
		if err != nil {
			t.Fatalf("Failed to clean up: %v", err)
		}
	}
}

func TestBlackList_IsBanned(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Create a new database
	var err error
	sysDb, err = database.NewDatabase(dbFilePath+dbFileName, false)
	if err != nil {
		t.Fatalf("Failed to create a new database: %v", err)
	}

	bl := NewBlacklistManager(sysDb)
	bl.SetBlacklistEnabled(true)

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
	//t.Log(err)
	if !bl.IsBanned("192.168.2.5") {
		//t.Log(bl.ListBannedIpRanges())
		t.Error("Expected IP range to be banned")
	}

	// Test case 4: IP range is not banned
	if bl.IsBanned("10.0.0.1") {
		t.Error("Expected IP range to not be banned")
	}
}

func TestBlackList_ListBannedIpRanges(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Create a new database
	var err error
	sysDb, err = database.NewDatabase(dbFilePath+dbFileName, false)
	if err != nil {
		t.Fatalf("Failed to create a new database: %v", err)
	}

	bl := NewBlacklistManager(sysDb)
	bl.SetBlacklistEnabled(true)

	// Test case 1: No banned IP ranges
	if len(bl.ListBannedIpRanges()) != 0 {
		t.Error("Expected no banned IP ranges")
	}

	// Test case 2: Banned IP ranges exist
	bl.Ban("192.168.1.1")
	bl.Ban("192.168.2.1-192.168.2.254")

	bannedRanges := bl.ListBannedIpRanges()
	if len(bannedRanges) != 2 {
		t.Error("Expected 2 banned IP ranges")
	}
}

func TestBlackList_Ban_UnBan(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Create a new database
	var err error
	sysDb, err = database.NewDatabase(dbFilePath+dbFileName, false)
	if err != nil {
		t.Fatalf("Failed to create a new database: %v", err)
	}

	bl := NewBlacklistManager(sysDb)
	bl.SetBlacklistEnabled(true)

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
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Create a new database
	var err error
	sysDb, err = database.NewDatabase(dbFilePath+dbFileName, false)
	if err != nil {
		t.Fatalf("Failed to create a new database: %v", err)
	}

	bl := NewBlacklistManager(sysDb)
	bl.SetBlacklistEnabled(true)

	// Test case 1: Ban with invalid IP range
	err = bl.Ban("invalid-ip-range")
	if err == nil {
		t.Error("Expected error for invalid IP range")
	}

	// Test case 2: Unban with invalid IP range
	err = bl.UnBan("invalid-ip-range")
	if err == nil {
		t.Error("Expected error for invalid IP range")
	}
}
