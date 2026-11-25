//go:build linux
// +build linux

package network

import (
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

// readSysNet reads a sysfs network attribute for the given interface.
// Returns "" on any error — absent on minimal embedded systems
// (busybox, Yocto builds without sysfs, etc.).
func readSysNet(ifaceName, attr string) (out0 string) {
	defer logger.Out1(logger.In2("network", "readSysNet", "ifaceName", ifaceName, "attr", attr), &out0)
	data, err := os.ReadFile("/sys/class/net/" + ifaceName + "/" + attr)
	if err != nil {
		logger.DebugErr("network", err)
		return ""
	}
	return strings.TrimSpace(string(data))
}

func formatMbps(mbps int) (out0 string) {
	defer logger.Out1(logger.In1("network", "formatMbps", "mbps", mbps), &out0)
	if mbps >= 1000 {
		if mbps%1000 == 0 {
			return fmt.Sprintf("%d Gbps", mbps/1000)
		}
		return fmt.Sprintf("%.1f Gbps", float64(mbps)/1000.0)
	}
	return fmt.Sprintf("%d Mbps", mbps)
}

// nicExtraAll returns enhanced NIC details for all interfaces using Linux sysfs.
// Gracefully returns N/A fields when sysfs attributes are unavailable
// (e.g. on embedded platforms without /sys/class/net/).
func nicExtraAll(ifaces []net.Interface) (out0 map[string]nicExtraInfo) {
	defer logger.Out1(logger.In1("network", "nicExtraAll", "ifaces", ifaces), &out0)
	result := make(map[string]nicExtraInfo, len(ifaces))
	for _, iface := range ifaces {
		// OperState: sysfs --> flag fallback
		state := readSysNet(iface.Name, "operstate")
		if state == "" {
			if iface.Flags&net.FlagUp != 0 {
				state = "up"
			} else {
				state = "down"
			}
		}

		// Speed
		speed := "N/A"
		if raw := readSysNet(iface.Name, "speed"); raw != "" {
			if mbps, err := strconv.Atoi(raw); err == nil && mbps > 0 {
				speed = formatMbps(mbps)
			}
		}

		// Duplex
		duplex := "N/A"
		switch strings.ToLower(readSysNet(iface.Name, "duplex")) {
		case "full":
			duplex = "Full"
		case "half":
			duplex = "Half"
		}

		result[iface.Name] = nicExtraInfo{OperState: state, Speed: speed, Duplex: duplex}
	}
	return result
}
