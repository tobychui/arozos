package wifi

import (
	"strings"
	"testing"
)

const sampleIwlist = `wlan0     Scan completed :
          Cell 01 - Address: AA:BB:CC:DD:EE:01
                    Channel:36
                    Frequency:5.18 GHz (Channel 36)
                    Quality=63/70  Signal level=-47 dBm
                    Encryption key:on
                    ESSID:"Home\xE5\xAE\xB6"
                    Bit Rates:6 Mb/s; 9 Mb/s; 12 Mb/s; 18 Mb/s; 24 Mb/s
                              36 Mb/s; 48 Mb/s; 54 Mb/s
                    Mode:Master
                    Extra:tsf=000000e8d4a51000
                    Extra: Last beacon: 30ms ago
                    IE: Unknown: 0007486F6D65E5AEB6
                    IE: Unknown: 0703545720
                    IE: Unknown: 2D1AEF0917FFFF000000000000000000000000000000000000000000
                    IE: Unknown: 3D1624050000000000000000000000000000000000000000
                    IE: Unknown: BF0CB259820FFAFF0000FAFF0000
                    IE: Unknown: C005012A000000
                    IE: IEEE 802.11i/WPA2 Version 1
                        Group Cipher : CCMP
                        Pairwise Ciphers (1) : CCMP
                        Authentication Suites (2) : PSK unknown (8)
          Cell 02 - Address: aa:bb:cc:dd:ee:02
                    Channel:6
                    Frequency:2.437 GHz (Channel 6)
                    Quality=30/70  Signal level=-80 dBm
                    Encryption key:on
                    ESSID:""
                    Bit Rates:1 Mb/s; 2 Mb/s; 5.5 Mb/s; 11 Mb/s
                    Mode:Master
                    IE: WPA Version 1
                        Group Cipher : TKIP
                        Pairwise Ciphers (1) : TKIP
                        Authentication Suites (1) : PSK
          Cell 03 - Address: AA:BB:CC:DD:EE:03
                    Channel:11
                    Frequency:2.462 GHz (Channel 11)
                    Quality=70/70  Signal level=-30 dBm
                    Encryption key:off
                    ESSID:"Guest"
                    Mode:Master
`

func TestParseIwlistScan(t *testing.T) {
	results := parseIwlistScan(sampleIwlist)
	if len(results) != 3 {
		t.Fatalf("got %d cells, want 3 (the last cell must not be dropped)", len(results))
	}

	a := results[0]
	checks := []struct {
		name string
		got  interface{}
		want interface{}
	}{
		{"Address", a.Address, "aa:bb:cc:dd:ee:01"},
		{"ESSID", a.ESSID, "Home\u5bb6"},
		{"Channel", a.Channel, 36},
		{"FrequencyMHz", a.FrequencyMHz, 5180},
		{"Frequency", a.Frequency, "5.180 GHz"},
		{"Band", a.Band, "5 GHz"},
		{"Quality", a.Quality, "63/70"},
		{"QualityPercent", a.QualityPercent, 90},
		{"SignalDBm", a.SignalDBm, -47},
		{"SignalLevel", a.SignalLevel, "-47 dBm"},
		{"BSSType", a.BSSType, "Infrastructure"},
		{"Security", a.Security, "WPA2/WPA3-Personal"},
		{"Cipher", a.Cipher, "AES-CCMP"},
		{"Country", a.Country, "TW"},
		{"PHYType", a.PHYType, "802.11ac"},
		{"ChannelWidth", a.ChannelWidth, 80},
		{"CenterChannel", a.CenterChannel, 42},
		{"SpatialStreams", a.SpatialStreams, 2},
		{"SupportedRates", len(a.SupportedRates), 8},
		{"UptimeSeconds", a.UptimeSeconds, int64(1000000)},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("cell 1 %s = %v, want %v", c.name, c.got, c.want)
		}
	}

	b := results[1]
	if !b.Hidden || b.ESSID != "" {
		t.Errorf("cell 2: Hidden=%v ESSID=%q", b.Hidden, b.ESSID)
	}
	if b.Security != "WPA-Personal" || b.Cipher != "TKIP" || b.PHYType != "802.11b" {
		t.Errorf("cell 2: Security=%q Cipher=%q PHY=%q", b.Security, b.Cipher, b.PHYType)
	}

	c := results[2]
	if c.ESSID != "Guest" || c.Security != "Open" || c.EncryptionKey || c.QualityPercent != 100 {
		t.Errorf("cell 3: %+v", c)
	}

	if got := parseIwlistScan("wlan0     No scan results\n"); len(got) != 0 {
		t.Errorf("empty scan returned %d cells", len(got))
	}
}

// TestParseIwlistScanTruncated parses every line prefix of the sample
func TestParseIwlistScanTruncated(t *testing.T) {
	lines := strings.Split(sampleIwlist, "\n")
	for i := range lines {
		parseIwlistScan(strings.Join(lines[:i], "\n"))
	}
}

