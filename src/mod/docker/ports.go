package docker

import (
	"net"
	"strconv"
	"strings"
)

/*
	ports.go

	Parses the Ports column of `docker ps` ("0.0.0.0:8081->80/tcp, :::8081->80/tcp")
	into the host ports a container publishes, so the container app publisher
	can offer them as proxy targets.
*/

// maxExpandedRange caps how many ports a published range expands into
const maxExpandedRange = 32

// PublishedPort is one container port published on the host
type PublishedPort struct {
	HostIP        string
	HostPort      int
	ContainerPort int
	Protocol      string
}

// Target is the address this host reaches the published port on
func (p PublishedPort) Target() string {
	ip := p.HostIP
	if ip == "" || ip == "0.0.0.0" || ip == "::" {
		ip = "127.0.0.1"
	}
	return net.JoinHostPort(ip, strconv.Itoa(p.HostPort))
}

// parsePortRange parses "80" or "8000-8003"
func parsePortRange(s string) (int, int, bool) {
	lo, hi, isRange := strings.Cut(s, "-")
	start, err := strconv.Atoi(lo)
	if err != nil || start < 1 || start > 65535 {
		return 0, 0, false
	}
	if !isRange {
		return start, start, true
	}
	end, err := strconv.Atoi(hi)
	if err != nil || end < start || end > 65535 {
		return 0, 0, false
	}
	return start, end, true
}

// ParsePublishedPorts returns the tcp ports of a `docker ps` Ports value that
// are published on the host, without the IPv4/IPv6 duplicates
func ParsePublishedPorts(ports string) []PublishedPort {
	results := []PublishedPort{}
	seen := map[string]bool{}
	for _, entry := range strings.Split(ports, ",") {
		entry = strings.TrimSpace(entry)
		host, container, published := strings.Cut(entry, "->")
		if !published {
			continue
		}
		containerPorts, proto, _ := strings.Cut(container, "/")
		if proto == "" {
			proto = "tcp"
		}
		if proto != "tcp" {
			continue
		}
		sep := strings.LastIndex(host, ":")
		if sep < 0 {
			continue
		}
		hostIP := strings.Trim(host[:sep], "[]")
		hStart, hEnd, ok := parsePortRange(host[sep+1:])
		if !ok {
			continue
		}
		cStart, _, ok := parsePortRange(containerPorts)
		if !ok {
			continue
		}
		for i := 0; hStart+i <= hEnd && i < maxExpandedRange; i++ {
			p := PublishedPort{HostIP: hostIP, HostPort: hStart + i, ContainerPort: cStart + i, Protocol: proto}
			//"0.0.0.0" and "::" publish the same port twice
			key := strconv.Itoa(p.HostPort) + ">" + strconv.Itoa(p.ContainerPort)
			if hostIP != "" && hostIP != "0.0.0.0" && hostIP != "::" {
				key = hostIP + ":" + key
			}
			if seen[key] {
				continue
			}
			seen[key] = true
			results = append(results, p)
		}
	}
	return results
}
