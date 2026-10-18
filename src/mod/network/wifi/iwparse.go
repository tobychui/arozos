package wifi

/*
	Linux wireless tool output parsers

	Pure text parsers for the output of "iwlist <if> scan" and
	"iw dev <if> link", kept free of build tags so they are tested on every
	platform. The commands themselves are run from wifi_linux.go.
*/

import (
	"encoding/hex"
	"regexp"
	"strconv"
	"strings"
)

var (
	reIwQuality   = regexp.MustCompile(`Quality[=:](\d+)/(\d+)`)
	reIwSignalDBm = regexp.MustCompile(`Signal level[=:](-?\d+(?:\.\d+)?) ?dBm`)
	reIwSignalRel = regexp.MustCompile(`Signal level[=:](\d+)/(\d+)`)
	reIwChannel   = regexp.MustCompile(`\(Channel (\d+)\)`)
	reIwRate      = regexp.MustCompile(`([\d.]+) Mb/s`)
	reIwSuiteNum  = regexp.MustCompile(`unknown \((\d+)\)`)
	reIwWidth     = regexp.MustCompile(`(\d+)MHz`)
	reLeadingInt  = regexp.MustCompile(`^\s*(-?\d+)`)
)

// iwlistCell collects one "Cell" of iwlist output
type iwlistCell struct {
	info     WiFiInfo
	rawIEs   []byte
	section  string //"rsn" or "wpa" while inside a decoded IE
	hasRSN   bool
	hasWPA   bool
	rsnAKMs  []uint32
	wpaAKMs  []uint32
	rsnCiphs []uint32
	wpaCiphs []uint32
	rates    []uint16
	inRates  bool
	tsf      uint64
}

