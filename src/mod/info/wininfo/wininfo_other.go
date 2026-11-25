//go:build !windows

package wininfo

import "imuslab.com/arozos/mod/info/logger"

// The Win32 calls only exist on Windows; see wininfo_windows.go

func ProcessorInfo() (Processor, error) {
	logger.DebugTrace("info/wininfo", "ProcessorInfo")
	return Processor{}, ErrUnsupported
}

func OSName() (string, error) {
	logger.DebugTrace("info/wininfo", "OSName")
	return "", ErrUnsupported
}

func MemoryStatus() (Memory, error) {
	logger.DebugTrace("info/wininfo", "MemoryStatus")
	return Memory{}, ErrUnsupported
}

func InstalledMemory() (uint64, error) {
	logger.DebugTrace("info/wininfo", "InstalledMemory")
	return 0, ErrUnsupported
}

func SystemTimes() (CPUTimes, error) {
	logger.DebugTrace("info/wininfo", "SystemTimes")
	return CPUTimes{}, ErrUnsupported
}

func LogicalDisks() ([]LogicalDisk, error) {
	logger.DebugTrace("info/wininfo", "LogicalDisks")
	return nil, ErrUnsupported
}

func NetAdapters() ([]NetAdapter, error) {
	logger.DebugTrace("info/wininfo", "NetAdapters")
	return nil, ErrUnsupported
}

func USBDevices() ([]string, error) {
	logger.DebugTrace("info/wininfo", "USBDevices")
	return nil, ErrUnsupported
}

func PhysicalDisks() ([]PhysicalDisk, error) {
	logger.DebugTrace("info/wininfo", "PhysicalDisks")
	return nil, ErrUnsupported
}
