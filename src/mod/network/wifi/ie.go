package wifi

/*
	802.11 information element parsing

	Beacons and probe responses carry a list of information elements (IEs)
	describing what an access point can do. The OS hands them over as raw
	bytes (the Windows WLAN API does, for every BSS of a scan), so they are
	decoded here, in plain Go, on every platform. The input comes from the air
	and must be treated as untrusted: every read is bounds checked.
*/

import (
	"encoding/binary"
	"fmt"
	"math"
	"strconv"
	"strings"
)

// Element IDs used below
const (
	ieSSID             = 0
	ieSupportedRates   = 1
	ieDSParameterSet   = 3
	ieCountry          = 7
	ieBSSLoad          = 11
	ieHTCapabilities   = 45
	ieRSN              = 48
	ieExtSupportedRate = 50
	ieMobilityDomain   = 54
	ieHTOperation      = 61
	ieRMEnabledCaps    = 70
	ieExtCapabilities  = 127
	ieVHTCapabilities  = 191
	ieVHTOperation     = 192
	ieVendorSpecific   = 221
	ieExtension        = 255

	ieExtHECapabilities  = 35
	ieExtHEOperation     = 36
	ieExtEHTOperation    = 106
	ieExtEHTCapabilities = 108
)

// bssElements is what could be learnt from the IEs of one BSS
type bssElements struct {
	SSID       []byte
	HasSSID    bool
	DSChannel  int
	Country    string
	HasRSN     bool
	HasWPA     bool
	rsnAKMs    []uint32
	wpaAKMs    []uint32
	ciphers    []uint32
	PMF        string
	HT         bool
	VHT        bool
	HE         bool
	EHT        bool
	htWidth    int //20 or 40, 0 when no HT operation element
	vhtWidth   int //80 or 160 when the VHT operation says so
	sixGWidth  int //Width from the HE 6 GHz operation information
	ehtWidth   int //Width from the EHT operation information
	vhtCenter  int
	sixGCenter int
	ehtCenter  int
	htCenter   int

	htStreams  int
	vhtStreams int
	heStreams  int
	vhtMaxMCS  int
	heMaxMCS   int

	StationCount       *int
	ChannelUtilization *int
	WPS                bool
	Roaming            []string
}

// forEachIE walks a list of information elements and calls fn for each
// complete element. A truncated trailing element is ignored.
func forEachIE(b []byte, fn func(id byte, data []byte)) {
	for len(b) >= 2 {
		id := b[0]
		l := int(b[1])
		if len(b)-2 < l {
			return
		}
		fn(id, b[2:2+l])
		b = b[2+l:]
	}
}