// parseIwlistScan parses the output of "iwlist <interface> scan"
func parseIwlistScan(out string) []WiFiInfo {
	results := []WiFiInfo{}
	var cur *iwlistCell
	flush := func() {
		if cur != nil && cur.info.Address != "" {
			results = append(results, cur.finish())
		}
		cur = nil
	}

	for _, raw := range strings.Split(out, "\n") {
		line := strings.TrimSpace(raw)
		if strings.HasPrefix(line, "Cell ") && strings.Contains(line, "Address:") {
			flush()
			cur = &iwlistCell{}
			fields := strings.Fields(line)
			cur.info.Address = strings.ToLower(fields[len(fields)-1])
			cur.info.QualityPercent = -1
			continue
		}
		if cur == nil || line == "" {
			continue
		}

		//Bit rates continue on the following lines
		if cur.inRates && !strings.Contains(line, ":") && reIwRate.MatchString(line) {
			cur.addRates(line)
			continue
		}
		cur.inRates = false

		switch {
		case strings.HasPrefix(line, "Channel:"):
			if ch, err := strconv.Atoi(strings.TrimSpace(line[len("Channel:"):])); err == nil {
				cur.info.Channel = ch
			}
		case strings.HasPrefix(line, "Frequency:"):
			value := strings.TrimSpace(line[len("Frequency:"):])
			cur.info.FrequencyMHz = parseFrequencyMHz(value)
			if m := reIwChannel.FindStringSubmatch(value); m != nil {
				cur.info.Channel, _ = strconv.Atoi(m[1])
			}
		case strings.HasPrefix(line, "Quality"):
			if m := reIwQuality.FindStringSubmatch(line); m != nil {
				cur.info.Quality = m[1] + "/" + m[2]
				a, _ := strconv.Atoi(m[1])
				b, _ := strconv.Atoi(m[2])
				if b > 0 {
					cur.info.QualityPercent = a * 100 / b
				}
			}
			if m := reIwSignalDBm.FindStringSubmatch(line); m != nil {
				dbm, _ := strconv.ParseFloat(m[1], 64)
				cur.info.SignalDBm = int(dbm)
				cur.info.SignalLevel = strconv.Itoa(cur.info.SignalDBm) + " dBm"
			} else if m := reIwSignalRel.FindStringSubmatch(line); m != nil {
				cur.info.SignalLevel = m[1] + "/" + m[2]
			}
		case strings.HasPrefix(line, "Encryption key:"):
			cur.info.EncryptionKey = strings.TrimSpace(line[len("Encryption key:"):]) == "on"
		case strings.HasPrefix(line, "ESSID:"):
			value := strings.TrimSpace(line[len("ESSID:"):])
			value = strings.TrimSuffix(strings.TrimPrefix(value, "\""), "\"")
			ssid, hidden := ssidString(unescapeIwString(value))
			cur.info.ESSID = ssid
			cur.info.Hidden = hidden
		case strings.HasPrefix(line, "Mode:"):
			switch strings.TrimSpace(line[len("Mode:"):]) {
			case "Master":
				cur.info.BSSType = "Infrastructure"
			case "Ad-Hoc":
				cur.info.BSSType = "Ad hoc"
			}
		case strings.HasPrefix(line, "Bit Rates:"):
			cur.inRates = true
			cur.addRates(line)
		case strings.HasPrefix(line, "IE: IEEE 802.11i/WPA2"):
			cur.section = "rsn"
			cur.hasRSN = true
		case strings.HasPrefix(line, "IE: WPA Version"):
			cur.section = "wpa"
			cur.hasWPA = true
		case strings.HasPrefix(line, "IE: Unknown:"):
			cur.section = ""
			if b, err := hex.DecodeString(strings.TrimSpace(line[len("IE: Unknown:"):])); err == nil {
				cur.rawIEs = append(cur.rawIEs, b...)
			}
		case strings.HasPrefix(line, "IE:"):
			cur.section = ""
		case strings.HasPrefix(line, "Pairwise Ciphers"):
			ciphers := parseIwSuiteList(line, map[string]uint32{"WEP-40": 1, "TKIP": 2, "WRAP": 3, "CCMP": 4, "WEP-104": 5})
			if cur.section == "rsn" {
				cur.rsnCiphs = ciphers
			} else if cur.section == "wpa" {
				cur.wpaCiphs = ciphers
			}
		case strings.HasPrefix(line, "Authentication Suites"):
			akms := parseIwSuiteList(line, map[string]uint32{"802.1x": 1, "PSK": 2})
			if cur.section == "rsn" {
				cur.rsnAKMs = akms
			} else if cur.section == "wpa" {
				cur.wpaAKMs = akms
			}
		case strings.HasPrefix(line, "Extra:tsf="):
			if v, err := strconv.ParseUint(strings.TrimSpace(line[len("Extra:tsf="):]), 16, 64); err == nil {
				cur.tsf = v
			}
		}
	}
	flush()
	return results
}

func (c *iwlistCell) addRates(line string) {
	for _, m := range reIwRate.FindAllStringSubmatch(line, -1) {
		if v, err := strconv.ParseFloat(m[1], 64); err == nil && v > 0 {
			c.rates = append(c.rates, uint16(v*2))
		}
	}
}

// finish combines the decoded fields with what the raw IEs reveal
func (c *iwlistCell) finish() WiFiInfo {
	info := c.info
	el := parseIEs(c.rawIEs)
	if c.hasRSN {
		el.HasRSN = true
		el.rsnAKMs = c.rsnAKMs
		el.ciphers = c.rsnCiphs
	}
	if c.hasWPA {
		el.HasWPA = true
		el.wpaAKMs = c.wpaAKMs
		if !c.hasRSN {
			el.ciphers = c.wpaCiphs
		}
	}
	if info.ESSID == "" && !info.Hidden && el.HasSSID {
		info.ESSID, info.Hidden = ssidString(el.SSID)
	}

	rates := c.rates
	if len(rates) == 0 {
		rates = ratesFromIE(c.rawIEs)
	}
	_, all, legacyMax := legacyRates(rates)
	info.SupportedRates = all

	normalizeWiFiInfo(&info)
	phy, generation, width, center := el.phyInfo(info.Band, legacyMax)
	info.PHYType = phy
	info.Generation = generation
	info.ChannelWidth = width
	if width > 20 {
		info.CenterChannel = center
	}
	streams := el.spatialStreams()
	maxMCS := el.heMaxMCS
	if phy == "802.11ac" {
		maxMCS = el.vhtMaxMCS
	}
	info.SpatialStreams = streams
	info.MaxRateMbps = estimateMaxRate(phy, width, streams, maxMCS, legacyMax)
	info.Security = el.securityName(info.EncryptionKey)
	info.Cipher = el.cipherName(info.EncryptionKey)
	info.PMF = el.PMF
	info.Country = el.Country
	info.StationCount = el.StationCount
	info.ChannelUtilization = el.ChannelUtilization
	info.WPS = el.WPS
	info.Roaming = el.Roaming
	info.UptimeSeconds = int64(c.tsf / 1000000)
	return info
}

