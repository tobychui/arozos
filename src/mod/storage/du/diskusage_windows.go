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
func NewDiskUsage(volumePath string) (out0 *DiskUsage) {
	defer logger.Out1(logger.In1("storage/du", "NewDiskUsage", "volumePath", volumePath), &out0)

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
func (du *DiskUsage) Free() (out0 uint64) {
	defer logger.Out1(logger.In1("storage/du", "DiskUsage.Free", "du", du), &out0)
	return uint64(du.freeBytes)
}

// Available returns total available bytes on file system to an unprivileged user
func (du *DiskUsage) Available() (out0 uint64) {
	defer logger.Out1(logger.In1("storage/du", "DiskUsage.Available", "du", du), &out0)
	return uint64(du.availBytes)
}

// Size returns total size of the file system
func (du *DiskUsage) Size() (out0 uint64) {
	defer logger.Out1(logger.In1("storage/du", "DiskUsage.Size", "du", du), &out0)
	return uint64(du.totalBytes)
}

// Used returns total bytes used in file system
func (du *DiskUsage) Used() (out0 uint64) {
	defer logger.Out1(logger.In1("storage/du", "DiskUsage.Used", "du", du), &out0)
	return du.Size() - du.Free()
}

// Usage returns percentage of use on the file system
func (du *DiskUsage) Usage() (out0 float32) {
	defer logger.Out1(logger.In1("storage/du", "DiskUsage.Usage", "du", du), &out0)
	return float32(du.Used()) / float32(du.Size())
}
