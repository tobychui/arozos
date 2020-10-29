package upnp

import (
	"log"
	"gitlab.com/NebulousLabs/go-upnp"
)

/*
	uPNP Module
	
	This module handles uPNP Connections to the gateway router and create a port forward entry
	for the host system at the given port (set with -port paramter)
*/

type UPnPClient struct{
	Connection *upnp.IGD	//UPnP conenction object
	ExternalIP string				//Storage of external IP address
	RequiredPorts []int			//All the required ports will be recored
}
	


func NewUPNPClient(basePort int, hostname string) (*UPnPClient, error){
	//Create uPNP forwarding in the NAT router
	log.Println("Discovering UPnP router in Local Area Network...")
	d, err := upnp.Discover()
    if err != nil {
        return &UPnPClient{}, err
    }

    // discover external IP
    ip, err := d.ExternalIP()
    if err != nil {
        return &UPnPClient{}, err
	}
	
	//Create the final obejcts
	newUPnPObject := &UPnPClient{
		Connection: d,
		ExternalIP: ip,
		RequiredPorts: []int{},
	}

	//Require the port that is running ArOZ Online Host
	err = newUPnPObject.ForwardPort(basePort, hostname);
	if (err != nil){
		return &UPnPClient{}, err
	}

	return newUPnPObject, nil
}

func (u *UPnPClient)ForwardPort(portNumber int, ruleName string) error{
	// forward a port
	err := u.Connection.Forward(uint16(portNumber), ruleName)
	if err != nil {
		return err
	}

	u.RequiredPorts = append(u.RequiredPorts, portNumber)
	return nil
}

func (u *UPnPClient)Close(){
	//Shutdown the default UPnP Object
	if u != nil{
		for _, portNumber := range u.RequiredPorts{
			err := u.Connection.Clear(uint16(portNumber))
			if err != nil {
				log.Println(err)
			}
		}
	}
}