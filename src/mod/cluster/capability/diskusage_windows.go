//go:build windows

package capability

import "imuslab.com/arozos/mod/info/logger"
import "golang.org/x/sys/windows"

// DiskUsage returns the free and total bytes of the volume holding path.
func DiskUsage(path string) (free int64, total int64, err error) {
	defer logger.Out3(logger.In1("cluster/capability", "DiskUsage", "path", path), &free, &total, &err)
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		logger.DebugErr("cluster/capability", err)
		return 0, 0, err
	}
	var freeAvail, totalBytes, totalFree uint64
	if err := windows.GetDiskFreeSpaceEx(p, &freeAvail, &totalBytes, &totalFree); err != nil {
		logger.DebugErr("cluster/capability", err)
		return 0, 0, err
	}
	return int64(freeAvail), int64(totalBytes), nil
}
