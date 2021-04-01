package aclient

import "imuslab.com/arozos/mod/network/mdns"

/*
	ArOZ Cluster Client Module
	author: tobychui

	This module is designed to connect this host to a remote host and act as a client
	for sending commands

*/

type Aclient struct {
	Options AclientOption
}

type AclientOption struct {
	MDNS *mdns.MDNSHost
}

func NewClient(option AclientOption) *Aclient {
	return &Aclient{
		Options: option,
	}
}

func (a *Aclient) DiscoverServices(serviceType string) {

}
