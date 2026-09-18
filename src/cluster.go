package main

import (
	"net/http"
	"path/filepath"
	"sync"
	"time"

	"imuslab.com/arozos/mod/cluster/capability"
	"imuslab.com/arozos/mod/cluster/identity"
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
	clusterIdentity     *identity.Manager
)

// clusterAccountStore adapts the auth agent and permission handler to the
// identity service's AccountStore interface.
type clusterAccountStore struct{}

func (s *clusterAccountStore) UserExists(username string) bool { return authAgent.UserExists(username) }
func (s *clusterAccountStore) PasswordHash(username string) (string, error) {
	return authAgent.GetPasswordHash(username)
}
func (s *clusterAccountStore) SetPasswordHash(username string, hash string) error {
	return authAgent.SetPasswordHash(username, hash)
}
func (s *clusterAccountStore) Groups(username string) ([]string, error) {
	return authAgent.GetUserGroups(username)
}
func (s *clusterAccountStore) SetGroups(username string, groups []string) error {
	return authAgent.SetUserGroups(username, groups)
}
func (s *clusterAccountStore) ListUsers() []string { return authAgent.ListUsers() }
func (s *clusterAccountStore) DeleteUser(username string) error {
	return authAgent.UnregisterUser(username)
}
func (s *clusterAccountStore) GroupExists(group string) bool {
	return permissionHandler.GroupExists(group)
}

// clusterNotifyPasswordChanged forwards a password change of a replicated
// account to the identity origin. Safe to call when clustering is off.
func clusterNotifyPasswordChanged(username string, passwordHash string) {
	if clusterIdentity != nil {
		clusterIdentity.NotifyPasswordChanged(username, passwordHash)
	}
}

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
		registerAdmin := func(pattern string, handler func(http.ResponseWriter, *http.Request)) {
			adminRouter.HandleFunc(pattern, handler)
		}
		clusterManager.RegisterAdminRoutes(registerAdmin)

		//Identity service: forward auth to the cluster's identity origin with
		//replicated accounts as fallback, plus signed user assertions
		idm, err := identity.New(identity.Option{
			Membership: clusterManager,
			Accounts:   &clusterAccountStore{},
		})
		if err != nil {
			systemWideLogger.PrintAndLog("Cluster", "Unable to start cluster identity service: "+err.Error(), err)
		} else {
			clusterIdentity = idm
			authAgent.ForwardAuth = clusterIdentity.ForwardAuth
			clusterIdentity.RegisterAdminRoutes(registerAdmin)
		}

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
	if clusterIdentity != nil {
		clusterIdentity.Close()
	}
	if clusterManager != nil {
		clusterManager.Close()
	}
}
