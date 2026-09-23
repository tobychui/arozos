package metadata

import (
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"imuslab.com/arozos/mod/cluster/membership"
)

/*
	Helpers
*/

func init() {
	//Shorten the liveness windows so leader failover is observable in tests
	membership.HeartbeatInterval = 500 * time.Millisecond
	membership.OnlineWindow = 2 * time.Second
	membership.OfflineWindow = 4 * time.Second
}

type testNode struct {
	m    *membership.Manager
	meta *Manager
	srv  *httptest.Server
	id   string
}

func fastOption(m *membership.Manager) Option {
	return Option{
		Membership:    m,
		LeaseDuration: 3 * time.Second,
		LeaseRenew:    1 * time.Second,
		LeaseTick:     200 * time.Millisecond,
		PendingRetry:  300 * time.Millisecond,
		LogKeep:       50,
	}
}

func newTestNode(t *testing.T, id string) *testNode {
	t.Helper()
	dir := t.TempDir()
	m, err := membership.NewManager(membership.Option{
		NodeID:      id,
		DBFile:      filepath.Join(dir, "cluster.db"),
		KeyFile:     filepath.Join(dir, "node.key"),
		Version:     "test",
		DefaultName: "Node " + id,
	})
	if err != nil {
		t.Fatalf("NewManager(%s): %v", id, err)
	}
	meta, err := New(fastOption(m))
	if err != nil {
		t.Fatalf("metadata.New(%s): %v", id, err)
	}
	srv := httptest.NewServer(m.ACNHandler())
	cfg := m.Config()
	cfg.AdvertiseURL = srv.URL
	if err := m.UpdateConfig(cfg); err != nil {
		t.Fatalf("UpdateConfig: %v", err)
	}
	n := &testNode{m: m, meta: meta, srv: srv, id: id}
	t.Cleanup(func() {
		meta.Close()
		m.Close()
		srv.Close()
	})
	return n
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

// cluster3 returns three joined nodes; a joined first so it becomes leader.
func cluster3(t *testing.T) (*testNode, *testNode, *testNode) {
	t.Helper()
	a := newTestNode(t, "node-a")
	b := newTestNode(t, "node-b")
	c := newTestNode(t, "node-c")
	if _, err := a.m.CreateCluster("Meta"); err != nil {
		t.Fatalf("CreateCluster: %v", err)
	}
	time.Sleep(1100 * time.Millisecond) //Joined is in seconds; keep a strictly first
	for _, n := range []*testNode{b, c} {
		token, _, _ := a.m.NewJoinToken(time.Hour)
		if _, err := n.m.JoinCluster(token); err != nil {
			t.Fatalf("JoinCluster(%s): %v", n.id, err)
		}
	}
	waitFor(t, "a to become leader", 10*time.Second, func() bool { return a.meta.IsLeader() })
	waitFor(t, "everyone to know the leader", 10*time.Second, func() bool {
		return b.meta.Leader() == "node-a" && c.meta.Leader() == "node-a"
	})
	return a, b, c
}

func hasPath(n *testNode, p string) bool {
	_, err := n.meta.Stat(p)
	return err == nil
}

/*
	Pure store tests
*/

func TestNormalizePath(t *testing.T) {
	tests := map[string]string{
		"":                      "/",
		"/":                     "/",
		"photos":                "/photos",
		"/photos/":              "/photos",
		"cluster:/photos/a.jpg": "/photos/a.jpg",
		"cluster:photos\\x\\y":  "/photos/x/y",
		"/a/../b/./c":           "/b/c",
		"/../x":                 "/x",
	}
	for in, want := range tests {
		if got := NormalizePath(in); got != want {
			t.Errorf("NormalizePath(%q) = %q want %q", in, got, want)
		}
	}
	if TopFolder("/photos/2026/a.jpg") != "/photos" || TopFolder("/") != "/" || ParentPath("/a/b") != "/a" || ParentPath("/") != "/" {
		t.Errorf("TopFolder / ParentPath wrong")
	}
}

func TestStoreLWWAndPaths(t *testing.T) {
	n := newTestNode(t, "solo")
	st := n.meta.st
	if !st.putFile(&FileRecord{ID: "f1", Path: "/docs/a.txt", Size: 1, Version: 10}) {
		t.Fatalf("first put should store")
	}
	if st.putFile(&FileRecord{ID: "f1", Path: "/docs/a.txt", Size: 99, Version: 5}) {
		t.Errorf("older version must be ignored")
	}
	if rec, _ := st.getFileByPath("/docs/a.txt"); rec.Size != 1 {
		t.Errorf("stale write applied")
	}
	//Rename moves the path index
	st.putFile(&FileRecord{ID: "f1", Path: "/docs/b.txt", Size: 1, Version: 11})
	if _, ok := st.getFileByPath("/docs/a.txt"); ok {
		t.Errorf("old path still resolves")
	}
	if rec, ok := st.getFileByPath("/docs/b.txt"); !ok || rec.ID != "f1" {
		t.Errorf("new path does not resolve")
	}
	//Tombstone hides from listing but the record stays
	st.putFile(&FileRecord{ID: "f1", Path: "/docs/b.txt", Removed: true, Version: 12})
	if _, ok := st.getFileByPath("/docs/b.txt"); ok {
		t.Errorf("tombstone resolves")
	}
	if _, ok := st.getFileByID("f1"); !ok {
		t.Errorf("tombstone record lost")
	}
	//Re-create under the same path with a new ID and newer version wins
	st.putFile(&FileRecord{ID: "f2", Path: "/docs/b.txt", Version: 13})
	if rec, ok := st.getFileByPath("/docs/b.txt"); !ok || rec.ID != "f2" {
		t.Errorf("re-created path should resolve to f2")
	}
}

func TestStoreListDirAndPolicy(t *testing.T) {
	n := newTestNode(t, "solo")
	st := n.meta.st
	st.putFile(&FileRecord{ID: "d1", Path: "/photos", IsDir: true, Version: 1})
	st.putFile(&FileRecord{ID: "d2", Path: "/photos/2026", IsDir: true, Version: 1})
	st.putFile(&FileRecord{ID: "f1", Path: "/photos/a.jpg", Version: 1})
	st.putFile(&FileRecord{ID: "f2", Path: "/photos/2026/b.jpg", Version: 1})
	st.putFile(&FileRecord{ID: "f3", Path: "/photosx/c.jpg", Version: 1})
	root := st.listDir("/")
	if len(root) != 1 || root[0].Path != "/photos" {
		//"/photosx/c.jpg" has no directory record, so only /photos is a direct child
		t.Errorf("root should list only /photos, got %+v", root)
	}
	kids := st.listDir("/photos")
	if len(kids) != 2 || kids[0].Path != "/photos/2026" || kids[1].Path != "/photos/a.jpg" {
		t.Errorf("listDir(/photos) = %+v", kids)
	}
	if sub := st.listSubtree("/photos"); len(sub) != 3 {
		t.Errorf("subtree should have 3 entries, got %d", len(sub))
	}
	files, dirs := st.counts()
	if files != 3 || dirs != 2 {
		t.Errorf("counts = %d files %d dirs", files, dirs)
	}
	if p := st.policyFor("/photos/2026/b.jpg"); p.Replicas != 1 || p.Folder != "/photos" {
		t.Errorf("default policy wrong: %+v", p)
	}
	st.putPolicy(&Policy{Folder: "/photos/anything", Replicas: 3, Version: 1})
	if p := st.policyFor("/photos/2026/b.jpg"); p.Replicas != 3 {
		t.Errorf("policy lookup should walk to the top folder, got %+v", p)
	}
	if st.putPolicy(&Policy{Folder: "/photos", Replicas: 1, Version: 0}) {
		t.Errorf("older policy version applied")
	}
}

func TestStoreLog(t *testing.T) {
	n := newTestNode(t, "solo")
	st := n.meta.st
	for i := 0; i < 5; i++ {
		st.appendLog(Entry{Kind: KindPolicy}, 1)
	}
	if st.getLastSeq() != 5 {
		t.Fatalf("lastSeq = %d", st.getLastSeq())
	}
	entries, ok := st.logAfter(2, 10)
	if !ok || len(entries) != 3 || entries[0].Seq != 3 {
		t.Errorf("logAfter(2) = %v %+v", ok, entries)
	}
	entries, ok = st.logAfter(0, 2)
	if !ok || len(entries) != 2 {
		t.Errorf("logAfter page size ignored")
	}
	st.compactLog(2)
	if _, ok := st.logAfter(1, 10); ok {
		t.Errorf("compacted range should report not ok")
	}
	if entries, ok := st.logAfter(3, 10); !ok || len(entries) != 2 {
		t.Errorf("retained tail should be readable: %v %+v", ok, entries)
	}
}

/*
	Multi-node tests
*/

func TestLeaderElectionAndFailover(t *testing.T) {
	a, b, c := cluster3(t)
	st := b.meta.Status()
	if st.Leader != "node-a" || st.IsLeader || st.LeaderName != "Node node-a" {
		t.Errorf("b status: %+v", st)
	}
	term := a.meta.st.getLease().Term

	//Leader dies completely (no heartbeats, no renewals): b (joined before c)
	//takes over once a drops out of the eligible set and the lease expires
	a.meta.Close()
	a.m.Close()
	a.srv.Close()
	waitFor(t, "b to become leader", 20*time.Second, func() bool { return b.meta.IsLeader() })
	waitFor(t, "c to follow b", 10*time.Second, func() bool { return c.meta.Leader() == "node-b" })
	if b.meta.st.getLease().Term <= term {
		t.Errorf("new leader must use a higher term")
	}
	//Changes keep flowing without a
	if err := b.meta.Submit(KindPolicy, &Policy{Folder: "/docs", Replicas: 2}); err != nil {
		t.Fatalf("submit on b: %v", err)
	}
	waitFor(t, "c to get the policy", 5*time.Second, func() bool { return c.meta.PolicyFor("/docs/x").Replicas == 2 })
}

func TestReplicationThroughLeaderAndFollower(t *testing.T) {
	a, b, c := cluster3(t)

	//Submit on the leader reaches both followers
	if err := a.meta.Submit(KindFile, &FileRecord{ID: "f1", Path: "/docs/a.txt", Size: 10}); err != nil {
		t.Fatalf("submit: %v", err)
	}
	waitFor(t, "followers to get f1", 5*time.Second, func() bool { return hasPath(b, "/docs/a.txt") && hasPath(c, "/docs/a.txt") })

	//Submit on a follower goes through the leader to everyone
	if err := c.meta.Submit(KindFile, &FileRecord{ID: "f2", Path: "/docs/b.txt", Size: 20}); err != nil {
		t.Fatalf("submit on c: %v", err)
	}
	waitFor(t, "a and b to get f2", 5*time.Second, func() bool { return hasPath(a, "/docs/b.txt") && hasPath(b, "/docs/b.txt") })

	//Version assigned by Submit strictly increases and older data never wins
	rec, _ := a.meta.Stat("/docs/a.txt")
	v1 := rec.Version
	rec.Size = 11
	a.meta.Submit(KindFile, rec)
	rec2, _ := a.meta.Stat("/docs/a.txt")
	if rec2.Version <= v1 || rec2.Size != 11 {
		t.Errorf("version not bumped: %d -> %d", v1, rec2.Version)
	}
	stale := rec2.Clone()
	stale.Size = 5
	stale.Version = v1
	b.meta.apply(mustEntry(t, KindFile, stale, v1, "node-b"))
	if got, _ := b.meta.Stat("/docs/a.txt"); got.Size == 5 {
		t.Errorf("stale entry overwrote newer record")
	}

	//Rename keeps the ID, directory listing works everywhere
	a.meta.Submit(KindFile, &FileRecord{ID: "d1", Path: "/docs", IsDir: true})
	rec, _ = a.meta.Stat("/docs/b.txt")
	rec.Path = "/docs/c.txt"
	a.meta.Submit(KindFile, rec)
	waitFor(t, "rename to reach b", 5*time.Second, func() bool {
		r, err := b.meta.Stat("/docs/c.txt")
		return err == nil && r.ID == "f2" && !hasPath(b, "/docs/b.txt")
	})
	if kids, err := c.meta.ListDir("/docs"); err != nil || len(kids) != 2 {
		t.Errorf("ListDir on c: %v %+v", err, kids)
	}
}

func TestCatchupByLogAndSnapshot(t *testing.T) {
	a, b, _ := cluster3(t)
	//Isolate b: close its server so pushes fail, then write on a
	b.srv.Close()
	for i := 0; i < 5; i++ {
		a.meta.Submit(KindFile, &FileRecord{ID: "f" + string(rune('0'+i)), Path: "/logs/" + string(rune('0'+i)), Size: int64(i)})
	}
	if hasPath(b, "/logs/4") {
		t.Fatalf("b must not have received pushes while isolated")
	}
	//Bring b back with a fresh server on a new URL; heartbeats carry the lease
	//and lastSeq so b notices the gap and catches up by log
	b.srv = httptest.NewServer(b.m.ACNHandler())
	cfg := b.m.Config()
	cfg.AdvertiseURL = b.srv.URL
	b.m.UpdateConfig(cfg)
	waitFor(t, "b to catch up by log", 15*time.Second, func() bool { return hasPath(b, "/logs/0") && hasPath(b, "/logs/4") })

	//Now force a snapshot: compact the leader log entirely and reset b
	b.srv.Close()
	for i := 0; i < 60; i++ {
		a.meta.Submit(KindPolicy, &Policy{Folder: "/p" + uitoa(uint64(i)), Replicas: 2})
	}
	a.meta.st.compactLog(0)
	b.srv = httptest.NewServer(b.m.ACNHandler())
	cfg.AdvertiseURL = b.srv.URL
	b.m.UpdateConfig(cfg)
	waitFor(t, "b to catch up by snapshot", 15*time.Second, func() bool {
		return b.meta.PolicyFor("/p59/x").Replicas == 2 && b.meta.Status().Applied == a.meta.st.getLastSeq()
	})
}

func TestPendingWhenNoLeader(t *testing.T) {
	a := newTestNode(t, "node-a")
	if err := a.meta.Submit(KindFile, &FileRecord{ID: "x", Path: "/x"}); err != ErrNotInCluster {
		t.Errorf("submit outside cluster: %v", err)
	}
	a.m.CreateCluster("Solo")
	//Before the first lease tick there is no leader: change is queued locally
	if err := a.meta.Submit(KindFile, &FileRecord{ID: "x", Path: "/x", Size: 1}); err != nil {
		t.Fatalf("submit: %v", err)
	}
	if !hasPath(a, "/x") {
		t.Errorf("local apply must be immediate")
	}
	waitFor(t, "pending to drain once a is leader", 10*time.Second, func() bool {
		return a.meta.IsLeader() && a.meta.Status().Pending == 0 && a.meta.st.getLastSeq() >= 1
	})
}

func TestLeaveResetsStore(t *testing.T) {
	a, b, _ := cluster3(t)
	a.meta.Submit(KindFile, &FileRecord{ID: "f1", Path: "/keep.txt"})
	waitFor(t, "b to get the file", 5*time.Second, func() bool { return hasPath(b, "/keep.txt") })
	if err := b.m.LeaveCluster(); err != nil {
		t.Fatalf("leave: %v", err)
	}
	if hasPath(b, "/keep.txt") || b.meta.Status().InCluster {
		t.Errorf("metadata should be wiped after leaving")
	}
	if hasPath(a, "/keep.txt") == false {
		t.Errorf("a must keep its data")
	}
}

func mustEntry(t *testing.T, kind string, rec interface{}, version int64, origin string) Entry {
	t.Helper()
	e, err := newEntry(kind, rec, version, origin)
	if err != nil {
		t.Fatalf("newEntry: %v", err)
	}
	return e
}
