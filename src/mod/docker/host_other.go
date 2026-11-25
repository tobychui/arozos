//go:build !linux && !darwin && !freebsd && !windows

package docker

import "imuslab.com/arozos/mod/info/logger"

/*
	host_other.go

	Catch-all host-stats helpers for any GOOS not covered by host_linux.go,
	host_bsd.go (darwin/freebsd) or host_windows.go. These report "unavailable"
	so the Docker Manager overview cards degrade gracefully instead of failing to
	build, keeping the package portable per the project's cross-platform rule.
*/

// hostStorageUsage is not wired up on this platform.
func hostStorageUsage() (int64, int64, bool) {
	logger.DebugTrace("docker", "hostStorageUsage")
	return 0, 0, false
}

// hostLoadAvg is not wired up on this platform.
func hostLoadAvg() (float64, float64, float64, bool) {
	logger.DebugTrace("docker", "hostLoadAvg")
	return 0, 0, 0, false
}
