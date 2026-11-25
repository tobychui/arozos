//go:build windows

package wininfo

import (
	"encoding/binary"
	"errors"
	"strconv"
	"strings"
	"unsafe"

	"github.com/yusufpapurcu/wmi"
	"golang.org/x/sys/windows"
	"golang.org/x/sys/windows/registry"

	"imuslab.com/arozos/mod/info/logger"
)

var (
	kernel32                               = windows.NewLazySystemDLL("kernel32.dll")
	procGlobalMemoryStatusEx               = kernel32.NewProc("GlobalMemoryStatusEx")
	procGetSystemTimes                     = kernel32.NewProc("GetSystemTimes")
	procGetPhysicallyInstalledSystemMemory = kernel32.NewProc("GetPhysicallyInstalledSystemMemory")

	//Device setup classes and the disk device interface (devguid.h, ntddstor.h)
	guidDevClassUSB       = windows.GUID{Data1: 0x36fc9e60, Data2: 0xc465, Data3: 0x11cf, Data4: [8]byte{0x80, 0x56, 0x44, 0x45, 0x53, 0x54, 0x00, 0x00}}
	guidDevClassDiskDrive = windows.GUID{Data1: 0x4d36e967, Data2: 0xe325, Data3: 0x11ce, Data4: [8]byte{0xbf, 0xc1, 0x08, 0x00, 0x2b, 0xe1, 0x03, 0x18}}
	guidDevInterfaceDisk  = windows.GUID{Data1: 0x53f56307, Data2: 0xb6bf, Data3: 0x11d0, Data4: [8]byte{0x94, 0xf2, 0x00, 0xa0, 0xc9, 0x1e, 0xfb, 0x8b}}
)

const (
	ioctlDiskGetDriveGeometryEx = 0x000700a0 //IOCTL_DISK_GET_DRIVE_GEOMETRY_EX, FILE_ANY_ACCESS
)

// call runs a kernel32 function that returns a BOOL
func call(proc *windows.LazyProc, args ...uintptr) error {
	if logger.IsDebug() {
		logger.Debugf("info/wininfo", "call: len(args)=%d", len(args))
	}
	if err := proc.Find(); err != nil {
		return err
	}
	r, _, err := proc.Call(args...)
	if r == 0 {
		return err
	}
	return nil
}

// ProcessorInfo reads the first CPU from the registry
func ProcessorInfo() (Processor, error) {
	logger.Debug("info/wininfo", "ProcessorInfo")
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `HARDWARE\DESCRIPTION\System\CentralProcessor\0`, registry.QUERY_VALUE)
	if err != nil {
		return Processor{}, err
	}
	defer k.Close()
	p := Processor{}
	if s, _, err := k.GetStringValue("ProcessorNameString"); err == nil {
		p.Name = strings.TrimSpace(s)
	}
	if s, _, err := k.GetStringValue("Identifier"); err == nil {
		p.Identifier = strings.TrimSpace(s)
	}
	if v, _, err := k.GetIntegerValue("~MHz"); err == nil {
		p.MHz = uint32(v)
	}
	return p, nil
}

// OSName is the Windows edition, e.g. Microsoft Windows 11 Pro
func OSName() (string, error) {
	logger.Debug("info/wininfo", "OSName")
	k, err := registry.OpenKey(registry.LOCAL_MACHINE, `SOFTWARE\Microsoft\Windows NT\CurrentVersion`, registry.QUERY_VALUE)
	if err != nil {
		return "", err
	}
	defer k.Close()
	product, _, err := k.GetStringValue("ProductName")
	if err != nil {
		return "", err
	}
	build := 0
	if s, _, err := k.GetStringValue("CurrentBuildNumber"); err == nil {
		build, _ = strconv.Atoi(s)
	}
	return osDisplayName(product, build), nil
}

// memoryStatusEx is MEMORYSTATUSEX
type memoryStatusEx struct {
	Length               uint32
	MemoryLoad           uint32
	TotalPhys            uint64
	AvailPhys            uint64
	TotalPageFile        uint64
	AvailPageFile        uint64
	TotalVirtual         uint64
	AvailVirtual         uint64
	AvailExtendedVirtual uint64
}

// MemoryStatus is the physical memory Windows can use and how much is free
func MemoryStatus() (Memory, error) {
	logger.Debug("info/wininfo", "MemoryStatus")
	m := memoryStatusEx{}
	m.Length = uint32(unsafe.Sizeof(m))
	if err := call(procGlobalMemoryStatusEx, uintptr(unsafe.Pointer(&m))); err != nil {
		return Memory{}, err
	}
	return Memory{Total: m.TotalPhys, Available: m.AvailPhys}, nil
}

