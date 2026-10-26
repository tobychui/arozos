//go:build windows

package docker

import (
	"syscall"
	"unsafe"
)

// hostStorageUsage reports used/total bytes of the volume holding the current
// working directory via GetDiskFreeSpaceExW.
func hostStorageUsage() (int64, int64, bool) {
	kernel32 := syscall.NewLazyDLL("kernel32.dll")
	proc := kernel32.NewProc("GetDiskFreeSpaceExW")

	pathPtr, err := syscall.UTF16PtrFromString(".")
	if err != nil {
		return 0, 0, false
	}
	var freeAvail, total, totalFree uint64
	r, _, _ := proc.Call(
		uintptr(unsafe.Pointer(pathPtr)),
		uintptr(unsafe.Pointer(&freeAvail)),
		uintptr(unsafe.Pointer(&total)),
		uintptr(unsafe.Pointer(&totalFree)),
	)
	if r == 0 || total == 0 {
		return 0, 0, false
	}
	used := int64(total) - int64(totalFree)
	return used, int64(total), true
}

// hostLoadAvg is not available on Windows.
func hostLoadAvg() (float64, float64, float64, bool) {
	return 0, 0, 0, false
}
