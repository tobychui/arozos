package membership

/*
	ArozOS Cluster - membership manager

	The Manager is the cluster agent of one node. It owns the node key, the
	cluster database, the ACN server/transport and keeps the replicated
	membership view converged with the other nodes through heartbeats.

	Life cycle of a node:

		standalone --CreateCluster/JoinCluster--> member --LeaveCluster/evicted--> standalone

	Every node stays a fully working standalone ArozOS whatever its state.
*/

import (
	"context"
	"crypto/ed25519"
	"encoding/json"
	"errors"
	"net/http"
	"sort"
	"strings"
	"sync"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/cluster/acn"
	"imuslab.com/arozos/mod/cluster/capability"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
)

// Option configures a Manager.
type Option struct {
	NodeID       string
	DBFile       string
	KeyFile      string
	Version      string
	DefaultName  string
	Capabilities func() capability.Manifest
	Health       func() Health
}

// Manager is the cluster agent of this node.
type Manager struct {
	opt   Option
	store *store
	key   *acn.NodeKey

	mu      sync.RWMutex
	cluster *ClusterInfo
	nodes   map[string]*NodeRecord
	tokens  map[string]*JoinToken
	config  LocalConfig
	caps    capability.Manifest

	signer    *acn.Signer
	verifier  *acn.Verifier
	hub       *acn.TunnelHub
	server    *acn.Server
	transport *acn.Transport
	tunnel    *acn.TunnelClient

	loopMu    sync.Mutex
	loopStop  chan struct{}
	loopWG    sync.WaitGroup
	reachable map[string]bool    //last known reachability per peer, for log de-duplication
	latency   map[string]float64 //EWMA round trip to each peer, milliseconds
	latencyMx latencyCache       //cached pairwise matrix collected from peers
	started   time.Time

	//OnClusterChange fires (outside the lock) whenever the replicated
	//cluster-wide settings change, locally or through gossip.
	OnClusterChange func()
	//OnMembershipChange fires (outside the lock) when this node enters or
	//leaves a cluster, so sibling services can mount / unmount resources.
	OnMembershipChange func(inCluster bool)
}

func (m *Manager) fireMembershipChange(inCluster bool) {
	defer logger.Out0(logger.In2("cluster/membership", "Manager.fireMembershipChange", "m", m, "inCluster", inCluster))
	m.mu.RLock()
	cb := m.OnMembershipChange
	m.mu.RUnlock()
	if cb != nil {
		cb(inCluster)
	}
}

var (
	ErrNotInCluster     = errors.New("this node is not part of a cluster")
	ErrAlreadyInCluster = errors.New("this node is already part of a cluster, leave it first")
	ErrNodeNotFound     = errors.New("node not found")
)

// NewManager opens the cluster database and node key and, when the node was
// part of a cluster before the restart, resumes membership.
func NewManager(opt Option) (out0 *Manager, out1 error) {
	defer logger.Out2(logger.In1("cluster/membership", "NewManager", "&opt", &opt), &out0, &out1)
	if opt.NodeID == "" {
		return nil, errors.New("node id is required")
	}
	if opt.Capabilities == nil {
		opt.Capabilities = capability.Detect
	}
	if opt.Health == nil {
		opt.Health = func() Health { return Health{} }
	}
	st, err := newStore(opt.DBFile)
	if err != nil {
		logger.DebugErr("cluster/membership", err)
		return nil, err
	}
	key, err := acn.LoadOrCreateNodeKey(opt.KeyFile)
	if err != nil {
		logger.DebugErr("cluster/membership", err)
		st.close()
		return nil, err
	}

	m := &Manager{
		opt:       opt,
		store:     st,
		key:       key,
		nodes:     map[string]*NodeRecord{},
		tokens:    map[string]*JoinToken{},
		reachable: map[string]bool{},
		latency:   map[string]float64{},
		started:   time.Now(),
	}
	m.caps = opt.Capabilities()
	m.config = st.loadConfig()
	if m.config.Name == "" {
		m.config.Name = opt.DefaultName
	}
	m.cluster = st.loadCluster()
	m.nodes = st.loadNodes()
	m.tokens = st.loadJoinTokens()

	clusterID := ""
	if m.cluster != nil {
		clusterID = m.cluster.ID
	}
	m.signer = &acn.Signer{NodeID: opt.NodeID, ClusterID: clusterID, Key: key}
	m.verifier = acn.NewVerifier(m.clusterID, m)
	m.hub = acn.NewTunnelHub(m.verifier)
	m.hub.OnConnect = m.onTunnelConnect
	m.server = acn.NewServer(m.verifier, m.hub, opt.Version)
	m.registerACNHandlers()
	m.transport = acn.NewTransport(m.signer, m, m.hub, m.config.InsecureTLS)
	m.tunnel = &acn.TunnelClient{
		Signer:        m.signer,
		Handler:       m.server,
		PickHost:      m.pickTunnelHost,
		InsecureTLS:   m.config.InsecureTLS,
		OnStateChange: m.onTunnelState,
	}

	m.mu.Lock()
	m.refreshLocalRecordLocked()
	m.mu.Unlock()

	if m.cluster != nil {
		logger.PrintAndLog("Cluster", "Resuming membership of cluster "+m.cluster.Name+" ("+m.cluster.ID+")", nil)
		m.startLoops()
	}
	return m, nil
}

// Close stops heartbeats and tunnels and closes the database.
func (m *Manager) Close() {
	defer logger.Out0(logger.In1("cluster/membership", "Manager.Close", "m", m))
	m.stopLoops()
	m.hub.Close()
	m.store.close()
}