// parseIEs decodes the information elements of a beacon / probe response
func parseIEs(b []byte) bssElements {
	e := bssElements{}
	roaming := map[string]bool{}
	forEachIE(b, func(id byte, d []byte) {
		switch id {
		case ieSSID:
			if !e.HasSSID {
				e.HasSSID = true
				e.SSID = append([]byte{}, d...)
			}
		case ieDSParameterSet:
			if len(d) >= 1 {
				e.DSChannel = int(d[0])
			}
		case ieCountry:
			if len(d) >= 2 && isUpperLetter(d[0]) && isUpperLetter(d[1]) {
				e.Country = string(d[:2])
			}
		case ieBSSLoad:
			if len(d) >= 3 {
				count := int(binary.LittleEndian.Uint16(d[0:2]))
				util := int(math.Round(float64(d[2]) * 100 / 255))
				e.StationCount = &count
				e.ChannelUtilization = &util
			}
		case ieHTCapabilities:
			e.HT = true
			//Supported MCS set starts at offset 3, one byte per spatial stream
			if len(d) >= 7 {
				e.htStreams = countNonZero(d[3:7])
			}
		case ieHTOperation:
			e.HT = true
			if len(d) >= 2 {
				primary := int(d[0])
				offset := d[1] & 0x03
				anyWidth := d[1]&0x04 != 0
				e.htWidth = 20
				if anyWidth && offset == 1 {
					e.htWidth = 40
					e.htCenter = primary + 2
				} else if anyWidth && offset == 3 {
					e.htWidth = 40
					e.htCenter = primary - 2
				}
			}
		case ieRSN:
			akms, ciphers, caps, ok := parseCipherSuites(d, true)
			if ok {
				e.HasRSN = true
				e.rsnAKMs = akms
				e.ciphers = ciphers
				if caps&0x0040 != 0 {
					e.PMF = "Required"
				} else if caps&0x0080 != 0 {
					e.PMF = "Capable"
				}
			}
		case ieMobilityDomain:
			roaming["802.11r"] = true
		case ieRMEnabledCaps:
			roaming["802.11k"] = true
		case ieExtCapabilities:
			//Bit 19: BSS transition management
			if len(d) >= 3 && d[2]&0x08 != 0 {
				roaming["802.11v"] = true
			}
		case ieVHTCapabilities:
			e.VHT = true
			if len(d) >= 6 {
				e.vhtStreams, e.vhtMaxMCS = decodeMCSMap(binary.LittleEndian.Uint16(d[4:6]), []int{7, 8, 9})
			}
		case ieVHTOperation:
			e.VHT = true
			if len(d) >= 3 {
				seg0 := int(d[1])
				seg1 := int(d[2])
				switch d[0] {
				case 1:
					e.vhtWidth = 80
					e.vhtCenter = seg0
					if seg1 != 0 {
						e.vhtWidth = 160
						if absInt(seg1-seg0) == 8 {
							e.vhtCenter = seg1
						}
					}
				case 2, 3:
					e.vhtWidth = 160
					e.vhtCenter = seg0
				}
			}
		case ieVendorSpecific:
			if len(d) >= 4 && d[0] == 0x00 && d[1] == 0x50 && d[2] == 0xF2 {
				switch d[3] {
				case 1:
					akms, ciphers, _, ok := parseCipherSuites(d[4:], false)
					if ok {
						e.HasWPA = true
						e.wpaAKMs = akms
						if !e.HasRSN {
							e.ciphers = ciphers
						}
					}
				case 4:
					e.WPS = true
				}
			}
		case ieExtension:
			if len(d) < 1 {
				return
			}
			ext := d[0]
			d = d[1:]
			switch ext {
			case ieExtHECapabilities:
				e.HE = true
				//MAC caps (6) + PHY caps (11), then the Rx HE-MCS map for <= 80 MHz
				if len(d) >= 19 {
					e.heStreams, e.heMaxMCS = decodeMCSMap(binary.LittleEndian.Uint16(d[17:19]), []int{7, 9, 11})
				}
			case ieExtHEOperation:
				e.HE = true
				e.parseHEOperation(d)
			case ieExtEHTCapabilities:
				e.EHT = true
			case ieExtEHTOperation:
				e.EHT = true
				//Parameters (1) + basic EHT-MCS set (4), then the optional operation info
				if len(d) >= 8 && d[0]&0x01 != 0 {
					e.ehtWidth = []int{20, 40, 80, 160, 320, 0, 0, 0}[d[5]&0x07]
					e.ehtCenter = int(d[6])
					if d[7] != 0 {
						e.ehtCenter = int(d[7])
					}
				}
			}
		}
	})

	for _, r := range []string{"802.11k", "802.11v", "802.11r"} {
		if roaming[r] {
			e.Roaming = append(e.Roaming, r)
		}
	}
	return e
}

// parseHEOperation reads the 6 GHz operation information of an HE operation element
func (e *bssElements) parseHEOperation(d []byte) {
	if len(d) < 6 {
		return
	}
	params := uint32(d[0]) | uint32(d[1])<<8 | uint32(d[2])<<16
	p := 6 //Parameters (3) + BSS color (1) + basic HE-MCS set (2)
	if params&(1<<14) != 0 {
		p += 3 //VHT operation information
	}
	if params&(1<<15) != 0 {
		p++ //Co-hosted BSS
	}
	if params&(1<<17) == 0 || len(d) < p+4 {
		return
	}
	e.sixGWidth = []int{20, 40, 80, 160}[d[p+1]&0x03]
	e.sixGCenter = int(d[p+2])
	if e.sixGWidth == 160 && d[p+3] != 0 {
		e.sixGCenter = int(d[p+3])
	}
}

