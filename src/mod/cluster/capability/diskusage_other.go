//go:build !linux && !darwin && !freebsd && !windows

package capability

import "imuslab.com/arozos/mod/info/logger"
import "errors"

// DiskUsage is not available on this platform; callers treat 0 as unknown.
func DiskUsage(path string) (free int64, total int64, err error) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("cluster/capability", "DiskUsage: path=%.120q", path)
	}
	return 0, 0, errors.New("disk usage not supported on this platform")
}
