//go:build windows
// +build windows

package wifi

/*
	Native WLAN API bindings

	Talks to the WLAN AutoConfig service (WlanSvc) through wlanapi.dll instead
	of running netsh. The API returns binary structures, so the results do not
	depend on the console code page or the language of the OS, and no child
	process (or console code page switch) is involved.
*/

import (
	"errors"
	"net"
	"strconv"
	"strings"
	"sync"
	"time"
	"unsafe"

	"golang.org/x/sys/windows"
)

var (
	modwlanapi = windows.NewLazySystemDLL("wlanapi.dll")

	procWlanOpenHandle              = modwlanapi.NewProc("WlanOpenHandle")
	procWlanCloseHandle             = modwlanapi.NewProc("WlanCloseHandle")
	procWlanEnumInterfaces          = modwlanapi.NewProc("WlanEnumInterfaces")
	procWlanQueryInterface          = modwlanapi.NewProc("WlanQueryInterface")
	procWlanScan                    = modwlanapi.NewProc("WlanScan")
	procWlanGetNetworkBssList       = modwlanapi.NewProc("WlanGetNetworkBssList")
	procWlanGetAvailableNetworkList = modwlanapi.NewProc("WlanGetAvailableNetworkList")
	procWlanFreeMemory              = modwlanapi.NewProc("WlanFreeMemory")
	procWlanRegisterNotification    = modwlanapi.NewProc("WlanRegisterNotification")
)

// WLAN_INTF_OPCODE values
const (
	wlanIntfOpcodeRadioState        = 4
	wlanIntfOpcodeCurrentConnection = 7
	wlanIntfOpcodeChannelNumber     = 8
	wlanIntfOpcodeRSSI              = 0x10000102
)

const (
	wlanClientVersion            = 2 //Windows Vista and later
	dot11BSSTypeAny              = 3
	wlanNotificationSourceNone   = 0
	wlanNotificationSourceACM    = 0x08
	wlanNotificationACMScanDone  = 7
	wlanNotificationACMScanFail  = 8
	wlanScanTimeout              = 6 * time.Second
	errorServiceNotActive        = 1062
	errorAccessDenied            = 5
	errorNotReady                = 21
	errorNdisDot11PowerStateOff  = 0x80342002
	errorInvalidState            = 5023
	errorDeviceNotConnected      = 1167
	errorNdisInterfaceNotPresent = 0x8034000E
)

var errWlanUnavailable = errors.New("the WLAN API (wlanapi.dll) is not available on this system")

// wlanError turns a WLAN API return code into a readable error
func wlanError(fn string, code uintptr) error {
	switch code {
	case errorServiceNotActive:
		return errors.New("the WLAN AutoConfig service (WlanSvc) is not running")
	case errorAccessDenied:
		return errors.New("access to WiFi information was denied by Windows (allow desktop apps to use location in Privacy settings)")
	case errorNotReady, errorNdisDot11PowerStateOff, errorInvalidState:
		return errors.New("the wireless interface is not ready (the radio might be turned off)")
	case errorDeviceNotConnected, errorNdisInterfaceNotPresent:
		return errors.New("the wireless interface is not present")
	}
	return errors.New(fn + ": " + windows.Errno(code).Error())
}

type wlanClient struct {
	handle uintptr
}

func openWlanClient() (*wlanClient, error) {
	if err := modwlanapi.Load(); err != nil {
		return nil, errWlanUnavailable
	}
	var negotiated uint32
	var handle uintptr
	r, _, _ := procWlanOpenHandle.Call(wlanClientVersion, 0, uintptr(unsafe.Pointer(&negotiated)), uintptr(unsafe.Pointer(&handle)))
	if r != 0 {
		return nil, wlanError("WlanOpenHandle", r)
	}
	return &wlanClient{handle: handle}, nil
}

func (c *wlanClient) Close() {
	procWlanCloseHandle.Call(c.handle, 0)
}

// takeMemory copies size bytes of WLAN API allocated memory and frees it
func takeMemory(p *byte, size int) []byte {
	if p == nil {
		return nil
	}
	defer procWlanFreeMemory.Call(uintptr(unsafe.Pointer(p)))
	if size <= 0 {
		return nil
	}
	return append([]byte{}, unsafe.Slice(p, size)...)
}

// readUint32At reads a DWORD from WLAN API allocated memory
func readUint32At(p *byte, offset uintptr) uint32 {
	return *(*uint32)(unsafe.Add(unsafe.Pointer(p), offset))
}

