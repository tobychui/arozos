package main

import (
	"io"
	"net/http"
	"net/url"
	"path/filepath"
	"sync"
	"time"

	"encoding/json"
	"errors"
	"strings"

	"imuslab.com/arozos/mod/cluster/capability"
	"imuslab.com/arozos/mod/cluster/events"
	"imuslab.com/arozos/mod/cluster/identity"
	"imuslab.com/arozos/mod/cluster/jobs"
	"imuslab.com/arozos/mod/cluster/membership"
	"imuslab.com/arozos/mod/cluster/metadata"
	"imuslab.com/arozos/mod/cluster/replication"
	"imuslab.com/arozos/mod/cluster/scheduling"
	"imuslab.com/arozos/mod/cluster/storage"
	fs "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/abstractions/clusterfs"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/usageinfo"
	"imuslab.com/arozos/mod/network/neighbour"
	prout "imuslab.com/arozos/mod/prouter"
	"imuslab.com/arozos/mod/time/nightly"
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
	clusterMetadata     *metadata.Manager
	clusterStorage      *storage.Service
	clusterReplication  *replication.Manager
	clusterEvents       *events.Bus
	clusterJobs         *jobs.Manager
	clusterScheduling   *scheduling.Manager
	clusterMountMu      sync.Mutex
)

// clusterRunHook executes an event hook script as its owner with the event
// readable through postPara("event") (JSON).
func clusterRunHook(h events.Hook, ev events.Event) error {
	if AGIGateway == nil {
		return errors.New("AGI gateway not ready")
	}
	u, err := userHandler.GetUserInfoFromUsername(h.Owner)
	if err != nil {
		return err
	}
	fsh, err := u.GetFileSystemHandlerFromVirtualPath(h.Script)
	if err != nil {
		return err
	}
	rpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(h.Script, u.Username)
	if err != nil {
		return err
	}
	if !fsh.FileSystemAbstraction.FileExists(rpath) {
		return errors.New("hook script not found: " + h.Script)
	}
	js, _ := json.Marshal(ev)
	form := "event=" + url.QueryEscape(string(js))
	req, _ := http.NewRequest(http.MethodPost, "/system/cluster/events/hook", strings.NewReader(form))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	_, _, err = AGIGateway.ExecuteAGIScriptAsUser(fsh, rpath, u, nil, req)
	return err
}

// clusterProvider adapts the cluster services to the AGI cluster library.
type clusterProvider struct{}

