package membership

import (
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"imuslab.com/arozos/mod/cluster/capability"
)

/*
	Helpers
*/

type testCluster struct {
	t *testing.T
}

// newTestManager spins up a manager with its own database, key and HTTP
// server. When reachable is true the server URL is advertised so other nodes
// can contact it directly; otherwise the node is NAT-only and must tunnel.
func newTestManager(t *testing.T, id string, reachable bool) (*Manager, *httptest.Server) {
	t.Helper()
	dir := t.TempDir()
	m, err := NewManager(Option{
		NodeID:      id,
		DBFile:      filepath.Join(dir, "cluster.db"),
		KeyFile:     filepath.Join(dir, "node.key"),
		Version:     "test",
		DefaultName: "Node " + id,
		Capabilities: func() capability.Manifest {
			return capability.Manifest{OS: "testos", Arch: "testarch", CPUCores: 2, Features: map[string]bool{"ffmpeg": true}, DetectedAt: 1}
		},
		Health: func() Health { return Health{CPUUsage: 10, RAMUsed: 1, RAMTotal: 4} },
	})
	if err != nil {
		t.Fatalf("NewManager(%s): %v", id, err)
	}
	srv := httptest.NewServer(m.ACNHandler())
	if reachable {
		cfg := m.Config()
		cfg.AdvertiseURL = srv.URL
		if err := m.UpdateConfig(cfg); err != nil {
			t.Fatalf("UpdateConfig(%s): %v", id, err)
		}
	}
	t.Cleanup(func() {
		m.Close()
		srv.Close()
	})
	return m, srv
}

func waitFor(t *testing.T, what string, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func memberIDs(m *Manager) map[string]NodeView {
	out := map[string]NodeView{}
	for _, v := range m.NodeViews() {
		out[v.ID] = v
	}
	return out
}

/*
	Join tokens
*/

func TestJoinTokenRoundTrip(t *testing.T) {
	cluster := ClusterInfo{ID: "c1", Name: "Home"}
	token, encoded, err := NewJoinToken(cluster, "https://a.example.com/", time.Hour)
	if err != nil {
		t.Fatalf("NewJoinToken: %v", err)
	}
	p, err := DecodeJoinToken(encoded)
	if err != nil {
		t.Fatalf("DecodeJoinToken: %v", err)
	}
	if p.ClusterID != "c1" || p.ClusterName != "Home" || p.URL != "https://a.example.com" || p.TokenID != token.ID {
		t.Errorf("payload mismatch: %+v", p)
	}
	if !token.Valid(p.Secret, time.Now()) {
		t.Errorf("token should validate its own secret")
	}
	if token.Valid("wrong", time.Now()) {
		t.Errorf("wrong secret accepted")
	}
	if token.Valid(p.Secret, time.Now().Add(2*time.Hour)) {
		t.Errorf("expired token accepted")
	}
}

func TestJoinTokenInvalid(t *testing.T) {
	if _, _, err := NewJoinToken(ClusterInfo{ID: "c"}, "", time.Hour); err == nil {
		t.Errorf("token without issuer URL must fail")
	}
	for _, bad := range []string{"", "hello", "aroz-join:!!!", "aroz-join:e30"} {
		if _, err := DecodeJoinToken(bad); err == nil {
			t.Errorf("DecodeJoinToken(%q) expected error", bad)
		}
	}
}

/*
	State machine
*/

func TestComputeState(t *testing.T) {
	now := time.Now()
	tests := []struct {
		name  string
		rec   NodeRecord
		local bool
		want  NodeState
	}{
		{"local always online", NodeRecord{}, true, StateOnline},
		{"never seen", NodeRecord{}, false, StateUnknown},
		{"fresh", NodeRecord{LastSeen: now.Add(-5 * time.Second).Unix()}, false, StateOnline},
		{"fresh but loaded", NodeRecord{LastSeen: now.Unix(), Health: Health{CPUUsage: 99, Timestamp: now.Unix()}}, false, StateDegraded},
		{"stale", NodeRecord{LastSeen: now.Add(-OnlineWindow - time.Second).Unix()}, false, StateUnknown},
		{"gone", NodeRecord{LastSeen: now.Add(-OfflineWindow - time.Second).Unix()}, false, StateOffline},
		{"maintenance wins", NodeRecord{AdminState: AdminStateMaintenance, LastSeen: now.Unix()}, false, StateMaintenance},
		{"draining wins locally", NodeRecord{AdminState: AdminStateDraining}, true, StateDraining},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := tc.rec.ComputeState(now, tc.local); got != tc.want {
				t.Errorf("got %s want %s", got, tc.want)
			}
		})
	}
}