// parseCipherSuites decodes an RSN element, or the body of a WPA (v1) vendor
// element after its OUI and type. It returns the AKM suite types, the pairwise
// cipher types and (RSN only) the capability field.
func parseCipherSuites(d []byte, rsn bool) (akms []uint32, ciphers []uint32, caps uint16, ok bool) {
	oui := []byte{0x00, 0x0F, 0xAC}
	if !rsn {
		oui = []byte{0x00, 0x50, 0xF2}
	}
	if len(d) < 2 {
		return nil, nil, 0, false
	}
	d = d[2:] //Version
	if len(d) < 4 {
		//Only the version: the defaults (CCMP / 802.1X) for RSN
		if rsn {
			return []uint32{1}, []uint32{4}, 0, true
		}
		return nil, nil, 0, true
	}
	d = d[4:] //Group data cipher

	readList := func() ([]uint32, bool) {
		if len(d) < 2 {
			return nil, false
		}
		n := int(binary.LittleEndian.Uint16(d[0:2]))
		d = d[2:]
		if n > len(d)/4 {
			return nil, false
		}
		list := []uint32{}
		for i := 0; i < n; i++ {
			s := d[i*4 : i*4+4]
			if s[0] == oui[0] && s[1] == oui[1] && s[2] == oui[2] {
				list = append(list, uint32(s[3]))
			}
		}
		d = d[n*4:]
		return list, true
	}

	ciphers, okList := readList()
	if !okList {
		return nil, nil, 0, true
	}
	akms, okList = readList()
	if !okList {
		return nil, ciphers, 0, true
	}
	if rsn && len(d) >= 2 {
		caps = binary.LittleEndian.Uint16(d[0:2])
	}
	return akms, ciphers, caps, true
}

// decodeMCSMap reads a VHT / HE style MCS map (2 bits per spatial stream,
// 3 = not supported). It returns the stream count and the highest MCS of the
// first stream, picked from maxByCode.
func decodeMCSMap(m uint16, maxByCode []int) (streams int, maxMCS int) {
	for i := 0; i < 8; i++ {
		code := int(m>>(2*i)) & 0x03
		if code == 3 {
			continue
		}
		streams = i + 1
		if i == 0 {
			maxMCS = maxByCode[code]
		}
	}
	return streams, maxMCS
}

// securityName describes the authentication an AP offers
func (e *bssElements) securityName(privacy bool) string {
	has := func(list []uint32, types ...uint32) bool {
		for _, a := range list {
			for _, t := range types {
				if a == t {
					return true
				}
			}
		}
		return false
	}

	if e.HasRSN {
		sae := has(e.rsnAKMs, 8, 9, 24, 25)
		psk := has(e.rsnAKMs, 2, 4, 6)
		suiteB := has(e.rsnAKMs, 12, 13)
		ent := has(e.rsnAKMs, 1, 3, 5)
		owe := has(e.rsnAKMs, 18)
		wpaPrefix := "WPA2"
		if e.HasWPA {
			wpaPrefix = "WPA/WPA2"
		}
		switch {
		case sae && psk:
			return "WPA2/WPA3-Personal"
		case sae:
			return "WPA3-Personal"
		case psk:
			return wpaPrefix + "-Personal"
		case suiteB:
			return "WPA3-Enterprise 192-bit"
		case ent && e.PMF == "Required" && has(e.rsnAKMs, 5) && !has(e.rsnAKMs, 1, 3):
			return "WPA3-Enterprise"
		case ent:
			return wpaPrefix + "-Enterprise"
		case owe:
			return "Enhanced Open (OWE)"
		}
		return "WPA2"
	}
	if e.HasWPA {
		if has(e.wpaAKMs, 1) {
			return "WPA-Enterprise"
		}
		return "WPA-Personal"
	}
	if privacy {
		return "WEP"
	}
	return "Open"
}

// cipherName joins the pairwise ciphers an AP offers
func (e *bssElements) cipherName(privacy bool) string {
	names := []string{}
	for _, c := range e.ciphers {
		n := rsnCipherName(c)
		if n != "" && !containsString(names, n) {
			names = append(names, n)
		}
	}
	if len(names) == 0 && privacy && !e.HasRSN && !e.HasWPA {
		return "WEP"
	}
	return strings.Join(names, " + ")
}

func rsnCipherName(t uint32) string {
	switch t {
	case 1:
		return "WEP-40"
	case 2:
		return "TKIP"
	case 4:
		return "AES-CCMP"
	case 5:
		return "WEP-104"
	case 8:
		return "AES-GCMP"
	case 9:
		return "AES-GCMP-256"
	case 10:
		return "AES-CCMP-256"
	}
	return ""
}

