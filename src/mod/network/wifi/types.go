package wifi

type WiFiInfo struct {
	Address         string
	Channel         int
	Frequency       string
	Quality         string
	SignalLevel     string
	EncryptionKey   bool
	ESSID           string
	ConnectedBefore bool
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
