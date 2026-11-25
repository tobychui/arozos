//go:build windows
// +build windows

package wifi

/*
	WiFi connection module for Windows
	author: tobychui

	Reads interface state and scan results through the native WLAN API
	(wlanapi_windows.go). Earlier versions parsed the output of
	"chcp 65001 && netsh wlan ...", which depended on the OS language and
	switched the code page of the console ArozOS was running in.
*/

import (
	"bytes"
	"errors"
	"sort"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

// Toggle WiFi On Off. Only allow on sudo mode
func (w *WiFiManager) SetInterfacePower(wlanInterface string, on bool) error {
	logger.DebugTrace("network/wifi", "WiFiManager.SetInterfacePower")
	return errors.New("Windows WiFi function is currently readonly")
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

func (w *WiFiManager) GetInterfacePowerStatuts(wlanInterface string) (out0 bool, out1 error) {
	defer logger.Out2(logger.In2("network/wifi", "WiFiManager.GetInterfacePowerStatuts", "w", w, "wlanInterface", wlanInterface), &out0, &out1)
	client, err := openWlanClient()
	if err != nil {
		logger.DebugErr("network/wifi", err)
		return false, err
	}
	defer client.Close()

	iface, _, err := findWlanInterface(client, wlanInterface, false)
	if err != nil {
		logger.DebugErr("network/wifi", err)
		return false, err
	}
	guid := guidFromBytes(iface.GUID)
	states, err := client.radioState(&guid)
	if err != nil {
		logger.DebugErr("network/wifi", err)
		return false, err
	}
	software, hardware := radioSummary(states)
	return software == "on" && hardware != "off", nil
}

// radioSummary folds the per-PHY radio states into one software and one
// hardware state: "on" when any PHY is on
func radioSummary(states []wlanPhyRadioState) (out0 string, out1 string) {
	defer logger.Out2(logger.In1("network/wifi", "radioSummary", "states", states), &out0, &out1)
	software, hardware := "unknown", "unknown"
	for _, s := range states {
		if sw := dot11RadioStateName(s.Software); sw == "on" || software == "unknown" {
			software = sw
		}
		if hw := dot11RadioStateName(s.Hardware); hw == "on" || hardware == "unknown" {
			hardware = hw
		}
	}
	return software, hardware
}

// findWlanInterface picks the interface whose friendly name, description or
// GUID matches name. When nothing matches (or name is empty) the first
// interface is returned if fallback is set.
func findWlanInterface(client *wlanClient, name string, fallback bool) (out0 wlanInterfaceInfo, out1 adapterInfo, out2 error) {
	defer logger.Out3(logger.In3("network/wifi", "findWlanInterface", "client", client, "name", name, "fallback", fallback), &out0, &out1, &out2)
	ifaces, err := client.interfaces()
	if err != nil {
		logger.DebugErr("network/wifi", err)
		return wlanInterfaceInfo{}, adapterInfo{}, err
	}
	if len(ifaces) == 0 {
		return wlanInterfaceInfo{}, adapterInfo{}, errors.New("Wireless Interface Not Found")
	}
	adapters := adaptersByGUID()
	name = strings.TrimSpace(name)
	for _, iface := range ifaces {
		guid := guidString(iface.GUID)
		adapter := adapters[guid]
		if name != "" && (strings.EqualFold(adapter.FriendlyName, name) || strings.EqualFold(iface.Description, name) || strings.EqualFold(guid, name)) {
			return iface, adapter, nil
		}
	}
	if !fallback {
		return wlanInterfaceInfo{}, adapterInfo{}, errors.New("wlan Interface not exists")
	}
	return ifaces[0], adapters[guidString(ifaces[0].GUID)], nil
}

// interfaceDisplayName is the name the rest of ArozOS uses for an interface
func interfaceDisplayName(iface wlanInterfaceInfo, adapter adapterInfo) (out0 string) {
	defer logger.Out1(logger.In2("network/wifi", "interfaceDisplayName", "&iface", &iface, "&adapter", &adapter), &out0)
	if adapter.FriendlyName != "" {
		return adapter.FriendlyName
	}
	return iface.Description
}

func (w *WiFiManager) ScanNearbyWiFi(interfaceName string) (out0 []WiFiInfo, out1 error) {
	defer logger.Out2(logger.In2("network/wifi", "WiFiManager.ScanNearbyWiFi", "w", w, "interfaceName", interfaceName), &out0, &out1)
	client, err := openWlanClient()
	if err != nil {
		logger.DebugErr("network/wifi", err)
		return []WiFiInfo{}, err
	}
	defer client.Close()

	iface, adapter, err := findWlanInterface(client, interfaceName, true)
	if err != nil {
		logger.DebugErr("network/wifi", err)
		return []WiFiInfo{}, err
	}
	guid := guidFromBytes(iface.GUID)
	displayName := interfaceDisplayName(iface, adapter)

	//Ask the driver for fresh results. A failed scan (for example while the
	//radio is off) still leaves the cached list to read.
	scanErr := client.scan(guid)

	entries, err := client.bssList(&guid)
	if err != nil {
		logger.DebugErr("network/wifi", err)
		if scanErr != nil {
			logger.DebugErr("network/wifi", scanErr)
			return []WiFiInfo{}, scanErr
		}
		return []WiFiInfo{}, err
	}

	//Saved profiles and the fallback security per SSID
	networks, _ := client.availableNetworks(&guid)
	networkBySSID := map[string]wlanAvailableNetwork{}
	for _, n := range networks {
		key := string(n.SSID)
		if old, ok := networkBySSID[key]; !ok || n.Flags&wlanAvailableNetworkHasProfile != 0 && old.Flags&wlanAvailableNetworkHasProfile == 0 {
			networkBySSID[key] = n
		}
	}

	var connectedBSSID []byte
	if iface.State == 1 {
		if conn, err := client.connection(&guid); err == nil {
			connectedBSSID = conn.BSSID[:]
		}
	}

	results := []WiFiInfo{}
	for _, entry := range entries {
		info := bssInfoFromEntry(entry)
		info.Interface = displayName
		if n, ok := networkBySSID[string(entry.SSID)]; ok {
			info.ConnectedBefore = n.Flags&wlanAvailableNetworkHasProfile != 0
			if info.Security == "Open" && n.SecurityEnabled {
				info.Security = dot11AuthName(n.AuthAlgorithm)
				info.Cipher = dot11CipherName(n.CipherAlgorithm)
				info.EncryptionKey = true
			}
		}
		info.Connected = connectedBSSID != nil && bytes.Equal(connectedBSSID, entry.BSSID[:])
		results = append(results, info)
	}

	sort.SliceStable(results, func(i, j int) bool {
		return results[i].SignalDBm > results[j].SignalDBm
	})
	return results, nil
}

func (w *WiFiManager) GetWirelessInterfaces() (out0 []string, out1 error) {
	defer logger.Out2(logger.In1("network/wifi", "WiFiManager.GetWirelessInterfaces", "w", w), &out0, &out1)
	client, err := openWlanClient()
	if err != nil {
		logger.DebugErr("network/wifi", err)
		return []string{}, err
	}
	defer client.Close()

	ifaces, err := client.interfaces()
	if err != nil {
		logger.DebugErr("network/wifi", err)
		return []string{}, err
	}
	adapters := adaptersByGUID()
	names := []string{}
	for _, iface := range ifaces {
		names = append(names, interfaceDisplayName(iface, adapters[guidString(iface.GUID)]))
	}
	return names, nil
}

// GetInterfaceStatus returns the live state of every wireless interface
func (w *WiFiManager) GetInterfaceStatus() (out0 []WiFiInterfaceStatus, out1 error) {
	defer logger.Out2(logger.In1("network/wifi", "WiFiManager.GetInterfaceStatus", "w", w), &out0, &out1)
	client, err := openWlanClient()
	if err != nil {
		logger.DebugErr("network/wifi", err)
		return []WiFiInterfaceStatus{}, err
	}
	defer client.Close()

	ifaces, err := client.interfaces()
	if err != nil {
		logger.DebugErr("network/wifi", err)
		return []WiFiInterfaceStatus{}, err
	}
	adapters := adaptersByGUID()
	results := []WiFiInterfaceStatus{}
	for _, iface := range ifaces {
		results = append(results, interfaceStatus(client, iface, adapters[guidString(iface.GUID)]))
	}
	return results, nil
}

func interfaceStatus(client *wlanClient, iface wlanInterfaceInfo, adapter adapterInfo) (out0 WiFiInterfaceStatus) {
	defer logger.Out1(logger.In3("network/wifi", "interfaceStatus", "client", client, "&iface", &iface, "&adapter", &adapter), &out0)
	guid := guidFromBytes(iface.GUID)
	status := WiFiInterfaceStatus{
		Name:          interfaceDisplayName(iface, adapter),
		Description:   iface.Description,
		GUID:          guidString(iface.GUID),
		MAC:           adapter.MAC,
		State:         wlanInterfaceStateName(iface.State),
		Connected:     iface.State == 1,
		SoftwareRadio: "unknown",
		HardwareRadio: "unknown",
		SignalQuality: -1,
		IPv4:          nonNil(adapter.IPv4),
		IPv6:          nonNil(adapter.IPv6),
		Gateways:      nonNil(adapter.Gateways),
		DNS:           nonNil(adapter.DNS),
		MTU:           adapter.MTU,
	}
	if states, err := client.radioState(&guid); err == nil {
		status.SoftwareRadio, status.HardwareRadio = radioSummary(states)
	}
	if !status.Connected {
		return status
	}

	conn, err := client.connection(&guid)
	if err != nil {
		logger.DebugErr("network/wifi", err)
		return status
	}
	status.SSID, _ = ssidString(conn.SSID)
	status.BSSID = formatMAC(conn.BSSID[:])
	status.ProfileName = conn.ProfileName
	status.ConnectionMode = wlanConnectionModeName(conn.Mode)
	status.BSSType = dot11BSSTypeName(conn.BSSType)
	status.PHYType = dot11PhyName(conn.PhyType)
	status.SignalQuality = int(conn.SignalQuality)
	status.RxRateMbps = float64(conn.RxRateKbps) / 1000
	status.TxRateMbps = float64(conn.TxRateKbps) / 1000
	status.Security = dot11AuthName(conn.AuthAlgorithm)
	if !conn.SecurityEnabled {
		status.Security = "Open"
	}
	status.Cipher = dot11CipherName(conn.CipherAlgorithm)
	status.OneX = conn.OneXEnabled

	if ch, err := client.uint32Value(&guid, wlanIntfOpcodeChannelNumber); err == nil {
		status.Channel = int(ch)
	}
	if rssi, err := client.uint32Value(&guid, wlanIntfOpcodeRSSI); err == nil && int32(rssi) < 0 {
		status.RSSI = int(int32(rssi))
	} else {
		status.RSSI = rssiFromQuality(status.SignalQuality)
	}

	//The cached scan results describe the connected AP in detail. Reading
	//them does not start a new scan.
	if entries, err := client.bssList(&guid); err == nil {
		for _, entry := range entries {
			if !bytes.Equal(entry.BSSID[:], conn.BSSID[:]) {
				continue
			}
			ap := bssInfoFromEntry(entry)
			ap.Interface = status.Name
			ap.Connected = true
			ap.ConnectedBefore = true
			status.AP = &ap
			status.FrequencyMHz = ap.FrequencyMHz
			status.Band = ap.Band
			status.ChannelWidth = ap.ChannelWidth
			if ap.Channel > 0 {
				status.Channel = ap.Channel
			}
			if ap.PHYType != "" && status.PHYType == "" {
				status.PHYType = ap.PHYType
			}
			break
		}
	}
	if status.FrequencyMHz == 0 {
		status.FrequencyMHz = frequencyOfChannel(status.Channel, false)
		status.Band = bandOfFrequency(status.FrequencyMHz)
	}
	status.Generation = generationOfPHY(status.PHYType, status.Band)
	return status
}

func (w *WiFiManager) ConnectWiFi(ssid string, password string, connType string, identity string) (*WiFiConnectionResult, error) {
	logger.DebugTrace("network/wifi", "WiFiManager.ConnectWiFi")
	return &WiFiConnectionResult{}, errors.New("Windows WiFi function is currently readonly")
}

// Get connected wifi ssid, interface name and error if any
func (w *WiFiManager) GetConnectedWiFi() (out0 string, out1 string, out2 error) {
	defer logger.Out3(logger.In1("network/wifi", "WiFiManager.GetConnectedWiFi", "w", w), &out0, &out1, &out2)
	statuses, err := w.GetInterfaceStatus()
	if err != nil {
		logger.DebugErr("network/wifi", err)
		if err == errWlanUnavailable {
			return "", "", nil
		}
		return "", "", err
	}
	if len(statuses) == 0 {
		return "", "", nil
	}
	for _, s := range statuses {
		if s.Connected {
			return s.SSID, s.Name, nil
		}
	}
	return "", statuses[0].Name, nil
}

func (w *WiFiManager) RemoveWifi(ssid string) error {
	logger.DebugTrace("network/wifi", "WiFiManager.RemoveWifi")
	return errors.New("Windows WiFi function is currently readonly")
}

func nonNil(list []string) (out0 []string) {
	defer logger.Out1(logger.In1("network/wifi", "nonNil", "list", list), &out0)
	if list == nil {
		return []string{}
	}
	return list
}
