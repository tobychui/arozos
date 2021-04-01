package main

import (
	"log"
	"net/http"

	"imuslab.com/arozos/mod/cluster/aclient"
	"imuslab.com/arozos/mod/network/neighbour"
	prout "imuslab.com/arozos/mod/prouter"
)

/*
	Functions related to ArozOS clusters
	Author: tobychui

	This is a section of the arozos core that handle cluster
	related function endpoints

*/

var (
	NeighbourDiscoverer *neighbour.Discoverer
)

func ClusterInit() {
	//Only enable cluster scanning on mdns enabled mode
	if *allow_mdns && MDNS != nil {
		//Start the network discovery
		thisDiscoverer := neighbour.NewDiscoverer(MDNS)
		//Start a scan immediately (in go routine for non blocking)
		go func() {
			thisDiscoverer.UpdateScan(3)
		}()

		//Setup the scanning timer
		thisDiscoverer.StartScanning(300, 5)
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

		/*
			Start and Cluster Server and Client
		*/

		if *allow_clustering {
			aclient.NewClient(aclient.AclientOption{
				MDNS: MDNS,
			})
		}

	} else {
		log.Println("MDNS not enabled or startup failed. Skipping Cluster Scanner initiation.")
	}

}
