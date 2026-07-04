package mdns

import (
	"context"
	"fmt"
	"net"
	"os"
	"strings"
	"time"

	"github.com/grandcat/zeroconf"
	"imuslab.com/arozos/mod/info/logger"
)

type MDNSHost struct {
	MDNS          *zeroconf.Server
	Host          *NetworkHost
	IfaceOverride *net.Interface
}

type NetworkHost struct {
	HostName     string
	Port         int
	IPv4         []net.IP
	Domain       string
	Model        string
	UUID         string
	Vendor       string
	BuildVersion string
	MinorVersion string
	MacAddr      []string
	Online       bool
}

// Create a new MDNS discoverer, set MacOverride to empty string for using the first NIC discovered
func NewMDNS(config NetworkHost, MacOverride string) (*MDNSHost, error) {
	//Get host MAC Address
	macAddress, err := getMacAddr()
	if err != nil {
		return nil, err
	}

	macAddressBoardcast := ""
	if err == nil {
		macAddressBoardcast = strings.Join(macAddress, ",")
	} else {
		logger.PrintAndLog("Mdns", fmt.Sprint("[mDNS] Unable to get MAC Address: ", err.Error()), nil)
	}

	//Register the mds services
	server, err := zeroconf.Register(config.HostName, "_http._tcp", "local.", config.Port, []string{"version_build=" + config.BuildVersion, "version_minor=" + config.MinorVersion, "vendor=" + config.Vendor, "model=" + config.Model, "uuid=" + config.UUID, "domain=" + config.Domain, "mac_addr=" + macAddressBoardcast}, nil)
	if err != nil {
		logger.PrintAndLog("Mdns", fmt.Sprint("[mDNS] Error when registering zeroconf broadcast message", err.Error()), nil)
		return &MDNSHost{}, err
	}

	//Discover the iface to override if exists
	var overrideIface *net.Interface = nil
	if MacOverride != "" {
		ifaceIp := ""
		ifaces, err := net.Interfaces()
		if err != nil {
			logger.PrintAndLog("Mdns", "[mDNS] Unable to override iface MAC: "+err.Error()+". Resuming with default iface", nil)
		}

		foundMatching := false
		for _, iface := range ifaces {
			thisIfaceMac := iface.HardwareAddr.String()
			thisIfaceMac = strings.ReplaceAll(thisIfaceMac, ":", "-")
			MacOverride = strings.ReplaceAll(MacOverride, ":", "-")
			if strings.EqualFold(thisIfaceMac, strings.TrimSpace(MacOverride)) {
				//This is the correct iface to use
				overrideIface = &iface
				addrs, err := iface.Addrs()

				if err == nil && len(addrs) > 0 {
					ifaceIp = addrs[0].String()
				}

				for _, addr := range addrs {
					var ip net.IP
					switch v := addr.(type) {
					case *net.IPNet:
						ip = v.IP
					case *net.IPAddr:
						ip = v.IP
					}

					if ip.To4() != nil {
						//This NIC have Ipv4 addr
						ifaceIp = ip.String()
					}
				}
				foundMatching = true
				break
			}
		}

		if !foundMatching {
			logger.PrintAndLog("Mdns", "[mDNS] Unable to find the target iface with MAC address: "+MacOverride+". Resuming with default iface", nil)
		} else {
			logger.PrintAndLog("Mdns", "[mDNS] Entering force MAC address mode, listening on: "+MacOverride+"(IP address: "+ifaceIp+")", nil)
		}
	}

	return &MDNSHost{
		MDNS:          server,
		Host:          &config,
		IfaceOverride: overrideIface,
	}, nil
}

func (m *MDNSHost) Close() {
	if m != nil {
		m.MDNS.Shutdown()
	}

}

// Scan with given timeout and domain filter. Use m.Host.Domain for scanning similar typed devices
func (m *MDNSHost) Scan(timeout int, domainFilter string) []*NetworkHost {
	// Discover all services on the network (e.g. _workstation._tcp)

	var zcoption zeroconf.ClientOption = nil
	if m.IfaceOverride != nil {
		zcoption = zeroconf.SelectIfaces([]net.Interface{*m.IfaceOverride})
	}

	resolver, err := zeroconf.NewResolver(zcoption)
	if err != nil {
		logger.PrintAndLog("Mdns", fmt.Sprint("Failed to initialize resolver:", err.Error()), nil)
		os.Exit(1)
	}

	entries := make(chan *zeroconf.ServiceEntry)
	//Create go routine  to wait for the resolver

	discoveredHost := []*NetworkHost{}

	go func(results <-chan *zeroconf.ServiceEntry) {
		for entry := range results {
			if domainFilter == "" {
				//This is a ArOZ Online Host
				//Split the required information out of the text element
				TEXT := entry.Text
				properties := map[string]string{}
				for _, v := range TEXT {
					kv := strings.Split(v, "=")
					if len(kv) == 2 {
						properties[kv[0]] = kv[1]
					}
				}

				var macAddrs []string
				val, ok := properties["mac_addr"]
				if !ok || val == "" {
					//No MacAddr found. Target node version too old
					macAddrs = []string{}
				} else {
					macAddrs = strings.Split(properties["mac_addr"], ",")
				}

				//log.Println(properties)
				discoveredHost = append(discoveredHost, &NetworkHost{
					HostName:     entry.HostName,
					Port:         entry.Port,
					IPv4:         entry.AddrIPv4,
					Domain:       properties["domain"],
					Model:        properties["model"],
					UUID:         properties["uuid"],
					Vendor:       properties["vendor"],
					BuildVersion: properties["version_build"],
					MinorVersion: properties["version_minor"],
					MacAddr:      macAddrs,
					Online:       true,
				})

			} else {
				if stringInSlice("domain="+domainFilter, entry.Text) {
					//This is generic scan request
					//Split the required information out of the text element
					TEXT := entry.Text
					properties := map[string]string{}
					for _, v := range TEXT {
						kv := strings.Split(v, "=")
						if len(kv) == 2 {
							properties[kv[0]] = kv[1]
						}
					}

					var macAddrs []string
					val, ok := properties["mac_addr"]
					if !ok || val == "" {
						//No MacAddr found. Target node version too old
						macAddrs = []string{}
					} else {
						macAddrs = strings.Split(properties["mac_addr"], ",")
					}

					//log.Println(properties)
					discoveredHost = append(discoveredHost, &NetworkHost{
						HostName:     entry.HostName,
						Port:         entry.Port,
						IPv4:         entry.AddrIPv4,
						Domain:       properties["domain"],
						Model:        properties["model"],
						UUID:         properties["uuid"],
						Vendor:       properties["vendor"],
						BuildVersion: properties["version_build"],
						MinorVersion: properties["version_minor"],
						MacAddr:      macAddrs,
						Online:       true,
					})

				}
			}

		}
	}(entries)

	//Resolve each of the mDNS and pipe it back to the log functions
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*time.Duration(timeout))
	defer cancel()
	err = resolver.Browse(ctx, "_http._tcp", "local.", entries)
	if err != nil {
		logger.PrintAndLog("Mdns", fmt.Sprint("Failed to browse:", err.Error()), nil)
		os.Exit(1)
	}

	//Update the master scan record
	<-ctx.Done()
	return discoveredHost
}
