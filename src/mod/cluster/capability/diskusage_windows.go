//go:build windows

package capability

import "golang.org/x/sys/windows"

// DiskUsage returns the free and total bytes of the volume holding path.
func DiskUsage(path string) (free int64, total int64, err error) {
	p, err := windows.UTF16PtrFromString(path)
	if err != nil {
		return 0, 0, err
	}
	var freeAvail, totalBytes, totalFree uint64
	if err := windows.GetDiskFreeSpaceEx(p, &freeAvail, &totalBytes, &totalFree); err != nil {
		return 0, 0, err
	}
	return int64(freeAvail), int64(totalBytes), nil
}