func TestHealthDegraded(t *testing.T) {
	tests := []struct {
		name string
		h    Health
		want bool
	}{
		{"empty", Health{}, false},
		{"normal", Health{CPUUsage: 40, RAMUsed: 2, RAMTotal: 8, DiskFree: 50, DiskTotal: 100, Timestamp: 1}, false},
		{"cpu", Health{CPUUsage: 98, Timestamp: 1}, true},
		{"ram", Health{RAMUsed: 98, RAMTotal: 100, Timestamp: 1}, true},
		{"disk", Health{DiskFree: 1, DiskTotal: 100, Timestamp: 1}, true},
	}
	for _, tc := range tests {
		if got := tc.h.Degraded(); got != tc.want {
			t.Errorf("%s: got %v want %v", tc.name, got, tc.want)
		}
	}
}

/*
	Merge
*/

func TestMergeLastWriterWins(t *testing.T) {
	m, _ := newTestManager(t, "self", true)
	if _, err := m.CreateCluster("merge"); err != nil {
		t.Fatalf("CreateCluster: %v", err)
	}

	m.mu.Lock()
	changed, _ := m.mergeRecordLocked(NodeRecord{ID: "p", Name: "old", Updated: 10, LastSeen: 5, Health: Health{CPUUsage: 1, Timestamp: 5}})
	if !changed {
		t.Errorf("new record should be a change")
	}
	changed, _ = m.mergeRecordLocked(NodeRecord{ID: "p", Name: "stale", Updated: 5, LastSeen: 9, Health: Health{CPUUsage: 2, Timestamp: 9}})
	if changed || m.nodes["p"].Name != "old" {
		t.Errorf("older Updated must not overwrite static fields")
	}
	if m.nodes["p"].LastSeen != 9 || m.nodes["p"].Health.CPUUsage != 2 {
		t.Errorf("transient fields must merge by recency")
	}
	changed, _ = m.mergeRecordLocked(NodeRecord{ID: "p", Name: "new", Updated: 20})
	if !changed || m.nodes["p"].Name != "new" {
		t.Errorf("newer Updated must win")
	}

	//Our own record: only admin state may be pushed onto us, and a removal evicts us
	self := m.nodes["self"]
	_, evicted := m.mergeRecordLocked(NodeRecord{ID: "self", Name: "hijack", Updated: self.Updated + 1})
	if evicted || m.nodes["self"].Name == "hijack" {
		t.Errorf("other nodes must not rename us")
	}
	changed, _ = m.mergeRecordLocked(NodeRecord{ID: "self", AdminState: AdminStateMaintenance, Updated: self.Updated + 2})
	if !changed || m.nodes["self"].AdminState != AdminStateMaintenance {
		t.Errorf("admin state should be accepted")
	}
	_, evicted = m.mergeRecordLocked(NodeRecord{ID: "self", Removed: true, Updated: self.Updated + 3})
	if !evicted {
		t.Errorf("newer tombstone for ourselves must evict")
	}
	m.mu.Unlock()
}

/*
	Full life cycle over HTTP
*/

