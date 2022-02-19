package mdns

import (
	"context"
	"log"
	"net"
	"strings"
	"time"

	"github.com/grandcat/zeroconf"
)

type MDNSHost struct {
	MDNS *zeroconf.Server
	Host *NetworkHost
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

func NewMDNS(config NetworkHost) (*MDNSHost, error) {
	//Get host MAC Address
	macAddress, err := getMacAddr()
	macAddressBoardcast := ""
	if err == nil {
		macAddressBoardcast = strings.Join(macAddress, ",")
	}

	//Register the mds services
	server, err := zeroconf.Register(config.HostName, "_http._tcp", "local.", config.Port, []string{"version_build=" + config.BuildVersion, "version_minor=" + config.MinorVersion, "vendor=" + config.Vendor, "model=" + config.Model, "uuid=" + config.UUID, "domain=" + config.Domain, "mac_addr=" + macAddressBoardcast}, nil)
	if err != nil {
		return &MDNSHost{}, err
	}

	return &MDNSHost{
		MDNS: server,
		Host: &config,
	}, nil
}

func (m *MDNSHost) Close() {
	if m != nil {
		m.MDNS.Shutdown()
	}

}

//Scan with given timeout and domain filter. Use m.Host.Domain for scanning similar typed devices
func (m *MDNSHost) Scan(timeout int, domainFilter string) []*NetworkHost {
	// Discover all services on the network (e.g. _workstation._tcp)
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		log.Fatalln("Failed to initialize resolver:", err.Error())
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

				}
			}

		}
	}(entries)

	//Resolve each of the mDNS and pipe it back to the log functions
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*time.Duration(timeout))
	defer cancel()
	err = resolver.Browse(ctx, "_http._tcp", "local.", entries)
	if err != nil {
		log.Fatalln("Failed to browse:", err.Error())
	}

	//Update the master scan record

	<-ctx.Done()
	return discoveredHost
}
