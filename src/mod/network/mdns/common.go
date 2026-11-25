package mdns

import (
	"net"

	"imuslab.com/arozos/mod/info/logger"
)

func stringInSlice(a string, list []string) (out0 bool) {
	defer logger.Out1(logger.In2("network/mdns", "stringInSlice", "a", a, "list", list), &out0)
	for _, b := range list {
		if b == a {
			return true
		}
	}
	return false
}

func getMacAddr() (out0 []string, out1 error) {
	defer logger.Out2(logger.In0("network/mdns", "getMacAddr"), &out0, &out1)
	ifas, err := net.Interfaces()
	if err != nil {
		logger.DebugErr("network/mdns", err)
		return nil, err
	}
	var as []string
	for _, ifa := range ifas {
		a := ifa.HardwareAddr.String()
		if a != "" {
			as = append(as, a)
		}
	}
	return as, nil
}

func getMaxMacAddrString(maxLength int) (out0 string, out1 error) {
	defer logger.Out2(logger.In1("network/mdns", "getMaxMacAddrString", "maxLength", maxLength), &out0, &out1)
	ifas, err := net.Interfaces()
	if err != nil {
		logger.DebugErr("network/mdns", err)
		return "", err
	}

	type ifaceInfo struct {
		mac      string
		isLAN    bool
		priority int
	}

	var ifaces []ifaceInfo
	for _, ifa := range ifas {
		mac := ifa.HardwareAddr.String()
		if mac == "" {
			continue
		}

		isLAN := false
		priority := 0

		addrs, _ := ifa.Addrs()
		for _, addr := range addrs {
			var ip net.IP
			switch v := addr.(type) {
			case *net.IPNet:
				ip = v.IP
			case *net.IPAddr:
				ip = v.IP
			}

			if ip == nil {
				continue
			}

			if ip.To4() != nil {
				parsedIP := ip.To4()
				if parsedIP[0] == 10 {
					isLAN = true
					priority = 3
				} else if parsedIP[0] == 172 && parsedIP[1] >= 16 && parsedIP[1] <= 31 {
					isLAN = true
					priority = 3
				} else if parsedIP[0] == 192 && parsedIP[1] == 168 {
					isLAN = true
					priority = 3
				} else {
					isLAN = false
					priority = 1
				}
				break
			}
		}

		ifaces = append(ifaces, ifaceInfo{
			mac:      mac,
			isLAN:    isLAN,
			priority: priority,
		})
	}

	var lanMacs []string
	var otherMacs []string
	for _, iface := range ifaces {
		if iface.isLAN {
			lanMacs = append(lanMacs, iface.mac)
		} else {
			otherMacs = append(otherMacs, iface.mac)
		}
	}

	var prioritizedMacs []string
	prioritizedMacs = append(prioritizedMacs, lanMacs...)
	prioritizedMacs = append(prioritizedMacs, otherMacs...)

	var macString string
	for i, mac := range prioritizedMacs {
		if i > 0 {
			macString += ","
		}
		macString += mac

		if len(macString) >= maxLength {
			break
		}
	}

	return macString, nil
}
