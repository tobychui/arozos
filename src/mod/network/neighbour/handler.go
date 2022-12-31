package neighbour

import (
	"encoding/json"
	"net/http"

	"imuslab.com/arozos/mod/network/mdns"
	"imuslab.com/arozos/mod/utils"
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
	utils.SendJSONResponse(w, string(js))
}

//Get networkHosts that are offline
func (d *Discoverer) HandleScanRecord(w http.ResponseWriter, r *http.Request) {
	offlineNodes, err := d.GetOfflineHosts()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	js, err := json.Marshal(offlineNodes)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendJSONResponse(w, string(js))
}

//Send wake on land to target
func (d *Discoverer) HandleWakeOnLan(w http.ResponseWriter, r *http.Request) {
	mac, err := utils.GetPara(r, "mac")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid mac address")
		return
	}

	err = d.SendWakeOnLan(mac)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}
