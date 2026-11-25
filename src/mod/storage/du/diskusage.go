//go:build !windows
// +build !windows

package du

import "imuslab.com/arozos/mod/info/logger"
import "syscall"

// DiskUsage contains usage data and provides user-friendly access methods
type DiskUsage struct {
	stat *syscall.Statfs_t
}

// NewDiskUsages returns an object holding the disk usage of volumePath
// or nil in case of error (invalid path, etc)
func NewDiskUsage(volumePath string) (out0 *DiskUsage) {
	defer logger.Out1(logger.In1("storage/du", "NewDiskUsage", "volumePath", volumePath), &out0)

	var stat syscall.Statfs_t
	syscall.Statfs(volumePath, &stat)
	return &DiskUsage{&stat}
}

// Free returns total free bytes on file system
func (du *DiskUsage) Free() (out0 uint64) {
	defer logger.Out1(logger.In1("storage/du", "DiskUsage.Free", "du", du), &out0)
	return du.stat.Bfree * uint64(du.stat.Bsize)
}

// Available return total available bytes on file system to an unprivileged user
func (du *DiskUsage) Available() (out0 uint64) {
	defer logger.Out1(logger.In1("storage/du", "DiskUsage.Available", "du", du), &out0)
	return uint64(du.stat.Bavail) * uint64(du.stat.Bsize)
}

// Size returns total size of the file system
func (du *DiskUsage) Size() (out0 uint64) {
	defer logger.Out1(logger.In1("storage/du", "DiskUsage.Size", "du", du), &out0)
	return uint64(du.stat.Blocks) * uint64(du.stat.Bsize)
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
