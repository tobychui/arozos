package neighbour

import (
	"encoding/json"
	"net/http"

	"imuslab.com/arozos/mod/network/mdns"
)

/*
	Static handlers for Cluster Neighbourhood
	author: tobychui

*/

type ScanResults struct {
	LastUpdate  int64               //Last update timestamp for the scan results
	ThisHost    *mdns.NetworkHost   //The host information this host is sending out (also looping back)
	NearbyHosts []*mdns.NetworkHost //Other hosts in the network
}

//Handle HTTP request for scanning and return the result
func (d *Discoverer) HandleScanningRequest(w http.ResponseWriter, r *http.Request) {
	result := new(ScanResults)

	hosts := d.GetNearbyHosts()
	for _, host := range hosts {
		if host.UUID == d.Host.Host.UUID {
			//This a loopback signal
			result.ThisHost = host
		} else {
			//This is a signal from other host in the network
			result.NearbyHosts = append(result.NearbyHosts, host)
		}
	}

	result.LastUpdate = d.LastScanningTime

	js, _ := json.Marshal(result)
	sendJSONResponse(w, string(js))
}
