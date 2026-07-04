//go:build darwin

package docker

import "syscall"

// hostStorageUsage reports used/total bytes of the filesystem holding the
// current working directory.
func hostStorageUsage() (int64, int64, bool) {
	var st syscall.Statfs_t
	if err := syscall.Statfs(".", &st); err != nil {
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

// hostLoadAvg is not wired up on macOS (getloadavg needs cgo); report
// unavailable so the UI hides the value.
func hostLoadAvg() (float64, float64, float64, bool) {
	return 0, 0, 0, false
}