func (c *wlanClient) interfaces() ([]wlanInterfaceInfo, error) {
	var p *byte
	r, _, _ := procWlanEnumInterfaces.Call(c.handle, 0, uintptr(unsafe.Pointer(&p)))
	if r != 0 {
		return nil, wlanError("WlanEnumInterfaces", r)
	}
	if p == nil {
		return []wlanInterfaceInfo{}, nil
	}
	n := int(readUint32At(p, 0))
	return parseWlanInterfaceList(takeMemory(p, 8+n*wlanInterfaceInfoSize))
}

func (c *wlanClient) query(guid *windows.GUID, opcode uint32) ([]byte, error) {
	var size uint32
	var p *byte
	r, _, _ := procWlanQueryInterface.Call(c.handle, uintptr(unsafe.Pointer(guid)), uintptr(opcode), 0,
		uintptr(unsafe.Pointer(&size)), uintptr(unsafe.Pointer(&p)), 0)
	if r != 0 {
		return nil, wlanError("WlanQueryInterface", r)
	}
	return takeMemory(p, int(size)), nil
}

func (c *wlanClient) bssList(guid *windows.GUID) ([]wlanBSSEntry, error) {
	var p *byte
	r, _, _ := procWlanGetNetworkBssList.Call(c.handle, uintptr(unsafe.Pointer(guid)), 0, dot11BSSTypeAny, 0, 0, uintptr(unsafe.Pointer(&p)))
	if r != 0 {
		return nil, wlanError("WlanGetNetworkBssList", r)
	}
	if p == nil {
		return []wlanBSSEntry{}, nil
	}
	total := int(readUint32At(p, 0))
	return parseWlanBSSList(takeMemory(p, total))
}

func (c *wlanClient) availableNetworks(guid *windows.GUID) ([]wlanAvailableNetwork, error) {
	var p *byte
	r, _, _ := procWlanGetAvailableNetworkList.Call(c.handle, uintptr(unsafe.Pointer(guid)), 0, 0, uintptr(unsafe.Pointer(&p)))
	if r != 0 {
		return nil, wlanError("WlanGetAvailableNetworkList", r)
	}
	if p == nil {
		return []wlanAvailableNetwork{}, nil
	}
	n := int(readUint32At(p, 0))
	return parseWlanAvailableNetworkList(takeMemory(p, 8+n*wlanAvailableNetworkSize))
}

func (c *wlanClient) connection(guid *windows.GUID) (*wlanConnectionAttributes, error) {
	b, err := c.query(guid, wlanIntfOpcodeCurrentConnection)
	if err != nil {
		return nil, err
	}
	return parseWlanConnectionAttributes(b)
}

func (c *wlanClient) radioState(guid *windows.GUID) ([]wlanPhyRadioState, error) {
	b, err := c.query(guid, wlanIntfOpcodeRadioState)
	if err != nil {
		return nil, err
	}
	return parseWlanRadioState(b)
}

func (c *wlanClient) uint32Value(guid *windows.GUID, opcode uint32) (uint32, error) {
	b, err := c.query(guid, opcode)
	if err != nil {
		return 0, err
	}
	if len(b) < 4 {
		return 0, errWlanTruncated
	}
	return uint32(b[0]) | uint32(b[1])<<8 | uint32(b[2])<<16 | uint32(b[3])<<24, nil
}

/*
	Scanning

	WlanScan only starts a scan. Completion is reported through a
	notification callback; the callback is created once for the process
	(callbacks are a limited resource) and wakes the goroutines waiting for
	that interface.
*/

type wlanNotificationData struct {
	Source        uint32
	Code          uint32
	InterfaceGUID windows.GUID
	DataSize      uint32
	Data          uintptr
}

var (
	wlanNotifyOnce     sync.Once
	wlanNotifyCallback uintptr
	wlanScanMu         sync.Mutex
	wlanScanWaiters    = map[windows.GUID]map[chan struct{}]bool{}
)

func wlanNotificationHandler(data *wlanNotificationData, context uintptr) uintptr {
	if data == nil || data.Source != wlanNotificationSourceACM {
		return 0
	}
	if data.Code != wlanNotificationACMScanDone && data.Code != wlanNotificationACMScanFail {
		return 0
	}
	wlanScanMu.Lock()
	for ch := range wlanScanWaiters[data.InterfaceGUID] {
		select {
		case ch <- struct{}{}:
		default:
		}
	}
	wlanScanMu.Unlock()
	return 0
}

