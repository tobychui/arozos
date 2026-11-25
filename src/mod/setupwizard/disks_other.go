//go:build !linux

package setupwizard

import "imuslab.com/arozos/mod/info/logger"

// Supported reports whether this platform can list, format and mount disks.
// Elsewhere the wizard offers to use a folder as a drive instead.
const Supported = false

// ListDisks is only available on Linux
func ListDisks(used []UsedDrive) ([]Disk, error) {
	logger.DebugTrace("setupwizard", "ListDisks")
	return nil, ErrUnsupported
}

// Format is only available on Linux
func Format(device string, fstype string, label string, used []UsedDrive) error {
	logger.DebugTrace("setupwizard", "Format")
	return ErrUnsupported
}

// PrepareMountPoint is only available on Linux
func PrepareMountPoint(id string) (string, error) {
	logger.DebugTrace("setupwizard", "PrepareMountPoint")
	return "", ErrUnsupported
}
