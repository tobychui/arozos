package wifi

// WiFiInfo describes one access point (BSS) found by a scan. The first block
// of fields is the original, string based format every platform fills; the
// rest is filled as far as the platform can tell and left at its zero value
// (or nil) otherwise.
type WiFiInfo struct {
	Address         string //BSSID
	Channel         int
	Frequency       string //Human readable, e.g. "5.180 GHz"
	Quality         string //e.g. "70/70" or "86/100"
	SignalLevel     string //e.g. "-52 dBm"
	EncryptionKey   bool
	ESSID           string
	ConnectedBefore bool //A saved profile exists for this SSID

	Interface          string   //Interface that scanned this BSS
	Hidden             bool     //The AP does not broadcast its SSID
	Connected          bool     //This is the BSS the interface is associated with
	SignalDBm          int      //RSSI in dBm, 0 when unknown
	QualityPercent     int      //Link quality 0 - 100, -1 when unknown
	FrequencyMHz       int      //Center frequency of the primary channel
	Band               string   //"2.4 GHz", "5 GHz", "6 GHz" or "60 GHz"
	ChannelWidth       int      //Operating channel width in MHz, 0 when unknown
	CenterChannel      int      //Center channel of a 40 MHz or wider channel
	PHYType            string   //e.g. "802.11ax"
	Generation         string   //e.g. "Wi-Fi 6"
	BSSType            string   //"Infrastructure" or "Ad hoc"
	Security           string   //e.g. "WPA2-Personal", "WPA3-Personal", "Open"
	Cipher             string   //e.g. "AES-CCMP"
	PMF                string   //Protected management frames: "Required", "Capable" or ""
	SpatialStreams     int      //Spatial streams the AP advertises, 0 when unknown
	MaxRateMbps        float64  //Estimated maximum PHY rate, 0 when unknown
	BasicRates         []string //Legacy basic (mandatory) rates in Mbps
	SupportedRates     []string //All legacy rates in Mbps
	BeaconInterval     int      //Beacon interval in time units (1.024 ms)
	UptimeSeconds      int64    //AP uptime from the beacon timestamp, 0 when unknown
	Country            string   //Two letter regulatory country code
	StationCount       *int     //Clients associated with the AP (BSS Load element)
	ChannelUtilization *int     //Channel busy percentage (BSS Load element)
	WPS                bool     //Wi-Fi Protected Setup is enabled
	Roaming            []string //Fast roaming amendments: "802.11k", "802.11v", "802.11r"
}

// WiFiInterfaceStatus is the live state of one wireless interface.
type WiFiInterfaceStatus struct {
	Name          string //Friendly name, e.g. "Wi-Fi 2" or "wlan0"
	Description   string //Adapter model
	GUID          string //Windows interface GUID
	MAC           string
	State         string //"connected", "disconnected", "associating", ...
	Connected     bool
	SoftwareRadio string //"on", "off" or "unknown"
	HardwareRadio string //"on", "off" or "unknown"

	SSID           string
	BSSID          string
	ProfileName    string
	ConnectionMode string
	BSSType        string
	PHYType        string
	Generation     string
	Channel        int
	FrequencyMHz   int
	Band           string
	ChannelWidth   int
	SignalQuality  int     //Percent, -1 when unknown
	RSSI           int     //dBm, 0 when unknown
	RxRateMbps     float64 //Receive link rate
	TxRateMbps     float64 //Transmit link rate
	Security       string
	Cipher         string
	OneX           bool //802.1X authentication in use

	IPv4     []string
	IPv6     []string
	Gateways []string
	DNS      []string
	MTU      int

	AP *WiFiInfo //Details of the connected access point, when known
}

type WiFiConnectionResult struct {
	ConnectedSSID string
	Success       bool
}

var wifiProfileTemplate string = `<?xml version="1.0"?>
<WLANProfile xmlns="http://www.microsoft.com/networking/WLAN/profile/v1">
	<name>{{SSID}}</name>
	<SSIDConfig>
		<SSID>
			<hex>{{SSID_HEX}}</hex>
			<name>{{SSID}}</name>
		</SSID>
	</SSIDConfig>
	<connectionType>ESS</connectionType>
	<connectionMode>auto</connectionMode>
	<MSM>
		<security>
			<authEncryption>
				<authentication>WPA2PSK</authentication>
				<encryption>AES</encryption>
				<useOneX>false</useOneX>
			</authEncryption>
			<sharedKey>
				<keyType>passPhrase</keyType>
				<protected>false</protected>
				<keyMaterial>{{PASSWORD}}</keyMaterial>
			</sharedKey>
		</security>
	</MSM>
	<MacRandomization xmlns="http://www.microsoft.com/networking/WLAN/profile/v3">
		<enableRandomization>false</enableRandomization>
	</MacRandomization>
</WLANProfile>
`
