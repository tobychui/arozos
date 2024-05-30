package whitelist

import (
	"os"
	"testing"

	"imuslab.com/arozos/mod/database"
)

var dbFilePath = "../../../../test/"
var dbFileName = "testdb.db"
var sysdb *database.Database

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
		sysdb.Close()
		//pp, _ := os.Getwd()
		//t.Log(pp)
		//t.Log(filepath.Dir(pp + "/" + dbFilePath + dbFileName))

		err := os.RemoveAll(dbFilePath)
		if err != nil {
			t.Fatalf("Failed to clean up: %v", err)
		}
	}
}

func TestWhiteList_SetWhitelistEnabled(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Create a new database
	var err error
	sysdb, err = database.NewDatabase(dbFilePath+dbFileName, false)
	if err != nil {
		t.Fatalf("Failed to create a new database: %v", err)
	}

	wl := NewWhitelistManager(sysdb)

	// Test case 1: Enable whitelist
	wl.SetWhitelistEnabled(true)
	if !wl.Enabled {
		t.Error("Expected whitelist to be enabled")
	}

	// Test case 2: Disable whitelist
	wl.SetWhitelistEnabled(false)
	if wl.Enabled {
		t.Error("Expected whitelist to be disabled")
	}
}

func TestWhiteList_IsWhitelisted(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Create a new database
	var err error
	sysdb, err = database.NewDatabase(dbFilePath+dbFileName, false)
	if err != nil {
		t.Fatalf("Failed to create a new database: %v", err)
	}
	wl := NewWhitelistManager(sysdb)

	// Test case 1: IP is whitelisted when whitelist is disabled
	if !wl.IsWhitelisted("192.168.1.1") {
		t.Error("Expected IP to be whitelisted when whitelist is disabled")
	}

	// Test case 2: Enable whitelist and whitelist specific IP
	wl.SetWhitelistEnabled(true)
	_ = wl.SetWhitelist("192.168.1.1")

	if !wl.IsWhitelisted("192.168.1.1") || wl.IsWhitelisted("192.168.2.1") {
		t.Error("Unexpected whitelisting behavior")
	}

	// Test case 3: Check if reserved IP addresses are always whitelisted
	if !wl.IsWhitelisted("127.0.0.1") || !wl.IsWhitelisted("localhost") {
		t.Error("Expected reserved IP addresses to be whitelisted")
	}
}

func TestWhiteList_ListWhitelistedIpRanges(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Create a new database
	var err error
	sysdb, err = database.NewDatabase(dbFilePath+dbFileName, false)
	if err != nil {
		t.Fatalf("Failed to create a new database: %v", err)
	}

	wl := NewWhitelistManager(sysdb)
	wl.SetWhitelistEnabled(true)

	// Test case 1: No whitelisted IP ranges
	if len(wl.ListWhitelistedIpRanges()) != 1 {
		//t.Log(wl.ListWhitelistedIpRanges())
		t.Error("Expected no whitelisted IP ranges")
	}

	// Test case 2: Whitelisted IP ranges exist
	_ = wl.SetWhitelist("192.168.1.1")
	_ = wl.SetWhitelist("192.168.2.1-192.168.2.254")

	whitelistedRanges := wl.ListWhitelistedIpRanges()
	if len(whitelistedRanges) != 3 {
		t.Error("Expected 3 whitelisted IP ranges")
	}
}

func TestWhiteList_SetWhitelist_UnsetWhitelist(t *testing.T) {
	teardownSuite := setupSuite(t)
	defer teardownSuite(t)

	// Create a new database
	var err error
	sysdb, err = database.NewDatabase(dbFilePath+dbFileName, false)
	if err != nil {
		t.Fatalf("Failed to create a new database: %v", err)
	}

	wl := NewWhitelistManager(sysdb)
	wl.SetWhitelistEnabled(true)

	// Test case 1: Set whitelist for a specific IP
	err = wl.SetWhitelist("192.168.1.1")
	if err != nil || !wl.IsWhitelisted("192.168.1.1") {
		t.Error("Unexpected error or IP not whitelisted")
	}

	// Test case 2: Set whitelist for an IP range
	err = wl.SetWhitelist("192.168.2.1-192.168.2.254")
	if err != nil || !wl.IsWhitelisted("192.168.2.5") {
		t.Error("Unexpected error or IP range not whitelisted")
	}

	// Test case 3: Unset whitelist for a specific IP
	err = wl.UnsetWhitelist("192.168.1.1")
	if err != nil || wl.IsWhitelisted("192.168.1.1") {
		t.Error("Unexpected error or IP still whitelisted")
	}

	// Test case 4: Unset whitelist for an IP range
	err = wl.UnsetWhitelist("192.168.2.1-192.168.2.254")
	if err != nil || wl.IsWhitelisted("192.168.2.5") {
		t.Error("Unexpected error or IP range still whitelisted")
	}

	// Test case 5: Unset whitelist for an invalid IP range
	err = wl.UnsetWhitelist("invalid-ip-range")
	if err == nil {
		t.Error("Expected error for invalid IP range")
	}
}
