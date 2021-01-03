package prouter

import (
	"bytes"
	"net"
	"net/http"
	"strings"
)

type ipRange struct {
	start net.IP
	end   net.IP
}

var privateRanges = []ipRange{
	ipRange{
		start: net.ParseIP("10.0.0.0"),
		end:   net.ParseIP("10.255.255.255"),
	},
	ipRange{
		start: net.ParseIP("100.64.0.0"),
		end:   net.ParseIP("100.127.255.255"),
	},
	ipRange{
		start: net.ParseIP("172.16.0.0"),
		end:   net.ParseIP("172.31.255.255"),
	},
	ipRange{
		start: net.ParseIP("192.0.0.0"),
		end:   net.ParseIP("192.0.0.255"),
	},
	ipRange{
		start: net.ParseIP("192.168.0.0"),
		end:   net.ParseIP("192.168.255.255"),
	},
	ipRange{
		start: net.ParseIP("198.18.0.0"),
		end:   net.ParseIP("198.19.255.255"),
	},
	ipRange{
		start: net.ParseIP("198.18.0.0"),
		end:   net.ParseIP("198.19.255.255"),
	},
}

func checkIfLAN(r *http.Request) bool {
	PredictedClientIP := []net.IP{}
	forwarded := r.Header.Get("X-FORWARDED-FOR")
	rip := r.Header.Get("X-Real-Ip") //Not that kind of RIP
	if forwarded != "" {
		ips := strings.Split(forwarded, ", ")
		for _, ip := range ips {
			PredictedClientIP = append(PredictedClientIP, net.ParseIP(strings.TrimSpace(ip)))
		}
	} else if rip != "" {
		PredictedClientIP = append(PredictedClientIP, net.ParseIP(strings.TrimSpace(rip)))
	} else {
		ip, _, err := net.SplitHostPort(r.RemoteAddr)
		if err != nil {

		} else {
			userIP := net.ParseIP(ip)
			PredictedClientIP = append(PredictedClientIP, userIP)
		}
	}

	//Check if localhost loopback
	if len(PredictedClientIP) == 1 {
		onlyAddr := PredictedClientIP[0].String()
		if onlyAddr == "127.0.0.1" {
			return true
		} else if onlyAddr == "::1" {
			return true
		} else if onlyAddr == "localhost" {
			return true
		}
	}

	IsLocal := true
	for _, thisIP := range PredictedClientIP {
		thisIpIsPrivate := isPrivateSubnet(thisIP)
		if thisIpIsPrivate == false {
			IsLocal = false
		}
	}

	return IsLocal
}

func isPrivateSubnet(ipAddress net.IP) bool {
	// my use case is only concerned with ipv4 atm
	if ipCheck := ipAddress.To4(); ipCheck != nil {
		// iterate over all our ranges
		for _, r := range privateRanges {
			// check if this ip is in a private range
			if inRange(r, ipAddress) {
				return true
			}
		}
	}
	return false
}

func inRange(r ipRange, ipAddress net.IP) bool {
	// strcmp type byte comparison
	if bytes.Compare(ipAddress, r.start) >= 0 && bytes.Compare(ipAddress, r.end) < 0 {
		return true
	}
	return false
}
