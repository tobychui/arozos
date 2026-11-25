//go:build linux

package docker

import (
	"os"
	"strconv"
	"strings"
	"syscall"

	"imuslab.com/arozos/mod/info/logger"
)

// hostStorageUsage reports used/total bytes of the filesystem holding the
// current working directory.
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

// hostLoadAvg reads the 1/5/15-minute load averages from /proc/loadavg.
func hostLoadAvg() (out0 float64, out1 float64, out2 float64, out3 bool) {
	defer logger.Out4(logger.In0("docker", "hostLoadAvg"), &out0, &out1, &out2, &out3)
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		logger.DebugErr("docker", err)
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