// phyInfo works out the 802.11 amendment, Wi-Fi generation, channel width and
// center channel of a BSS from its elements and band.
func (e *bssElements) phyInfo(band string, legacyMaxRate float64) (phy string, generation string, width int, center int) {
	width = 20
	if e.htWidth > 0 {
		width = e.htWidth
		center = e.htCenter
	}
	if band != "2.4 GHz" && e.vhtWidth > width {
		width = e.vhtWidth
		center = e.vhtCenter
	}
	if band == "6 GHz" && e.sixGWidth > 0 {
		width = e.sixGWidth
		center = e.sixGCenter
	}
	if e.ehtWidth > 0 {
		width = e.ehtWidth
		center = e.ehtCenter
	}

	switch {
	case e.EHT:
		return "802.11be", "Wi-Fi 7", width, center
	case e.HE && band == "6 GHz":
		return "802.11ax", "Wi-Fi 6E", width, center
	case e.HE:
		return "802.11ax", "Wi-Fi 6", width, center
	case e.VHT && band != "2.4 GHz":
		return "802.11ac", "Wi-Fi 5", width, center
	case e.HT:
		return "802.11n", "Wi-Fi 4", width, center
	case band == "60 GHz":
		return "802.11ad", "", width, center
	case band == "5 GHz":
		return "802.11a", "", width, center
	case legacyMaxRate > 11:
		return "802.11g", "", width, center
	case legacyMaxRate > 0:
		return "802.11b", "", width, center
	}
	return "", "", width, center
}

// spatialStreams returns the stream count of the newest PHY the AP supports
func (e *bssElements) spatialStreams() int {
	for _, s := range []int{e.heStreams, e.vhtStreams, e.htStreams} {
		if s > 0 {
			return s
		}
	}
	return 0
}

// estimateMaxRate estimates the highest PHY rate (Mbps) an AP can offer from
// its newest PHY, channel width and spatial streams, using the short guard
// interval rates of the highest MCS it advertises.
func estimateMaxRate(phy string, width int, streams int, maxMCS int, legacyMax float64) float64 {
	if streams <= 0 {
		streams = 1
	}
	col := map[int]int{20: 0, 40: 1, 80: 2, 160: 3, 320: 4}
	c, ok := col[width]
	if !ok {
		c = 0
	}
	var perStream float64
	switch phy {
	case "802.11be":
		perStream = []float64{172.059, 344.118, 720.588, 1441.176, 2882.353}[c]
	case "802.11ax":
		table := map[int][]float64{
			7:  {86.029, 172.059, 360.294, 720.588, 720.588},
			9:  {114.706, 229.412, 480.392, 960.784, 960.784},
			11: {143.382, 286.765, 600.490, 1200.980, 1200.980},
		}
		row, ok := table[maxMCS]
		if !ok {
			row = table[11]
		}
		perStream = row[c]
	case "802.11ac":
		table := map[int][]float64{
			7: {72.222, 150, 325, 650, 650},
			8: {86.667, 180, 390, 780, 780},
			9: {86.667, 200, 433.333, 866.667, 866.667},
		}
		row, ok := table[maxMCS]
		if !ok {
			row = table[9]
		}
		perStream = row[c]
	case "802.11n":
		if streams > 4 {
			streams = 4
		}
		perStream = 72.222
		if width >= 40 {
			perStream = 150
		}
	default:
		return legacyMax
	}
	return math.Round(perStream*float64(streams)*10) / 10
}

// legacyRates splits a rate set (units of 500 kbps, high bit = basic rate)
// into the basic and the full list, formatted in Mbps, plus the highest rate
func legacyRates(rates []uint16) (basic []string, all []string, max float64) {
	basic = []string{}
	all = []string{}
	for _, r := range rates {
		mbps := float64(r&0x7FFF) / 2
		if mbps <= 0 {
			continue
		}
		s := strconv.FormatFloat(mbps, 'f', -1, 64)
		if !containsString(all, s) {
			all = append(all, s)
		}
		if r&0x8000 != 0 && !containsString(basic, s) {
			basic = append(basic, s)
		}
		if mbps > max {
			max = mbps
		}
	}
	return basic, all, max
}

// ratesFromIE reads the supported / extended supported rates elements, which
// use the same encoding as legacyRates but with the basic flag in bit 7
func ratesFromIE(b []byte) []uint16 {
	rates := []uint16{}
	forEachIE(b, func(id byte, d []byte) {
		if id != ieSupportedRates && id != ieExtSupportedRate {
			return
		}
		for _, r := range d {
			v := uint16(r & 0x7F)
			if r&0x80 != 0 {
				v |= 0x8000
			}
			rates = append(rates, v)
		}
	})
	return rates
}