func (c *clusterProvider) InCluster() bool {
	return clusterManager != nil && clusterManager.InCluster()
}
func (c *clusterProvider) Self() interface{} {
	for _, n := range clusterManager.NodeViews() {
		if n.Local {
			return n
		}
	}
	return nil
}
func (c *clusterProvider) Nodes() interface{} { return clusterManager.NodeViews() }
func (c *clusterProvider) Status() interface{} {
	out := map[string]interface{}{"cluster": clusterManager.Cluster(), "identityOrigin": clusterManager.IdentityOrigin()}
	if clusterMetadata != nil {
		out["metadata"] = clusterMetadata.Status()
		out["volumes"] = clusterMetadata.Volumes()
	}
	if clusterStorage != nil {
		out["storage"] = clusterStorage.Status()
	}
	if clusterReplication != nil {
		out["replication"] = clusterReplication.Status()
	}
	return out
}
func (c *clusterProvider) Stat(path string) (interface{}, error) {
	if clusterMetadata == nil {
		return nil, errors.New("metadata store not available")
	}
	return clusterMetadata.Stat(path)
}
func (c *clusterProvider) List(path string) (interface{}, error) {
	if clusterMetadata == nil {
		return nil, errors.New("metadata store not available")
	}
	return clusterMetadata.ListDir(path)
}
func (c *clusterProvider) SetReplicas(path string, n int) error {
	if clusterMetadata == nil {
		return errors.New("metadata store not available")
	}
	if n < 0 || n > 16 {
		return errors.New("replicas must be between 0 and 16")
	}
	rec, err := clusterMetadata.Stat(path)
	if err != nil {
		return err
	}
	rec.Replicas = n
	return clusterMetadata.Submit(metadata.KindFile, rec)
}
func (c *clusterProvider) SetPolicy(folder string, n int) error {
	if clusterMetadata == nil {
		return errors.New("metadata store not available")
	}
	if n < 1 || n > 16 {
		return errors.New("replicas must be between 1 and 16")
	}
	return clusterMetadata.Submit(metadata.KindPolicy, &metadata.Policy{Folder: folder, Replicas: n})
}
func (c *clusterProvider) AddHook(owner string, types []string, script string) (interface{}, error) {
	if clusterEvents == nil {
		return nil, errors.New("event bus not available")
	}
	return clusterEvents.AddHook(owner, types, script)
}
func (c *clusterProvider) RemoveHook(id string, owner string) error {
	if clusterEvents == nil {
		return errors.New("event bus not available")
	}
	return clusterEvents.RemoveHook(id, owner)
}
func (c *clusterProvider) Hooks(owner string) interface{} {
	if clusterEvents == nil {
		return []events.Hook{}
	}
	return clusterEvents.Hooks(owner)
}
func (c *clusterProvider) SubmitJob(owner string, name string, scriptVpath string, args []byte, inputs []string, features []string, nodes []string, timeoutSec int, dataset string, partitionMax int) (interface{}, error) {
	if clusterJobs == nil {
		return nil, errors.New("cluster jobs not available")
	}
	source, err := clusterReadScript(owner, scriptVpath)
	if err != nil {
		return nil, err
	}
	req := jobs.SubmitRequest{
		Name: name, ScriptVpath: scriptVpath, Script: source,
		Inputs: inputs, Features: features, Nodes: nodes, TimeoutSec: timeoutSec,
		Dataset: dataset, PartitionMax: partitionMax,
	}
	if len(args) > 0 && json.Valid(args) {
		req.Args = json.RawMessage(args)
	}
	return clusterJobs.Submit(jobs.SpecFrom(req, owner))
}
func (c *clusterProvider) JobStatus(id string, requester string, isAdmin bool) (interface{}, error) {
	if clusterJobs == nil {
		return nil, errors.New("cluster jobs not available")
	}
	rec, ok := clusterJobs.Get(id)
	if !ok || (!isAdmin && rec.Spec.Owner != requester) {
		return nil, errors.New("job not found")
	}
	return rec, nil
}
func (c *clusterProvider) JobList(owner string) interface{} {
	if clusterJobs == nil {
		return []jobs.Record{}
	}
	return clusterJobs.List(owner)
}
func (c *clusterProvider) CancelJob(id string, requester string, isAdmin bool) error {
	if clusterJobs == nil {
		return errors.New("cluster jobs not available")
	}
	return clusterJobs.Cancel(id, requester, isAdmin)
}
func (c *clusterProvider) WaitJob(id string, timeoutSec int, requester string, isAdmin bool) (interface{}, error) {
	if clusterJobs == nil {
		return nil, errors.New("cluster jobs not available")
	}
	rec, ok := clusterJobs.Get(id)
	if !ok || (!isAdmin && rec.Spec.Owner != requester) {
		return nil, errors.New("job not found")
	}
	return clusterJobs.WaitFor(id, timeoutSec)
}
func (c *clusterProvider) Emit(user string, evType string, data []byte) error {
	if clusterEvents == nil {
		return errors.New("event bus not available")
	}
	evType = strings.ToLower(strings.TrimSpace(evType))
	if evType == "" {
		return errors.New("event type required")
	}
	if !strings.HasPrefix(evType, "app.") {
		evType = "app." + evType
	}
	if len(data) > 64<<10 {
		return errors.New("event data too large (64 KB max)")
	}
	clusterEvents.Publish(events.Event{Type: evType, User: user, Data: json.RawMessage(data)})
	return nil
}

