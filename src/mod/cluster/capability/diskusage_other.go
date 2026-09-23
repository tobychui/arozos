//go:build !linux && !darwin && !freebsd && !windows

package capability

import "errors"

// DiskUsage is not available on this platform; callers treat 0 as unknown.
func DiskUsage(path string) (free int64, total int64, err error) {
	return 0, 0, errors.New("disk usage not supported on this platform")
}