func TestParseIwLink(t *testing.T) {
	connected := `Connected to aa:bb:cc:dd:ee:01 (on wlan0)
	SSID: Home\xe5\xae\xb6
	freq: 5180.0
	RX: 123456 bytes (789 packets)
	TX: 23456 bytes (123 packets)
	signal: -52 dBm
	rx bitrate: 433.3 MBit/s VHT-MCS 9 80MHz short GI VHT-NSS 1
	tx bitrate: 390.0 MBit/s VHT-MCS 8 80MHz short GI VHT-NSS 1

	bss flags:	short-slot-time
	dtim period:	1
	beacon int:	100
`
	link := parseIwLink(connected)
	if !link.Connected || link.BSSID != "aa:bb:cc:dd:ee:01" || link.SSID != "Home\u5bb6" {
		t.Errorf("link = %+v", link)
	}
	if link.FreqMHz != 5180 || link.SignalDBm != -52 || link.Width != 80 || link.BeaconInt != 100 {
		t.Errorf("link = %+v", link)
	}
	if link.RxRateMbps != 433.3 || link.TxRateMbps != 390 || link.PHYType != "802.11ac" {
		t.Errorf("link = %+v", link)
	}

	if link := parseIwLink("Not connected.\n"); link.Connected {
		t.Error("Not connected parsed as connected")
	}

	he := parseIwLink("Connected to 00:11:22:33:44:55 (on wlp2s0)\n\tfreq: 2437\n\ttx bitrate: 286.7 MBit/s 40MHz HE-MCS 11 HE-NSS 2 HE-GI 0 HE-DCM 0\n")
	if he.PHYType != "802.11ax" || he.Width != 40 || he.FreqMHz != 2437 {
		t.Errorf("HE link = %+v", he)
	}
}

func TestPhyOfBitrate(t *testing.T) {
	cases := map[string]string{
		"54.0 MBit/s":                         "",
		"72.2 MBit/s MCS 7 short GI":          "802.11n",
		"866.7 MBit/s VHT-MCS 9 160MHz":       "802.11ac",
		"1201.0 MBit/s 80MHz HE-MCS 11":       "802.11ax",
		"2882.4 MBit/s 320MHz EHT-MCS 13 EHT": "802.11be",
	}
	for in, want := range cases {
		if got := phyOfBitrate(in); got != want {
			t.Errorf("phyOfBitrate(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestParseFrequencyMHz(t *testing.T) {
	cases := map[string]int{
		"2.412 GHz":             2412,
		"5.18 GHz (Channel 36)": 5180,
		"5180":                  5180,
		"5180.0":                5180,
		"5180 MHz":              5180,
		"":                      0,
		"abc":                   0,
		"-5":                    0,
	}
	for in, want := range cases {
		if got := parseFrequencyMHz(in); got != want {
			t.Errorf("parseFrequencyMHz(%q) = %d, want %d", in, got, want)
		}
	}
}

func TestParseProcRoute(t *testing.T) {
	content := "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\n" +
		"wlan0\t00000000\t0100A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0\n" +
		"wlan0\t0000A8C0\t00000000\t0001\t0\t0\t600\t00FFFFFF\t0\t0\t0\n" +
		"eth0\t00000000\t0101A8C0\t0003\t0\t0\t100\t00000000\t0\t0\t0\n"
	got := parseProcRoute(content, "wlan0")
	if len(got) != 1 || got[0] != "192.168.0.1" {
		t.Errorf("parseProcRoute(wlan0) = %v", got)
	}
	if got := parseProcRoute(content, "wlan1"); len(got) != 0 {
		t.Errorf("parseProcRoute(wlan1) = %v", got)
	}
}

func TestNormalizeWiFiInfo(t *testing.T) {
	cases := []struct {
		name    string
		in      WiFiInfo
		dbm     int
		quality int
		mhz     int
		band    string
		channel int
	}{
		{"iwlist strings", WiFiInfo{SignalLevel: "-60 dBm", Quality: "35/70", Frequency: "2.437 GHz"}, -60, 50, 2437, "2.4 GHz", 6},
		{"nmcli estimate", WiFiInfo{SignalLevel: "-55 dBm[Estimated]", Quality: "80/100", Channel: 149, Frequency: "54 Mbit/s"}, -55, 80, 5745, "5 GHz", 149},
		{"signal only", WiFiInfo{SignalLevel: "-75 dBm"}, -75, 50, 0, "", 0},
		{"nothing", WiFiInfo{}, 0, -1, 0, "", 0},
	}
	for _, tc := range cases {
		info := tc.in
		normalizeWiFiInfo(&info)
		if info.SignalDBm != tc.dbm || info.QualityPercent != tc.quality || info.FrequencyMHz != tc.mhz || info.Band != tc.band || info.Channel != tc.channel {
			t.Errorf("%s: got dBm=%d quality=%d MHz=%d band=%q channel=%d", tc.name, info.SignalDBm, info.QualityPercent, info.FrequencyMHz, info.Band, info.Channel)
		}
	}
}

func TestUnescapeIwString(t *testing.T) {
	cases := map[string]string{
		`plain`:          "plain",
		`a\x41b`:         "aAb",
		`bad\xZZ`:        `bad\xZZ`,
		`end\x4`:         `end\x4`,
		`\xe5\xae\xb6!!`: "\u5bb6!!",
	}
	for in, want := range cases {
		if got := string(unescapeIwString(in)); got != want {
			t.Errorf("unescapeIwString(%q) = %q, want %q", in, got, want)
		}
	}
}
