//go:build darwin
// +build darwin

package wifi

/*
	This interface is left to be developed in the future when I have a macbook :P

*/
import "errors"

// Toggle WiFi On Off. Only allow on sudo mode
func (w *WiFiManager) SetInterfacePower(wlanInterface string, on bool) error {
	return errors.New("Platform not supported")
}

func (w *WiFiManager) GetInterfacePowerStatuts(wlanInterface string) (bool, error) {
	return false, errors.New("Platform not supported")
}

func (w *WiFiManager) ScanNearbyWiFi(interfaceName string) ([]WiFiInfo, error) {
	return []WiFiInfo{}, errors.New("Platform not supported")
}

func (w *WiFiManager) GetWirelessInterfaces() ([]string, error) {
	return []string{}, nil
}

func (w *WiFiManager) ConnectWiFi(ssid string, password string, connType string, identity string) (*WiFiConnectionResult, error) {
	return &WiFiConnectionResult{}, errors.New("Platform not supported")
}

func (w *WiFiManager) GetConnectedWiFi() (string, string, error) {
	return "", "", errors.New("Platform not supported")
}

func (w *WiFiManager) RemoveWifi(ssid string) error {
	return errors.New("Platform not supported")
}

// CanControlInterfacePower reports whether SetInterfacePower is supported
func (w *WiFiManager) CanControlInterfacePower() bool {
	return false
}

// CanConnect reports whether ConnectWiFi and RemoveWifi are supported
func (w *WiFiManager) CanConnect() bool {
	return false
}

// GetInterfaceStatus returns the live state of every wireless interface
func (w *WiFiManager) GetInterfaceStatus() ([]WiFiInterfaceStatus, error) {
	return []WiFiInterfaceStatus{}, nil
}
