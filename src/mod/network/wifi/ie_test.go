package wifi

import (
	"testing"
)

// ie builds one information element
func ie(id byte, data ...byte) []byte {
	return append([]byte{id, byte(len(data))}, data...)
}

// ieExt builds one extension element
func ieExt(ext byte, data ...byte) []byte {
	return ie(ieExtension, append([]byte{ext}, data...)...)
}

func concat(parts ...[]byte) []byte {
	out := []byte{}
	for _, p := range parts {
		out = append(out, p...)
	}
	return out
}

// rsnIE builds an RSN element with the given pairwise ciphers, AKMs and capabilities
func rsnIE(ciphers []byte, akms []byte, caps uint16) []byte {
	d := []byte{1, 0, 0x00, 0x0F, 0xAC, 4}
	d = append(d, byte(len(ciphers)), 0)
	for _, c := range ciphers {
		d = append(d, 0x00, 0x0F, 0xAC, c)
	}
	d = append(d, byte(len(akms)), 0)
	for _, a := range akms {
		d = append(d, 0x00, 0x0F, 0xAC, a)
	}
	d = append(d, byte(caps), byte(caps>>8))
	return ie(ieRSN, d...)
}

func wpaIE(ciphers []byte, akms []byte) []byte {
	d := []byte{0x00, 0x50, 0xF2, 1, 1, 0, 0x00, 0x50, 0xF2, 2}
	d = append(d, byte(len(ciphers)), 0)
	for _, c := range ciphers {
		d = append(d, 0x00, 0x50, 0xF2, c)
	}
	d = append(d, byte(len(akms)), 0)
	for _, a := range akms {
		d = append(d, 0x00, 0x50, 0xF2, a)
	}
	return ie(ieVendorSpecific, d...)
}

// htCaps builds an HT capabilities element advertising n spatial streams
func htCaps(streams int) []byte {
	d := make([]byte, 26)
	for i := 0; i < streams && i < 4; i++ {
		d[3+i] = 0xFF
	}
	return ie(ieHTCapabilities, d...)
}

// vhtCaps builds a VHT capabilities element: n streams, MCS map code for all
func vhtCaps(streams int, code uint16) []byte {
	var m uint16 = 0xFFFF
	for i := 0; i < streams; i++ {
		m &^= 3 << (2 * i)
		m |= code << (2 * i)
	}
	d := make([]byte, 12)
	d[4] = byte(m)
	d[5] = byte(m >> 8)
	return ie(ieVHTCapabilities, d...)
}

func heCaps(streams int, code uint16) []byte {
	var m uint16 = 0xFFFF
	for i := 0; i < streams; i++ {
		m &^= 3 << (2 * i)
		m |= code << (2 * i)
	}
	d := make([]byte, 21)
	d[17] = byte(m)
	d[18] = byte(m >> 8)
	return ieExt(ieExtHECapabilities, d...)
}

func TestForEachIEStopsOnTruncation(t *testing.T) {
	cases := []struct {
		name string
		in   []byte
		want int
	}{
		{"empty", nil, 0},
		{"one byte", []byte{0}, 0},
		{"two elements", concat(ie(0, 'a'), ie(3, 6)), 2},
		{"truncated second", append(ie(0, 'a'), 3, 5, 1), 1},
		{"zero length", ie(0), 1},
	}
	for _, tc := range cases {
		n := 0
		forEachIE(tc.in, func(id byte, d []byte) { n++ })
		if n != tc.want {
			t.Errorf("%s: got %d elements, want %d", tc.name, n, tc.want)
		}
	}
}

