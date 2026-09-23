//go:build darwin
// +build darwin

package filesystem

import (
	"os"
	"syscall"
)

// macOS (HFS+ / APFS) exposes the birth time as part of stat
func getFileCreationTime(fileInfo os.FileInfo) (int64, bool) {
	fileStat, ok := fileInfo.Sys().(*syscall.Stat_t)
	if !ok || fileStat == nil {
		return 0, false
	}

	creationTime := int64(fileStat.Birthtimespec.Sec)
	if creationTime <= 0 {
		return 0, false
	}
	return creationTime, true
}
