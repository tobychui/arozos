package du

import (
	"syscall"
	"unsafe"

	"imuslab.com/arozos/mod/info/logger"
)

type DiskUsage struct {
	freeBytes  int64
	totalBytes int64
	availBytes int64
}

// NewDiskUsages returns an object holding the disk usage of volumePath
// or nil in case of error (invalid path, etc)
func NewDiskUsage(volumePath string) *DiskUsage {
	if logger.IsDebug() {
		logger.Debugf("storage/du", "NewDiskUsage: volumePath=%.120q", volumePath)
	}

	h := syscall.MustLoadDLL("kernel32.dll")
	c := h.MustFindProc("GetDiskFreeSpaceExW")

	du := &DiskUsage{}

	c.Call(
		uintptr(unsafe.Pointer(syscall.StringToUTF16Ptr(volumePath))),
		uintptr(unsafe.Pointer(&du.freeBytes)),
		uintptr(unsafe.Pointer(&du.totalBytes)),
		uintptr(unsafe.Pointer(&du.availBytes)))

	return du
}

// Free returns total free bytes on file system
func (du *DiskUsage) Free() uint64 {
	logger.DebugTrace("storage/du", "DiskUsage.Free")
	return uint64(du.freeBytes)
}

// Available returns total available bytes on file system to an unprivileged user
func (du *DiskUsage) Available() uint64 {
	logger.DebugTrace("storage/du", "DiskUsage.Available")
	return uint64(du.availBytes)
}

// Size returns total size of the file system
func (du *DiskUsage) Size() uint64 {
	logger.DebugTrace("storage/du", "DiskUsage.Size")
	return uint64(du.totalBytes)
}

// Used returns total bytes used in file system
func (du *DiskUsage) Used() uint64 {
	logger.DebugTrace("storage/du", "DiskUsage.Used")
	return du.Size() - du.Free()
}

// Usage returns percentage of use on the file system
func (du *DiskUsage) Usage() float32 {
	logger.DebugTrace("storage/du", "DiskUsage.Usage")
	return float32(du.Used()) / float32(du.Size())
}