// parseIwSuiteList reads the names after the colon of an iwlist
// "Pairwise Ciphers (n) : ..." or "Authentication Suites (n) : ..." line
func parseIwSuiteList(line string, names map[string]uint32) []uint32 {
	i := strings.Index(line, ":")
	if i < 0 {
		return nil
	}
	value := line[i+1:]
	list := []uint32{}
	for _, m := range reIwSuiteNum.FindAllStringSubmatch(value, -1) {
		if v, err := strconv.Atoi(m[1]); err == nil {
			list = append(list, uint32(v))
		}
	}
	value = reIwSuiteNum.ReplaceAllString(value, "")
	for _, f := range strings.Fields(value) {
		if v, ok := names[f]; ok {
			list = append(list, v)
		}
	}
	return list
}

// unescapeIwString decodes the \xNN escapes iw / iwlist use for SSID bytes
func unescapeIwString(s string) []byte {
	out := []byte{}
	for i := 0; i < len(s); i++ {
		if s[i] == '\\' && i+3 < len(s) && s[i+1] == 'x' {
			if b, err := hex.DecodeString(s[i+2 : i+4]); err == nil {
				out = append(out, b[0])
				i += 3
				continue
			}
		}
		out = append(out, s[i])
	}
	return out
}

// parseFrequencyMHz reads "2.412 GHz", "5180 MHz", "5180" or "5180.0"
func parseFrequencyMHz(s string) int {
	fields := strings.Fields(strings.TrimSpace(s))
	if len(fields) == 0 {
		return 0
	}
	v, err := strconv.ParseFloat(fields[0], 64)
	if err != nil || v <= 0 {
		return 0
	}
	if len(fields) > 1 && strings.EqualFold(fields[1], "GHz") || len(fields) == 1 && v < 100 {
		v *= 1000
	}
	return int(v + 0.5)
}

// iwLinkInfo is the parsed output of "iw dev <interface> link"
type iwLinkInfo struct {
	Connected  bool
	BSSID      string
	SSID       string
	Hidden     bool
	FreqMHz    int
	SignalDBm  int
	RxRateMbps float64
	TxRateMbps float64
	Width      int
	PHYType    string
	BeaconInt  int
}

