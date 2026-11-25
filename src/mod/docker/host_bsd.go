//go:build darwin || freebsd

package docker

import "imuslab.com/arozos/mod/info/logger"
import "syscall"

// hostStorageUsage reports used/total bytes of the filesystem holding the
// current working directory. syscall.Statfs is available on both macOS and
// FreeBSD with the same Statfs_t block-count fields.
func hostStorageUsage() (out0 int64, out1 int64, out2 bool) {
	defer logger.Out3(logger.In0("docker", "hostStorageUsage"), &out0, &out1, &out2)
	var st syscall.Statfs_t
	if err := syscall.Statfs(".", &st); err != nil {
		logger.DebugErr("docker", err)
		return 0, 0, false
	}
	bsize := int64(st.Bsize)
	total := int64(st.Blocks) * bsize
	avail := int64(st.Bavail) * bsize
	if total <= 0 {
		return 0, 0, false
	}
	return total - avail, total, true
}

// hostLoadAvg is not wired up on macOS (getloadavg needs cgo) or FreeBSD (no
// /proc/loadavg); report unavailable so the UI hides the value.
func hostLoadAvg() (float64, float64, float64, bool) {
	logger.DebugTrace("docker", "hostLoadAvg")
	return 0, 0, 0, false
}