// ACNHandler is the HTTP handler to mount at acn.BasePath.
func (m *Manager) ACNHandler() http.Handler {
	logger.DebugTrace("cluster/membership", "Manager.ACNHandler")
	return m.server
}

// Transport exposes the node-to-node transport to higher layers.
func (m *Manager) Transport() *acn.Transport {
	logger.DebugTrace("cluster/membership", "Manager.Transport")
	return m.transport
}

// Server exposes the ACN server so higher layers can register endpoints.
func (m *Manager) Server() *acn.Server {
	logger.DebugTrace("cluster/membership", "Manager.Server")
	return m.server
}

// NodeID returns the ID of this node.
func (m *Manager) NodeID() string {
	logger.DebugTrace("cluster/membership", "Manager.NodeID")
	return m.opt.NodeID
}

// Sign signs an arbitrary message with this node's key so higher layers can
// issue verifiable statements (e.g. user assertions).
func (m *Manager) Sign(message []byte) []byte {
	logger.DebugTrace("cluster/membership", "Manager.Sign")
	return ed25519.Sign(m.key.Private, message)
}

// DB exposes the cluster database so sibling cluster services can keep their
// cluster-scoped state in it (use the TableIdentity table, wiped on leave).
func (m *Manager) DB() *database.Database {
	logger.DebugTrace("cluster/membership", "Manager.DB")
	return m.store.db
}

// NodeName returns the display name of a member, or the ID when unknown.
func (m *Manager) NodeName(nodeID string) (out0 string) {
	defer logger.Out1(logger.In2("cluster/membership", "Manager.NodeName", "m", m, "nodeID", nodeID), &out0)
	m.mu.RLock()
	defer m.mu.RUnlock()
	if rec, ok := m.nodes[nodeID]; ok && rec.Name != "" {
		return rec.Name
	}
	return nodeID
}

// IdentityOrigin returns the node that verifies logins for the cluster,
// empty when unset or when not in a cluster.
func (m *Manager) IdentityOrigin() (out0 string) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.IdentityOrigin", "m", m), &out0)
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.cluster == nil {
		return ""
	}
	return m.cluster.IdentityOrigin
}

// SetIdentityOrigin makes nodeID the login authority of the cluster (empty
// disables forward authentication) and replicates the setting.
func (m *Manager) SetIdentityOrigin(nodeID string) (out0 error) {
	defer logger.Out1(logger.In2("cluster/membership", "Manager.SetIdentityOrigin", "m", m, "nodeID", nodeID), &out0)
	m.mu.Lock()
	if m.cluster == nil {
		m.mu.Unlock()
		return ErrNotInCluster
	}
	if nodeID != "" {
		rec, ok := m.nodes[nodeID]
		if !ok || rec.Removed {
			m.mu.Unlock()
			return ErrNodeNotFound
		}
	}
	m.cluster.IdentityOrigin = nodeID
	m.cluster.SettingsVersion = nextVersion(m.cluster.SettingsVersion)
	if err := m.store.saveCluster(m.cluster); err != nil {
		logger.DebugErr("cluster/membership", err)
		m.mu.Unlock()
		return err
	}
	peers := m.peerIDsLocked()
	cb := m.OnClusterChange
	m.mu.Unlock()

	if cb != nil {
		cb()
	}
	go m.broadcast(peers, acn.BasePath+"/members/sync", m.syncPayload(), 15*time.Second)
	return nil
}

// mergeClusterLocked adopts newer replicated cluster settings.
func (m *Manager) mergeClusterLocked(in *ClusterInfo) (out0 bool) {
	defer logger.Out1(logger.In2("cluster/membership", "Manager.mergeClusterLocked", "m", m, "in", in), &out0)
	if in == nil || m.cluster == nil || in.ID != m.cluster.ID {
		return false
	}
	if in.SettingsVersion <= m.cluster.SettingsVersion {
		return false
	}
	m.cluster.IdentityOrigin = in.IdentityOrigin
	m.cluster.SettingsVersion = in.SettingsVersion
	if in.Name != "" {
		m.cluster.Name = in.Name
	}
	m.store.saveCluster(m.cluster)
	return true
}

// clusterCopyLocked returns a copy of the cluster info for gossip payloads.
func (m *Manager) clusterCopyLocked() (out0 *ClusterInfo) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.clusterCopyLocked", "m", m), &out0)
	if m.cluster == nil {
		return nil
	}
	c := *m.cluster
	return &c
}

// syncPayload builds the full gossip payload (settings plus every record).
func (m *Manager) syncPayload() (out0 SyncRequest) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.syncPayload", "m", m), &out0)
	m.mu.RLock()
	defer m.mu.RUnlock()
	return SyncRequest{Cluster: m.clusterCopyLocked(), Nodes: m.allRecordsLocked()}
}

// InCluster reports whether this node is currently a cluster member.
func (m *Manager) InCluster() (out0 bool) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.InCluster", "m", m), &out0)
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cluster != nil
}

// Cluster returns a copy of the cluster info, nil when standalone.
func (m *Manager) Cluster() (out0 *ClusterInfo) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.Cluster", "m", m), &out0)
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.cluster == nil {
		return nil
	}
	c := *m.cluster
	return &c
}

func (m *Manager) clusterID() (out0 string) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.clusterID", "m", m), &out0)
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.cluster == nil {
		return ""
	}
	return m.cluster.ID
}