/*
	Channel and band helpers
*/

// bandOfFrequency returns the band a center frequency (MHz) belongs to
func bandOfFrequency(mhz int) string {
	switch {
	case mhz >= 2400 && mhz < 2500:
		return "2.4 GHz"
	case mhz >= 4900 && mhz < 5925:
		return "5 GHz"
	case mhz >= 5925 && mhz <= 7125:
		return "6 GHz"
	case mhz >= 57000 && mhz <= 71000:
		return "60 GHz"
	}
	return ""
}

// channelOfFrequency returns the channel number of a center frequency (MHz)
func channelOfFrequency(mhz int) int {
	switch {
	case mhz == 2484:
		return 14
	case mhz >= 2412 && mhz <= 2472:
		return (mhz - 2407) / 5
	case mhz == 5935:
		return 2
	case mhz > 5950 && mhz <= 7115:
		return (mhz - 5950) / 5
	case mhz >= 4910 && mhz <= 4980:
		return (mhz - 4000) / 5
	case mhz >= 5000 && mhz < 5925:
		return (mhz - 5000) / 5
	case mhz >= 58320 && mhz <= 70200:
		return (mhz - 56160) / 2160
	}
	return 0
}

// frequencyOfChannel guesses the center frequency (MHz) of a channel when
// only the channel number is known. Channels that exist in both the 5 GHz
// and the 6 GHz band resolve to 5 GHz unless sixGHz is set.
func frequencyOfChannel(ch int, sixGHz bool) int {
	switch {
	case ch <= 0:
		return 0
	case sixGHz && ch == 2:
		return 5935
	case sixGHz && ch <= 233:
		return 5950 + ch*5
	case ch == 14:
		return 2484
	case ch < 14:
		return 2407 + ch*5
	case ch >= 182 && ch <= 196:
		return 4000 + ch*5
	case ch <= 177:
		return 5000 + ch*5
	}
	return 0
}

// formatFrequency renders MHz as "5.180 GHz"
func formatFrequency(mhz int) string {
	if mhz <= 0 {
		return ""
	}
	return fmt.Sprintf("%.3f GHz", float64(mhz)/1000)
}

// generationOfPHY maps an 802.11 amendment to its Wi-Fi generation name
func generationOfPHY(phy string, band string) string {
	switch phy {
	case "802.11be":
		return "Wi-Fi 7"
	case "802.11ax":
		if band == "6 GHz" {
			return "Wi-Fi 6E"
		}
		return "Wi-Fi 6"
	case "802.11ac":
		return "Wi-Fi 5"
	case "802.11n":
		return "Wi-Fi 4"
	}
	return ""
}

// qualityFromRSSI maps an RSSI (dBm) to a 0 - 100 quality the way Windows
// does: -100 dBm and below is 0 %, -50 dBm and above is 100 %
func qualityFromRSSI(dbm int) int {
	if dbm == 0 {
		return -1
	}
	q := 2 * (dbm + 100)
	if q < 0 {
		return 0
	}
	if q > 100 {
		return 100
	}
	return q
}

// rssiFromQuality is the inverse of qualityFromRSSI
func rssiFromQuality(q int) int {
	if q < 0 {
		return 0
	}
	return q/2 - 100
}

/*
	Small helpers
*/

// ssidString turns raw SSID bytes into a string, reporting hidden SSIDs
// (empty or all zero) as hidden
func ssidString(b []byte) (string, bool) {
	allZero := true
	for _, c := range b {
		if c != 0 {
			allZero = false
			break
		}
	}
	if len(b) == 0 || allZero {
		return "", true
	}
	return strings.ToValidUTF8(string(b), "\uFFFD"), false
}

func formatMAC(b []byte) string {
	parts := make([]string, len(b))
	for i, c := range b {
		parts[i] = fmt.Sprintf("%02x", c)
	}
	return strings.Join(parts, ":")
}

func isUpperLetter(c byte) bool {
	return c >= 'A' && c <= 'Z'
}

func countNonZero(b []byte) int {
	n := 0
	for _, c := range b {
		if c != 0 {
			n++
		}
	}
	return n
}

func absInt(v int) int {
	if v < 0 {
		return -v
	}
	return v
}

func containsString(list []string, s string) bool {
	for _, v := range list {
		if v == s {
			return true
		}
	}
	return false
}
