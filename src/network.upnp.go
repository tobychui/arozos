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
	UPnP_connection_object *upnp.IGD	//UPnP conenction object
	UPnP_externalIP string				//Storage of external IP address
	UPnP_requiredPorts []int			//All the required ports will be recored
)

func network_upnp_init(){
	//Create uPNP forwarding in the NAT router
	log.Println("Discovering UPnP router in Local Area Network...")
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
	UPnP_externalIP = ip
	UPnP_connection_object = d;

	//Require the port that is running ArOZ Online Host
	err = network_upnp_requirePort(*listen_port, *host_name);
	if (err != nil){
		panic(err);
	}

	//Display a tip to let user know how to use uPNP when they are outside
	var connectionEndpoint string = "http://" + ip
	if *use_tls{
		connectionEndpoint = "https://" + ip
	}

	connectionEndpoint += ":" + IntToString(*listen_port)
	log.Println("Access your host with the following address when you are outside: " + connectionEndpoint )
}

func network_upnp_requirePort(portNumber int, ruleName string) error{
	// forward a port
	err := UPnP_connection_object.Forward(uint16(portNumber), ruleName)
	if err != nil {
		return err
	}

	UPnP_requiredPorts = append(UPnP_requiredPorts, portNumber)
	return nil
}

func network_upnp_close(){
	//Shutdown the default UPnP Object
	for _, portNumber := range UPnP_requiredPorts{
		err := UPnP_connection_object.Clear(uint16(portNumber))
		if err != nil {
			log.Println(err)
		}
	}
	
}