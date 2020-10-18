package main

import (
	"context"
	"log"
	"net"
	"strings"
	"time"

	"github.com/grandcat/zeroconf"
)

//Define the struct to store the network nearby HOST
type networkHost struct {
	HostName     string
	Port         int
	IPv4         []net.IP
	Domain       string
	Model        string
	UUID         string
	Vendor       string
	BuildVersion string
	MinorVersion string
}

func network_mdns_init() {
	//Register the mds services
	deviceUUID := system_id_getSystemUUID()
	server, err := zeroconf.Register("ArOZ", "_http._tcp", "local.", *listen_port, []string{"version_build=" + build_version, "version_minor=" + internal_version, "vendor=" + deviceVendor, "model=" + deviceModel, "uuid=" + deviceUUID, "domain=aroz.online"}, nil)
	if err != nil {
		panic(err)
	}
	mDNS = server

	//Test scanning
	go func() {
		//Run it in goroutine to prevent freezing the main thread
		log.Println(network_mdns_scan(15))
		log.Println("LAN mDNS Scan Completed")
	}()

}

func network_mdns_shutdown() {
	mDNS.Shutdown()
}

func network_mdns_scan(timeout int) []networkHost {
	// Discover all services on the network (e.g. _workstation._tcp)
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		log.Fatalln("Failed to initialize resolver:", err.Error())
	}

	entries := make(chan *zeroconf.ServiceEntry)
	//Create go routine  to wait for the resolver

	discoveredHost := []networkHost{}

	go func(results <-chan *zeroconf.ServiceEntry) {
		for entry := range results {
			if stringInSlice("domain=aroz.online", entry.Text) {
				//This is a ArOZ Online Host
				/*
					log.Println("HostName", entry.HostName)
					log.Println("Port", entry.Port)
					log.Println("AddrIPv4", entry.AddrIPv4)
				*/

				//Split the required information out of the text element
				TEXT := entry.Text
				properties := map[string]string{}
				for _, v := range TEXT {
					kv := strings.Split(v, "=")
					if len(kv) == 2 {
						properties[kv[0]] = kv[1]
					}
				}

				//log.Println(properties)
				discoveredHost = append(discoveredHost, networkHost{
					HostName:     entry.HostName,
					Port:         entry.Port,
					IPv4:         entry.AddrIPv4,
					Domain:       properties["domain"],
					Model:        properties["model"],
					UUID:         properties["uuid"],
					Vendor:       properties["vendor"],
					BuildVersion: properties["version_build"],
					MinorVersion: properties["version_minor"],
				})

			}

		}
		//log.Println("No more entries.")
	}(entries)

	//Resolve each of the mDNS and pipe it back to the log functions
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*time.Duration(timeout))
	defer cancel()
	err = resolver.Browse(ctx, "_http._tcp", "local.", entries)
	if err != nil {
		log.Fatalln("Failed to browse:", err.Error())
	}

	<-ctx.Done()

	return discoveredHost
}