// clusterLocalRoots lists the local, non-buffered drives a volume may live on.
func clusterLocalRoots() map[string]string {
	roots := map[string]string{}
	for _, fsh := range GetAllLoadedFsh() {
		if fsh == nil || fsh.Closed || fsh.RequireBuffer || fsh.UUID == "tmp" || fsh.UUID == "cluster" {
			continue
		}
		if arozfs.IsNetworkDrive(fsh.Filesystem) {
			continue
		}
		roots[fsh.UUID] = filepath.Clean(fsh.Path)
	}
	return roots
}

// clusterBackend adapts the storage service to the clusterfs backend interface.
type clusterBackend struct{ s *storage.Service }

func toInfo(i storage.Info) clusterfs.Info {
	return clusterfs.Info{Path: i.Path, IsDir: i.IsDir, Size: i.Size, ModTime: i.ModTime}
}
func (b *clusterBackend) Stat(p string) (clusterfs.Info, error) {
	i, err := b.s.Stat(p)
	return toInfo(i), err
}
func (b *clusterBackend) List(p string) ([]clusterfs.Info, error) {
	items, err := b.s.List(p)
	if err != nil {
		return nil, err
	}
	out := make([]clusterfs.Info, 0, len(items))
	for _, i := range items {
		out = append(out, toInfo(i))
	}
	return out, nil
}
func (b *clusterBackend) Mkdir(p string, owner string) error       { return b.s.Mkdir(p, owner) }
func (b *clusterBackend) Remove(p string, recursive bool) error    { return b.s.Remove(p, recursive) }
func (b *clusterBackend) Rename(o string, n string) error          { return b.s.Rename(o, n) }
func (b *clusterBackend) OpenRead(p string) (io.ReadCloser, error) { return b.s.OpenRead(p) }
func (b *clusterBackend) Write(p string, r io.Reader, owner string) error {
	return b.s.Write(p, r, owner)
}
func (b *clusterBackend) Ready() bool { return b.s.Ready() }

// clusterMountDrive attaches the cluster:/ drive to the base storage pool so
// every user sees it, and clusterUnmountDrive removes it again.
// clusterDriveWanted reports whether cluster:/ should be visible: this node
// is in a cluster and the cluster has at least one volume to keep files in.
// Without either, the drive is left out of File Manager and every other part
// of the system, nightly tasks included.
func clusterDriveWanted() bool {
	if clusterManager == nil || clusterStorage == nil || clusterMetadata == nil || !clusterManager.InCluster() {
		return false
	}
	return clusterHasVolume(clusterMetadata.Volumes())
}

// clusterHasVolume reports whether any volume is still part of the cluster.
func clusterHasVolume(vols []metadata.Volume) bool {
	for _, v := range vols {
		if !v.Removed {
			return true
		}
	}
	return false
}

/*
	Master node

	Nightly maintenance of cluster:/ (expired trash, old version history)
	acts on files every member can see, so letting every node run it means
	doing the same scan, and the same deletions, once per node. The master
	node is the node holding the metadata leader lease, which is also the
	node that hands out placement and replication decisions.
*/

// clusterIsMasterNode reports whether this node maintains the storage shared
// by the cluster. A node with no cluster is the only node there is, so it is
// its own master.
func clusterIsMasterNode() bool {
	if *disable_cluster || clusterManager == nil || clusterMetadata == nil || !clusterManager.InCluster() {
		return true
	}
	return clusterMetadata.IsLeader()
}

// nightlyFshOption returns how nightly maintenance of one file system handler
// should be run: a drive shared by the whole cluster is maintained by the
// master node only, every other drive by the host it belongs to.
func nightlyFshOption(fsh *fs.FileSystemHandler) nightly.TaskOption {
	if fsh != nil && fsh.Filesystem == "cluster" {
		return nightly.TaskOption{Name: "cluster:/ maintenance", MasterNodeOnly: true}
	}
	return nightly.TaskOption{}
}

