//go:build windows

package usageinfo

import (
	"unsafe"

	"golang.org/x/sys/windows"
)

var procGetLogicalProcessorInformation = windows.NewLazySystemDLL("kernel32.dll").NewProc("GetLogicalProcessorInformation")

// physicalCores asks kernel32 for the processor topology and counts the core
// records. Returns 0 when the call is unavailable or fails.
func physicalCores() int {
	if procGetLogicalProcessorInformation.Find() != nil {
		return 0
	}

	//SYSTEM_LOGICAL_PROCESSOR_INFORMATION: ULONG_PTR mask, 4 byte relationship,
	//then a 16 byte union aligned to 8 bytes
	ptrSize := int(unsafe.Sizeof(uintptr(0)))
	entrySize := ptrSize + 4
	if entrySize%8 != 0 {
		entrySize += 8 - entrySize%8
	}
	entrySize += 16

	var length uint32
	procGetLogicalProcessorInformation.Call(0, uintptr(unsafe.Pointer(&length)))
	if length == 0 || length > 1<<20 {
		return 0
	}
	buf := make([]byte, length)
	ok, _, _ := procGetLogicalProcessorInformation.Call(uintptr(unsafe.Pointer(&buf[0])), uintptr(unsafe.Pointer(&length)))
	if ok == 0 || int(length) > len(buf) {
		return 0
	}
	return countCoreEntries(buf[:length], entrySize, ptrSize)
}
