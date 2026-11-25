package wifi

/*
	WiFi Manager
	author: tobychui

	This is the wifi management interface for the arozos system
*/

import (
	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
)

type WiFiManager struct {
	database            *db.Database
	sudo_mode           bool
	wpa_supplicant_path string
	wan_interface_name  string
}

// Create a new WiFi manager
func NewWiFiManager(database *db.Database, useSudo bool, wpapath string, wlanname string) *WiFiManager {
	if logger.IsDebug() {
		logger.Debugf("network/wifi", "NewWiFiManager: useSudo=%t wpapath=%.120q wlanname=%.120q", useSudo, wpapath, wlanname)
	}
	//Create a database table for wifi
	database.NewTable("wifi")
	return &WiFiManager{
		database:            database,
		sudo_mode:           useSudo,
		wpa_supplicant_path: wpapath,
		wan_interface_name:  wlanname,
	}
}