func TestSecurityName(t *testing.T) {
	cases := []struct {
		name       string
		ies        []byte
		privacy    bool
		wantSec    string
		wantCipher string
		wantPMF    string
	}{
		{"open", nil, false, "Open", "", ""},
		{"wep", nil, true, "WEP", "WEP", ""},
		{"wpa2 personal", rsnIE([]byte{4}, []byte{2}, 0), true, "WPA2-Personal", "AES-CCMP", ""},
		{"wpa3 personal", rsnIE([]byte{4}, []byte{8}, 0x00C0), true, "WPA3-Personal", "AES-CCMP", "Required"},
		{"wpa2/wpa3 transition", rsnIE([]byte{4}, []byte{2, 8}, 0x0080), true, "WPA2/WPA3-Personal", "AES-CCMP", "Capable"},
		{"wpa/wpa2 mixed", concat(rsnIE([]byte{2, 4}, []byte{2}, 0), wpaIE([]byte{2}, []byte{2})), true, "WPA/WPA2-Personal", "TKIP + AES-CCMP", ""},
		{"wpa only", wpaIE([]byte{2}, []byte{2}), true, "WPA-Personal", "TKIP", ""},
		{"wpa enterprise", wpaIE([]byte{2}, []byte{1}), true, "WPA-Enterprise", "TKIP", ""},
		{"wpa2 enterprise", rsnIE([]byte{4}, []byte{1}, 0), true, "WPA2-Enterprise", "AES-CCMP", ""},
		{"wpa3 enterprise", rsnIE([]byte{4}, []byte{5}, 0x00C0), true, "WPA3-Enterprise", "AES-CCMP", "Required"},
		{"wpa3 192-bit", rsnIE([]byte{9}, []byte{12}, 0x00C0), true, "WPA3-Enterprise 192-bit", "AES-GCMP-256", "Required"},
		{"owe", rsnIE([]byte{4}, []byte{18}, 0x00C0), false, "Enhanced Open (OWE)", "AES-CCMP", "Required"},
		{"rsn version only", ie(ieRSN, 1, 0), true, "WPA2-Enterprise", "AES-CCMP", ""},
	}
	for _, tc := range cases {
		e := parseIEs(tc.ies)
		if got := e.securityName(tc.privacy); got != tc.wantSec {
			t.Errorf("%s: security = %q, want %q", tc.name, got, tc.wantSec)
		}
		if got := e.cipherName(tc.privacy); got != tc.wantCipher {
			t.Errorf("%s: cipher = %q, want %q", tc.name, got, tc.wantCipher)
		}
		if e.PMF != tc.wantPMF {
			t.Errorf("%s: PMF = %q, want %q", tc.name, e.PMF, tc.wantPMF)
		}
	}
}

func TestPhyInfo(t *testing.T) {
	cases := []struct {
		name        string
		ies         []byte
		band        string
		legacyMax   float64
		wantPHY     string
		wantGen     string
		wantWidth   int
		wantCenter  int
		wantStreams int
		wantMaxRate float64
	}{
		{"802.11b", nil, "2.4 GHz", 11, "802.11b", "", 20, 0, 0, 11},
		{"802.11g", nil, "2.4 GHz", 54, "802.11g", "", 20, 0, 0, 54},
		{"802.11a", nil, "5 GHz", 54, "802.11a", "", 20, 0, 0, 54},
		{"n 20MHz 2ss", concat(htCaps(2), ie(ieHTOperation, 6, 0, 0, 0, 0)), "2.4 GHz", 54, "802.11n", "Wi-Fi 4", 20, 0, 2, 144.4},
		{"n 40MHz above", concat(htCaps(2), ie(ieHTOperation, 36, 0x05, 0, 0, 0)), "5 GHz", 54, "802.11n", "Wi-Fi 4", 40, 38, 2, 300},
		{"n 40MHz below", concat(htCaps(1), ie(ieHTOperation, 40, 0x07, 0, 0, 0)), "5 GHz", 54, "802.11n", "Wi-Fi 4", 40, 38, 1, 150},
		{"ac 80MHz 3ss", concat(htCaps(3), ie(ieHTOperation, 149, 0x05), vhtCaps(3, 2), ie(ieVHTOperation, 1, 155, 0, 0, 0)), "5 GHz", 54, "802.11ac", "Wi-Fi 5", 80, 155, 3, 1300},
		{"ac 160MHz", concat(htCaps(2), ie(ieHTOperation, 36, 0x05), vhtCaps(2, 2), ie(ieVHTOperation, 1, 42, 50, 0, 0)), "5 GHz", 54, "802.11ac", "Wi-Fi 5", 160, 50, 2, 1733.3},
		{"vht on 2.4 is n", concat(htCaps(2), ie(ieHTOperation, 6, 0), vhtCaps(2, 2)), "2.4 GHz", 54, "802.11n", "Wi-Fi 4", 20, 0, 2, 144.4},
		{"ax 80MHz 2ss", concat(htCaps(2), ie(ieHTOperation, 36, 0x05), vhtCaps(2, 2), ie(ieVHTOperation, 1, 42, 0), heCaps(2, 2)), "5 GHz", 54, "802.11ax", "Wi-Fi 6", 80, 42, 2, 1201},
		{"ax 6GHz 160MHz", concat(heCaps(2, 2), ieExt(ieExtHEOperation, 0, 0, 0x02, 0, 0, 0, 37, 0x03, 39, 47, 0)), "6 GHz", 54, "802.11ax", "Wi-Fi 6E", 160, 47, 2, 2402},
		{"be 320MHz", concat(heCaps(2, 2), ieExt(ieExtEHTCapabilities, 0), ieExt(ieExtEHTOperation, 0x01, 0, 0, 0, 0, 0x04, 31, 63)), "6 GHz", 54, "802.11be", "Wi-Fi 7", 320, 63, 2, 5764.7},
	}
	for _, tc := range cases {
		e := parseIEs(tc.ies)
		phy, gen, width, center := e.phyInfo(tc.band, tc.legacyMax)
		if phy != tc.wantPHY || gen != tc.wantGen || width != tc.wantWidth || center != tc.wantCenter {
			t.Errorf("%s: phyInfo = (%q, %q, %d, %d), want (%q, %q, %d, %d)", tc.name, phy, gen, width, center, tc.wantPHY, tc.wantGen, tc.wantWidth, tc.wantCenter)
		}
		streams := e.spatialStreams()
		if streams != tc.wantStreams {
			t.Errorf("%s: streams = %d, want %d", tc.name, streams, tc.wantStreams)
		}
		maxMCS := e.heMaxMCS
		if phy == "802.11ac" {
			maxMCS = e.vhtMaxMCS
		}
		if got := estimateMaxRate(phy, width, streams, maxMCS, tc.legacyMax); got != tc.wantMaxRate {
			t.Errorf("%s: max rate = %v, want %v", tc.name, got, tc.wantMaxRate)
		}
	}
}