// InstalledMemory is the memory installed in the machine in bytes, the sum
// of its memory modules. It falls back to the usable memory when the
// firmware does not report it (some virtual machines).
func InstalledMemory() (uint64, error) {
	logger.Debug("info/wininfo", "InstalledMemory")
	var kb uint64
	if err := call(procGetPhysicallyInstalledSystemMemory, uintptr(unsafe.Pointer(&kb))); err == nil && kb > 0 {
		return kb * 1024, nil
	}
	m, err := MemoryStatus()
	if err != nil {
		return 0, err
	}
	return m.Total, nil
}

func filetime(f windows.Filetime) uint64 {
	logger.DebugTrace("info/wininfo", "filetime")
	return uint64(f.HighDateTime)<<32 | uint64(f.LowDateTime)
}

// SystemTimes samples the system wide CPU times; compare two samples with
// CPULoad
func SystemTimes() (CPUTimes, error) {
	logger.Debug("info/wininfo", "SystemTimes")
	var idle, kernel, user windows.Filetime
	if err := call(procGetSystemTimes, uintptr(unsafe.Pointer(&idle)), uintptr(unsafe.Pointer(&kernel)), uintptr(unsafe.Pointer(&user))); err != nil {
		return CPUTimes{}, err
	}
	return CPUTimes{Idle: filetime(idle), Kernel: filetime(kernel), User: filetime(user)}, nil
}

