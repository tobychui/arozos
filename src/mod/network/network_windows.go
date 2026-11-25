//go:build windows
// +build windows

package network

import (
	"net"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/info/wininfo"
)

// nicExtraAll returns enhanced NIC details for all interfaces on Windows,
// read through the IP Helper API and an in-process WMI query
// (mod/info/wininfo). It used to start PowerShell's Get-NetAdapter, which
// shared the console ArozOS runs in.
func nicExtraAll(ifaces []net.Interface) map[string]nicExtraInfo {
	if logger.IsDebug() {
		logger.Debugf("network", "nicExtraAll: len(ifaces)=%d", len(ifaces))
	}
	result := make(map[string]nicExtraInfo, len(ifaces))

	// Flag-based fallback for interfaces the API does not report
	for _, iface := range ifaces {
		state := "down"
		if iface.Flags&net.FlagUp != 0 {
			state = "up"
		}
		result[iface.Name] = nicExtraInfo{OperState: state, Speed: "N/A", Duplex: "N/A"}
	}

	adapters, err := wininfo.NetAdapters()
	if err != nil {
		return result
	}
	for _, a := range adapters {
		if a.Name == "" {
			continue
		}
		result[a.Name] = nicExtraInfo{
			OperState: wininfo.OperStateName(a.OperStatus),
			Speed:     wininfo.FormatLinkSpeed(a.Speed),
			Duplex:    wininfo.DuplexName(a.Duplex),
		}
	}
	return result
}
