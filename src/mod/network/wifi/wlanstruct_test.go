package wifi

import (
	"encoding/binary"
	"testing"
	"unicode/utf16"
)

func putUTF16(b []byte, s string) {
	for i, c := range utf16.Encode([]rune(s)) {
		binary.LittleEndian.PutUint16(b[i*2:], c)
	}
}

func putSSID(b []byte, ssid string) {
	binary.LittleEndian.PutUint32(b[0:4], uint32(len(ssid)))
	copy(b[4:36], ssid)
}

type testBSS struct {
	ssid    string
	bssid   [6]byte
	phy     uint32
	rssi    int32
	quality uint32
	beacon  uint16
	tsf     uint64
	caps    uint16
	freqKHz uint32
	rates   []uint16
	ies     []byte
}

// buildBSSList lays out a WLAN_BSS_LIST the way wlansvc does: the fixed
// entries first, then the information elements of every entry
func buildBSSList(entries []testBSS) []byte {
	le := binary.LittleEndian
	fixed := 8 + len(entries)*wlanBSSEntrySize
	b := make([]byte, fixed)
	le.PutUint32(b[4:8], uint32(len(entries)))
	for i, e := range entries {
		start := 8 + i*wlanBSSEntrySize
		d := b[start : start+wlanBSSEntrySize]
		putSSID(d[0:36], e.ssid)
		copy(d[40:46], e.bssid[:])
		le.PutUint32(d[48:52], 1)
		le.PutUint32(d[52:56], e.phy)
		le.PutUint32(d[56:60], uint32(e.rssi))
		le.PutUint32(d[60:64], e.quality)
		d[64] = 1
		le.PutUint16(d[66:68], e.beacon)
		le.PutUint64(d[72:80], e.tsf)
		le.PutUint16(d[88:90], e.caps)
		le.PutUint32(d[92:96], e.freqKHz)
		le.PutUint32(d[96:100], uint32(len(e.rates)))
		for r, rate := range e.rates {
			le.PutUint16(d[100+r*2:], rate)
		}
		le.PutUint32(d[352:356], uint32(len(b)-start))
		le.PutUint32(d[356:360], uint32(len(e.ies)))
		b = append(b, e.ies...)
		for len(b)%8 != 0 {
			b = append(b, 0)
		}
	}
	le.PutUint32(b[0:4], uint32(len(b)))
	return b
}

func TestParseWlanBSSList(t *testing.T) {
	list := buildBSSList([]testBSS{
		{
			ssid: "Home-5G", bssid: [6]byte{0xAE, 0x20, 0x2E, 0xF8, 0x39, 0x30}, phy: 8, rssi: -36, quality: 100,
			beacon: 100, tsf: 1041878 * 1000000, caps: 0x0011, freqKHz: 5745000,
			rates: []uint16{0x800C, 18, 0x8018, 36, 48, 72, 96, 108},
			ies: concat(ie(ieSSID, []byte("Home-5G")...), ie(ieCountry, 'T', 'W', 4), htCaps(3), ie(ieHTOperation, 149, 0x05),
				vhtCaps(3, 2), ie(ieVHTOperation, 1, 155, 0), rsnIE([]byte{4}, []byte{2}, 0)),
		},
		{
			ssid: "", bssid: [6]byte{1, 2, 3, 4, 5, 6}, phy: 7, rssi: -80, quality: 40,
			caps: 0x0001, freqKHz: 2437000, rates: []uint16{0x8002, 0x8004},
		},
	})

	entries, err := parseWlanBSSList(list)
	if err != nil {
		t.Fatalf("parseWlanBSSList: %v", err)
	}
	if len(entries) != 2 {
		t.Fatalf("got %d entries, want 2", len(entries))
	}

	info := bssInfoFromEntry(entries[0])
	checks := []struct {
		name string
		got  interface{}
		want interface{}
	}{
		{"ESSID", info.ESSID, "Home-5G"},
		{"Address", info.Address, "ae:20:2e:f8:39:30"},
		{"Channel", info.Channel, 149},
		{"Band", info.Band, "5 GHz"},
		{"Frequency", info.Frequency, "5.745 GHz"},
		{"SignalDBm", info.SignalDBm, -36},
		{"SignalLevel", info.SignalLevel, "-36 dBm"},
		{"Quality", info.Quality, "100/100"},
		{"ChannelWidth", info.ChannelWidth, 80},
		{"CenterChannel", info.CenterChannel, 155},
		{"PHYType", info.PHYType, "802.11ac"},
		{"Generation", info.Generation, "Wi-Fi 5"},
		{"Security", info.Security, "WPA2-Personal"},
		{"Cipher", info.Cipher, "AES-CCMP"},
		{"EncryptionKey", info.EncryptionKey, true},
		{"SpatialStreams", info.SpatialStreams, 3},
		{"MaxRateMbps", info.MaxRateMbps, 1300.0},
		{"Country", info.Country, "TW"},
		{"BeaconInterval", info.BeaconInterval, 100},
		{"UptimeSeconds", info.UptimeSeconds, int64(1041878)},
		{"BSSType", info.BSSType, "Infrastructure"},
		{"BasicRates", len(info.BasicRates), 2},
		{"SupportedRates", len(info.SupportedRates), 8},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s = %v, want %v", c.name, c.got, c.want)
		}
	}

	hidden := bssInfoFromEntry(entries[1])
	if !hidden.Hidden || hidden.ESSID != "" {
		t.Errorf("hidden entry: Hidden=%v ESSID=%q", hidden.Hidden, hidden.ESSID)
	}
	if hidden.PHYType != "802.11n" || hidden.Security != "Open" || hidden.Channel != 6 {
		t.Errorf("hidden entry: PHY=%q Security=%q Channel=%d", hidden.PHYType, hidden.Security, hidden.Channel)
	}
}

