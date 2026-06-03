package network

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"

	"gitlab.com/NebulousLabs/go-upnp"
	"imuslab.com/arozos/mod/utils"
)

type NICS struct {
	Name               string
	Index              int
	Flags              string
	HardwareAddr       string
	MTU                int
	IPv4Addr           string
	IPv4Mask           string   // subnet mask e.g. "255.255.255.0"
	IPv6Addr           string   // first IPv6 addr (kept for compatibility)
	IPv6Addrs          []string // all unicast IPv6 addresses
	IPv4MulticastAddrs string
	IPv6MulticastAddrs string
	// Enhanced details — populated from /sys/class/net/ on Linux;
	// gracefully falls back to "N/A" on embedded / non-Linux platforms.
	OperState string // "up" / "down" / "dormant" / "unknown"
	Speed     string // "1 Gbps", "100 Mbps", "N/A"
	Duplex    string // "Full" / "Half" / "N/A"
	Type      string // "ethernet" / "wifi" / "loopback" / "vpn" / "virtual" / "unknown"
}

// nicExtraInfo holds the platform-specific enhanced details for a NIC.
// Populated by the per-platform nicExtraAll() implementation.
type nicExtraInfo struct {
	OperState string // "up" / "down" / "dormant" / "unknown"
	Speed     string // "1 Gbps", "100 Mbps", "N/A"
	Duplex    string // "Full" / "Half" / "N/A"
}

// nicType classifies the interface as ethernet / wifi / loopback / vpn / virtual / unknown.
func nicType(iface net.Interface) string {
	name := strings.ToLower(iface.Name)
	if iface.Flags&net.FlagLoopback != 0 {
		return "loopback"
	}
	for _, p := range []string{"wlan", "wlp", "wl"} {
		if strings.HasPrefix(name, p) {
			return "wifi"
		}
	}
	for _, p := range []string{"eth", "enp", "eno", "ens", "en"} {
		if strings.HasPrefix(name, p) {
			return "ethernet"
		}
	}
	for _, p := range []string{"tun", "tap"} {
		if strings.HasPrefix(name, p) {
			return "vpn"
		}
	}
	for _, kw := range []string{"vpn", "zerotier", "zt", "hamachi", "openvpn"} {
		if strings.Contains(name, kw) {
			return "vpn"
		}
	}
	for _, kw := range []string{"docker", "veth", "br-", "virbr", "vmnet", "vbox", "hyperv"} {
		if strings.HasPrefix(name, kw) || strings.Contains(name, kw) {
			return "virtual"
		}
	}
	return "unknown"
}

