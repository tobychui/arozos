package replication

import (
	"bytes"
	"io"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"

	"imuslab.com/arozos/mod/cluster/membership"
	"imuslab.com/arozos/mod/cluster/metadata"
	"imuslab.com/arozos/mod/cluster/storage"
)

func init() {
	membership.HeartbeatInterval = 500 * time.Millisecond
	membership.OnlineWindow = 2 * time.Second
	membership.OfflineWindow = 4 * time.Second
}

type testNode struct {
	id   string
	m    *membership.Manager
	meta *metadata.Manager
	st   *storage.Service
	repl *Manager
	srv  *httptest.Server
	root string
	vol  *metadata.Volume
	down bool
}

func newTestNode(t *testing.T, id string) *testNode {
	t.Helper()
	dir := t.TempDir()
	m, err := membership.NewManager(membership.Option{
		NodeID: id, DBFile: filepath.Join(dir, "cluster.db"), KeyFile: filepath.Join(dir, "node.key"),
		Version: "test", DefaultName: "Node " + id,
	})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	meta, err := metadata.New(metadata.Option{
		Membership: m, LeaseDuration: 3 * time.Second, LeaseRenew: time.Second,
		LeaseTick: 200 * time.Millisecond, PendingRetry: 300 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("metadata.New: %v", err)
	}
	root := filepath.Join(dir, "disk")
	os.MkdirAll(root, 0755)
	st, err := storage.New(storage.Option{
		Membership: m, Metadata: meta, TmpDir: filepath.Join(dir, "tmp"),
		LocalRoots:      func() map[string]string { return map[string]string{"disk": root} },
		RefreshInterval: time.Hour, ReconcileInterval: time.Hour,
	})
	if err != nil {
		t.Fatalf("storage.New: %v", err)
	}
	repl, err := New(Option{
		Membership: m, Metadata: meta, Storage: st,
		PlanInterval: 400 * time.Millisecond, TaskLease: 2 * time.Second, LeaseRenew: 500 * time.Millisecond,
		OfflineStale: 3 * time.Second, MaxAttempts: 3,
	})
	if err != nil {
		t.Fatalf("replication.New: %v", err)
	}
	srv := httptest.NewServer(m.ACNHandler())
	cfg := m.Config()
	cfg.AdvertiseURL = srv.URL
	m.UpdateConfig(cfg)
	n := &testNode{id: id, m: m, meta: meta, st: st, repl: repl, srv: srv, root: root}
	t.Cleanup(func() { n.shutdown() })
	return n
}

func (n *testNode) shutdown() {
	if n.down {
		return
	}
	n.down = true
	n.repl.Close()
	n.st.Close()
	n.meta.Close()
	n.m.Close()
	n.srv.Close()
}

func waitFor(t *testing.T, what string, timeout time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// cluster3 builds a three node cluster where every node contributes a volume.
func cluster3(t *testing.T) (*testNode, *testNode, *testNode) {
	t.Helper()
	a := newTestNode(t, "node-a")
	b := newTestNode(t, "node-b")
	c := newTestNode(t, "node-c")
	if _, err := a.m.CreateCluster("Repl"); err != nil {
		t.Fatalf("CreateCluster: %v", err)
	}
	time.Sleep(1100 * time.Millisecond)
	for _, n := range []*testNode{b, c} {
		token, _, _ := a.m.NewJoinToken(time.Hour)
		if _, err := n.m.JoinCluster(token); err != nil {
			t.Fatalf("join %s: %v", n.id, err)
		}
	}
	waitFor(t, "leader", 10*time.Second, func() bool {
		return a.meta.IsLeader() && b.meta.Leader() == "node-a" && c.meta.Leader() == "node-a"
	})
	for _, n := range []*testNode{a, b, c} {
		vol, err := n.st.AddVolume("disk", "/cluster", n.id+" volume")
		if err != nil {
			t.Fatalf("AddVolume %s: %v", n.id, err)
		}
		n.vol = vol
	}
	waitFor(t, "volumes everywhere", 5*time.Second, func() bool {
		return len(a.meta.Volumes()) == 3 && len(b.meta.Volumes()) == 3 && len(c.meta.Volumes()) == 3
	})
	return a, b, c
}

func healthyCount(n *testNode, p string) int {
	rec, err := n.meta.Stat(p)
	if err != nil {
		return -1
	}
	return len(rec.HealthyLocations())
}

func nodesHolding(n *testNode, p string) map[string]bool {
	out := map[string]bool{}
	rec, err := n.meta.Stat(p)
	if err != nil {
		return out
	}
	for _, l := range rec.HealthyLocations() {
		out[l.NodeID] = true
	}
	return out
}

func readVia(t *testing.T, n *testNode, p string) []byte {
	t.Helper()
	r, err := n.st.OpenRead(p)
	if err != nil {
		t.Fatalf("OpenRead on %s: %v", n.id, err)
	}
	defer r.Close()
	b, err := io.ReadAll(r)
	if err != nil {
		t.Fatalf("read on %s: %v", n.id, err)
	}
	return b
}

func TestReplicatesToPolicyAndDropsExtras(t *testing.T) {
	a, b, c := cluster3(t)
	if err := a.meta.Submit(metadata.KindPolicy, &metadata.Policy{Folder: "/docs", Replicas: 2}); err != nil {
		t.Fatalf("policy: %v", err)
	}
	content := bytes.Repeat([]byte("replica-me "), 100000) //1.1 MB
	if err := a.st.Write("/docs/report.bin", bytes.NewReader(content), "toby"); err != nil {
		t.Fatalf("write: %v", err)
	}
	waitFor(t, "second healthy copy", 40*time.Second, func() bool { return healthyCount(a, "/docs/report.bin") == 2 })
	holders := nodesHolding(a, "/docs/report.bin")
	if len(holders) != 2 || !holders["node-a"] {
		t.Fatalf("copies should be on a and one other node, got %v", holders)
	}
	//The copy is a real verified file on the target's disk
	var target *testNode
	for _, n := range []*testNode{b, c} {
		if holders[n.id] {
			target = n
		}
	}
	onDisk, err := os.ReadFile(filepath.Join(target.root, "cluster", "docs", "report.bin"))
	if err != nil || !bytes.Equal(onDisk, content) {
		t.Fatalf("replica on %s missing or different: %v", target.id, err)
	}
	rec, _ := a.meta.Stat("/docs/report.bin")
	if loc, _ := rec.Location(target.vol.ID); loc.State != metadata.LocVerified {
		t.Errorf("replica state = %s, want verified", loc.State)
	}
	//Task history recorded on the leader
	waitFor(t, "task history", 20*time.Second, func() bool {
		st := a.repl.Status()
		return len(st.History) >= 1 && st.History[0].State == TaskDone && st.Queued == 0 && st.Running == 0
	})

	//Lower the policy: one copy is dropped, never the last one
	a.meta.Submit(metadata.KindPolicy, &metadata.Policy{Folder: "/docs", Replicas: 1})
	waitFor(t, "extra copy dropped", 30*time.Second, func() bool { return healthyCount(a, "/docs/report.bin") == 1 })
	//a's copy is the primary, so the target's copy is the one removed (the
	//physical delete follows the metadata update asynchronously)
	waitFor(t, "dropped copy removed from disk", 30*time.Second, func() bool {
		_, err := os.Stat(filepath.Join(target.root, "cluster", "docs", "report.bin"))
		return err != nil
	})
	if !nodesHolding(a, "/docs/report.bin")["node-a"] {
		t.Errorf("primary copy on a should have been kept")
	}
	if got := readVia(t, c, "/docs/report.bin"); !bytes.Equal(got, content) {
		t.Errorf("file unreadable after drop")
	}
	if st := a.repl.Status(); st.OverReplicated != 0 || st.UnderReplicated != 0 || st.Files != 1 {
		t.Errorf("status after settle: %+v", st)
	}
}

func TestRepairsStaleCopyInPlace(t *testing.T) {
	a, b, _ := cluster3(t)
	a.meta.Submit(metadata.KindPolicy, &metadata.Policy{Folder: "/docs", Replicas: 2})
	content := []byte("verify me carefully")
	a.st.Write("/docs/v.txt", bytes.NewReader(content), "")
	waitFor(t, "replica", 15*time.Second, func() bool { return healthyCount(a, "/docs/v.txt") == 2 })
	holders := nodesHolding(a, "/docs/v.txt")
	var target *testNode = b
	if !holders["node-b"] {
		t.Skip("copy landed on c; test targets b for simplicity")
	}
	//Corrupt the replica behind the cluster's back
	p := filepath.Join(target.root, "cluster", "docs", "v.txt")
	os.WriteFile(p, []byte("corrupted!!"), 0644)
	res := target.st.VerifyLocalCopies(0)
	if res.Stale != 1 || res.Checked < 1 {
		t.Fatalf("verify result: %+v", res)
	}
	waitFor(t, "leader to see the stale copy", 5*time.Second, func() bool {
		rec, _ := a.meta.Stat("/docs/v.txt")
		loc, _ := rec.Location(target.vol.ID)
		return loc.State == metadata.LocStale
	})
	//The planner repairs it in place
	waitFor(t, "repair", 15*time.Second, func() bool {
		rec, err := a.meta.Stat("/docs/v.txt")
		if err != nil {
			return false
		}
		loc, ok := rec.Location(target.vol.ID)
		return ok && loc.State == metadata.LocVerified
	})
	fixed, _ := os.ReadFile(p)
	if !bytes.Equal(fixed, content) {
		t.Errorf("repaired copy content wrong: %q", fixed)
	}
	//Verification of a good copy keeps it verified and bumps the timestamp
	res = target.st.VerifyLocalCopies(0)
	if res.Stale != 0 || res.Verified < 1 {
		t.Errorf("second verify: %+v", res)
	}
}

func TestOfflineNodeCopiesGoStaleAndGetReplaced(t *testing.T) {
	a, b, c := cluster3(t)
	a.meta.Submit(metadata.KindPolicy, &metadata.Policy{Folder: "/docs", Replicas: 2})
	content := []byte("survive a dead node")
	a.st.Write("/docs/s.txt", bytes.NewReader(content), "")
	waitFor(t, "replica", 15*time.Second, func() bool { return healthyCount(a, "/docs/s.txt") == 2 })
	holders := nodesHolding(a, "/docs/s.txt")
	var victim, survivor *testNode
	if holders["node-b"] {
		victim, survivor = b, c
	} else {
		victim, survivor = c, b
	}
	victim.shutdown()
	waitFor(t, "victim's copy marked stale and replaced", 30*time.Second, func() bool {
		rec, err := a.meta.Stat("/docs/s.txt")
		if err != nil {
			return false
		}
		loc, _ := rec.Location(victim.vol.ID)
		h := nodesHolding(a, "/docs/s.txt")
		return loc.State == metadata.LocStale && h[survivor.id] && h["node-a"]
	})
	if got := readVia(t, survivor, "/docs/s.txt"); !bytes.Equal(got, content) {
		t.Errorf("survivor cannot read the file")
	}
	st := a.repl.Status()
	if st.StaleCopies != 1 {
		t.Errorf("status should report 1 stale copy: %+v", st)
	}
}

func TestEvacuation(t *testing.T) {
	a, b, c := cluster3(t)
	content := []byte("move me")
	if err := b.st.Write("/docs/e.txt", bytes.NewReader(content), ""); err != nil {
		t.Fatalf("write: %v", err)
	}
	//b wrote it: the copy is on b's volume (local placement)
	waitFor(t, "record on leader", 5*time.Second, func() bool { return nodesHolding(a, "/docs/e.txt")["node-b"] })
	if err := b.st.RemoveVolume(b.vol.ID); err == nil {
		t.Errorf("removing a volume with sole copies must be refused")
	}
	if err := b.st.StartEvacuation(b.vol.ID); err != nil {
		t.Fatalf("StartEvacuation: %v", err)
	}
	waitFor(t, "volume retired", 20*time.Second, func() bool {
		v, ok := a.meta.Volume(b.vol.ID)
		return ok && v.Removed
	})
	h := nodesHolding(a, "/docs/e.txt")
	if h["node-b"] || (!h["node-a"] && !h["node-c"]) {
		t.Errorf("copy not moved off b: %v", h)
	}
	if _, err := os.Stat(filepath.Join(b.root, "cluster", "docs", "e.txt")); err == nil {
		t.Errorf("evacuated copy still on b's disk")
	}
	if got := readVia(t, c, "/docs/e.txt"); !bytes.Equal(got, content) {
		t.Errorf("file unreadable after evacuation")
	}
	//Writes no longer land on b
	if err := b.st.Write("/docs/after.txt", bytes.NewReader([]byte("x")), ""); err != nil {
		t.Fatalf("write after evacuation: %v", err)
	}
	if nodesHolding(b, "/docs/after.txt")["node-b"] {
		t.Errorf("new file placed on the retired volume")
	}
}

func TestPlanNowForwardsToLeader(t *testing.T) {
	a, b, _ := cluster3(t)
	a.st.Write("/x.txt", bytes.NewReader([]byte("x")), "")
	waitFor(t, "b to see file", 5*time.Second, func() bool { _, err := b.meta.Stat("/x.txt"); return err == nil })
	res, err := b.repl.PlanNow()
	if err != nil {
		t.Fatalf("PlanNow on follower: %v", err)
	}
	if res.Files != 1 || res.Time == 0 {
		t.Errorf("forwarded plan result: %+v", res)
	}
	if st := b.repl.Status(); st.IsLeader || st.LeaderName != "Node node-a" || st.Files != 1 {
		t.Errorf("follower status: %+v", st)
	}
}

func TestSiteDiversity(t *testing.T) {
	//Two sites: a and b are next to each other, c is far away
	matrix := map[string]map[string]float64{
		"a": {"b": 2, "c": 400},
		"b": {"a": 2, "c": 200},
		"c": {"a": 400, "b": 200},
	}
	tests := []struct {
		name      string
		candidate string
		holders   []string
		want      float64
	}{
		{"same site as the copy", "b", []string{"a"}, 0.002},
		{"other site", "c", []string{"a"}, 0.4},
		{"nearest holder wins", "c", []string{"a", "b"}, 0.2},
		{"holder is itself", "a", []string{"a"}, 0},
		{"nothing measured", "d", []string{"a"}, -1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := siteDiversity(matrix, tc.candidate, tc.holders)
			if diff := got - tc.want; diff > 0.0001 || diff < -0.0001 {
				t.Errorf("siteDiversity(%s, %v) = %v; want %v", tc.candidate, tc.holders, got, tc.want)
			}
		})
	}

	//A round trip over a second is as diverse as it gets
	far := map[string]map[string]float64{"x": {"y": 5000}}
	if got := siteDiversity(far, "x", []string{"y"}); got != 1 {
		t.Errorf("a very distant node should saturate at 1, got %v", got)
	}
}