// ResolvePeer implements acn.PeerResolver.
func (m *Manager) ResolvePeer(nodeID string) (out0 *acn.Peer, out1 bool) {
	defer logger.Out2(logger.In2("cluster/membership", "Manager.ResolvePeer", "m", m, "nodeID", nodeID), &out0, &out1)
	m.mu.RLock()
	defer m.mu.RUnlock()
	rec, ok := m.nodes[nodeID]
	if !ok || rec.Removed {
		return nil, false
	}
	pub, err := acn.DecodePublicKey(rec.PublicKey)
	if err != nil {
		logger.DebugErr("cluster/membership", err)
		return nil, false
	}
	return &acn.Peer{
		ID:           rec.ID,
		Name:         rec.Name,
		PublicKey:    pub,
		AdvertiseURL: rec.AdvertiseURL,
		TunnelVia:    rec.TunnelVia,
	}, true
}

/*
	Local record
*/

// refreshLocalRecordLocked makes sure the record describing this node exists
// and reflects the current config, key and capabilities.
func (m *Manager) refreshLocalRecordLocked() {
	defer logger.Out0(logger.In1("cluster/membership", "Manager.refreshLocalRecordLocked", "m", m))
	now := time.Now().Unix()
	rec, ok := m.nodes[m.opt.NodeID]
	if !ok {
		rec = &NodeRecord{ID: m.opt.NodeID, Joined: now}
		m.nodes[m.opt.NodeID] = rec
	}
	changed := !ok || rec.Removed
	url := strings.TrimRight(strings.TrimSpace(m.config.AdvertiseURL), "/")
	if rec.Name != m.config.Name || rec.PublicKey != m.key.PublicKeyString() || rec.AdvertiseURL != url || rec.Version != m.opt.Version {
		changed = true
	}
	if rec.Capabilities.DetectedAt != m.caps.DetectedAt {
		changed = true
	}
	if url != "" && rec.TunnelVia != "" {
		//A reachable node never needs a tunnel host
		rec.TunnelVia = ""
		changed = true
	}
	if changed {
		rec.Name = m.config.Name
		rec.PublicKey = m.key.PublicKeyString()
		rec.AdvertiseURL = url
		rec.Version = m.opt.Version
		rec.Capabilities = m.caps
		rec.Removed = false
		rec.Updated = nextVersion(rec.Updated)
		m.store.saveNode(rec)
	}
}

// localSnapshotLocked returns the local record with fresh transient fields.
func (m *Manager) localSnapshotLocked() (out0 NodeRecord) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.localSnapshotLocked", "m", m), &out0)
	rec := m.nodes[m.opt.NodeID].Clone()
	h := m.opt.Health()
	h.Uptime = int64(time.Since(m.started).Seconds())
	h.Timestamp = time.Now().Unix()
	rec.Health = h
	rec.LastSeen = h.Timestamp
	return *rec
}

// allRecordsLocked lists every record including tombstones, self first.
func (m *Manager) allRecordsLocked() (out0 []NodeRecord) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.allRecordsLocked", "m", m), &out0)
	out := []NodeRecord{m.localSnapshotLocked()}
	ids := make([]string, 0, len(m.nodes))
	for id := range m.nodes {
		if id != m.opt.NodeID {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	for _, id := range ids {
		out = append(out, *m.nodes[id].Clone())
	}
	return out
}

func (m *Manager) peerIDsLocked() (out0 []string) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.peerIDsLocked", "m", m), &out0)
	ids := []string{}
	for id, rec := range m.nodes {
		if id != m.opt.NodeID && !rec.Removed {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)
	return ids
}

/*
	Merge
*/

// mergeRecordLocked folds one gossiped record into the local view. It reports
// whether persistent fields changed and whether this node has been evicted.
func (m *Manager) mergeRecordLocked(in NodeRecord) (changed bool, evicted bool) {
	defer logger.Out2(logger.In2("cluster/membership", "Manager.mergeRecordLocked", "m", m, "&in", &in), &changed, &evicted)
	if in.ID == "" {
		return false, false
	}
	if in.ID == m.opt.NodeID {
		local := m.nodes[m.opt.NodeID]
		if in.Updated > local.Updated {
			if in.Removed {
				return false, true
			}
			//Only admin state may be set on us by other members
			if in.AdminState != local.AdminState {
				local.AdminState = in.AdminState
				local.Updated = in.Updated
				return true, false
			}
		}
		return false, false
	}

	existing, ok := m.nodes[in.ID]
	if !ok {
		rec := in
		m.nodes[in.ID] = &rec
		return true, false
	}
	if in.Updated > existing.Updated {
		existing.Name = in.Name
		existing.PublicKey = in.PublicKey
		existing.AdvertiseURL = in.AdvertiseURL
		existing.TunnelVia = in.TunnelVia
		existing.Version = in.Version
		existing.Capabilities = in.Capabilities
		existing.AdminState = in.AdminState
		existing.Removed = in.Removed
		existing.Joined = in.Joined
		existing.Updated = in.Updated
		changed = true
	}
	if in.Health.Timestamp > existing.Health.Timestamp {
		existing.Health = in.Health
	}
	if in.LastSeen > existing.LastSeen {
		existing.LastSeen = in.LastSeen
	}
	return changed, false
}

// mergeNodes applies a batch of records, persists changes and handles eviction.
func (m *Manager) mergeNodes(records []NodeRecord) {
	logger.DebugTrace("cluster/membership", "Manager.mergeNodes")
	m.mergeGossip(nil, records)
}

// mergeGossip applies replicated cluster settings and a batch of records.
func (m *Manager) mergeGossip(cluster *ClusterInfo, records []NodeRecord) {
	defer logger.Out0(logger.In3("cluster/membership", "Manager.mergeGossip", "m", m, "cluster", cluster, "records", records))
	m.mu.Lock()
	if m.cluster == nil {
		m.mu.Unlock()
		return
	}
	settingsChanged := m.mergeClusterLocked(cluster)
	evicted := false
	for _, in := range records {
		changed, ev := m.mergeRecordLocked(in)
		if ev {
			evicted = true
		}
		if changed {
			m.store.saveNode(m.nodes[in.ID])
		}
	}
	m.gcTombstonesLocked()
	cb := m.OnClusterChange
	m.mu.Unlock()

	if settingsChanged && cb != nil {
		cb()
	}
	if evicted {
		logger.PrintAndLog("Cluster", "This node has been removed from the cluster by another member", nil)
		m.wipeLocalState()
	}
}

func (m *Manager) gcTombstonesLocked() {
	defer logger.Out0(logger.In1("cluster/membership", "Manager.gcTombstonesLocked", "m", m))
	cutoff := time.Now().Add(-TombstoneTTL).UnixMilli()
	for id, rec := range m.nodes {
		if rec.Removed && rec.Updated < cutoff && id != m.opt.NodeID {
			delete(m.nodes, id)
			m.store.deleteNode(id)
		}
	}
}

/*
	Cluster life cycle
*/

// CreateCluster turns this standalone node into the first member of a new cluster.
func (m *Manager) CreateCluster(name string) (out0 *ClusterInfo, out1 error) {
	defer logger.Out2(logger.In2("cluster/membership", "Manager.CreateCluster", "m", m, "name", name), &out0, &out1)
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, errors.New("cluster name cannot be empty")
	}
	m.mu.Lock()
	if m.cluster != nil {
		m.mu.Unlock()
		return nil, ErrAlreadyInCluster
	}
	info := &ClusterInfo{ID: uuid.NewV4().String(), Name: name, Created: time.Now().Unix()}
	if err := m.store.saveCluster(info); err != nil {
		logger.DebugErr("cluster/membership", err)
		m.mu.Unlock()
		return nil, err
	}
	m.cluster = info
	m.signer.ClusterID = info.ID
	m.nodes = map[string]*NodeRecord{}
	m.refreshLocalRecordLocked()
	local := m.nodes[m.opt.NodeID]
	local.Joined = info.Created
	local.Updated = nextVersion(local.Updated)
	m.store.saveNode(local)
	m.mu.Unlock()

	logger.PrintAndLog("Cluster", "Created cluster "+name+" ("+info.ID+")", nil)
	m.startLoops()
	m.fireMembershipChange(true)
	c := *info
	return &c, nil
}

