package wifi

/*
	Native WLAN API structures

	The Windows WLAN API (wlanapi.dll) returns its results as C structures.
	They are copied into Go byte slices by wlanapi_windows.go and decoded here
	at fixed offsets, so the layout does not depend on Go's struct alignment
	(which differs from the C layout on 32-bit targets) and the decoding can
	be tested on every platform.
*/

import (
	"encoding/binary"
	"errors"
	"strconv"
	"strings"
	"unicode/utf16"
)

// Sizes of the fixed-size WLAN API structures, in bytes
const (
	wlanInterfaceInfoSize    = 532 //WLAN_INTERFACE_INFO
	wlanAvailableNetworkSize = 628 //WLAN_AVAILABLE_NETWORK
	wlanBSSEntrySize         = 360 //WLAN_BSS_ENTRY
	wlanConnectionAttrSize   = 604 //WLAN_CONNECTION_ATTRIBUTES
	dot11SSIDSize            = 36  //DOT11_SSID
)

// WLAN_AVAILABLE_NETWORK flags
const (
	wlanAvailableNetworkConnected  = 0x1
	wlanAvailableNetworkHasProfile = 0x2
)

var errWlanTruncated = errors.New("truncated WLAN API structure")

type wlanInterfaceInfo struct {
	GUID        [16]byte
	Description string
	State       uint32
}

type wlanAvailableNetwork struct {
	ProfileName     string
	SSID            []byte
	BSSType         uint32
	SignalQuality   uint32
	SecurityEnabled bool
	AuthAlgorithm   uint32
	CipherAlgorithm uint32
	Flags           uint32
}

type wlanBSSEntry struct {
	SSID           []byte
	PhyID          uint32
	BSSID          [6]byte
	BSSType        uint32
	PhyType        uint32
	RSSI           int32
	LinkQuality    uint32
	InRegDomain    bool
	BeaconPeriod   uint16
	Timestamp      uint64
	HostTimestamp  uint64
	Capability     uint16
	CenterFreqKHz  uint32
	Rates          []uint16
	InformationElt []byte
}

type wlanConnectionAttributes struct {
	State           uint32
	Mode            uint32
	ProfileName     string
	SSID            []byte
	BSSType         uint32
	BSSID           [6]byte
	PhyType         uint32
	PhyIndex        uint32
	SignalQuality   uint32
	RxRateKbps      uint32
	TxRateKbps      uint32
	SecurityEnabled bool
	OneXEnabled     bool
	AuthAlgorithm   uint32
	CipherAlgorithm uint32
}

type wlanPhyRadioState struct {
	PhyIndex uint32
	Software uint32
	Hardware uint32
}

// utf16String decodes a fixed size, NUL terminated WCHAR array
func utf16String(b []byte) string {
	u := make([]uint16, 0, len(b)/2)
	for i := 0; i+1 < len(b); i += 2 {
		c := binary.LittleEndian.Uint16(b[i:])
		if c == 0 {
			break
		}
		u = append(u, c)
	}
	return string(utf16.Decode(u))
}

// dot11SSID decodes a DOT11_SSID (length + 32 bytes)
func dot11SSID(b []byte) []byte {
	if len(b) < dot11SSIDSize {
		return nil
	}
	n := binary.LittleEndian.Uint32(b[0:4])
	if n > 32 {
		n = 32
	}
	return append([]byte{}, b[4:4+n]...)
}

// guidString formats a Windows GUID stored in its in-memory byte order
func guidString(g [16]byte) string {
	le := binary.LittleEndian
	return strings.ToUpper(
		"{" + hex32(le.Uint32(g[0:4])) + "-" + hex16(le.Uint16(g[4:6])) + "-" + hex16(le.Uint16(g[6:8])) + "-" +
			hexBytes(g[8:10]) + "-" + hexBytes(g[10:16]) + "}")
}

func hex32(v uint32) string {
	return hexBytes([]byte{byte(v >> 24), byte(v >> 16), byte(v >> 8), byte(v)})
}
func hex16(v uint16) string { return hexBytes([]byte{byte(v >> 8), byte(v)}) }
func hexBytes(b []byte) string {
	const digits = "0123456789abcdef"
	s := make([]byte, 0, len(b)*2)
	for _, c := range b {
		s = append(s, digits[c>>4], digits[c&0x0F])
	}
	return string(s)
}

