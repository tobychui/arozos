//go:build !linux && !darwin && !windows
// +build !linux,!darwin,!windows

package network

import "net"

// nicExtraAll returns enhanced NIC details for platforms where no specific
// implementation exists (FreeBSD, OpenBSD, Plan 9, etc.).
// OperState is derived from interface flags; Speed and Duplex are N/A.
func nicExtraAll(ifaces []net.Interface) map[string]nicExtraInfo {
	result := make(map[string]nicExtraInfo, len(ifaces))
	for _, iface := range ifaces {
		state := "down"
		if iface.Flags&net.FlagUp != 0 {
			state = "up"
		}
		result[iface.Name] = nicExtraInfo{OperState: state, Speed: "N/A", Duplex: "N/A"}
	}
	return result
}
