package neighbour

import (
	"log"
	"time"

	"imuslab.com/arozos/mod/network/mdns"
)

/*
	This is a module for discovering nearby arozos systems.

	Require MDNS Service
*/

type Discoverer struct {
	Host             *mdns.MDNSHost
	LastScanningTime int64
	NearbyHosts      []*mdns.NetworkHost
	d                chan bool
	t                *time.Ticker
}

//NEw Discoverer return a nearby Aroz Discover agent
func NewDiscoverer(MDNS *mdns.MDNSHost) Discoverer {
	return Discoverer{
		Host:             MDNS,
		LastScanningTime: -1,
		NearbyHosts:      []*mdns.NetworkHost{},
	}
}

//Return a list of NetworkHost with the same domain
func (d *Discoverer) GetNearbyHosts() []*mdns.NetworkHost {
	nearbyHosts := []*mdns.NetworkHost{}
	for _, host := range d.NearbyHosts {
		nearbyHosts = append(nearbyHosts, host)
	}

	return nearbyHosts
}

//Start Scanning, interval and scna Duration in seconds
func (d *Discoverer) StartScanning(interval int, scanDuration int) {
	log.Println("ArozOS Neighbour Scanning Started")
	if d.ScannerRunning() {
		//Another scanner already running. Terminate it
		d.StopScanning()
	}

	//Create a new ticker with the given interval and duration
	ticker := time.NewTicker(time.Duration(interval) * time.Second)
	done := make(chan bool)

	//Start scanner routine
	go func() {
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				d.UpdateScan(scanDuration)
			}
		}
	}()

	//Update the Discoverer settings
	d.d = done
	d.t = ticker

}

func (d *Discoverer) UpdateScan(scanDuration int) {
	d.LastScanningTime = time.Now().Unix()
	results := d.Host.Scan(scanDuration)
	d.NearbyHosts = results
}

func (d *Discoverer) ScannerRunning() bool {
	if d.d != nil {
		return true
	} else {
		return false
	}
}

func (d *Discoverer) StopScanning() {
	if d.d != nil {
		//Another ticker already running. Terminate it
		d.d <- true

		//Clear the old ticker
		d.t.Stop()

		d.d = nil
		d.t = nil
	}
	log.Println("ArozOS Neighbour Scanning Stopped")
}