// nightlyShouldMaintainFsh reports whether tonight's maintenance of this file
// system handler belongs to this host.
func nightlyShouldMaintainFsh(fsh *fs.FileSystemHandler) bool {
	return nightlyManager.ShouldRun(nightlyFshOption(fsh))
}

// clusterSyncDrive mounts or unmounts cluster:/ to match clusterDriveWanted.
func clusterSyncDrive() {
	if clusterDriveWanted() {
		clusterMountDrive()
	} else {
		clusterUnmountDrive()
	}
}

func clusterMountDrive() {
	clusterMountMu.Lock()
	defer clusterMountMu.Unlock()
	if clusterStorage == nil || baseStoragePool == nil || !clusterManager.InCluster() {
		return
	}
	if baseStoragePool.ContainDiskID("cluster") {
		return
	}
	handler := &fs.FileSystemHandler{
		Name:                  "Cluster",
		UUID:                  "cluster",
		Path:                  "cluster:/",
		Hierarchy:             "public",
		HierarchyConfig:       fs.DefaultEmptyHierarchySpecificConfig,
		ReadOnly:              false,
		RequireBuffer:         true,
		InitiationTime:        time.Now().Unix(),
		FileSystemAbstraction: clusterfs.New("cluster", &clusterBackend{s: clusterStorage}),
		Filesystem:            "cluster",
		StartOptions:          fs.FileSystemOption{Name: "Cluster", Uuid: "cluster", Path: "cluster:/", Hierarchy: "public", Filesystem: "cluster"},
		RuntimePersistenceConfig: fs.RuntimePersistenceConfig{
			LocalBufferPath: *tmp_directory,
		},
	}
	if err := baseStoragePool.AttachFsHandler(handler); err != nil {
		systemWideLogger.PrintAndLog("Cluster", "Unable to mount cluster drive: "+err.Error(), err)
		return
	}
	systemWideLogger.PrintAndLog("Cluster", "cluster:/ mounted for all users", nil)
}

func clusterUnmountDrive() {
	clusterMountMu.Lock()
	defer clusterMountMu.Unlock()
	if baseStoragePool == nil || !baseStoragePool.ContainDiskID("cluster") {
		return
	}
	baseStoragePool.DetachFsHandler("cluster")
	systemWideLogger.PrintAndLog("Cluster", "cluster:/ unmounted", nil)
}

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
	if *disable_cluster {
		systemWideLogger.PrintAndLog("Cluster", "Cluster features are disabled by the -disable_cluster flag", nil)
	} else {
		clusterStartAgent()
	}
	clusterStartNeighbourhood()

	//Let the nightly tasks know which node maintains the shared storage
	nightlyManager.SetMasterNodeResolver(clusterIsMasterNode)
}

