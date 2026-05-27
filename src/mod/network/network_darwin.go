//go:build darwin
// +build darwin

package network

import (
	"fmt"
	"net"
	"os/exec"
	"regexp"
	"strconv"
	"strings"
)

var (
	// status: active  /  status: inactive
	reDarwinStatus = regexp.MustCompile(`(?m)^\s*status:\s*(\S+)`)
	// 10Gbase-SR, 25Gbase-LR, etc.  → Gbps
	reDarwinGig = regexp.MustCompile(`(?i)(\d+)[Gg]base`)
	// 1000baseT, 100baseTX, 10baseT  → Mbps
	reDarwinMeg = regexp.MustCompile(`(?i)(\d+)base`)
	// <full-duplex> or <half-duplex>
	reDarwinDuplex = regexp.MustCompile(`(?i)<(full|half)-duplex>`)
)

func formatMbps(mbps int) string {
	if mbps >= 1000 {
		if mbps%1000 == 0 {
			return fmt.Sprintf("%d Gbps", mbps/1000)
		}
		return fmt.Sprintf("%.1f Gbps", float64(mbps)/1000.0)
	}
	return fmt.Sprintf("%d Mbps", mbps)
}

// nicExtraAll returns enhanced NIC details for all interfaces on macOS.
// Uses ifconfig(8) per interface; returns N/A fields when the command
// is unavailable or produces no parseable output.
func nicExtraAll(ifaces []net.Interface) map[string]nicExtraInfo {
	result := make(map[string]nicExtraInfo, len(ifaces))
	for _, iface := range ifaces {
		result[iface.Name] = darwinNICExtra(iface)
	}
	return result
}

func darwinNICExtra(iface net.Interface) nicExtraInfo {
	// Fallback state from Go flags
	state := "down"
	if iface.Flags&net.FlagUp != 0 {
		state = "up"
	}

	out, err := exec.Command("ifconfig", iface.Name).Output()
	if err != nil {
		return nicExtraInfo{OperState: state, Speed: "N/A", Duplex: "N/A"}
	}
	output := string(out)

	// OperState from "status:" line
	if m := reDarwinStatus.FindStringSubmatch(output); len(m) > 1 {
		switch strings.ToLower(m[1]) {
		case "active":
			state = "up"
		case "inactive":
			state = "down"
		default:
			state = strings.ToLower(m[1])
		}
	}

	// Speed: try Gbps pattern first (e.g. "10Gbase-SR"),
	// then Mbps pattern (e.g. "1000baseT")
	speed := "N/A"
	if m := reDarwinGig.FindStringSubmatch(output); len(m) > 1 {
		if gbps, err2 := strconv.Atoi(m[1]); err2 == nil && gbps > 0 {
			speed = fmt.Sprintf("%d Gbps", gbps)
		}
	} else if m := reDarwinMeg.FindStringSubmatch(output); len(m) > 1 {
		if mbps, err2 := strconv.Atoi(m[1]); err2 == nil && mbps > 0 {
			speed = formatMbps(mbps)
		}
	}

	// Duplex
	duplex := "N/A"
	if m := reDarwinDuplex.FindStringSubmatch(output); len(m) > 1 {
		if strings.EqualFold(m[1], "full") {
			duplex = "Full"
		} else {
			duplex = "Half"
		}
	}

	return nicExtraInfo{OperState: state, Speed: speed, Duplex: duplex}
}