// parseWlanInterfaceList decodes a WLAN_INTERFACE_INFO_LIST
func parseWlanInterfaceList(b []byte) ([]wlanInterfaceInfo, error) {
	if len(b) < 8 {
		return nil, errWlanTruncated
	}
	n := int(binary.LittleEndian.Uint32(b[0:4]))
	if n < 0 || n > (len(b)-8)/wlanInterfaceInfoSize {
		return nil, errWlanTruncated
	}
	list := []wlanInterfaceInfo{}
	for i := 0; i < n; i++ {
		e := b[8+i*wlanInterfaceInfoSize : 8+(i+1)*wlanInterfaceInfoSize]
		info := wlanInterfaceInfo{
			Description: utf16String(e[16:528]),
			State:       binary.LittleEndian.Uint32(e[528:532]),
		}
		copy(info.GUID[:], e[0:16])
		list = append(list, info)
	}
	return list, nil
}

// parseWlanAvailableNetworkList decodes a WLAN_AVAILABLE_NETWORK_LIST
func parseWlanAvailableNetworkList(b []byte) ([]wlanAvailableNetwork, error) {
	if len(b) < 8 {
		return nil, errWlanTruncated
	}
	n := int(binary.LittleEndian.Uint32(b[0:4]))
	if n < 0 || n > (len(b)-8)/wlanAvailableNetworkSize {
		return nil, errWlanTruncated
	}
	le := binary.LittleEndian
	list := []wlanAvailableNetwork{}
	for i := 0; i < n; i++ {
		e := b[8+i*wlanAvailableNetworkSize : 8+(i+1)*wlanAvailableNetworkSize]
		list = append(list, wlanAvailableNetwork{
			ProfileName:     utf16String(e[0:512]),
			SSID:            dot11SSID(e[512:548]),
			BSSType:         le.Uint32(e[548:552]),
			SignalQuality:   le.Uint32(e[604:608]),
			SecurityEnabled: le.Uint32(e[608:612]) != 0,
			AuthAlgorithm:   le.Uint32(e[612:616]),
			CipherAlgorithm: le.Uint32(e[616:620]),
			Flags:           le.Uint32(e[620:624]),
		})
	}
	return list, nil
}

// parseWlanBSSList decodes a WLAN_BSS_LIST, including the information
// elements that follow each entry
func parseWlanBSSList(b []byte) ([]wlanBSSEntry, error) {
	if len(b) < 8 {
		return nil, errWlanTruncated
	}
	le := binary.LittleEndian
	total := int(le.Uint32(b[0:4]))
	if total < 8 || total > len(b) {
		total = len(b)
	}
	b = b[:total]
	n := int(le.Uint32(b[4:8]))
	if n < 0 || n > (len(b)-8)/wlanBSSEntrySize {
		return nil, errWlanTruncated
	}
	list := []wlanBSSEntry{}
	for i := 0; i < n; i++ {
		start := 8 + i*wlanBSSEntrySize
		e := b[start : start+wlanBSSEntrySize]
		entry := wlanBSSEntry{
			SSID:          dot11SSID(e[0:36]),
			PhyID:         le.Uint32(e[36:40]),
			BSSType:       le.Uint32(e[48:52]),
			PhyType:       le.Uint32(e[52:56]),
			RSSI:          int32(le.Uint32(e[56:60])),
			LinkQuality:   le.Uint32(e[60:64]),
			InRegDomain:   e[64] != 0,
			BeaconPeriod:  le.Uint16(e[66:68]),
			Timestamp:     le.Uint64(e[72:80]),
			HostTimestamp: le.Uint64(e[80:88]),
			Capability:    le.Uint16(e[88:90]),
			CenterFreqKHz: le.Uint32(e[92:96]),
		}
		copy(entry.BSSID[:], e[40:46])

		//WLAN_RATE_SET: rate count (documented as a byte length, but
		//wlansvc reports the number of rates), then up to 126 USHORT rates
		rateCount := int(le.Uint32(e[96:100]))
		if rateCount > 126 {
			rateCount = 126
		}
		for r := 0; r < rateCount; r++ {
			entry.Rates = append(entry.Rates, le.Uint16(e[100+r*2:]))
		}

		//Information elements, offset relative to the start of this entry
		ieOffset := int64(le.Uint32(e[352:356]))
		ieSize := int64(le.Uint32(e[356:360]))
		ieStart := int64(start) + ieOffset
		if ieSize > 0 && ieOffset >= wlanBSSEntrySize && ieStart+ieSize <= int64(len(b)) {
			entry.InformationElt = append([]byte{}, b[ieStart:ieStart+ieSize]...)
		}
		list = append(list, entry)
	}
	return list, nil
}