// JoinCluster contacts the issuing node named in the token and joins its cluster.
func (m *Manager) JoinCluster(tokenString string) (out0 *ClusterInfo, out1 error) {
	defer logger.Out2(logger.In2("cluster/membership", "Manager.JoinCluster", "m", m, "!tokenString", tokenString), &out0, &out1)
	payload, err := DecodeJoinToken(tokenString)
	if err != nil {
		logger.DebugErr("cluster/membership", err)
		return nil, err
	}
	m.mu.Lock()
	if m.cluster != nil {
		m.mu.Unlock()
		return nil, ErrAlreadyInCluster
	}
	m.refreshLocalRecordLocked()
	now := time.Now().Unix()
	local := m.nodes[m.opt.NodeID].Clone()
	local.Joined = now
	local.Updated = nextVersion(local.Updated)
	local.AdminState = AdminStateNormal
	req := JoinRequest{ClusterID: payload.ClusterID, TokenID: payload.TokenID, Secret: payload.Secret, Node: *local}
	m.mu.Unlock()

	js, _ := json.Marshal(req)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	resp, err := m.transport.DoURL(ctx, payload.URL, http.MethodPost, acn.BasePath+"/join", js, false)
	if err != nil {
		logger.DebugErr("cluster/membership", err)
		return nil, errors.New("unable to reach " + payload.URL + ": " + err.Error())
	}
	if err := resp.Error(); err != nil {
		logger.DebugErr("cluster/membership", err)
		return nil, err
	}
	var jr JoinResponse
	if err := json.Unmarshal(resp.Body, &jr); err != nil {
		logger.DebugErr("cluster/membership", err)
		return nil, errors.New("invalid join response from " + payload.URL)
	}
	if jr.Cluster.ID == "" || jr.Cluster.ID != payload.ClusterID {
		return nil, errors.New("join response does not match the token's cluster")
	}

	m.mu.Lock()
	if m.cluster != nil {
		m.mu.Unlock()
		return nil, ErrAlreadyInCluster
	}
	info := jr.Cluster
	if err := m.store.saveCluster(&info); err != nil {
		logger.DebugErr("cluster/membership", err)
		m.mu.Unlock()
		return nil, err
	}
	m.cluster = &info
	m.signer.ClusterID = info.ID
	m.nodes = map[string]*NodeRecord{}
	self := *local
	if self.AdvertiseURL == "" {
		self.TunnelVia = jr.Via
	}
	m.nodes[self.ID] = &self
	m.store.saveNode(&self)
	for _, rec := range jr.Nodes {
		if changed, _ := m.mergeRecordLocked(rec); changed {
			m.store.saveNode(m.nodes[rec.ID])
		}
	}
	m.mu.Unlock()

	logger.PrintAndLog("Cluster", "Joined cluster "+info.Name+" ("+info.ID+") through "+payload.URL, nil)
	m.startLoops()
	m.fireMembershipChange(true)
	return &info, nil
}

