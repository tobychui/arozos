//go:build !linux

package setupwizard

// Supported reports whether this platform can list, format and mount disks.
// Elsewhere the wizard offers to use a folder as a drive instead.
const Supported = false

// ListDisks is only available on Linux
func ListDisks(used []UsedDrive) ([]Disk, error) {
	return nil, ErrUnsupported
}

// Format is only available on Linux
func Format(device string, fstype string, label string, used []UsedDrive) error {
	return ErrUnsupported
}

// PrepareMountPoint is only available on Linux
func PrepareMountPoint(id string) (string, error) {
	return "", ErrUnsupported
}
