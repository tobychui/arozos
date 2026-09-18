package main

import (
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"imuslab.com/arozos/mod/cluster/capability"
	"imuslab.com/arozos/mod/cluster/membership"
	"imuslab.com/arozos/mod/info/usageinfo"
	"imuslab.com/arozos/mod/network/neighbour"
	prout "imuslab.com/arozos/mod/prouter"
)

/*
	Functions related to ArozOS clusters
	Author: tobychui

	This is a section of the arozos core that handle cluster
	related function endpoints:

	- Neighbourhood: mDNS discovery of nearby ArozOS hosts (LAN only)
	- Cluster membership: the cluster agent of this node (mod/cluster/membership)
	  reachable by other nodes under /cluster/acn/* (see main.router.go)
*/

var (
	NeighbourDiscoverer *neighbour.Discoverer
	clusterManager      *membership.Manager
)

// clusterHealthProvider builds the load snapshot shipped with each heartbeat.
// RAM figures are cached because reading them shells out on some platforms.
type clusterHealthProvider struct {
	mu        sync.Mutex
	ramUsed   int64
	ramTotal  int64
	ramSample time.Time
}

func (p *clusterHealthProvider) snapshot() membership.Health {
	h := membership.Health{}
	if cpu, _, _, _, ready := usageinfo.GetCachedStats(); ready {
		h.CPUUsage = cpu
	}
	p.mu.Lock()
	if time.Since(p.ramSample) > time.Minute {
		used, total := usageinfo.GetNumericRAMUsage()
		if total > 0 {
			p.ramUsed, p.ramTotal = used, total
		}
		p.ramSample = time.Now()
	}
	h.RAMUsed, h.RAMTotal = p.ramUsed, p.ramTotal
	p.mu.Unlock()
	if free, total, err := capability.DiskUsage(filepath.Clean(*root_directory)); err == nil {
		h.DiskFree, h.DiskTotal = free, total
	}
	return h
}

func ClusterInit() {
	//Cluster agent: always available so a node can create or join a cluster
	//from System Settings regardless of the LAN discovery features
	health := &clusterHealthProvider{}
	manager, err := membership.NewManager(membership.Option{
		NodeID:      deviceUUID,
		DBFile:      filepath.Join("system", "cluster.db"),
		KeyFile:     filepath.Join("system", "cluster", "node.key"),
		Version:     build_version + " " + internal_version,
		DefaultName: *host_name,
		Health:      health.snapshot,
	})
	if err != nil {
		systemWideLogger.PrintAndLog("Cluster", "Unable to start cluster agent: "+err.Error(), err)
	} else {
		clusterManager = manager

		adminRouter := prout.NewModuleRouter(prout.RouterOption{
			ModuleName:  "System Setting",
			AdminOnly:   true,
			UserHandler: userHandler,
			DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
				errorHandlePermissionDenied(w, r)
			},
		})
		clusterManager.RegisterAdminRoutes(func(pattern string, handler func(http.ResponseWriter, *http.Request)) {
			adminRouter.HandleFunc(pattern, handler)
		})

		registerSetting(settingModule{
			Name:         "Cluster",
			Desc:         "Create or join an ArozOS cluster",
			IconPath:     "SystemAO/cluster/img/small_icon.png",
			Group:        "Cluster",
			StartDir:     "SystemAO/cluster/cluster.html",
			RequireAdmin: true,
		})
	}

	//Only enable neighbourhood scanning on mdns enabled mode
	if *allow_mdns && MDNS != nil {
		//Start the network discovery
		thisDiscoverer := neighbour.NewDiscoverer(MDNS, sysdb)
		//Start a scan immediately (in go routine for non blocking)
		go func() {
			thisDiscoverer.UpdateScan(10)
		}()

		//Setup the scanning timer
		thisDiscoverer.StartScanning(300, 15)
		NeighbourDiscoverer = &thisDiscoverer

		//Register the settings
		registerSetting(settingModule{
			Name:         "Neighbourhood",
			Desc:         "Nearby ArOZ Host for Clustering",
			IconPath:     "SystemAO/cluster/img/small_icon.png",
			Group:        "Cluster",
			StartDir:     "SystemAO/cluster/neighbour.html",
			RequireAdmin: false,
		})

		//Register cluster scanning endpoints
		router := prout.NewModuleRouter(prout.RouterOption{
			ModuleName:  "System Setting",
			UserHandler: userHandler,
			DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
				errorHandlePermissionDenied(w, r)
			},
		})

		router.HandleFunc("/system/cluster/scan", NeighbourDiscoverer.HandleScanningRequest)
		router.HandleFunc("/system/cluster/record", NeighbourDiscoverer.HandleScanRecord)
		router.HandleFunc("/system/cluster/wol", NeighbourDiscoverer.HandleWakeOnLan)
	} else {
		systemWideLogger.PrintAndLog("Cluster", "MDNS not enabled or startup failed. Skipping Cluster Scanner initiation.", nil)
	}
}

// ClusterShutdown stops heartbeats and tunnels before the process exits.
func ClusterShutdown() {
	if clusterManager != nil {
		clusterManager.Close()
	}
}