// LogicalDisks lists the drive letters with their file system and space
func LogicalDisks() ([]LogicalDisk, error) {
	logger.Debug("info/wininfo", "LogicalDisks")
	mask, err := windows.GetLogicalDrives()
	if err != nil {
		return nil, err
	}
	disks := []LogicalDisk{}
	for i := 0; i < 26; i++ {
		if mask&(1<<uint(i)) == 0 {
			continue
		}
		letter := string(rune('A'+i)) + ":"
		root, err := windows.UTF16PtrFromString(letter + `\`)
		if err != nil {
			continue
		}
		if windows.GetDriveType(root) == windows.DRIVE_NO_ROOT_DIR {
			continue
		}
		disk := LogicalDisk{Root: letter}
		fsName := make([]uint16, windows.MAX_PATH+1)
		if windows.GetVolumeInformation(root, nil, 0, nil, nil, nil, &fsName[0], uint32(len(fsName))) == nil {
			disk.FileSystem = windows.UTF16ToString(fsName)
		}
		var freeToCaller, total, free uint64
		if windows.GetDiskFreeSpaceEx(root, &freeToCaller, &total, &free) == nil {
			disk.Size, disk.Free, disk.Ready = total, free, true
		}
		disks = append(disks, disk)
	}
	return disks, nil
}

// NetAdapters lists the network adapters known to the IP stack, with their
// link state, speed and duplex
func NetAdapters() ([]NetAdapter, error) {
	logger.Debug("info/wininfo", "NetAdapters")
	flags := uint32(windows.GAA_FLAG_SKIP_UNICAST | windows.GAA_FLAG_SKIP_ANYCAST | windows.GAA_FLAG_SKIP_MULTICAST | windows.GAA_FLAG_SKIP_DNS_SERVER)
	size := uint32(16 << 10)
	var buf []byte
	for attempt := 0; ; attempt++ {
		buf = make([]byte, size)
		err := windows.GetAdaptersAddresses(windows.AF_UNSPEC, flags, 0, (*windows.IpAdapterAddresses)(unsafe.Pointer(&buf[0])), &size)
		if err == nil {
			break
		}
		if errors.Is(err, windows.ERROR_NO_DATA) {
			return []NetAdapter{}, nil
		}
		//Adapters can appear between the two calls: grow and retry a few times
		if !errors.Is(err, windows.ERROR_BUFFER_OVERFLOW) || attempt >= 3 {
			return nil, err
		}
	}

	list := []NetAdapter{}
	for a := (*windows.IpAdapterAddresses)(unsafe.Pointer(&buf[0])); a != nil; a = a.Next {
		list = append(list, NetAdapter{
			Name:        windows.UTF16PtrToString(a.FriendlyName),
			Description: windows.UTF16PtrToString(a.Description),
			OperStatus:  a.OperStatus,
			Speed:       a.TransmitLinkSpeed,
			Loopback:    a.IfType == windows.IF_TYPE_SOFTWARE_LOOPBACK,
		})
	}

	duplex := adapterDuplexes()
	for i := range list {
		list[i].Duplex = duplex[list[i].Name]
	}
	return list, nil
}

// msftNetAdapter is the part of MSFT_NetAdapter (root\StandardCimv2) the IP
// Helper API does not report. Its Name is the adapter's friendly name.
type msftNetAdapter struct {
	Name       string
	FullDuplex *bool
}

/*
adapterDuplexes reads the duplex state of the adapters the way Get-NetAdapter
does, from MSFT_NetAdapter, but through WMI in this process (COM), so no
PowerShell is started. The legacy NDIS query IOCTL cannot do it: it only
passes a fixed list of OIDs, and the duplex state is not on it. Adapters
without a value are left out, so they read as DuplexUnknown.
*/
func adapterDuplexes() map[string]Duplex {
	logger.Debug("info/wininfo", "adapterDuplexes")
	result := map[string]Duplex{}
	rows := []msftNetAdapter{}
	client := &wmi.Client{PtrNil: true}
	if err := client.Query("SELECT Name, FullDuplex FROM MSFT_NetAdapter", &rows, nil, `root\StandardCimv2`); err != nil {
		return result
	}
	for _, row := range rows {
		if row.FullDuplex == nil {
			continue
		}
		if *row.FullDuplex {
			result[row.Name] = DuplexFull
		} else {
			result[row.Name] = DuplexHalf
		}
	}
	return result
}

// deviceName is the first non empty registry name of a device
func deviceName(set windows.DevInfo, data *windows.DevInfoData, properties ...windows.SPDRP) string {
	if logger.IsDebug() {
		logger.Debugf("info/wininfo", "deviceName: len(properties)=%d", len(properties))
	}
	for _, property := range properties {
		value, err := set.DeviceRegistryProperty(data, property)
		if err != nil {
			continue
		}
		if s, ok := value.(string); ok && strings.TrimSpace(s) != "" {
			return strings.TrimSpace(s)
		}
	}
	return ""
}

// eachPresentDevice calls fn for every device of a setup class that is
// plugged in
func eachPresentDevice(class *windows.GUID, fn func(set windows.DevInfo, data *windows.DevInfoData)) error {
	logger.Debug("info/wininfo", "eachPresentDevice")
	set, err := windows.SetupDiGetClassDevsEx(class, "", 0, windows.DIGCF_PRESENT, 0, "")
	if err != nil {
		return err
	}
	defer set.Close()
	for i := 0; ; i++ {
		data, err := set.EnumDeviceInfo(i)
		if err != nil {
			//ERROR_NO_MORE_ITEMS ends the list; anything else would repeat
			break
		}
		fn(set, data)
	}
	return nil
}

// USBDevices lists the description of every USB device and hub that is
// plugged in, like Win32_USBHub. Host controllers (PCI devices) are left
// out.
func USBDevices() ([]string, error) {
	logger.Debug("info/wininfo", "USBDevices")
	names := []string{}
	err := eachPresentDevice(&guidDevClassUSB, func(set windows.DevInfo, data *windows.DevInfoData) {
		id, err := set.DeviceInstanceID(data)
		if err != nil || !strings.HasPrefix(strings.ToUpper(id), `USB\`) {
			return
		}
		if name := deviceName(set, data, windows.SPDRP_DEVICEDESC, windows.SPDRP_FRIENDLYNAME); name != "" {
			names = append(names, name)
		}
	})
	return names, err
}

// PhysicalDisks lists the disk drives with their model and size
func PhysicalDisks() ([]PhysicalDisk, error) {
	logger.Debug("info/wininfo", "PhysicalDisks")
	disks := []PhysicalDisk{}
	err := eachPresentDevice(&guidDevClassDiskDrive, func(set windows.DevInfo, data *windows.DevInfoData) {
		disk := PhysicalDisk{Model: deviceName(set, data, windows.SPDRP_FRIENDLYNAME, windows.SPDRP_DEVICEDESC)}
		if id, err := set.DeviceInstanceID(data); err == nil {
			paths, err := windows.CM_Get_Device_Interface_List(id, &guidDevInterfaceDisk, windows.CM_GET_DEVICE_INTERFACE_LIST_PRESENT)
			if err == nil && len(paths) > 0 {
				disk.Size = diskSize(paths[0])
			}
		}
		disks = append(disks, disk)
	})
	return disks, err
}

// diskSize asks a disk for its size. Opening it without read or write access
// is enough for the geometry and needs no administrator rights.
func diskSize(devicePath string) uint64 {
	if logger.IsDebug() {
		logger.Debugf("info/wininfo", "diskSize: devicePath=%.120q", devicePath)
	}
	path, err := windows.UTF16PtrFromString(devicePath)
	if err != nil {
		return 0
	}
	h, err := windows.CreateFile(path, 0, windows.FILE_SHARE_READ|windows.FILE_SHARE_WRITE, nil, windows.OPEN_EXISTING, 0, 0)
	if err != nil {
		return 0
	}
	defer windows.CloseHandle(h)
	//DISK_GEOMETRY_EX: a 24 byte DISK_GEOMETRY, then the disk size (LARGE_INTEGER)
	buf := make([]byte, 256)
	var n uint32
	if windows.DeviceIoControl(h, ioctlDiskGetDriveGeometryEx, nil, 0, &buf[0], uint32(len(buf)), &n, nil) != nil || n < 32 {
		return 0
	}
	size := int64(binary.LittleEndian.Uint64(buf[24:32]))
	if size < 0 {
		return 0
	}
	return uint64(size)
}