// LeaveCluster tells the other members goodbye and returns to standalone mode.
func (m *Manager) LeaveCluster() (out0 error) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.LeaveCluster", "m", m), &out0)
	m.mu.RLock()
	if m.cluster == nil {
		m.mu.RUnlock()
		return ErrNotInCluster
	}
	peers := m.peerIDsLocked()
	m.mu.RUnlock()

	m.stopLoops()
	m.broadcast(peers, acn.BasePath+"/leave", NodeIDRequest{NodeID: m.opt.NodeID}, 10*time.Second)
	m.wipeLocalState()
	logger.PrintAndLog("Cluster", "Left the cluster", nil)
	return nil
}

// wipeLocalState drops all cluster records and returns to standalone mode.
func (m *Manager) wipeLocalState() {
	defer logger.Out0(logger.In1("cluster/membership", "Manager.wipeLocalState", "m", m))
	m.stopLoops()
	m.hub.Close()
	m.mu.Lock()
	m.store.wipeCluster()
	m.cluster = nil
	m.signer.ClusterID = ""
	m.nodes = map[string]*NodeRecord{}
	m.tokens = map[string]*JoinToken{}
	m.reachable = map[string]bool{}
	m.latency = map[string]float64{}
	m.latencyMx.reset()
	m.refreshLocalRecordLocked()
	m.mu.Unlock()
	m.fireMembershipChange(false)
}

// RemoveNode evicts another member.
func (m *Manager) RemoveNode(nodeID string) (out0 error) {
	defer logger.Out1(logger.In2("cluster/membership", "Manager.RemoveNode", "m", m, "nodeID", nodeID), &out0)
	if nodeID == m.opt.NodeID {
		return errors.New("use leave to remove this node")
	}
	m.mu.Lock()
	if m.cluster == nil {
		m.mu.Unlock()
		return ErrNotInCluster
	}
	rec, ok := m.nodes[nodeID]
	if !ok || rec.Removed {
		m.mu.Unlock()
		return ErrNodeNotFound
	}
	rec.Removed = true
	rec.Updated = nextVersion(rec.Updated)
	m.store.saveNode(rec)
	peers := m.peerIDsLocked()
	m.mu.Unlock()

	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		//Tell the evicted node itself first; ResolvePeer no longer knows it, so resolve manually
		m.mu.RLock()
		target := m.nodes[nodeID]
		m.mu.RUnlock()
		if target != nil {
			m.notifyEvicted(ctx, target)
		}
		m.broadcast(peers, acn.BasePath+"/members/sync", m.syncPayload(), 15*time.Second)
	}()
	logger.PrintAndLog("Cluster", "Removed node "+nodeID+" from the cluster", nil)
	return nil
}

// notifyEvicted delivers the evict notice to a node that is no longer resolvable.
func (m *Manager) notifyEvicted(ctx context.Context, target *NodeRecord) {
	defer logger.Out0(logger.In3("cluster/membership", "Manager.notifyEvicted", "m", m, "ctx", ctx, "target", target))
	body, _ := json.Marshal(NodeIDRequest{NodeID: target.ID})
	if target.AdvertiseURL != "" {
		m.transport.DoURL(ctx, target.AdvertiseURL, http.MethodPost, acn.BasePath+"/evict", body, true)
		return
	}
	if m.hub.Connected(target.ID) {
		req, _ := http.NewRequest(http.MethodPost, acn.BasePath+"/evict", nil)
		req.Header.Set("Content-Type", "application/json")
		m.signer.Sign(req, acn.BasePath+"/evict", body)
		m.hub.Do(ctx, target.ID, http.MethodPost, acn.BasePath+"/evict", req.Header, body)
	}
}

// SetNodeAdminState puts a node into maintenance / draining / normal mode.
func (m *Manager) SetNodeAdminState(nodeID string, state string) (out0 error) {
	defer logger.Out1(logger.In3("cluster/membership", "Manager.SetNodeAdminState", "m", m, "nodeID", nodeID, "state", state), &out0)
	state = strings.ToLower(strings.TrimSpace(state))
	if state == "normal" {
		state = AdminStateNormal
	}
	if state != AdminStateNormal && state != AdminStateMaintenance && state != AdminStateDraining {
		return errors.New("unsupported node state")
	}
	m.mu.Lock()
	if m.cluster == nil {
		m.mu.Unlock()
		return ErrNotInCluster
	}
	rec, ok := m.nodes[nodeID]
	if !ok || rec.Removed {
		m.mu.Unlock()
		return ErrNodeNotFound
	}
	rec.AdminState = state
	rec.Updated = nextVersion(rec.Updated)
	m.store.saveNode(rec)
	peers := m.peerIDsLocked()
	m.mu.Unlock()
	go m.broadcast(peers, acn.BasePath+"/members/sync", m.syncPayload(), 15*time.Second)
	return nil
}

/*
	Configuration
*/

// Config returns the local node configuration.
func (m *Manager) Config() (out0 LocalConfig) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.Config", "m", m), &out0)
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.config
}