func TestCreateJoinHeartbeatLeave(t *testing.T) {
	a, _ := newTestManager(t, "node-a", true)
	b, _ := newTestManager(t, "node-b", true)

	if a.InCluster() {
		t.Fatalf("fresh node must be standalone")
	}
	if _, _, err := a.NewJoinToken(time.Hour); err != ErrNotInCluster {
		t.Errorf("token before cluster: %v", err)
	}
	info, err := a.CreateCluster("Home Lab")
	if err != nil {
		t.Fatalf("CreateCluster: %v", err)
	}
	if _, err := a.CreateCluster("again"); err != ErrAlreadyInCluster {
		t.Errorf("second create: %v", err)
	}

	token, _, err := a.NewJoinToken(time.Hour)
	if err != nil {
		t.Fatalf("NewJoinToken: %v", err)
	}
	joined, err := b.JoinCluster(token)
	if err != nil {
		t.Fatalf("JoinCluster: %v", err)
	}
	if joined.ID != info.ID {
		t.Errorf("joined wrong cluster")
	}
	if len(a.ListJoinTokens()) != 1 || a.ListJoinTokens()[0].Uses != 1 {
		t.Errorf("token usage not counted: %+v", a.ListJoinTokens())
	}

	waitFor(t, "a to see b online", 5*time.Second, func() bool {
		v, ok := memberIDs(a)["node-b"]
		return ok && v.State == StateOnline
	})
	waitFor(t, "b to see a online", 5*time.Second, func() bool {
		v, ok := memberIDs(b)["node-a"]
		return ok && v.State == StateOnline && v.Health.CPUUsage == 10
	})
	if len(a.NodeViews()) != 2 || len(b.NodeViews()) != 2 {
		t.Fatalf("expected 2 members each, got %d / %d", len(a.NodeViews()), len(b.NodeViews()))
	}

	//Probe route
	res := a.ProbeNode("node-b")
	if !res.OK || res.Route != "direct" {
		t.Errorf("probe b: %+v", res)
	}

	//Admin state propagates
	if err := a.SetNodeAdminState("node-b", "maintenance"); err != nil {
		t.Fatalf("SetNodeAdminState: %v", err)
	}
	waitFor(t, "b to learn its maintenance state", 5*time.Second, func() bool {
		return memberIDs(b)["node-b"].State == StateMaintenance
	})

	//Leave
	if err := b.LeaveCluster(); err != nil {
		t.Fatalf("LeaveCluster: %v", err)
	}
	if b.InCluster() {
		t.Errorf("b should be standalone after leaving")
	}
	waitFor(t, "a to forget b", 5*time.Second, func() bool {
		_, ok := memberIDs(a)["node-b"]
		return !ok
	})
	if err := b.LeaveCluster(); err != ErrNotInCluster {
		t.Errorf("leave twice: %v", err)
	}
}

func TestJoinRejectsBadToken(t *testing.T) {
	a, _ := newTestManager(t, "node-a", true)
	b, _ := newTestManager(t, "node-b", true)
	if _, err := a.CreateCluster("Home"); err != nil {
		t.Fatalf("CreateCluster: %v", err)
	}
	token, rec, err := a.NewJoinToken(time.Hour)
	if err != nil {
		t.Fatalf("NewJoinToken: %v", err)
	}
	if err := a.RevokeJoinToken(rec.ID); err != nil {
		t.Fatalf("RevokeJoinToken: %v", err)
	}
	if _, err := b.JoinCluster(token); err == nil {
		t.Errorf("revoked token must be rejected")
	}
	if b.InCluster() {
		t.Errorf("b must stay standalone")
	}
	if _, err := b.JoinCluster("garbage"); err == nil {
		t.Errorf("garbage token must be rejected")
	}
}

func TestTunnelOnlyNodeJoinsAndIsRelayed(t *testing.T) {
	a, _ := newTestManager(t, "node-a", true)
	b, _ := newTestManager(t, "node-b", true)
	c, _ := newTestManager(t, "node-c", false) //NAT-only

	if _, err := a.CreateCluster("Home"); err != nil {
		t.Fatalf("CreateCluster: %v", err)
	}
	token, _, _ := a.NewJoinToken(time.Hour)
	if _, err := c.JoinCluster(token); err != nil {
		t.Fatalf("c join: %v", err)
	}
	waitFor(t, "c tunnel to a", 10*time.Second, func() bool { return a.hub.Connected("node-c") })

	st := c.Status()
	if !st.Local.TunnelConnected || st.Local.TunnelHost != "node-a" || st.Local.Reachable {
		t.Errorf("c status: %+v", st.Local)
	}
	if res := a.ProbeNode("node-c"); !res.OK || res.Route != "tunnel" {
		t.Errorf("a->c probe: %+v", res)
	}
	waitFor(t, "c to see a online", 5*time.Second, func() bool {
		return memberIDs(c)["node-a"].State == StateOnline
	})

	//Second reachable node joins and must reach c by relaying through a
	token2, _, _ := a.NewJoinToken(time.Hour)
	if _, err := b.JoinCluster(token2); err != nil {
		t.Fatalf("b join: %v", err)
	}
	waitFor(t, "b to learn c's tunnel host", 5*time.Second, func() bool {
		v, ok := memberIDs(b)["node-c"]
		return ok && v.TunnelVia == "node-a"
	})
	res := b.ProbeNode("node-c")
	if !res.OK || res.Route != "relay via node-a" {
		t.Errorf("b->c relay probe: %+v", res)
	}
	waitFor(t, "c to see b online", 5*time.Second, func() bool {
		return memberIDs(c)["node-b"].State == StateOnline
	})
	waitFor(t, "b to see c online", 5*time.Second, func() bool {
		return memberIDs(b)["node-c"].State == StateOnline
	})
}