// TestParseWlanBSSListHostile checks that wrong counts and IE offsets never
// read out of bounds
func TestParseWlanBSSListHostile(t *testing.T) {
	list := buildBSSList([]testBSS{{ssid: "a", freqKHz: 2412000, ies: ie(ieSSID, 'a')}})
	le := binary.LittleEndian

	cases := []struct {
		name   string
		mutate func(b []byte)
		ok     bool
	}{
		{"valid", func(b []byte) {}, true},
		{"count too large", func(b []byte) { le.PutUint32(b[4:8], 1000) }, false},
		{"total too large", func(b []byte) { le.PutUint32(b[0:4], 0xFFFFFFFF) }, true},
		{"ie offset past end", func(b []byte) { le.PutUint32(b[8+352:], 0xFFFFFFF0) }, true},
		{"ie size past end", func(b []byte) { le.PutUint32(b[8+356:], 0xFFFFFFF0) }, true},
		{"ie offset inside entry", func(b []byte) { le.PutUint32(b[8+352:], 4) }, true},
		{"rate count huge", func(b []byte) { le.PutUint32(b[8+96:], 0xFFFFFFFF) }, true},
		{"ssid length huge", func(b []byte) { le.PutUint32(b[8:], 0xFFFFFFFF) }, true},
	}
	for _, tc := range cases {
		b := append([]byte{}, list...)
		tc.mutate(b)
		entries, err := parseWlanBSSList(b)
		if (err == nil) != tc.ok {
			t.Errorf("%s: err = %v, want ok=%v", tc.name, err, tc.ok)
		}
		for _, e := range entries {
			bssInfoFromEntry(e)
		}
	}
	for i := 0; i <= len(list); i++ {
		entries, _ := parseWlanBSSList(list[:i])
		for _, e := range entries {
			bssInfoFromEntry(e)
		}
	}
}

func TestParseWlanInterfaceList(t *testing.T) {
	b := make([]byte, 8+2*wlanInterfaceInfoSize)
	binary.LittleEndian.PutUint32(b[0:4], 2)
	guid := []byte{0x87, 0xAB, 0xF7, 0x0B, 0xB4, 0x4A, 0xFB, 0x42, 0xA6, 0x2E, 0xD7, 0xE7, 0x20, 0xF1, 0x5A, 0x7C}
	copy(b[8:24], guid)
	putUTF16(b[24:536], "Realtek 8811CU Wireless LAN 802.11ac USB NIC")
	binary.LittleEndian.PutUint32(b[8+528:], 4)
	binary.LittleEndian.PutUint32(b[8+wlanInterfaceInfoSize+528:], 1)

	list, err := parseWlanInterfaceList(b)
	if err != nil || len(list) != 2 {
		t.Fatalf("parseWlanInterfaceList = %v, %v", list, err)
	}
	if list[0].Description != "Realtek 8811CU Wireless LAN 802.11ac USB NIC" {
		t.Errorf("Description = %q", list[0].Description)
	}
	if g := guidString(list[0].GUID); g != "{0BF7AB87-4AB4-42FB-A62E-D7E720F15A7C}" {
		t.Errorf("GUID = %s", g)
	}
	if wlanInterfaceStateName(list[0].State) != "disconnected" || wlanInterfaceStateName(list[1].State) != "connected" {
		t.Errorf("States = %d, %d", list[0].State, list[1].State)
	}

	if _, err := parseWlanInterfaceList(b[:100]); err == nil {
		t.Error("truncated interface list accepted")
	}
	if _, err := parseWlanInterfaceList(nil); err == nil {
		t.Error("empty interface list accepted")
	}
}

