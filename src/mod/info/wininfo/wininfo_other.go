//go:build !windows

package wininfo

// The Win32 calls only exist on Windows; see wininfo_windows.go

func ProcessorInfo() (Processor, error) { return Processor{}, ErrUnsupported }

func OSName() (string, error) { return "", ErrUnsupported }

func MemoryStatus() (Memory, error) { return Memory{}, ErrUnsupported }

func InstalledMemory() (uint64, error) { return 0, ErrUnsupported }

func SystemTimes() (CPUTimes, error) { return CPUTimes{}, ErrUnsupported }

func LogicalDisks() ([]LogicalDisk, error) { return nil, ErrUnsupported }

func NetAdapters() ([]NetAdapter, error) { return nil, ErrUnsupported }

func USBDevices() ([]string, error) { return nil, ErrUnsupported }

func PhysicalDisks() ([]PhysicalDisk, error) { return nil, ErrUnsupported }