func TestEvictNode(t *testing.T) {
	a, _ := newTestManager(t, "node-a", true)
	b, _ := newTestManager(t, "node-b", true)
	if _, err := a.CreateCluster("Home"); err != nil {
		t.Fatalf("CreateCluster: %v", err)
	}
	token, _, _ := a.NewJoinToken(time.Hour)
	if _, err := b.JoinCluster(token); err != nil {
		t.Fatalf("join: %v", err)
	}
	waitFor(t, "a sees b", 5*time.Second, func() bool { _, ok := memberIDs(a)["node-b"]; return ok })

	if err := a.RemoveNode("node-a"); err == nil {
		t.Errorf("removing self must fail")
	}
	if err := a.RemoveNode("node-b"); err != nil {
		t.Fatalf("RemoveNode: %v", err)
	}
	if _, ok := memberIDs(a)["node-b"]; ok {
		t.Errorf("a still lists b")
	}
	waitFor(t, "b to notice eviction", 10*time.Second, func() bool { return !b.InCluster() })
	if err := a.RemoveNode("node-b"); err != ErrNodeNotFound {
		t.Errorf("remove twice: %v", err)
	}
}

func TestResumeAfterRestart(t *testing.T) {
	dir := t.TempDir()
	opt := Option{NodeID: "node-r", DBFile: filepath.Join(dir, "cluster.db"), KeyFile: filepath.Join(dir, "node.key"), Version: "test", DefaultName: "R"}
	m, err := NewManager(opt)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	cfg := m.Config()
	cfg.AdvertiseURL = "https://r.example.com"
	if err := m.UpdateConfig(cfg); err != nil {
		t.Fatalf("UpdateConfig: %v", err)
	}
	info, err := m.CreateCluster("Persist")
	if err != nil {
		t.Fatalf("CreateCluster: %v", err)
	}
	pub := m.Status().Local.PublicKey
	m.Close()

	m2, err := NewManager(opt)
	if err != nil {
		t.Fatalf("NewManager again: %v", err)
	}
	defer m2.Close()
	if !m2.InCluster() || m2.Cluster().ID != info.ID {
		t.Errorf("cluster not resumed")
	}
	if m2.Config().AdvertiseURL != "https://r.example.com" {
		t.Errorf("config not persisted")
	}
	if m2.Status().Local.PublicKey != pub {
		t.Errorf("node key changed across restart")
	}
	if len(m2.NodeViews()) != 1 || !m2.NodeViews()[0].Local {
		t.Errorf("local record missing after restart: %+v", m2.NodeViews())
	}
}

func TestUpdateConfigValidation(t *testing.T) {
	m, _ := newTestManager(t, "node-v", true)
	cfg := m.Config()
	cfg.Name = ""
	if err := m.UpdateConfig(cfg); err == nil {
		t.Errorf("empty name accepted")
	}
	cfg = m.Config()
	cfg.AdvertiseURL = "ftp://nope"
	if err := m.UpdateConfig(cfg); err == nil {
		t.Errorf("bad URL scheme accepted")
	}
	cfg = m.Config()
	cfg.TunnelVia = "node-v"
	if err := m.UpdateConfig(cfg); err != nil || m.Config().TunnelVia != "" {
		t.Errorf("tunnel via self should be cleared, got %q (%v)", m.Config().TunnelVia, err)
	}
}
