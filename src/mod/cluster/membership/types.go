package membership

/*
	ArozOS Cluster - membership types

	A cluster is a set of NodeRecords sharing one ClusterInfo. Records are
	replicated between nodes by gossip (heartbeats and sync pushes) and merged
	with last-writer-wins on the Updated timestamp, so every node converges on
	the same membership view without a permanent master.
*/

import (
	"time"

	"imuslab.com/arozos/mod/cluster/capability"
)

// NodeState is the computed liveness state of a node.
type NodeState string

const (
	StateOnline      NodeState = "ONLINE"
	StateDegraded    NodeState = "DEGRADED"
	StateOffline     NodeState = "OFFLINE"
	StateUnknown     NodeState = "UNKNOWN"
	StateDraining    NodeState = "DRAINING"
	StateMaintenance NodeState = "MAINTENANCE"
)

// Admin-selected modes that override the computed state.
const (
	AdminStateNormal      = ""
	AdminStateMaintenance = "maintenance"
	AdminStateDraining    = "draining"
)

// Timing parameters. They are variables (not constants) so tests of the
// packages built on membership can shorten them; production code never
// changes them.
var (
	// HeartbeatInterval is how often each node reports to every peer.
	HeartbeatInterval = 15 * time.Second
	// OnlineWindow is the maximum silence before a node stops being ONLINE.
	OnlineWindow = 45 * time.Second
	// OfflineWindow is the silence after which a node is OFFLINE (UNKNOWN in between).
	OfflineWindow = 3 * time.Minute
	// TombstoneTTL is how long a removed node's record is kept for gossip.
	TombstoneTTL = 7 * 24 * time.Hour
)

// Health is the transient load snapshot a node ships with each heartbeat.
type Health struct {
	CPUUsage  float64 `json:"cpuUsage"` //percent
	RAMUsed   int64   `json:"ramUsed"`
	RAMTotal  int64   `json:"ramTotal"`
	DiskFree  int64   `json:"diskFree"`
	DiskTotal int64   `json:"diskTotal"`
	Uptime    int64   `json:"uptime"` //seconds since ArozOS started
	Timestamp int64   `json:"timestamp"`
}

// Degraded reports whether the snapshot indicates an overloaded node.
func (h Health) Degraded() bool {
	if h.Timestamp == 0 {
		return false
	}
	if h.CPUUsage >= 97 {
		return true
	}
	if h.RAMTotal > 0 && float64(h.RAMUsed)/float64(h.RAMTotal) >= 0.97 {
		return true
	}
	if h.DiskTotal > 0 && float64(h.DiskFree)/float64(h.DiskTotal) <= 0.02 {
		return true
	}
	return false
}

// NodeRecord is the replicated description of one cluster member.
type NodeRecord struct {
	ID           string              `json:"id"`
	Name         string              `json:"name"`
	PublicKey    string              `json:"publicKey"`
	AdvertiseURL string              `json:"advertiseUrl"` //empty for NAT-only nodes
	TunnelVia    string              `json:"tunnelVia"`    //node terminating this node's tunnel
	Version      string              `json:"version"`
	Capabilities capability.Manifest `json:"capabilities"`
	AdminState   string              `json:"adminState"`
	Removed      bool                `json:"removed"`
	Joined       int64               `json:"joined"`
	Updated      int64               `json:"updated"` //version stamp for last-writer-wins merge

	//Transient fields, merged by recency rather than by Updated
	LastSeen int64  `json:"lastSeen"`
	Health   Health `json:"health"`
}

// Clone returns a deep enough copy for handing out of the manager.
func (n *NodeRecord) Clone() *NodeRecord {
	c := *n
	if n.Capabilities.Features != nil {
		c.Capabilities.Features = map[string]bool{}
		for k, v := range n.Capabilities.Features {
			c.Capabilities.Features[k] = v
		}
	}
	return &c
}

// ComputeState derives the liveness state of a record at time now. Local is
// true for the record describing this very node.
func (n *NodeRecord) ComputeState(now time.Time, local bool) NodeState {
	switch n.AdminState {
	case AdminStateMaintenance:
		return StateMaintenance
	case AdminStateDraining:
		return StateDraining
	}
	if local {
		return StateOnline
	}
	if n.LastSeen == 0 {
		return StateUnknown
	}
	silence := now.Sub(time.Unix(n.LastSeen, 0))
	if silence <= OnlineWindow {
		if n.Health.Degraded() {
			return StateDegraded
		}
		return StateOnline
	}
	if silence <= OfflineWindow {
		return StateUnknown
	}
	return StateOffline
}

// NodeView is a record plus its computed state, as exposed to UIs and APIs.
type NodeView struct {
	NodeRecord
	State  NodeState `json:"state"`
	Local  bool      `json:"local"`
	Tunnel bool      `json:"tunnel"` //true when this node currently terminates the peer's tunnel
}

// ClusterInfo identifies the cluster itself plus the cluster-wide settings
// that are replicated to every member (last-writer-wins on SettingsVersion).
type ClusterInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Created int64  `json:"created"`

	//IdentityOrigin is the node that verifies logins for the whole cluster
	//(the SSO owner). Empty means every node authenticates on its own.
	IdentityOrigin  string `json:"identityOrigin"`
	SettingsVersion int64  `json:"settingsVersion"`
}

// LocalConfig is the operator-set configuration of this node.
type LocalConfig struct {
	Name         string `json:"name"`
	AdvertiseURL string `json:"advertiseUrl"`
	TunnelVia    string `json:"tunnelVia"` //preferred tunnel host, empty for automatic
	InsecureTLS  bool   `json:"insecureTls"`
}

// JoinToken is the server-side record of an issued join token.
type JoinToken struct {
	ID         string `json:"id"`
	SecretHash string `json:"-"`
	Created    int64  `json:"created"`
	Expires    int64  `json:"expires"`
	Uses       int    `json:"uses"`
}

// Wire payloads

type JoinRequest struct {
	ClusterID string     `json:"clusterId"`
	TokenID   string     `json:"tokenId"`
	Secret    string     `json:"secret"`
	Node      NodeRecord `json:"node"`
}

type JoinResponse struct {
	Cluster ClusterInfo  `json:"cluster"`
	Nodes   []NodeRecord `json:"nodes"`
	Via     string       `json:"via"` //ID of the node that accepted the join
}

type HeartbeatRequest struct {
	Node    NodeRecord   `json:"node"`
	Cluster *ClusterInfo `json:"cluster,omitempty"`
}

type HeartbeatResponse struct {
	Nodes   []NodeRecord `json:"nodes"`
	Cluster *ClusterInfo `json:"cluster,omitempty"`
	Time    int64        `json:"time"`
}

type SyncRequest struct {
	Nodes   []NodeRecord `json:"nodes"`
	Cluster *ClusterInfo `json:"cluster,omitempty"`
}

type NodeIDRequest struct {
	NodeID string `json:"nodeId"`
}

// NextVersion is the exported form of nextVersion for sibling cluster packages.
func NextVersion(prev int64) int64 { return nextVersion(prev) }

// nextVersion returns a record version stamp that is strictly greater than
// prev, so a change made in the same millisecond as the previous one still
// wins the last-writer-wins merge on every other node.
func nextVersion(prev int64) int64 {
	v := time.Now().UnixMilli()
	if v <= prev {
		v = prev + 1
	}
	return v
}
