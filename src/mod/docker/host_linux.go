//go:build linux

package docker

import (
	"os"
	"strconv"
	"strings"
	"syscall"
)

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

// hostLoadAvg reads the 1/5/15-minute load averages from /proc/loadavg.
func hostLoadAvg() (float64, float64, float64, bool) {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return 0, 0, 0, false
	}
	f := strings.Fields(string(data))
	if len(f) < 3 {
		return 0, 0, 0, false
	}
	l1, _ := strconv.ParseFloat(f[0], 64)
	l5, _ := strconv.ParseFloat(f[1], 64)
	l15, _ := strconv.ParseFloat(f[2], 64)
	return l1, l5, l15, true
}
