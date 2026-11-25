package neighbour

import (
	"encoding/json"
	"fmt"
	"time"

	"imuslab.com/arozos/mod/cluster/wakeonlan"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/network/mdns"
)

/*
	This is a module for discovering nearby arozos systems.

	Require MDNS Service
*/

const (
	AutoDeleteRecordTime = int64(2592000) //30 days = 2592000 seconds
)

type Discoverer struct {
	Host             *mdns.MDNSHost
	Database         *database.Database
	LastScanningTime int64
	NearbyHosts      []*mdns.NetworkHost
	d                chan bool
	t                *time.Ticker
}

type HostRecord struct {
	Name       string
	Model      string
	Version    string
	UUID       string
	LastSeenIP []string
	MacAddr    []string
	LastOnline int64
}

// New Discoverer return a nearby Aroz Discover agent
func NewDiscoverer(MDNS *mdns.MDNSHost, Database *database.Database) (out0 Discoverer) {
	defer logger.Out1(logger.In2("network/neighbour", "NewDiscoverer", "MDNS", MDNS, "Database", Database), &out0)
	//Create a new table for neighbour records
	Database.NewTable("neighbour")

	return Discoverer{
		Host:             MDNS,
		Database:         Database,
		LastScanningTime: -1,
		NearbyHosts:      []*mdns.NetworkHost{},
	}
}

// Return a list of NetworkHost with the same domain
func (d *Discoverer) GetNearbyHosts() (out0 []*mdns.NetworkHost) {
	defer logger.Out1(logger.In1("network/neighbour", "Discoverer.GetNearbyHosts", "d", d), &out0)
	nearbyHosts := []*mdns.NetworkHost{}
	for _, host := range d.NearbyHosts {
		nearbyHosts = append(nearbyHosts, host)
	}

	return nearbyHosts
}

// Start Scanning, interval and scan Duration in seconds
func (d *Discoverer) StartScanning(interval int, scanDuration int) {
	defer logger.Out0(logger.In3("network/neighbour", "Discoverer.StartScanning", "d", d, "interval", interval, "scanDuration", scanDuration))
	logger.PrintAndLog("Neighbour", "ArozOS Neighbour Scanning Started", nil)
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

	go func() {
		//Run initial scanning
		d.UpdateScan(scanDuration)
		logger.PrintAndLog("Neighbour", fmt.Sprint("ArozOS Neighbour Scanning Completed, ", len(d.NearbyHosts), " neighbours found!"), nil)
	}()

	//Update the Discoverer settings
	d.d = done
	d.t = ticker
}

func (d *Discoverer) UpdateScan(scanDuration int) {
	defer logger.Out0(logger.In2("network/neighbour", "Discoverer.UpdateScan", "d", d, "scanDuration", scanDuration))
	d.LastScanningTime = time.Now().Unix()
	results := d.Host.Scan(scanDuration, d.Host.Host.Domain)
	d.NearbyHosts = results

	//Record all scanned host into database
	for _, thisHost := range results {
		thisHostIpString := []string{}
		for _, ipaddr := range thisHost.IPv4 {
			thisHostIpString = append(thisHostIpString, ipaddr.String())
		}
		thisHostRecord := HostRecord{
			Name:       thisHost.HostName,
			Model:      thisHost.Model,
			Version:    thisHost.MinorVersion,
			UUID:       thisHost.UUID,
			LastSeenIP: thisHostIpString,
			MacAddr:    thisHost.MacAddr,
			LastOnline: time.Now().Unix(),
		}
		d.Database.Write("neighbour", thisHost.UUID, thisHostRecord)
	}
}

func (d *Discoverer) GetOfflineHosts() (out0 []*HostRecord, out1 error) {
	defer logger.Out2(logger.In1("network/neighbour", "Discoverer.GetOfflineHosts", "d", d), &out0, &out1)
	results := []*HostRecord{}
	entries, err := d.Database.ListTable("neighbour")
	if err != nil {
		logger.DebugErr("network/neighbour", err)
		return results, err
	}
	for _, keypairs := range entries {
		//Get the host record and UUI from the database
		thisHostUUID := string(keypairs[0])
		thisHostRecord := HostRecord{}
		json.Unmarshal(keypairs[1], &thisHostRecord)

		if time.Now().Unix()-thisHostRecord.LastOnline > AutoDeleteRecordTime {
			//Remove this record
			logger.PrintAndLog("Neighbour", "[Neighbour] Removing network host record due to long period offline: "+thisHostUUID+" ("+thisHostRecord.Name+")", nil)
			d.Database.Delete("neighbour", thisHostUUID)
			continue
		}
		//Check this host is online
		nodeIsOnline := false
		for _, thisOnlineHost := range d.NearbyHosts {
			if thisOnlineHost.UUID == thisHostUUID {
				//This is online node. skip this
				nodeIsOnline = true
				break
			}
		}

		if !nodeIsOnline {
			results = append(results, &thisHostRecord)
		}
	}

	return results, nil
}

// Try to wake on lan one of the network host
func (d *Discoverer) SendWakeOnLan(macAddr string) error {
	logger.DebugTrace("network/neighbour", "Discoverer.SendWakeOnLan")
	return wakeonlan.WakeTarget(macAddr)
}

func (d *Discoverer) ScannerRunning() (out0 bool) {
	defer logger.Out1(logger.In1("network/neighbour", "Discoverer.ScannerRunning", "d", d), &out0)
	if d.d != nil {
		return true
	} else {
		return false
	}
}

func (d *Discoverer) StopScanning() {
	defer logger.Out0(logger.In1("network/neighbour", "Discoverer.StopScanning", "d", d))
	if d.d != nil {
		//Another ticker already running. Terminate it
		d.d <- true

		//Clear the old ticker
		d.t.Stop()

		d.d = nil
		d.t = nil
	}
	logger.PrintAndLog("Neighbour", "ArozOS Neighbour Scanning Stopped", nil)
}
