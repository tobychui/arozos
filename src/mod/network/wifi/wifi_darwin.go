//go:build darwin
// +build darwin

package wifi

/*
	This interface is left to be developed in the future when I have a macbook :P

*/
import "imuslab.com/arozos/mod/info/logger"
import "errors"

// Toggle WiFi On Off. Only allow on sudo mode
func (w *WiFiManager) SetInterfacePower(wlanInterface string, on bool) error {
	logger.DebugTrace("network/wifi", "WiFiManager.SetInterfacePower")
	return errors.New("Platform not supported")
}

func (w *WiFiManager) GetInterfacePowerStatuts(wlanInterface string) (bool, error) {
	logger.DebugTrace("network/wifi", "WiFiManager.GetInterfacePowerStatuts")
	return false, errors.New("Platform not supported")
}

func (w *WiFiManager) ScanNearbyWiFi(interfaceName string) ([]WiFiInfo, error) {
	logger.DebugTrace("network/wifi", "WiFiManager.ScanNearbyWiFi")
	return []WiFiInfo{}, errors.New("Platform not supported")
}

func (w *WiFiManager) GetWirelessInterfaces() ([]string, error) {
	logger.DebugTrace("network/wifi", "WiFiManager.GetWirelessInterfaces")
	return []string{}, nil
}

func (w *WiFiManager) ConnectWiFi(ssid string, password string, connType string, identity string) (*WiFiConnectionResult, error) {
	logger.DebugTrace("network/wifi", "WiFiManager.ConnectWiFi")
	return &WiFiConnectionResult{}, errors.New("Platform not supported")
}

func (w *WiFiManager) GetConnectedWiFi() (string, string, error) {
	logger.DebugTrace("network/wifi", "WiFiManager.GetConnectedWiFi")
	return "", "", errors.New("Platform not supported")
}

func (w *WiFiManager) RemoveWifi(ssid string) error {
	logger.DebugTrace("network/wifi", "WiFiManager.RemoveWifi")
	return errors.New("Platform not supported")
}

// CanControlInterfacePower reports whether SetInterfacePower is supported
func (w *WiFiManager) CanControlInterfacePower() bool {
	logger.DebugTrace("network/wifi", "WiFiManager.CanControlInterfacePower")
	return false
}

// CanConnect reports whether ConnectWiFi and RemoveWifi are supported
func (w *WiFiManager) CanConnect() bool {
	logger.DebugTrace("network/wifi", "WiFiManager.CanConnect")
	return false
}

// GetInterfaceStatus returns the live state of every wireless interface
func (w *WiFiManager) GetInterfaceStatus() ([]WiFiInterfaceStatus, error) {
	logger.DebugTrace("network/wifi", "WiFiManager.GetInterfaceStatus")
	return []WiFiInterfaceStatus{}, nil
}