// UpdateConfig changes the local node configuration and republishes the record.
func (m *Manager) UpdateConfig(cfg LocalConfig) (out0 error) {
	defer logger.Out1(logger.In2("cluster/membership", "Manager.UpdateConfig", "m", m, "&cfg", &cfg), &out0)
	cfg.Name = strings.TrimSpace(cfg.Name)
	cfg.AdvertiseURL = strings.TrimRight(strings.TrimSpace(cfg.AdvertiseURL), "/")
	cfg.TunnelVia = strings.TrimSpace(cfg.TunnelVia)
	if cfg.Name == "" {
		return errors.New("node name cannot be empty")
	}
	if cfg.AdvertiseURL != "" && !strings.HasPrefix(cfg.AdvertiseURL, "http://") && !strings.HasPrefix(cfg.AdvertiseURL, "https://") {
		return errors.New("advertise URL must start with http:// or https://")
	}
	if cfg.TunnelVia == m.opt.NodeID {
		cfg.TunnelVia = ""
	}

	m.mu.Lock()
	old := m.config
	m.config = cfg
	if err := m.store.saveConfig(cfg); err != nil {
		logger.DebugErr("cluster/membership", err)
		m.config = old
		m.mu.Unlock()
		return err
	}
	m.transport.SetInsecureTLS(cfg.InsecureTLS)
	m.tunnel.InsecureTLS = cfg.InsecureTLS
	m.refreshLocalRecordLocked()
	inCluster := m.cluster != nil
	peers := m.peerIDsLocked()
	m.mu.Unlock()

	if inCluster {
		switch {
		case old.AdvertiseURL == "" && cfg.AdvertiseURL != "":
			m.tunnel.Stop()
		case old.AdvertiseURL != "" && cfg.AdvertiseURL == "":
			m.tunnel.Start()
		case cfg.AdvertiseURL == "" && old.TunnelVia != cfg.TunnelVia:
			m.tunnel.Reconnect()
		}
		go m.broadcast(peers, acn.BasePath+"/members/sync", m.syncPayload(), 15*time.Second)
	}
	return nil
}

// RefreshCapabilities re-detects the local manifest and republishes it.
func (m *Manager) RefreshCapabilities() (out0 capability.Manifest) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.RefreshCapabilities", "m", m), &out0)
	caps := m.opt.Capabilities()
	m.mu.Lock()
	m.caps = caps
	m.refreshLocalRecordLocked()
	m.mu.Unlock()
	return caps
}

/*
	Join tokens
*/

// NewJoinToken issues a token other nodes can use to join through this node.
func (m *Manager) NewJoinToken(ttl time.Duration) (out0 string, out1 *JoinToken, out2 error) {
	defer logger.Out3(logger.In2("cluster/membership", "Manager.NewJoinToken", "m", m, "&ttl", &ttl), &out0, &out1, &out2)
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.cluster == nil {
		return "", nil, ErrNotInCluster
	}
	token, encoded, err := NewJoinToken(*m.cluster, m.config.AdvertiseURL, ttl)
	if err != nil {
		logger.DebugErr("cluster/membership", err)
		return "", nil, err
	}
	if err := m.store.saveJoinToken(token); err != nil {
		logger.DebugErr("cluster/membership", err)
		return "", nil, err
	}
	m.tokens[token.ID] = token
	return encoded, token, nil
}

// ListJoinTokens returns the unexpired tokens, purging expired ones.
func (m *Manager) ListJoinTokens() (out0 []JoinToken) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.ListJoinTokens", "m", m), &out0)
	m.mu.Lock()
	defer m.mu.Unlock()
	now := time.Now().Unix()
	out := []JoinToken{}
	for id, t := range m.tokens {
		if t.Expires < now {
			delete(m.tokens, id)
			m.store.deleteJoinToken(id)
			continue
		}
		out = append(out, *t)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Created > out[j].Created })
	return out
}

// RevokeJoinToken deletes a token before it expires.
func (m *Manager) RevokeJoinToken(id string) (out0 error) {
	defer logger.Out1(logger.In2("cluster/membership", "Manager.RevokeJoinToken", "m", m, "id", id), &out0)
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, ok := m.tokens[id]; !ok {
		return errors.New("token not found")
	}
	delete(m.tokens, id)
	return m.store.deleteJoinToken(id)
}

/*
	Views
*/

// NodeViews lists the live members with their computed state.
func (m *Manager) NodeViews() (out0 []NodeView) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.NodeViews", "m", m), &out0)
	m.mu.RLock()
	defer m.mu.RUnlock()
	now := time.Now()
	out := []NodeView{}
	for _, rec := range m.allRecordsLocked() {
		if rec.Removed {
			continue
		}
		local := rec.ID == m.opt.NodeID
		lat := -1.0
		if local {
			lat = 0
		} else if v, ok := m.latency[rec.ID]; ok {
			lat = v
		}
		out = append(out, NodeView{
			NodeRecord: rec,
			State:      rec.ComputeState(now, local),
			Local:      local,
			Tunnel:     m.hub.Connected(rec.ID),
			LatencyMs:  lat,
		})
	}
	return out
}

// snapshotRecords returns every record for gossip.
func (m *Manager) snapshotRecords() (out0 []NodeRecord) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.snapshotRecords", "m", m), &out0)
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.allRecordsLocked()
}

// LocalView summarises this node for the settings UI.
type LocalView struct {
	NodeID          string              `json:"nodeId"`
	PublicKey       string              `json:"publicKey"`
	Config          LocalConfig         `json:"config"`
	Version         string              `json:"version"`
	Capabilities    capability.Manifest `json:"capabilities"`
	Health          Health              `json:"health"`
	Reachable       bool                `json:"reachable"`
	TunnelConnected bool                `json:"tunnelConnected"`
	TunnelHost      string              `json:"tunnelHost"`
}

// Status is the full picture handed to the admin UI.
type Status struct {
	InCluster bool         `json:"inCluster"`
	Cluster   *ClusterInfo `json:"cluster"`
	Local     LocalView    `json:"local"`
	Nodes     []NodeView   `json:"nodes"`
	Tokens    []JoinToken  `json:"tokens"`
	Tunnels   []string     `json:"tunnels"`
	Time      int64        `json:"time"`
}

