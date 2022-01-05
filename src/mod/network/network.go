package network

import (
	"encoding/json"
	"errors"
	"io/ioutil"
	"log"
	"net"
	"net/http"
	"strings"

	"gitlab.com/NebulousLabs/go-upnp"
)

type NICS struct {
	Flags              string
	HardwareAddr       string
	Index              int
	MTU                int
	IPv4Addr           string
	IPv6Addr           string
	IPv4MulticastAddrs string
	IPv6MulticastAddrs string
	Name               string
}

func GetNICInfo(w http.ResponseWriter, r *http.Request) {
	interfaces, err := net.Interfaces()
	if err != nil {
		sendJSONResponse(w, err.Error())
	}
	var NICList []NICS
	for _, i := range interfaces {
		InterfaceName := i.Name
		InterfaceIPv4 := ""
		InterfaceIPv6 := ""
		Flags := i.Flags.String()
		HardwareAddr := i.HardwareAddr.String()
		Index := i.Index
		MTU := i.MTU
		IPv4MulticastAddr := ""
		IPv6MulticastAddr := ""

		if HardwareAddr == "" {
			HardwareAddr = "N/A"
		}

		Addrs, _ := i.Addrs()
		for _, addr := range Addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			ip = ip.To4()
			if ip != nil {
				InterfaceIPv4 = ip.String()
			} else {
				InterfaceIPv6 = ip.String()
			}
		}
		if InterfaceIPv4 == "" || InterfaceIPv4 == "<nil>" {
			InterfaceIPv4 = "N/A"
		}
		if InterfaceIPv6 == "" || InterfaceIPv6 == "<nil>" {
			InterfaceIPv6 = "N/A"
		}

		MultiAddrs, _ := i.MulticastAddrs()
		for _, addr := range MultiAddrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}
			ip = ip.To4()
			if ip != nil {
				IPv4MulticastAddr = ip.String()
			} else {
				IPv6MulticastAddr = ip.String()
			}
		}
		if IPv4MulticastAddr == "" || IPv4MulticastAddr == "<nil>" {
			IPv4MulticastAddr = "N/A"
		}
		if IPv6MulticastAddr == "" || IPv6MulticastAddr == "<nil>" {
			IPv6MulticastAddr = "N/A"
		}

		n := NICS{
			Flags:              Flags,
			HardwareAddr:       HardwareAddr,
			Index:              Index,
			MTU:                MTU,
			IPv4Addr:           InterfaceIPv4,
			IPv6Addr:           InterfaceIPv6,
			IPv4MulticastAddrs: IPv4MulticastAddr,
			IPv6MulticastAddrs: IPv6MulticastAddr,
			Name:               InterfaceName,
		}

		NICList = append(NICList, n)
	}

	var jsonData []byte
	jsonData, err = json.Marshal(NICList)
	if err != nil {
		log.Println(err)
	}
	sendJSONResponse(w, string(jsonData))
}

//Get the IP address of the NIC that can conncet to the internet
func GetOutboundIP() (net.IP, error) {
	conn, err := net.Dial("udp", "8.8.8.8:80")
	if err != nil {
		return nil, err
	}
	defer conn.Close()

	localAddr := conn.LocalAddr().(*net.UDPAddr)

	return localAddr.IP, nil
}

//Get External IP address, will require 3rd party services
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
	body, err := ioutil.ReadAll(resp.Body)
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
	sendJSONResponse(w, "pong")
}