func GetNICInfo(w http.ResponseWriter, r *http.Request) {
	interfaces, err := net.Interfaces()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	var NICList []NICS
	extras := nicExtraAll(interfaces)
	for _, iface := range interfaces {
		ipv4Addr := ""
		ipv4Mask := ""
		var ipv6Addrs []string

		if addrs, aerr := iface.Addrs(); aerr == nil {
			for _, addr := range addrs {
				switch v := addr.(type) {
				case *net.IPNet:
					if v.IP.To4() != nil {
						ipv4Addr = v.IP.String()
						ipv4Mask = net.IP(v.Mask).String()
					} else {
						ipv6Addrs = append(ipv6Addrs, v.IP.String())
					}
				case *net.IPAddr:
					if v.IP.To4() != nil {
						ipv4Addr = v.IP.String()
					} else {
						ipv6Addrs = append(ipv6Addrs, v.IP.String())
					}
				}
			}
		}
		if ipv4Addr == "" {
			ipv4Addr = "N/A"
		}
		if ipv4Mask == "" {
			ipv4Mask = "N/A"
		}
		if ipv6Addrs == nil {
			ipv6Addrs = []string{}
		}

		ipv4McastAddr := ""
		ipv6McastAddr := ""
		if maddrs, merr := iface.MulticastAddrs(); merr == nil {
			for _, addr := range maddrs {
				var ip net.IP
				switch v := addr.(type) {
				case *net.IPNet:
					ip = v.IP
				case *net.IPAddr:
					ip = v.IP
				}
				if ip != nil {
					if ip.To4() != nil {
						ipv4McastAddr = ip.String()
					} else {
						ipv6McastAddr = ip.String()
					}
				}
			}
		}
		if ipv4McastAddr == "" {
			ipv4McastAddr = "N/A"
		}
		if ipv6McastAddr == "" {
			ipv6McastAddr = "N/A"
		}

		hwAddr := iface.HardwareAddr.String()
		if hwAddr == "" {
			hwAddr = "N/A"
		}

		ipv6First := "N/A"
		if len(ipv6Addrs) > 0 {
			ipv6First = ipv6Addrs[0]
		}

		extra := extras[iface.Name]
		n := NICS{
			Name:               iface.Name,
			Index:              iface.Index,
			Flags:              iface.Flags.String(),
			HardwareAddr:       hwAddr,
			MTU:                iface.MTU,
			IPv4Addr:           ipv4Addr,
			IPv4Mask:           ipv4Mask,
			IPv6Addr:           ipv6First,
			IPv6Addrs:          ipv6Addrs,
			IPv4MulticastAddrs: ipv4McastAddr,
			IPv6MulticastAddrs: ipv6McastAddr,
			OperState:          extra.OperState,
			Speed:              extra.Speed,
			Duplex:             extra.Duplex,
			Type:               nicType(iface),
		}
		NICList = append(NICList, n)
	}

	jsonData, err := json.Marshal(NICList)
	if err != nil {
		networkLogger.PrintAndLog("Network", fmt.Sprint(err), nil)
		utils.SendErrorResponse(w, "Failed to encode NIC data")
		return
	}
	utils.SendJSONResponse(w, string(jsonData))
}

// Get the IP address of the NIC that can conncet to the internet
func GetOutboundIP() (net.IP, error) {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	localAddr := conn.LocalAddr().(*net.UDPAddr)

	return localAddr.IP, nil
}

// Get External IP address, will require 3rd party services
func GetExternalIPAddr() (string, error) {
	u, err := upnp.Discover()
	if err != nil {
		return "", err
	}
	// discover external IP
	ip, err := u.ExternalIP()
	if err != nil {
		return "", err
	}
	return ip, nil
}

func GetExternalIPAddrVia3rdPartyServices() (string, error) {
	//Fallback to using Amazon AWS IP resolve service
	resp, err := http.Get("http://checkip.amazonaws.com/")
	if err != nil {
		return "", err
	}

	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", err
	}

	return strings.TrimSpace(string(body)), nil
}

func IsPublicIP(IP net.IP) bool {
	if IP.IsLoopback() || IP.IsLinkLocalMulticast() || IP.IsLinkLocalUnicast() {
		return false
	}
	if ip4 := IP.To4(); ip4 != nil {
		switch {
		case ip4[0] == 10:
			return false
		case ip4[0] == 172 && ip4[1] >= 16 && ip4[1] <= 31:
			return false
		case ip4[0] == 192 && ip4[1] == 168:
			return false
		default:
			return true
		}
	}
	return false
}

func IsIPv6Addr(ip string) (bool, error) {
	if net.ParseIP(ip) == nil {
		return false, errors.New("Address parsing failed")
	}
	for i := 0; i < len(ip); i++ {
		switch ip[i] {
		case '.':
			return false, nil
		case ':':
			return true, nil
		}
	}
	return false, errors.New("Unable to determine address type")
}

func GetPing(w http.ResponseWriter, r *http.Request) {
	utils.SendJSONResponse(w, "pong")
}

func GetIpFromRequest(r *http.Request) (string, error) {
	ip := r.Header.Get("X-REAL-IP")
	netIP := net.ParseIP(ip)
	if netIP != nil {
		return ip, nil
	}

	ips := r.Header.Get("X-FORWARDED-FOR")
	splitIps := strings.Split(ips, ",")
	for _, ip := range splitIps {
		netIP := net.ParseIP(ip)
		if netIP != nil {
			return ip, nil
		}
	}

	ip, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return "", err
	}
	netIP = net.ParseIP(ip)
	if netIP != nil {
		return ip, nil
	}
	return "", errors.New("No IP information found")
}