// Status builds the admin view.
func (m *Manager) Status() (out0 Status) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.Status", "m", m), &out0)
	connected, host := m.tunnel.Status()
	m.mu.RLock()
	local := m.localSnapshotLocked()
	cfg := m.config
	var cluster *ClusterInfo
	if m.cluster != nil {
		c := *m.cluster
		cluster = &c
	}
	m.mu.RUnlock()

	return Status{
		InCluster: cluster != nil,
		Cluster:   cluster,
		Local: LocalView{
			NodeID:          m.opt.NodeID,
			PublicKey:       m.key.PublicKeyString(),
			Config:          cfg,
			Version:         m.opt.Version,
			Capabilities:    local.Capabilities,
			Health:          local.Health,
			Reachable:       cfg.AdvertiseURL != "",
			TunnelConnected: connected,
			TunnelHost:      host.NodeID,
		},
		Nodes:   m.NodeViews(),
		Tokens:  m.ListJoinTokens(),
		Tunnels: m.hub.ConnectedNodes(),
		Time:    time.Now().Unix(),
	}
}

// ProbeResult is the outcome of an on-demand reachability check.
type ProbeResult struct {
	NodeID    string `json:"nodeId"`
	OK        bool   `json:"ok"`
	LatencyMs int64  `json:"latencyMs"`
	Route     string `json:"route"`
	Error     string `json:"error,omitempty"`
}

// ProbeNode pings a member through whatever route the transport picks.
func (m *Manager) ProbeNode(nodeID string) (out0 ProbeResult) {
	defer logger.Out1(logger.In2("cluster/membership", "Manager.ProbeNode", "m", m, "nodeID", nodeID), &out0)
	res := ProbeResult{NodeID: nodeID}
	peer, ok := m.ResolvePeer(nodeID)
	if !ok {
		res.Error = ErrNodeNotFound.Error()
		return res
	}
	switch {
	case m.hub.Connected(nodeID):
		res.Route = "tunnel"
	case peer.AdvertiseURL != "":
		res.Route = "direct"
	case peer.TunnelVia != "":
		res.Route = "relay via " + peer.TunnelVia
	default:
		res.Route = "none"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	start := time.Now()
	err := m.transport.DoJSON(ctx, nodeID, http.MethodPost, acn.BasePath+"/ping", nil, nil)
	res.LatencyMs = time.Since(start).Milliseconds()
	if err != nil {
		logger.DebugErr("cluster/membership", err)
		res.Error = err.Error()
		return res
	}
	res.OK = true
	m.markSeen(nodeID)
	return res
}

/*
	Gossip loops
*/

func (m *Manager) startLoops() {
	defer logger.Out0(logger.In1("cluster/membership", "Manager.startLoops", "m", m))
	m.loopMu.Lock()
	if m.loopStop != nil {
		m.loopMu.Unlock()
		return
	}
	m.loopStop = make(chan struct{})
	stop := m.loopStop
	m.loopWG.Add(1)
	m.loopMu.Unlock()

	go func() {
		defer m.loopWG.Done()
		m.heartbeatAll()
		ticker := time.NewTicker(HeartbeatInterval)
		defer ticker.Stop()
		for {
			select {
			case <-stop:
				return
			case <-ticker.C:
				m.heartbeatAll()
			}
		}
	}()

	if m.Config().AdvertiseURL == "" {
		m.tunnel.Start()
	}
}

func (m *Manager) stopLoops() {
	defer logger.Out0(logger.In1("cluster/membership", "Manager.stopLoops", "m", m))
	m.loopMu.Lock()
	if m.loopStop == nil {
		m.loopMu.Unlock()
		return
	}
	close(m.loopStop)
	m.loopStop = nil
	m.loopMu.Unlock()
	m.loopWG.Wait()
	m.tunnel.Stop()
}

// heartbeatAll reports to every peer in parallel and merges their views.
func (m *Manager) heartbeatAll() {
	defer logger.Out0(logger.In1("cluster/membership", "Manager.heartbeatAll", "m", m))
	m.mu.RLock()
	if m.cluster == nil {
		m.mu.RUnlock()
		return
	}
	local := m.localSnapshotLocked()
	cluster := m.clusterCopyLocked()
	peers := m.peerIDsLocked()
	m.mu.RUnlock()

	var wg sync.WaitGroup
	for _, id := range peers {
		wg.Add(1)
		go func(peerID string) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
			defer cancel()
			var resp HeartbeatResponse
			start := time.Now()
			err := m.transport.DoJSON(ctx, peerID, http.MethodPost, acn.BasePath+"/heartbeat", HeartbeatRequest{Node: local, Cluster: cluster}, &resp)
			m.noteReachability(peerID, err)
			if err != nil {
				logger.DebugErr("cluster/membership", err)
				return
			}
			m.noteLatency(peerID, float64(time.Since(start).Microseconds())/1000)
			m.markSeen(peerID)
			m.mergeGossip(resp.Cluster, resp.Nodes)
		}(id)
	}
	wg.Wait()
}

func (m *Manager) markSeen(nodeID string) {
	defer logger.Out0(logger.In2("cluster/membership", "Manager.markSeen", "m", m, "nodeID", nodeID))
	m.mu.Lock()
	defer m.mu.Unlock()
	if rec, ok := m.nodes[nodeID]; ok {
		rec.LastSeen = time.Now().Unix()
	}
}

