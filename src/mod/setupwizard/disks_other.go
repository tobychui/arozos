//go:build !linux

package setupwizard

import "imuslab.com/arozos/mod/info/logger"

// Supported reports whether this platform can list, format and mount disks.
// Elsewhere the wizard offers to use a folder as a drive instead.
const Supported = false

// ListDisks is only available on Linux
func ListDisks(used []UsedDrive) ([]Disk, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("setupwizard", "ListDisks: len(used)=%d", len(used))
	}
	return nil, ErrUnsupported
}

// Format is only available on Linux
func Format(device string, fstype string, label string, used []UsedDrive) error {
	if logger.IsDebugTrace() {
		logger.DebugTracef("setupwizard", "Format: device=%.120q fstype=%.120q label=%.120q len(used)=%d", device, fstype, label, len(used))
	}
	return ErrUnsupported
}

// PrepareMountPoint is only available on Linux
func PrepareMountPoint(id string) (string, error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("setupwizard", "PrepareMountPoint: id=%.120q", id)
	}
	return "", ErrUnsupported
}
