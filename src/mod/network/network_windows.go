//go:build windows
// +build windows

package network

import (
	"encoding/json"
	"fmt"
	"net"
	"os/exec"
	"strings"
)

// winAdapter is the JSON shape returned by Get-NetAdapter | ConvertTo-Json.
type winAdapter struct {
	Name       string          `json:"Name"`
	Status     string          `json:"Status"`
	LinkSpeed  json.RawMessage `json:"LinkSpeed"`  // string "1 Gbps" OR uint64 bits/sec
	FullDuplex json.RawMessage `json:"FullDuplex"` // bool or null
}

// nicExtraAll returns enhanced NIC details for all interfaces on Windows.
// Issues a single PowerShell Get-NetAdapter call to minimise process-spawn
// overhead; gracefully returns N/A fields when PowerShell is unavailable
// (minimal Server Core installs, etc.).
func nicExtraAll(ifaces []net.Interface) map[string]nicExtraInfo {
	result := make(map[string]nicExtraInfo, len(ifaces))

	// Populate flag-based fallback defaults first.
	for _, iface := range ifaces {
		state := "down"
		if iface.Flags&net.FlagUp != 0 {
			state = "up"
		}
		result[iface.Name] = nicExtraInfo{OperState: state, Speed: "N/A", Duplex: "N/A"}
	}

	// Single PowerShell call — fetch all adapters at once.
	// @() ensures ConvertTo-Json always outputs an array even for one adapter.
	const script = `$ErrorActionPreference='SilentlyContinue'; ` +
		`@(Get-NetAdapter | Select-Object Name,Status,LinkSpeed,FullDuplex) | ` +
		`ConvertTo-Json -Compress`

	out, err := exec.Command("powershell.exe",
		"-NoProfile", "-NonInteractive", "-Command", script).Output()
	if err != nil {
		return result // keep fallback defaults
	}

	// ConvertTo-Json may still emit a bare object when the pipeline contains
	// exactly one item on older PS versions — normalise to array.
	raw := strings.TrimSpace(string(out))
	if len(raw) > 0 && raw[0] == '{' {
		raw = "[" + raw + "]"
	}

	var adapters []winAdapter
	if jsonErr := json.Unmarshal([]byte(raw), &adapters); jsonErr != nil {
		return result
	}

	for _, a := range adapters {
		if a.Name == "" {
			continue
		}

		// OperState
		state := "down"
		switch strings.ToLower(a.Status) {
		case "up":
			state = "up"
		case "disconnected", "down", "disabled", "not present":
			state = "down"
		case "lower layer down", "dormant":
			state = "dormant"
		default:
			if a.Status != "" {
				state = strings.ToLower(a.Status)
			}
		}

		// LinkSpeed — may be a pre-formatted string ("1 Gbps") or a uint64
		// (bits per second) depending on PS version.
		speed := parseLinkSpeed(a.LinkSpeed)

		// FullDuplex — bool or null
		duplex := "N/A"
		var fd bool
		if jsonErr := json.Unmarshal(a.FullDuplex, &fd); jsonErr == nil {
			if fd {
				duplex = "Full"
			} else {
				duplex = "Half"
			}
		}

		result[a.Name] = nicExtraInfo{OperState: state, Speed: speed, Duplex: duplex}
	}
	return result
}

// parseLinkSpeed converts the Get-NetAdapter LinkSpeed field to a display string.
func parseLinkSpeed(raw json.RawMessage) string {
	if len(raw) == 0 {
		return "N/A"
	}
	// Try string (most PS versions return e.g. "1 Gbps")
	var s string
	if json.Unmarshal(raw, &s) == nil {
		s = strings.TrimSpace(s)
		if s != "" && s != "0 bps" && s != "0" {
			return s
		}
		return "N/A"
	}
	// Fallback: numeric bits-per-second
	var bps float64
	if json.Unmarshal(raw, &bps) == nil && bps > 0 {
		mbps := bps / 1_000_000
		gbps := mbps / 1_000
		if gbps >= 1 {
			if gbps == float64(int(gbps)) {
				return fmt.Sprintf("%d Gbps", int(gbps))
			}
			return fmt.Sprintf("%.1f Gbps", gbps)
		}
		if mbps >= 1 {
			return fmt.Sprintf("%d Mbps", int(mbps))
		}
	}
	return "N/A"
}