// parseWlanConnectionAttributes decodes WLAN_CONNECTION_ATTRIBUTES
func parseWlanConnectionAttributes(b []byte) (*wlanConnectionAttributes, error) {
	if len(b) < wlanConnectionAttrSize {
		return nil, errWlanTruncated
	}
	le := binary.LittleEndian
	c := &wlanConnectionAttributes{
		State:       le.Uint32(b[0:4]),
		Mode:        le.Uint32(b[4:8]),
		ProfileName: utf16String(b[8:520]),
		//WLAN_ASSOCIATION_ATTRIBUTES at 520
		SSID:          dot11SSID(b[520:556]),
		BSSType:       le.Uint32(b[556:560]),
		PhyType:       le.Uint32(b[568:572]),
		PhyIndex:      le.Uint32(b[572:576]),
		SignalQuality: le.Uint32(b[576:580]),
		RxRateKbps:    le.Uint32(b[580:584]),
		TxRateKbps:    le.Uint32(b[584:588]),
		//WLAN_SECURITY_ATTRIBUTES at 588
		SecurityEnabled: le.Uint32(b[588:592]) != 0,
		OneXEnabled:     le.Uint32(b[592:596]) != 0,
		AuthAlgorithm:   le.Uint32(b[596:600]),
		CipherAlgorithm: le.Uint32(b[600:604]),
	}
	copy(c.BSSID[:], b[560:566])
	return c, nil
}

// parseWlanRadioState decodes WLAN_RADIO_STATE
func parseWlanRadioState(b []byte) ([]wlanPhyRadioState, error) {
	if len(b) < 4 {
		return nil, errWlanTruncated
	}
	le := binary.LittleEndian
	n := int(le.Uint32(b[0:4]))
	if n > 64 {
		n = 64
	}
	if n < 0 || n > (len(b)-4)/12 {
		return nil, errWlanTruncated
	}
	list := []wlanPhyRadioState{}
	for i := 0; i < n; i++ {
		e := b[4+i*12 : 4+(i+1)*12]
		list = append(list, wlanPhyRadioState{
			PhyIndex: le.Uint32(e[0:4]),
			Software: le.Uint32(e[4:8]),
			Hardware: le.Uint32(e[8:12]),
		})
	}
	return list, nil
}

// bssInfoFromEntry turns one WLAN_BSS_ENTRY into a WiFiInfo
func bssInfoFromEntry(e wlanBSSEntry) WiFiInfo {
	ies := parseIEs(e.InformationElt)
	privacy := e.Capability&0x0010 != 0

	ssidBytes := e.SSID
	if len(ssidBytes) == 0 && ies.HasSSID {
		ssidBytes = ies.SSID
	}
	ssid, hidden := ssidString(ssidBytes)

	mhz := int(e.CenterFreqKHz / 1000)
	band := bandOfFrequency(mhz)
	channel := channelOfFrequency(mhz)
	if channel == 0 && ies.DSChannel > 0 {
		channel = ies.DSChannel
	}

	rates := e.Rates
	if len(rates) == 0 {
		rates = ratesFromIE(e.InformationElt)
	}
	basic, all, legacyMax := legacyRates(rates)

	phy, generation, width, center := ies.phyInfo(band, legacyMax)
	if phy == "" || len(e.InformationElt) == 0 && dot11PhyName(e.PhyType) != "" {
		//Without elements the PHY type reported by the driver is the better guess
		phy = dot11PhyName(e.PhyType)
		generation = generationOfPHY(phy, band)
	}
	streams := ies.spatialStreams()
	maxMCS := ies.heMaxMCS
	if phy == "802.11ac" {
		maxMCS = ies.vhtMaxMCS
	}
	if width <= 20 {
		center = 0
	}

	quality := int(e.LinkQuality)
	if quality > 100 {
		quality = 100
	}

	info := WiFiInfo{
		Address:            formatMAC(e.BSSID[:]),
		Channel:            channel,
		Frequency:          formatFrequency(mhz),
		Quality:            strconv.Itoa(quality) + "/100",
		SignalLevel:        strconv.Itoa(int(e.RSSI)) + " dBm",
		ESSID:              ssid,
		Hidden:             hidden,
		SignalDBm:          int(e.RSSI),
		QualityPercent:     quality,
		FrequencyMHz:       mhz,
		Band:               band,
		ChannelWidth:       width,
		CenterChannel:      center,
		PHYType:            phy,
		Generation:         generation,
		BSSType:            dot11BSSTypeName(e.BSSType),
		Security:           ies.securityName(privacy),
		Cipher:             ies.cipherName(privacy),
		PMF:                ies.PMF,
		SpatialStreams:     streams,
		MaxRateMbps:        estimateMaxRate(phy, width, streams, maxMCS, legacyMax),
		BasicRates:         basic,
		SupportedRates:     all,
		BeaconInterval:     int(e.BeaconPeriod),
		UptimeSeconds:      int64(e.Timestamp / 1000000),
		Country:            ies.Country,
		StationCount:       ies.StationCount,
		ChannelUtilization: ies.ChannelUtilization,
		WPS:                ies.WPS,
		Roaming:            ies.Roaming,
	}
	info.EncryptionKey = info.Security != "Open" && info.Security != ""
	return info
}

