package wifi

import (
	"testing"

	"imuslab.com/arozos/mod/database"
)

func TestNewWiFiManager(t *testing.T) {
	// Test case 1: Create new WiFi manager
	db, _ := database.NewDatabase("./test_wifi.db", false)
	defer db.Close()

	manager := NewWiFiManager(db, false, "/etc/wpa_supplicant/wpa_supplicant.conf", "wlan0")
	if manager == nil {
		t.Error("Test case 1 failed. WiFi manager should not be nil")
	}
}
