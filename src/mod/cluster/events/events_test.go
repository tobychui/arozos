package events

import (
	"net/http/httptest"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"imuslab.com/arozos/mod/cluster/membership"
)

func init() {
	membership.HeartbeatInterval = 500 * time.Millisecond
	membership.OnlineWindow = 2 * time.Second
	membership.OfflineWindow = 4 * time.Second
}

type testNode struct {
	m   *membership.Manager
	bus *Bus
	srv *httptest.Server
}

func newTestNode(t *testing.T, id string, runner HookRunner) *testNode {
	t.Helper()
	dir := t.TempDir()
	m, err := membership.NewManager(membership.Option{NodeID: id, DBFile: filepath.Join(dir, "c.db"), KeyFile: filepath.Join(dir, "k"), Version: "t", DefaultName: id})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	bus, err := New(m, runner)
	if err != nil {
		t.Fatalf("events.New: %v", err)
	}
	srv := httptest.NewServer(m.ACNHandler())
	cfg := m.Config()
	cfg.AdvertiseURL = srv.URL
	m.UpdateConfig(cfg)
	t.Cleanup(func() { bus.Close(); m.Close(); srv.Close() })
	return &testNode{m: m, bus: bus, srv: srv}
}

func waitFor(t *testing.T, what string, d time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(d)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(25 * time.Millisecond)
	}
}

func TestMatches(t *testing.T) {
	tests := []struct {
		types []string
		ev    string
		want  bool
	}{
		{[]string{"*"}, "file.created", true},
		{[]string{"file.created"}, "file.created", true},
		{[]string{"file.created"}, "file.removed", false},
		{[]string{"file.*"}, "file.removed", true},
		{[]string{"node.*"}, "file.removed", false},
		{[]string{"FILE.Created"}, "file.created", true},
	}
	for _, tc := range tests {
		if got := matches(typeSet(tc.types), tc.ev); got != tc.want {
			t.Errorf("matches(%v, %s) = %v", tc.types, tc.ev, got)
		}
	}
}

func TestLocalPublishSubscribeDedup(t *testing.T) {
	n := newTestNode(t, "solo", nil)
	var mu sync.Mutex
	got := []Event{}
	unsub := n.bus.Subscribe([]string{"file.*"}, func(e Event) { mu.Lock(); got = append(got, e); mu.Unlock() })
	n.bus.Publish(Event{Type: "file.created", Path: "/a"})
	n.bus.Publish(Event{Type: "node.online"})
	n.bus.Publish(Event{ID: "dup", Type: "file.removed"})
	n.bus.Publish(Event{ID: "dup", Type: "file.removed"})
	mu.Lock()
	if len(got) != 2 || got[0].Path != "/a" || got[0].Node != "solo" || got[0].ID == "" {
		t.Errorf("got %+v", got)
	}
	mu.Unlock()
	unsub()
	n.bus.Publish(Event{Type: "file.created"})
	mu.Lock()
	if len(got) != 2 {
		t.Errorf("unsubscribed listener still called")
	}
	mu.Unlock()
}

func TestFanOutAndHooks(t *testing.T) {
	var runMu sync.Mutex
	runs := []string{}
	runner := func(h Hook, ev Event) error {
		runMu.Lock()
		runs = append(runs, h.Script+":"+ev.Type)
		runMu.Unlock()
		return nil
	}
	a := newTestNode(t, "node-a", runner)
	b := newTestNode(t, "node-b", runner)
	a.m.CreateCluster("Ev")
	token, _, _ := a.m.NewJoinToken(time.Hour)
	if _, err := b.m.JoinCluster(token); err != nil {
		t.Fatalf("join: %v", err)
	}
	waitFor(t, "b online at a", 5*time.Second, func() bool {
		for _, n := range a.m.NodeViews() {
			if n.ID == "node-b" && n.State == membership.StateOnline {
				return true
			}
		}
		return false
	})
	var mu sync.Mutex
	seenOnB := []Event{}
	b.bus.Subscribe([]string{"file.created"}, func(e Event) { mu.Lock(); seenOnB = append(seenOnB, e); mu.Unlock() })
	if _, err := b.bus.AddHook("toby", []string{"file.*"}, "user:/hook.agi"); err != nil {
		t.Fatalf("AddHook: %v", err)
	}
	a.bus.Publish(Event{Type: "file.created", Path: "/x", User: "toby"})
	waitFor(t, "event to reach b", 5*time.Second, func() bool {
		mu.Lock()
		defer mu.Unlock()
		return len(seenOnB) == 1 && seenOnB[0].Node == "node-a" && seenOnB[0].Path == "/x"
	})
	waitFor(t, "hook to run on b", 5*time.Second, func() bool {
		runMu.Lock()
		defer runMu.Unlock()
		return len(runs) == 1 && runs[0] == "user:/hook.agi:file.created"
	})
	hooks := b.bus.Hooks("toby")
	if len(hooks) != 1 || hooks[0].RunCount != 1 || hooks[0].LastRun == 0 {
		t.Errorf("hook bookkeeping: %+v", hooks)
	}
	if err := b.bus.RemoveHook(hooks[0].ID, "alice"); err == nil {
		t.Errorf("other user removed hook")
	}
	if err := b.bus.RemoveHook(hooks[0].ID, "toby"); err != nil {
		t.Errorf("RemoveHook: %v", err)
	}
	if len(b.bus.Hooks("")) != 0 {
		t.Errorf("hook still listed")
	}
	//Hooks persist across bus restarts
	b.bus.AddHook("toby", []string{"node.*"}, "user:/n.agi")
	nb := &Bus{m: b.m, hooks: map[string]*Hook{}}
	nb.loadHooks()
	if len(nb.Hooks("toby")) != 1 {
		t.Errorf("hook not persisted")
	}
}