// noteLatency folds a round trip measurement into the peer's moving average.
func (m *Manager) noteLatency(peerID string, ms float64) {
	defer logger.Out0(logger.In3("cluster/membership", "Manager.noteLatency", "m", m, "peerID", peerID, "ms", ms))
	if ms < 0 {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if prev, ok := m.latency[peerID]; ok {
		m.latency[peerID] = prev*(1-latencyAlpha) + ms*latencyAlpha
	} else {
		m.latency[peerID] = ms
	}
}

// Latency returns the moving average round trip to a peer in milliseconds.
// known is false when this node has never measured it (0 for the local node).
func (m *Manager) Latency(nodeID string) (ms float64, known bool) {
	defer logger.Out2(logger.In2("cluster/membership", "Manager.Latency", "m", m, "nodeID", nodeID), &ms, &known)
	if nodeID == m.opt.NodeID {
		return 0, true
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	v, ok := m.latency[nodeID]
	return v, ok
}

// Latencies returns a copy of every measured round trip.
func (m *Manager) Latencies() (out0 map[string]float64) {
	defer logger.Out1(logger.In1("cluster/membership", "Manager.Latencies", "m", m), &out0)
	m.mu.RLock()
	defer m.mu.RUnlock()
	out := map[string]float64{}
	for k, v := range m.latency {
		out[k] = v
	}
	return out
}

// noteReachability logs only when a peer flips between reachable and not.
func (m *Manager) noteReachability(peerID string, err error) {
	defer logger.Out0(logger.In3("cluster/membership", "Manager.noteReachability", "m", m, "peerID", peerID, "err", err))
	m.mu.Lock()
	prev, known := m.reachable[peerID]
	now := err == nil
	m.reachable[peerID] = now
	name := peerID
	if rec, ok := m.nodes[peerID]; ok && rec.Name != "" {
		name = rec.Name
	}
	m.mu.Unlock()
	if !known || prev != now {
		if now {
			logger.PrintAndLog("Cluster", "Node "+name+" is reachable", nil)
		} else {
			logger.PrintAndLog("Cluster", "Node "+name+" is unreachable: "+err.Error(), nil)
		}
	}
}

// broadcast posts payload to the given peers in parallel and waits for all.
func (m *Manager) broadcast(peers []string, path string, payload interface{}, timeout time.Duration) {
	defer logger.Out0(logger.In5("cluster/membership", "Manager.broadcast", "m", m, "peers", peers, "path", path, "payload", payload, "&timeout", &timeout))
	var wg sync.WaitGroup
	for _, id := range peers {
		wg.Add(1)
		go func(peerID string) {
			defer wg.Done()
			ctx, cancel := context.WithTimeout(context.Background(), timeout)
			defer cancel()
			m.transport.DoJSON(ctx, peerID, http.MethodPost, path, payload, nil)
		}(id)
	}
	wg.Wait()
}

/*
	Tunnel callbacks
*/

// pickTunnelHost chooses the reachable peer a NAT-only node should attach to.
func (m *Manager) pickTunnelHost() (out0 acn.TunnelHost, out1 bool) {
	defer logger.Out2(logger.In1("cluster/membership", "Manager.pickTunnelHost", "m", m), &out0, &out1)
	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.cluster == nil {
		return acn.TunnelHost{}, false
	}
	if pref := m.config.TunnelVia; pref != "" {
		if rec, ok := m.nodes[pref]; ok && !rec.Removed && rec.AdvertiseURL != "" {
			return acn.TunnelHost{NodeID: rec.ID, URL: rec.AdvertiseURL}, true
		}
	}
	now := time.Now()
	var best *NodeRecord
	for _, id := range m.peerIDsLocked() {
		rec := m.nodes[id]
		if rec.AdvertiseURL == "" {
			continue
		}
		if best == nil {
			best = rec
			continue
		}
		bs, rs := best.ComputeState(now, false), rec.ComputeState(now, false)
		if bs != StateOnline && rs == StateOnline {
			best = rec
		} else if bs == rs && rec.LastSeen > best.LastSeen {
			best = rec
		}
	}
	if best == nil {
		return acn.TunnelHost{}, false
	}
	return acn.TunnelHost{NodeID: best.ID, URL: best.AdvertiseURL}, true
}

// onTunnelState records which host now terminates our tunnel and tells it.
func (m *Manager) onTunnelState(connected bool, host acn.TunnelHost) {
	defer logger.Out0(logger.In3("cluster/membership", "Manager.onTunnelState", "m", m, "connected", connected, "&host", &host))
	if !connected {
		return
	}
	m.mu.Lock()
	local, ok := m.nodes[m.opt.NodeID]
	if ok && local.TunnelVia != host.NodeID {
		local.TunnelVia = host.NodeID
		local.Updated = nextVersion(local.Updated)
		m.store.saveNode(local)
	}
	peers := m.peerIDsLocked()
	m.mu.Unlock()
	go m.broadcast(peers, acn.BasePath+"/members/sync", m.syncPayload(), 15*time.Second)
}

// onTunnelConnect runs on the host side when a NAT-only node attaches.
func (m *Manager) onTunnelConnect(nodeID string) {
	defer logger.Out0(logger.In2("cluster/membership", "Manager.onTunnelConnect", "m", m, "nodeID", nodeID))
	m.mu.Lock()
	defer m.mu.Unlock()
	rec, ok := m.nodes[nodeID]
	if !ok {
		return
	}
	rec.LastSeen = time.Now().Unix()
	if rec.TunnelVia != m.opt.NodeID {
		rec.TunnelVia = m.opt.NodeID
		rec.Updated = nextVersion(rec.Updated)
		m.store.saveNode(rec)
	}
}