// parseIwLink parses the output of "iw dev <interface> link"
func parseIwLink(out string) iwLinkInfo {
	link := iwLinkInfo{}
	for _, raw := range strings.Split(out, "\n") {
		line := strings.TrimSpace(raw)
		key, value, found := strings.Cut(line, ":")
		value = strings.TrimSpace(value)
		switch {
		case strings.HasPrefix(line, "Connected to "):
			fields := strings.Fields(line)
			if len(fields) >= 3 {
				link.Connected = true
				link.BSSID = strings.ToLower(fields[2])
			}
		case !found:
			continue
		case key == "SSID":
			link.SSID, link.Hidden = ssidString(unescapeIwString(value))
		case key == "freq":
			link.FreqMHz = parseFrequencyMHz(value)
		case key == "signal":
			if m := reLeadingInt.FindStringSubmatch(value); m != nil {
				link.SignalDBm, _ = strconv.Atoi(m[1])
			}
		case key == "rx bitrate" || key == "tx bitrate":
			rate := 0.0
			if f := strings.Fields(value); len(f) > 0 {
				rate, _ = strconv.ParseFloat(f[0], 64)
			}
			if key == "rx bitrate" {
				link.RxRateMbps = rate
			} else {
				link.TxRateMbps = rate
			}
			if m := reIwWidth.FindStringSubmatch(value); m != nil {
				if w, _ := strconv.Atoi(m[1]); w > link.Width {
					link.Width = w
				}
			}
			if phy := phyOfBitrate(value); phy != "" {
				link.PHYType = phy
			}
		case key == "beacon int":
			link.BeaconInt, _ = strconv.Atoi(value)
		}
	}
	return link
}

// phyOfBitrate maps the MCS type in an iw bitrate line to the 802.11 amendment
func phyOfBitrate(s string) string {
	switch {
	case strings.Contains(s, "EHT-MCS"):
		return "802.11be"
	case strings.Contains(s, "HE-MCS"):
		return "802.11ax"
	case strings.Contains(s, "VHT-MCS"):
		return "802.11ac"
	case strings.Contains(s, "MCS"):
		return "802.11n"
	}
	return ""
}

// parseProcRoute returns the default gateways of an interface from the
// content of /proc/net/route
func parseProcRoute(content string, iface string) []string {
	gateways := []string{}
	for _, line := range strings.Split(content, "\n") {
		f := strings.Fields(line)
		if len(f) < 3 || f[0] != iface || f[1] != "00000000" {
			continue
		}
		b, err := hex.DecodeString(f[2])
		if err != nil || len(b) != 4 {
			continue
		}
		ip := strconv.Itoa(int(b[3])) + "." + strconv.Itoa(int(b[2])) + "." + strconv.Itoa(int(b[1])) + "." + strconv.Itoa(int(b[0]))
		if ip != "0.0.0.0" && !containsString(gateways, ip) {
			gateways = append(gateways, ip)
		}
	}
	return gateways
}

// normalizeWiFiInfo fills the numeric fields of a scan result from the
// string fields when the platform parser did not set them
func normalizeWiFiInfo(info *WiFiInfo) {
	if info.SignalDBm == 0 {
		if m := reLeadingInt.FindStringSubmatch(info.SignalLevel); m != nil && strings.Contains(info.SignalLevel, "dBm") {
			info.SignalDBm, _ = strconv.Atoi(m[1])
		}
	}
	if info.QualityPercent <= 0 {
		info.QualityPercent = -1
		if m := reIwQuality.FindStringSubmatch("Quality=" + info.Quality); m != nil {
			a, _ := strconv.Atoi(m[1])
			b, _ := strconv.Atoi(m[2])
			if b > 0 {
				info.QualityPercent = a * 100 / b
			}
		}
		if info.QualityPercent < 0 && info.SignalDBm != 0 {
			info.QualityPercent = qualityFromRSSI(info.SignalDBm)
		}
	}
	if info.FrequencyMHz == 0 {
		info.FrequencyMHz = parseFrequencyMHz(info.Frequency)
		if bandOfFrequency(info.FrequencyMHz) == "" {
			info.FrequencyMHz = 0
		}
	}
	if info.FrequencyMHz == 0 && info.Channel > 0 {
		info.FrequencyMHz = frequencyOfChannel(info.Channel, false)
	}
	if info.Channel <= 0 && info.FrequencyMHz > 0 {
		info.Channel = channelOfFrequency(info.FrequencyMHz)
	}
	if info.FrequencyMHz > 0 {
		info.Band = bandOfFrequency(info.FrequencyMHz)
		info.Frequency = formatFrequency(info.FrequencyMHz)
	}
	if info.Generation == "" {
		info.Generation = generationOfPHY(info.PHYType, info.Band)
	}
}
