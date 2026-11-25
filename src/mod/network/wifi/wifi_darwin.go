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
	if logger.IsDebugTrace() {
		logger.DebugTracef("network/wifi", "WiFiManager.SetInterfacePower: wlanInterface=%.120q on=%t", wlanInterface, on)
	}
	return errors.New("Platform not supported")
}

func (w *WiFiManager) GetInterfacePowerStatuts(wlanInterface string) (bool, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("network/wifi", "WiFiManager.GetInterfacePowerStatuts: wlanInterface=%.120q", wlanInterface)
	}
	return false, errors.New("Platform not supported")
}

func (w *WiFiManager) ScanNearbyWiFi(interfaceName string) ([]WiFiInfo, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("network/wifi", "WiFiManager.ScanNearbyWiFi: interfaceName=%.120q", interfaceName)
	}
	return []WiFiInfo{}, errors.New("Platform not supported")
}

func (w *WiFiManager) GetWirelessInterfaces() ([]string, error) {
	logger.DebugTrace("network/wifi", "WiFiManager.GetWirelessInterfaces")
	return []string{}, nil
}

func (w *WiFiManager) ConnectWiFi(ssid string, password string, connType string, identity string) (*WiFiConnectionResult, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("network/wifi", "WiFiManager.ConnectWiFi: ssid=%.120q identity=%.120q", ssid, identity)
	}
	return &WiFiConnectionResult{}, errors.New("Platform not supported")
}

func (w *WiFiManager) GetConnectedWiFi() (string, string, error) {
	logger.DebugTrace("network/wifi", "WiFiManager.GetConnectedWiFi")
	return "", "", errors.New("Platform not supported")
}

func (w *WiFiManager) RemoveWifi(ssid string) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("network/wifi", "WiFiManager.RemoveWifi: ssid=%.120q", ssid)
	}
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
