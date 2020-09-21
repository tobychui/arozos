package main

import (
	"github.com/grandcat/zeroconf"
	"os"
	"log"
	"time"
	"context"
)

func network_mdns_init(){
	//Register the mds services
	deviceUUID := system_id_getSystemUUID();
	server, err := zeroconf.Register("ArOZ", "_http._tcp", "local.", *listen_port, []string{"version_build=" + build_version, "version_minor=" + internal_version, "vendor=" + deviceVendor, "model=" + deviceModel, "uuid=" + deviceUUID, "domain=aroz.online"}, nil)
	if err != nil {
		panic(err)
		os.Exit(0);
	}
	mDNS = server


	//Test scanning
	go func(){
		//Run it in goroutine to prevent freezing the main thread
		network_mdns_scan();
	}()
	
}

func network_mdns_shutdown(){
	mDNS.Shutdown()
}

func network_mdns_scan(){
	// Discover all services on the network (e.g. _workstation._tcp)
	resolver, err := zeroconf.NewResolver(nil)
	if err != nil {
		log.Fatalln("Failed to initialize resolver:", err.Error())
	}

	entries := make(chan *zeroconf.ServiceEntry)
	//Create go routine  to wait for the resolver
	go func(results <-chan *zeroconf.ServiceEntry) {
		for entry := range results {
			if stringInSlice("domain=aroz.online",entry.Text){
				//This is a ArOZ Online Host
				log.Println("HostName",entry.HostName)
				log.Println("Port",entry.Port)
				log.Println("Text",entry.Text)
				log.Println("AddrIPv4",entry.AddrIPv4)
			}
		
		}
		//log.Println("No more entries.")
	}(entries)
	
	//Resolve each of the mDNS and pipe it back to the log functions
	ctx, cancel := context.WithTimeout(context.Background(), time.Second*15)
	defer cancel()
	err = resolver.Browse(ctx, "_http._tcp", "local.", entries)
	if err != nil {
		log.Fatalln("Failed to browse:", err.Error())
	}

	<-ctx.Done()
}

