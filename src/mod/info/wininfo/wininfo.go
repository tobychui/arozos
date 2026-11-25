package wininfo

import (
	"errors"
	"fmt"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
)

/*
	Windows system information

	Reads hardware and system information on Windows through the Win32 API
	(registry, SetupAPI, IP Helper, volume and memory calls; the duplex state
	of network links alone comes from WMI, queried in this process over COM)
	instead of PowerShell, wmic or the old helper executables.

	A console program that ArozOS starts shares the console window ArozOS
	runs in, so a child could change that window: PowerShell started with
	-WindowStyle Hidden hid the cmd window ArozOS was started from, at boot
	and on every refresh of the host information. Calling the API directly
	starts no process at all, and is much faster than a PowerShell start.

	The calls live in wininfo_windows.go; other platforms get ErrUnsupported
	(wininfo_other.go). The helpers in this file are portable.
*/

// ErrUnsupported is returned on every platform other than Windows
var ErrUnsupported = errors.New("wininfo: only available on Windows")

// Processor is the first CPU as the registry describes it
type Processor struct {
	Name       string //e.g. Intel(R) Core(TM) i7-8700 CPU @ 3.20GHz
	Identifier string //e.g. Intel64 Family 6 Model 158 Stepping 10
	MHz        uint32 //Nominal clock speed
}

// Memory is the physical memory the system can use, in bytes
type Memory struct {
	Total     uint64
	Available uint64
}

// LogicalDisk is a drive letter. Ready is false when the drive holds no
// readable volume (an empty card reader or optical drive).
type LogicalDisk struct {
	Root       string //Drive letter with its colon, e.g. C:
	FileSystem string //e.g. NTFS, empty when not ready
	Size       uint64
	Free       uint64
	Ready      bool
}

// Duplex is the duplex state of a network link
type Duplex int

const (
	DuplexUnknown Duplex = iota
	DuplexHalf
	DuplexFull
)

// NetAdapter is a network adapter known to the IP stack
type NetAdapter struct {
	Name        string //Friendly name, the same as net.Interface.Name
	Description string //Product name, e.g. Intel(R) Ethernet Connection I219-V
	OperStatus  uint32 //IF_OPER_STATUS
	Speed       uint64 //Transmit link speed in bits per second
	Duplex      Duplex
	Loopback    bool
}

// PhysicalDisk is a disk drive with its size in bytes (0 when unknown)
type PhysicalDisk struct {
	Model string
	Size  uint64
}

// CPUTimes are the system wide CPU times in 100 ns units. Kernel includes
// the idle time, as GetSystemTimes reports it.
type CPUTimes struct {
	Idle   uint64
	Kernel uint64
	User   uint64
}

// CPULoad is the busy share of all CPUs between two samples, in percent
func CPULoad(prev CPUTimes, cur CPUTimes) (out0 float64) {
	defer logger.Out1(logger.In2("info/wininfo", "CPULoad", "&prev", &prev, "&cur", &cur), &out0)
	if cur.Idle < prev.Idle || cur.Kernel < prev.Kernel || cur.User < prev.User {
		return 0
	}
	idle := cur.Idle - prev.Idle
	total := (cur.Kernel - prev.Kernel) + (cur.User - prev.User)
	if total == 0 || idle > total {
		return 0
	}
	return float64(total-idle) / float64(total) * 100
}

// osDisplayName words the product name like Win32_OperatingSystem.Caption.
// The registry still says Windows 10 on Windows 11, which starts at build
// 22000.
func osDisplayName(product string, build int) (out0 string) {
	defer logger.Out1(logger.In2("info/wininfo", "osDisplayName", "product", product, "build", build), &out0)
	name := strings.TrimSpace(product)
	if name == "" {
		return ""
	}
	if build >= 22000 {
		name = strings.Replace(name, "Windows 10", "Windows 11", 1)
	}
	if !strings.HasPrefix(name, "Microsoft") {
		name = "Microsoft " + name
	}
	return name
}

// FormatLinkSpeed shows a link speed in bits per second the way
// Get-NetAdapter does ("1 Gbps", "866.7 Mbps"). An unknown or zero speed,
// as a disconnected adapter reports, is "N/A".
func FormatLinkSpeed(bps uint64) (out0 string) {
	defer logger.Out1(logger.In1("info/wininfo", "FormatLinkSpeed", "bps", bps), &out0)
	if bps == 0 || bps == ^uint64(0) {
		return "N/A"
	}
	units := []struct {
		size uint64
		name string
	}{{1000000000, "Gbps"}, {1000000, "Mbps"}, {1000, "Kbps"}}
	for _, unit := range units {
		if bps >= unit.size {
			if bps%unit.size == 0 {
				return fmt.Sprintf("%d %s", bps/unit.size, unit.name)
			}
			return fmt.Sprintf("%.1f %s", float64(bps)/float64(unit.size), unit.name)
		}
	}
	return fmt.Sprintf("%d bps", bps)
}

// OperStateName maps an IF_OPER_STATUS to the state names the network page
// uses on every platform: up, down, dormant, testing or unknown.
func OperStateName(status uint32) (out0 string) {
	defer logger.Out1(logger.In1("info/wininfo", "OperStateName", "status", status), &out0)
	switch status {
	case 1:
		return "up"
	case 2, 6: //down, not present
		return "down"
	case 3:
		return "testing"
	case 5, 7: //dormant, lower layer down
		return "dormant"
	}
	return "unknown"
}

// DuplexName is how the network page shows a duplex state
func DuplexName(d Duplex) (out0 string) {
	defer logger.Out1(logger.In1("info/wininfo", "DuplexName", "&d", &d), &out0)
	switch d {
	case DuplexFull:
		return "Full"
	case DuplexHalf:
		return "Half"
	}
	return "N/A"
}
