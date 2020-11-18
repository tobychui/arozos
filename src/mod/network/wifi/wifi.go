package wifi

/*
	WiFi Manager
	author: tobychui

	This is the wifi management interface for the arozos system
*/

import (
	db "imuslab.com/arozos/mod/database"
)

type WiFiManager struct {
	database            *db.Database
	sudo_mode           bool
	wpa_supplicant_path string
	wan_interface_name  string
}

//Create a new WiFi manager
func NewWiFiManager(database *db.Database, useSudo bool, wpapath string, wlanname string) *WiFiManager {
	//Create a database table for wifi
	database.NewTable("wifi")
	return &WiFiManager{
		database:            database,
		sudo_mode:           useSudo,
		wpa_supplicant_path: wpapath,
		wan_interface_name:  wlanname,
	}
}