func TestParseIEsMisc(t *testing.T) {
	blob := concat(
		ie(ieSSID, 'H', 'o', 'm', 'e'),
		ie(ieDSParameterSet, 11),
		ie(ieCountry, 'T', 'W', ' '),
		ie(ieBSSLoad, 5, 0, 128, 0, 0),
		ie(ieMobilityDomain, 1, 2, 3),
		ie(ieRMEnabledCaps, 0, 0, 0, 0, 0),
		ie(ieExtCapabilities, 0, 0, 0x08),
		ie(ieVendorSpecific, 0x00, 0x50, 0xF2, 4, 0x10),
	)
	e := parseIEs(blob)
	if string(e.SSID) != "Home" || !e.HasSSID {
		t.Errorf("SSID = %q", e.SSID)
	}
	if e.DSChannel != 11 {
		t.Errorf("DSChannel = %d, want 11", e.DSChannel)
	}
	if e.Country != "TW" {
		t.Errorf("Country = %q, want TW", e.Country)
	}
	if e.StationCount == nil || *e.StationCount != 5 {
		t.Errorf("StationCount = %v, want 5", e.StationCount)
	}
	if e.ChannelUtilization == nil || *e.ChannelUtilization != 50 {
		t.Errorf("ChannelUtilization = %v, want 50", e.ChannelUtilization)
	}
	if !e.WPS {
		t.Error("WPS not detected")
	}
	want := []string{"802.11k", "802.11v", "802.11r"}
	if len(e.Roaming) != len(want) {
		t.Fatalf("Roaming = %v, want %v", e.Roaming, want)
	}
	for i := range want {
		if e.Roaming[i] != want[i] {
			t.Errorf("Roaming = %v, want %v", e.Roaming, want)
		}
	}

	//An invalid country code is ignored
	if c := parseIEs(ie(ieCountry, 0xFF, 'W', ' ')).Country; c != "" {
		t.Errorf("invalid country parsed as %q", c)
	}
}

// TestParseIEsTruncated feeds every prefix of a full IE blob, and every blob
// with one length byte changed, to the parser: it must never panic.
func TestParseIEsTruncated(t *testing.T) {
	blob := concat(
		ie(ieSSID, 'x'), htCaps(2), ie(ieHTOperation, 36, 0x05),
		rsnIE([]byte{4, 2}, []byte{2, 8}, 0xC0), wpaIE([]byte{2}, []byte{2}),
		vhtCaps(2, 2), ie(ieVHTOperation, 1, 42, 50), heCaps(2, 2),
		ieExt(ieExtHEOperation, 0, 0xC0, 0x02, 0, 0, 0, 0, 0, 0, 37, 0x03, 39, 47, 0),
		ieExt(ieExtEHTOperation, 0x01, 0, 0, 0, 0, 0x04, 31, 63),
		ie(ieBSSLoad, 1, 0, 9, 0, 0), ie(ieCountry, 'U', 'S'),
	)
	for i := 0; i <= len(blob); i++ {
		parseIEs(blob[:i])
	}
	for i := range blob {
		for _, v := range []byte{0, 1, 2, 3, 4, 0x7F, 0xFF} {
			mutated := append([]byte{}, blob...)
			mutated[i] = v
			parseIEs(mutated)
			ratesFromIE(mutated)
		}
	}
	//Element bodies on their own
	for i := 0; i < 40; i++ {
		body := make([]byte, i)
		for j := range body {
			body[j] = 0xFF
		}
		parseCipherSuites(body, true)
		parseCipherSuites(body, false)
		e := bssElements{}
		e.parseHEOperation(body)
	}
}