/*
	DOT11 / WLAN enumeration names
*/

func dot11PhyName(t uint32) string {
	switch t {
	case 1:
		return "802.11 FHSS"
	case 2:
		return "802.11 DSSS"
	case 3:
		return "802.11 IR"
	case 4:
		return "802.11a"
	case 5:
		return "802.11b"
	case 6:
		return "802.11g"
	case 7:
		return "802.11n"
	case 8:
		return "802.11ac"
	case 9:
		return "802.11ad"
	case 10:
		return "802.11ax"
	case 11:
		return "802.11be"
	}
	return ""
}

func dot11BSSTypeName(t uint32) string {
	switch t {
	case 1:
		return "Infrastructure"
	case 2:
		return "Ad hoc"
	}
	return ""
}

func dot11AuthName(t uint32) string {
	switch t {
	case 1:
		return "Open"
	case 2:
		return "Shared Key (WEP)"
	case 3:
		return "WPA-Enterprise"
	case 4:
		return "WPA-Personal"
	case 5:
		return "WPA-None"
	case 6:
		return "WPA2-Enterprise"
	case 7:
		return "WPA2-Personal"
	case 8:
		return "WPA3-Enterprise 192-bit"
	case 9:
		return "WPA3-Personal"
	case 10:
		return "Enhanced Open (OWE)"
	case 11:
		return "WPA3-Enterprise"
	}
	if t >= 0x80000000 {
		return "Vendor specific"
	}
	return ""
}

func dot11CipherName(t uint32) string {
	switch t {
	case 0x00:
		return "None"
	case 0x01:
		return "WEP-40"
	case 0x02:
		return "TKIP"
	case 0x04:
		return "AES-CCMP"
	case 0x05:
		return "WEP-104"
	case 0x06:
		return "BIP"
	case 0x08:
		return "AES-GCMP"
	case 0x09:
		return "AES-GCMP-256"
	case 0x0a:
		return "AES-CCMP-256"
	case 0x100:
		return "Group cipher"
	case 0x101:
		return "WEP"
	}
	if t >= 0x80000000 {
		return "Vendor specific"
	}
	return ""
}

func wlanInterfaceStateName(s uint32) string {
	switch s {
	case 0:
		return "not ready"
	case 1:
		return "connected"
	case 2:
		return "ad hoc network formed"
	case 3:
		return "disconnecting"
	case 4:
		return "disconnected"
	case 5:
		return "associating"
	case 6:
		return "discovering"
	case 7:
		return "authenticating"
	}
	return "unknown"
}

func wlanConnectionModeName(m uint32) string {
	switch m {
	case 0:
		return "Profile"
	case 1:
		return "Temporary profile"
	case 2:
		return "Secure discovery"
	case 3:
		return "Unsecure discovery"
	case 4:
		return "Automatic"
	}
	return ""
}

func dot11RadioStateName(s uint32) string {
	switch s {
	case 1:
		return "on"
	case 2:
		return "off"
	}
	return "unknown"
}
