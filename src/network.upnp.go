package main

import (
	"log"
	"gitlab.com/NebulousLabs/go-upnp"
)

/*
	uPNP Module
	
	This module handles uPNP Connections to the gateway router and create a port forward entry
	for the host system at the given port (set with -port paramter)
*/

var (
	uPNP_connection_object *upnp.IGD
)

func network_upnp_init(){
	//Create uPNP forwarding in the NAT router
	log.Println("Discovering uPNP router in Local Area Network...")
	d, err := upnp.Discover()
    if err != nil {
        log.Fatal(err)
    }

    // discover external IP
    ip, err := d.ExternalIP()
    if err != nil {
        log.Fatal(err)
    }
	log.Println("Creating uPNP services with external IP: ", ip)

    // forward a port
    err = d.Forward(uint16(*listen_port), *host_name)
    if err != nil {
        log.Fatal(err)
	}
	
	uPNP_connection_object = d;

	//Display a tip to let user know how to use uPNP when they are outside
	var connectionEndpoint string = "http://" + ip
	if *use_tls{
		connectionEndpoint = "https://" + ip
	}

	connectionEndpoint += ":" + IntToString(*listen_port)
	log.Println("Access your host with the following address when you are outside: " + connectionEndpoint )
}

func network_upnp_close(){
	err := uPNP_connection_object.Clear(uint16(*listen_port))
    if err != nil {
        log.Fatal(err)
    }
}