func TestLegacyRates(t *testing.T) {
	basic, all, max := legacyRates([]uint16{0x8002, 0x8004, 0x800B, 0x8016, 12, 18, 0, 0x8002})
	wantBasic := []string{"1", "2", "5.5", "11"}
	wantAll := []string{"1", "2", "5.5", "11", "6", "9"}
	if len(basic) != len(wantBasic) || len(all) != len(wantAll) {
		t.Fatalf("legacyRates = %v / %v", basic, all)
	}
	for i := range wantBasic {
		if basic[i] != wantBasic[i] {
			t.Errorf("basic = %v, want %v", basic, wantBasic)
		}
	}
	for i := range wantAll {
		if all[i] != wantAll[i] {
			t.Errorf("all = %v, want %v", all, wantAll)
		}
	}
	if max != 11 {
		t.Errorf("max = %v, want 11", max)
	}

	rates := ratesFromIE(concat(ie(ieSupportedRates, 0x82, 0x0C), ie(ieExtSupportedRate, 0x6C)))
	if len(rates) != 3 || rates[0] != 0x8002 || rates[1] != 12 || rates[2] != 108 {
		t.Errorf("ratesFromIE = %v", rates)
	}
}

func TestChannelHelpers(t *testing.T) {
	cases := []struct {
		mhz     int
		band    string
		channel int
	}{
		{2412, "2.4 GHz", 1},
		{2437, "2.4 GHz", 6},
		{2472, "2.4 GHz", 13},
		{2484, "2.4 GHz", 14},
		{5180, "5 GHz", 36},
		{5745, "5 GHz", 149},
		{5885, "5 GHz", 177},
		{4920, "5 GHz", 184},
		{5935, "6 GHz", 2},
		{5955, "6 GHz", 1},
		{6135, "6 GHz", 37},
		{7115, "6 GHz", 233},
		{60480, "60 GHz", 2},
		{1000, "", 0},
	}
	for _, tc := range cases {
		if got := bandOfFrequency(tc.mhz); got != tc.band {
			t.Errorf("bandOfFrequency(%d) = %q, want %q", tc.mhz, got, tc.band)
		}
		if got := channelOfFrequency(tc.mhz); got != tc.channel {
			t.Errorf("channelOfFrequency(%d) = %d, want %d", tc.mhz, got, tc.channel)
		}
	}

	freqCases := []struct {
		ch     int
		sixGHz bool
		want   int
	}{
		{1, false, 2412}, {14, false, 2484}, {36, false, 5180}, {165, false, 5825},
		{184, false, 4920}, {1, true, 5955}, {2, true, 5935}, {37, true, 6135}, {0, false, 0}, {300, false, 0},
	}
	for _, tc := range freqCases {
		if got := frequencyOfChannel(tc.ch, tc.sixGHz); got != tc.want {
			t.Errorf("frequencyOfChannel(%d, %v) = %d, want %d", tc.ch, tc.sixGHz, got, tc.want)
		}
	}
}

func TestQualityConversions(t *testing.T) {
	cases := []struct {
		dbm     int
		quality int
	}{
		{0, -1}, {-30, 100}, {-50, 100}, {-60, 80}, {-75, 50}, {-100, 0}, {-110, 0},
	}
	for _, tc := range cases {
		if got := qualityFromRSSI(tc.dbm); got != tc.quality {
			t.Errorf("qualityFromRSSI(%d) = %d, want %d", tc.dbm, got, tc.quality)
		}
	}
	if got := rssiFromQuality(80); got != -60 {
		t.Errorf("rssiFromQuality(80) = %d, want -60", got)
	}
	if got := rssiFromQuality(-1); got != 0 {
		t.Errorf("rssiFromQuality(-1) = %d, want 0", got)
	}
}

func TestSSIDString(t *testing.T) {
	cases := []struct {
		in     []byte
		want   string
		hidden bool
	}{
		{nil, "", true},
		{[]byte{0, 0, 0}, "", true},
		{[]byte("Cafe"), "Cafe", false},
		{[]byte{0xE5, 0xAE, 0xB6}, "\u5bb6", false},
		{[]byte{'a', 0xFF}, "a\uFFFD", false},
	}
	for _, tc := range cases {
		got, hidden := ssidString(tc.in)
		if got != tc.want || hidden != tc.hidden {
			t.Errorf("ssidString(%v) = (%q, %v), want (%q, %v)", tc.in, got, hidden, tc.want, tc.hidden)
		}
	}
}