// clusterStartAgent starts the cluster agent and every cluster service on
// top of it. It is always available unless -disable_cluster is set, so a node
// can create or join a cluster from System Settings regardless of the LAN
// discovery features.
func clusterStartAgent() {
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
		//Settings first, then Info; Cluster Jobs is added once the job runtime starts
		registerSetting(settingModule{
			Name:         "Cluster Settings",
			Desc:         "Create or join a cluster and set up its storage and scheduling",
			IconPath:     "SystemAO/cluster/img/small_icon.png",
			Group:        "Cluster",
			StartDir:     "SystemAO/cluster/cluster.html",
			RequireAdmin: true,
		})
		registerSetting(settingModule{
			Name:         "Cluster Info",
			Desc:         "Health of this node, its peers, replication and scheduling",
			IconPath:     "SystemAO/cluster/img/small_icon.png",
			Group:        "Cluster",
			StartDir:     "SystemAO/cluster/clusterinfo.html",
			RequireAdmin: true,
		})

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

		//Metadata store: replicated namespace index + leader lease
		mdm, err := metadata.New(metadata.Option{Membership: clusterManager})
		if err != nil {
			systemWideLogger.PrintAndLog("Cluster", "Unable to start cluster metadata store: "+err.Error(), err)
		} else {
			clusterMetadata = mdm
			clusterMetadata.RegisterAdminRoutes(registerAdmin)

			//Placement scoring shared by jobs, writes and replication
			if sch, err := scheduling.New(clusterManager, clusterMetadata); err != nil {
				systemWideLogger.PrintAndLog("Cluster", "Unable to start cluster scheduling: "+err.Error(), err)
			} else {
				clusterScheduling = sch
				clusterScheduling.RegisterAdminRoutes(registerAdmin, clusterSchedExplain)
			}

			//Storage: volumes, chunked transfer and the cluster:/ drive
			sto, err := storage.New(storage.Option{
				Membership: clusterManager,
				Metadata:   clusterMetadata,
				Scheduler:  clusterScheduling,
				TmpDir:     *tmp_directory,
				LocalRoots: clusterLocalRoots,
			})
			if err != nil {
				systemWideLogger.PrintAndLog("Cluster", "Unable to start cluster storage: "+err.Error(), err)
			} else {
				clusterStorage = sto
				clusterStorage.RegisterAdminRoutes(registerAdmin)
				prevChange := clusterManager.OnMembershipChange
				clusterManager.OnMembershipChange = func(in bool) {
					if prevChange != nil {
						prevChange(in)
					}
					clusterSyncDrive()
				}
				//Show or hide cluster:/ as volumes come and go
				clusterMetadata.OnChange = func(kind string, payload []byte) {
					if kind == metadata.KindVolume {
						go clusterSyncDrive()
					}
				}
				clusterSyncDrive()

				//Event bus: file / replica / node events, script hooks, web feed
				bus, err := events.New(clusterManager, clusterRunHook)
				if err != nil {
					systemWideLogger.PrintAndLog("Cluster", "Unable to start cluster event bus: "+err.Error(), err)
				} else {
					clusterEvents = bus
					clusterStorage.OnFileWritten = func(rec metadata.FileRecord) {
						bus.Publish(events.Event{Type: "file.created", Path: rec.Path, FileID: rec.ID, User: rec.Owner})
					}
					clusterStorage.OnFileRemoved = func(rec metadata.FileRecord) {
						bus.Publish(events.Event{Type: "file.removed", Path: rec.Path, FileID: rec.ID, User: rec.Owner})
					}
					clusterStorage.OnFileRenamed = func(oldPath string, rec metadata.FileRecord) {
						data, _ := json.Marshal(map[string]string{"from": oldPath})
						bus.Publish(events.Event{Type: "file.renamed", Path: rec.Path, FileID: rec.ID, User: rec.Owner, Data: data})
					}
					clusterStorage.OnReplicaVerified = func(rec metadata.FileRecord, volumeID string) {
						data, _ := json.Marshal(map[string]string{"volume": volumeID})
						bus.Publish(events.Event{Type: "replica.verified", Path: rec.Path, FileID: rec.ID, Data: data})
					}
					clusterStorage.OnReplicaStale = func(rec metadata.FileRecord, volumeID string) {
						data, _ := json.Marshal(map[string]string{"volume": volumeID})
						bus.Publish(events.Event{Type: "replica.stale", Path: rec.Path, FileID: rec.ID, Data: data})
					}
					clusterStorage.OnDiskFull = func(vol metadata.Volume) {
						data, _ := json.Marshal(map[string]interface{}{"volume": vol.ID, "name": vol.Name, "free": vol.Free, "capacity": vol.Capacity})
						bus.Publish(events.Event{Type: "node.diskfull", Node: vol.NodeID, Data: data})
					}
					userRouter := prout.NewModuleRouter(prout.RouterOption{
						ModuleName:  "System Setting",
						AdminOnly:   false,
						UserHandler: userHandler,
						DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
							errorHandlePermissionDenied(w, r)
						},
					})
					userRouter.HandleFunc("/system/cluster/events/ws", bus.HandleWebSocket)
					userRouter.HandleFunc("/system/cluster/events/hooks", func(w http.ResponseWriter, r *http.Request) {
						u, err := userHandler.GetUserInfoFromRequest(w, r)
						if err != nil {
							errorHandlePermissionDenied(w, r)
							return
						}
						owner := u.Username
						if u.IsAdmin() {
							owner = ""
						}
						js, _ := json.Marshal(bus.Hooks(owner))
						w.Header().Set("Content-Type", "application/json")
						w.Write(js)
					})
				}

				//Job runtime and scheduler
				jm, err := jobs.New(jobs.Option{
					Membership:    clusterManager,
					Metadata:      clusterMetadata,
					Executor:      &clusterJobExecutor{},
					Scheduler:     clusterScheduling,
					LocalityBytes: clusterJobLocality,
				})
				if err != nil {
					systemWideLogger.PrintAndLog("Cluster", "Unable to start cluster jobs: "+err.Error(), err)
				} else {
					clusterJobs = jm
					if clusterEvents != nil {
						clusterJobs.OnFinished = func(rec jobs.Record) {
							evType := "job.completed"
							if rec.State.Status != jobs.StatusSucceeded {
								evType = "job.failed"
							}
							data, _ := json.Marshal(map[string]string{"name": rec.Spec.Name, "status": rec.State.Status, "error": rec.State.Error})
							clusterEvents.Publish(events.Event{Type: evType, FileID: rec.Spec.ID, User: rec.Spec.Owner, Node: rec.State.Node, Data: data})
						}
					}
					jobRouter := prout.NewModuleRouter(prout.RouterOption{
						ModuleName:  "Tasks Scheduler",
						AdminOnly:   false,
						UserHandler: userHandler,
						DeniedHandler: func(w http.ResponseWriter, r *http.Request) {
							errorHandlePermissionDenied(w, r)
						},
					})
					clusterJobs.RegisterUserRoutes(func(pattern string, handler func(http.ResponseWriter, *http.Request)) {
						jobRouter.HandleFunc(pattern, handler)
					}, clusterJobCaller, clusterJobSubmit)
					registerSetting(settingModule{
						Name:         "Cluster Jobs",
						Desc:         "Run scripts on any node of the cluster",
						IconPath:     "SystemAO/cluster/img/small_icon.png",
						Group:        "Cluster",
						StartDir:     "SystemAO/cluster/jobs.html",
						RequireAdmin: false,
					})
				}

				//AGI "cluster" library
				if AGIGateway != nil {
					AGIGateway.Option.ClusterProvider = &clusterProvider{}
					AGIGateway.ClusterLibRegister()
				}

				//Replication: keep every file at its policy's copy count
				rep, err := replication.New(replication.Option{
					Membership: clusterManager,
					Metadata:   clusterMetadata,
					Storage:    clusterStorage,
					Scheduler:  clusterScheduling,
				})
				if err != nil {
					systemWideLogger.PrintAndLog("Cluster", "Unable to start cluster replication: "+err.Error(), err)
				} else {
					clusterReplication = rep
					clusterReplication.RegisterAdminRoutes(registerAdmin)
					//Nightly integrity pass over this node's copies (1 GB budget)
					nightlyManager.RegisterNightlyTask(func() {
						if clusterStorage != nil && clusterManager.InCluster() {
							clusterStorage.VerifyLocalCopies(1 << 30)
						}
					})
				}
			}
		}

	}

}

// clusterStartNeighbourhood runs the older mDNS neighbour discovery, which is
// separate from the cluster and governed by -allow_mdns.
func clusterStartNeighbourhood() {
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
	if clusterJobs != nil {
		clusterJobs.Close()
	}
	if clusterEvents != nil {
		clusterEvents.Close()
	}
	if clusterReplication != nil {
		clusterReplication.Close()
	}
	if clusterStorage != nil {
		clusterStorage.Close()
	}
	if clusterMetadata != nil {
		clusterMetadata.Close()
	}
	if clusterIdentity != nil {
		clusterIdentity.Close()
	}
	if clusterManager != nil {
		clusterManager.Close()
	}
}