// scan triggers a scan on the interface and waits until it completes (or
// times out). The results are then read with bssList.
func (c *wlanClient) scan(guid windows.GUID) error {
	wlanNotifyOnce.Do(func() {
		wlanNotifyCallback = windows.NewCallback(wlanNotificationHandler)
	})

	done := make(chan struct{}, 1)
	wlanScanMu.Lock()
	if wlanScanWaiters[guid] == nil {
		wlanScanWaiters[guid] = map[chan struct{}]bool{}
	}
	wlanScanWaiters[guid][done] = true
	wlanScanMu.Unlock()
	defer func() {
		wlanScanMu.Lock()
		delete(wlanScanWaiters[guid], done)
		if len(wlanScanWaiters[guid]) == 0 {
			delete(wlanScanWaiters, guid)
		}
		wlanScanMu.Unlock()
	}()

	registered := false
	r, _, _ := procWlanRegisterNotification.Call(c.handle, wlanNotificationSourceACM, 1, wlanNotifyCallback, 0, 0, 0)
	if r == 0 {
		registered = true
		defer procWlanRegisterNotification.Call(c.handle, wlanNotificationSourceNone, 1, 0, 0, 0, 0)
	}

	r, _, _ = procWlanScan.Call(c.handle, uintptr(unsafe.Pointer(&guid)), 0, 0, 0)
	if r != 0 {
		return wlanError("WlanScan", r)
	}

	if !registered {
		//No notification: give the driver the 4 seconds it is allowed
		time.Sleep(4 * time.Second)
		return nil
	}
	select {
	case <-done:
	case <-time.After(wlanScanTimeout):
	}
	return nil
}

/*
	Adapter (IP layer) information
*/

type adapterInfo struct {
	FriendlyName string
	Description  string
	MAC          string
	MTU          int
	IPv4         []string
	IPv6         []string
	Gateways     []string
	DNS          []string
}

// adaptersByGUID returns the IP layer view of every adapter, keyed by the
// upper case "{GUID}" adapter name the WLAN API interface GUIDs map to
func adaptersByGUID() map[string]adapterInfo {
	result := map[string]adapterInfo{}
	size := uint32(16 * 1024)
	var buf []byte
	for i := 0; i < 4; i++ {
		buf = make([]byte, size)
		err := windows.GetAdaptersAddresses(windows.AF_UNSPEC,
			windows.GAA_FLAG_INCLUDE_GATEWAYS|windows.GAA_FLAG_SKIP_ANYCAST|windows.GAA_FLAG_SKIP_MULTICAST,
			0, (*windows.IpAdapterAddresses)(unsafe.Pointer(&buf[0])), &size)
		if err == nil {
			break
		}
		if err != windows.ERROR_BUFFER_OVERFLOW {
			return result
		}
		buf = nil
	}
	if buf == nil {
		return result
	}

	for a := (*windows.IpAdapterAddresses)(unsafe.Pointer(&buf[0])); a != nil; a = a.Next {
		info := adapterInfo{
			FriendlyName: windows.UTF16PtrToString(a.FriendlyName),
			Description:  windows.UTF16PtrToString(a.Description),
			MTU:          int(a.Mtu),
			IPv4:         []string{},
			IPv6:         []string{},
			Gateways:     []string{},
			DNS:          []string{},
		}
		if a.PhysicalAddressLength > 0 && a.PhysicalAddressLength <= uint32(len(a.PhysicalAddress)) {
			info.MAC = net.HardwareAddr(a.PhysicalAddress[:a.PhysicalAddressLength]).String()
		}
		for u := a.FirstUnicastAddress; u != nil; u = u.Next {
			ip := u.Address.IP()
			if ip == nil {
				continue
			}
			cidr := ip.String() + "/" + strconv.Itoa(int(u.OnLinkPrefixLength))
			if ip.To4() != nil {
				info.IPv4 = append(info.IPv4, cidr)
			} else {
				info.IPv6 = append(info.IPv6, cidr)
			}
		}
		for g := a.FirstGatewayAddress; g != nil; g = g.Next {
			if ip := g.Address.IP(); ip != nil {
				info.Gateways = append(info.Gateways, ip.String())
			}
		}
		for d := a.FirstDnsServerAddress; d != nil; d = d.Next {
			if ip := d.Address.IP(); ip != nil {
				info.DNS = append(info.DNS, ip.String())
			}
		}
		name := strings.ToUpper(windows.BytePtrToString(a.AdapterName))
		result[name] = info
	}
	return result
}

// guidFromBytes converts the in-memory GUID bytes into a windows.GUID
func guidFromBytes(b [16]byte) windows.GUID {
	g := windows.GUID{
		Data1: uint32(b[0]) | uint32(b[1])<<8 | uint32(b[2])<<16 | uint32(b[3])<<24,
		Data2: uint16(b[4]) | uint16(b[5])<<8,
		Data3: uint16(b[6]) | uint16(b[7])<<8,
	}
	copy(g.Data4[:], b[8:16])
	return g
}