func TestParseWlanConnectionAttributes(t *testing.T) {
	le := binary.LittleEndian
	b := make([]byte, wlanConnectionAttrSize)
	le.PutUint32(b[0:4], 1)
	le.PutUint32(b[4:8], 0)
	putUTF16(b[8:520], "Home-5G")
	putSSID(b[520:556], "Home-5G")
	le.PutUint32(b[556:560], 1)
	copy(b[560:566], []byte{0xAE, 0x20, 0x2E, 0xF8, 0x39, 0x30})
	le.PutUint32(b[568:572], 8)
	le.PutUint32(b[576:580], 92)
	le.PutUint32(b[580:584], 866700)
	le.PutUint32(b[584:588], 650000)
	le.PutUint32(b[588:592], 1)
	le.PutUint32(b[596:600], 7)
	le.PutUint32(b[600:604], 4)

	c, err := parseWlanConnectionAttributes(b)
	if err != nil {
		t.Fatalf("parseWlanConnectionAttributes: %v", err)
	}
	if c.ProfileName != "Home-5G" || string(c.SSID) != "Home-5G" {
		t.Errorf("profile / SSID = %q / %q", c.ProfileName, c.SSID)
	}
	if formatMAC(c.BSSID[:]) != "ae:20:2e:f8:39:30" {
		t.Errorf("BSSID = %s", formatMAC(c.BSSID[:]))
	}
	if dot11PhyName(c.PhyType) != "802.11ac" || c.SignalQuality != 92 || c.RxRateKbps != 866700 || c.TxRateKbps != 650000 {
		t.Errorf("association = %+v", c)
	}
	if !c.SecurityEnabled || dot11AuthName(c.AuthAlgorithm) != "WPA2-Personal" || dot11CipherName(c.CipherAlgorithm) != "AES-CCMP" {
		t.Errorf("security = %+v", c)
	}
	if wlanConnectionModeName(c.Mode) != "Profile" {
		t.Errorf("mode = %d", c.Mode)
	}
	if _, err := parseWlanConnectionAttributes(b[:600]); err == nil {
		t.Error("truncated connection attributes accepted")
	}
}

func TestParseWlanRadioState(t *testing.T) {
	le := binary.LittleEndian
	b := make([]byte, 4+64*12)
	le.PutUint32(b[0:4], 2)
	le.PutUint32(b[4:8], 0)
	le.PutUint32(b[8:12], 2)
	le.PutUint32(b[12:16], 1)
	le.PutUint32(b[16:20], 1)
	le.PutUint32(b[20:24], 1)
	le.PutUint32(b[24:28], 1)

	states, err := parseWlanRadioState(b)
	if err != nil || len(states) != 2 {
		t.Fatalf("parseWlanRadioState = %v, %v", states, err)
	}
	if dot11RadioStateName(states[0].Software) != "off" || dot11RadioStateName(states[1].Software) != "on" {
		t.Errorf("states = %+v", states)
	}
	le.PutUint32(b[0:4], 1000)
	if states, err := parseWlanRadioState(b); err != nil || len(states) != 64 {
		t.Errorf("oversized count: %d states, %v", len(states), err)
	}
	if _, err := parseWlanRadioState(b[:2]); err == nil {
		t.Error("truncated radio state accepted")
	}
}

func TestParseWlanAvailableNetworkList(t *testing.T) {
	le := binary.LittleEndian
	b := make([]byte, 8+wlanAvailableNetworkSize)
	le.PutUint32(b[0:4], 1)
	e := b[8:]
	putUTF16(e[0:512], "Home-5G")
	putSSID(e[512:548], "Home-5G")
	le.PutUint32(e[548:552], 1)
	le.PutUint32(e[604:608], 88)
	le.PutUint32(e[608:612], 1)
	le.PutUint32(e[612:616], 9)
	le.PutUint32(e[616:620], 4)
	le.PutUint32(e[620:624], wlanAvailableNetworkConnected|wlanAvailableNetworkHasProfile)

	list, err := parseWlanAvailableNetworkList(b)
	if err != nil || len(list) != 1 {
		t.Fatalf("parseWlanAvailableNetworkList = %v, %v", list, err)
	}
	n := list[0]
	if n.ProfileName != "Home-5G" || string(n.SSID) != "Home-5G" || n.SignalQuality != 88 || !n.SecurityEnabled {
		t.Errorf("network = %+v", n)
	}
	if dot11AuthName(n.AuthAlgorithm) != "WPA3-Personal" || n.Flags&wlanAvailableNetworkHasProfile == 0 {
		t.Errorf("network = %+v", n)
	}
	if _, err := parseWlanAvailableNetworkList(b[:500]); err == nil {
		t.Error("truncated network list accepted")
	}
}

func TestEnumNames(t *testing.T) {
	cases := []struct {
		got  string
		want string
	}{
		{dot11PhyName(10), "802.11ax"},
		{dot11PhyName(99), ""},
		{dot11BSSTypeName(2), "Ad hoc"},
		{dot11AuthName(0x80000001), "Vendor specific"},
		{dot11AuthName(10), "Enhanced Open (OWE)"},
		{dot11CipherName(0x101), "WEP"},
		{dot11CipherName(0), "None"},
		{wlanInterfaceStateName(99), "unknown"},
		{wlanConnectionModeName(4), "Automatic"},
		{dot11RadioStateName(0), "unknown"},
	}
	for i, c := range cases {
		if c.got != c.want {
			t.Errorf("case %d: got %q, want %q", i, c.got, c.want)
		}
	}
}
