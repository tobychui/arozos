package scheduling

import (
	"path/filepath"
	"testing"
	"time"

	"imuslab.com/arozos/mod/cluster/capability"
	"imuslab.com/arozos/mod/cluster/membership"
	"imuslab.com/arozos/mod/cluster/metadata"
)

func init() {
	membership.HeartbeatInterval = 500 * time.Millisecond
	membership.OnlineWindow = 2 * time.Second
	membership.OfflineWindow = 4 * time.Second
}

func newScorer(t *testing.T) (*Manager, *membership.Manager, *metadata.Manager) {
	t.Helper()
	dir := t.TempDir()
	m, err := membership.NewManager(membership.Option{
		NodeID: "solo", DBFile: filepath.Join(dir, "c.db"), KeyFile: filepath.Join(dir, "k"),
		Version: "t", DefaultName: "Solo",
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
	s, err := New(m, meta)
	if err != nil {
		t.Fatalf("scheduling.New: %v", err)
	}
	t.Cleanup(func() { meta.Close(); m.Close() })
	return s, m, meta
}

func node(id string, state membership.NodeState, cpu float64, ramUsed, ramTotal int64, latency float64, features ...string) membership.NodeView {
	f := map[string]bool{}
	for _, x := range features {
		f[x] = true
	}
	return membership.NodeView{
		NodeRecord: membership.NodeRecord{
			ID: id, Name: "Node " + id,
			Capabilities: capability.Manifest{OS: "linux", Arch: "amd64", CPUCores: 4, TotalRAM: ramTotal, Features: f},
			Health:       membership.Health{CPUUsage: cpu, RAMUsed: ramUsed, RAMTotal: ramTotal, Timestamp: 1},
		},
		State: state, LatencyMs: latency,
	}
}

func TestWeightsValidation(t *testing.T) {
	d := DefaultWeights()
	if err := d.Validate(); err != nil {
		t.Errorf("defaults must validate: %v", err)
	}
	bad := d
	bad.Locality = 2
	if err := bad.Validate(); err == nil {
		t.Errorf("out of range weight accepted")
	}
	bad = d
	bad.CPU = -0.1
	if err := bad.Validate(); err == nil {
		t.Errorf("negative weight accepted")
	}
}

func TestWeightsReplicate(t *testing.T) {
	s, m, _ := newScorer(t)
	if got := s.Weights(); got != DefaultWeights() {
		t.Errorf("should start at the defaults: %+v", got)
	}
	if err := s.SetWeights(Weights{Locality: 2}); err == nil {
		t.Errorf("invalid weights stored")
	}
	m.CreateCluster("Sched")
	w := DefaultWeights()
	w.Locality = 0.8
	w.CPU = 0.05
	if err := s.SetWeights(w); err != nil {
		t.Fatalf("SetWeights: %v", err)
	}
	if got := s.Weights(); got.Locality != 0.8 || got.CPU != 0.05 {
		t.Errorf("weights not stored: %+v", got)
	}
	if err := s.ResetWeights(); err != nil {
		t.Fatalf("ResetWeights: %v", err)
	}
	if got := s.Weights(); got != DefaultWeights() {
		t.Errorf("reset did not restore the defaults: %+v", got)
	}
}

func TestScoreFactors(t *testing.T) {
	s, _, _ := newScorer(t)
	idle := node("idle", membership.StateOnline, 5, 1, 8, 5)
	busy := node("busy", membership.StateOnline, 95, 7, 8, 5)

	idleScore, factors := s.Score(Candidate{Node: idle, FreeDisk: -1, LatencyToData: -1})
	busyScore, _ := s.Score(Candidate{Node: busy, FreeDisk: -1, LatencyToData: -1})
	if idleScore <= busyScore {
		t.Errorf("an idle node must score above a busy one: %v vs %v", idleScore, busyScore)
	}
	names := map[string]bool{}
	for _, f := range factors {
		names[f.Name] = true
	}
	for _, want := range []string{"locality", "cpu free", "memory free", "disk free", "queue depth"} {
		if !names[want] {
			t.Errorf("explanation is missing the %q factor", want)
		}
	}

	//Locality dominates by default
	far, _ := s.Score(Candidate{Node: idle, FreeDisk: -1, LatencyToData: -1})
	near, _ := s.Score(Candidate{Node: idle, Locality: 1, FreeDisk: -1, LatencyToData: -1})
	if near <= far {
		t.Errorf("holding the data must help: %v vs %v", near, far)
	}
	//Queue depth and distance hurt
	queued, _ := s.Score(Candidate{Node: idle, Queue: 8, FreeDisk: -1, LatencyToData: -1})
	if queued >= far {
		t.Errorf("a queued node must score lower")
	}
	distant, _ := s.Score(Candidate{Node: idle, FreeDisk: -1, LatencyToData: 900})
	if distant >= far {
		t.Errorf("a distant node must score lower")
	}
	//Preferred features help without being required
	plain := node("plain", membership.StateOnline, 5, 1, 8, 5)
	gpu := node("gpu", membership.StateOnline, 5, 1, 8, 5, "cuda")
	withGPU, _ := s.Score(Candidate{Node: gpu, Preferred: []string{"cuda"}, FreeDisk: -1, LatencyToData: -1})
	without, _ := s.Score(Candidate{Node: plain, Preferred: []string{"cuda"}, FreeDisk: -1, LatencyToData: -1})
	if withGPU <= without {
		t.Errorf("a preferred feature must help: %v vs %v", withGPU, without)
	}
}

func TestRankPrefersHealthyNodes(t *testing.T) {
	s, _, _ := newScorer(t)
	always := func(Candidate) (bool, string) { return true, "" }

	online := node("online", membership.StateOnline, 50, 4, 8, 10)
	degraded := node("degraded", membership.StateDegraded, 10, 1, 8, 1)
	offline := node("offline", membership.StateOffline, 1, 1, 8, 1)

	//A degraded node is skipped while a healthy one is available, even when
	//it would otherwise score higher
	ranked := s.Rank([]Candidate{
		{Node: degraded, FreeDisk: -1, LatencyToData: -1},
		{Node: online, FreeDisk: -1, LatencyToData: -1},
	}, always)
	best, why := Best(ranked)
	if best != "online" || why != "" {
		t.Errorf("expected the healthy node, got %q (%s)", best, why)
	}
	for _, r := range ranked {
		if r.NodeID == "degraded" && r.Eligible {
			t.Errorf("degraded node should be held back while a healthy one exists")
		}
	}

	//With only a degraded node it is used
	ranked = s.Rank([]Candidate{{Node: degraded, FreeDisk: -1, LatencyToData: -1}}, always)
	if best, _ := Best(ranked); best != "degraded" {
		t.Errorf("a degraded node must be used when it is all there is, got %q", best)
	}

	//Ineligible nodes carry their reason and never win
	ranked = s.Rank([]Candidate{
		{Node: offline, FreeDisk: -1, LatencyToData: -1},
		{Node: online, FreeDisk: -1, LatencyToData: -1},
	}, func(c Candidate) (bool, string) {
		if c.Node.State != membership.StateOnline {
			return false, "node is " + string(c.Node.State)
		}
		return true, ""
	})
	if best, _ := Best(ranked); best != "online" {
		t.Errorf("offline node won: %q", best)
	}
	if ranked[len(ranked)-1].Eligible || ranked[len(ranked)-1].Reason == "" {
		t.Errorf("ineligible node must sort last with a reason: %+v", ranked[len(ranked)-1])
	}

	//Nothing eligible: Best explains why
	ranked = s.Rank([]Candidate{{Node: offline, FreeDisk: -1, LatencyToData: -1}}, func(c Candidate) (bool, string) {
		return false, "node is offline"
	})
	if best, why := Best(ranked); best != "" || why != "node is offline" {
		t.Errorf("expected a reason, got %q %q", best, why)
	}
}

func TestStatusPreview(t *testing.T) {
	s, m, _ := newScorer(t)
	m.CreateCluster("Sched")
	st := s.Status()
	if !st.InCluster || len(st.Nodes) != 1 || st.Nodes[0].ID != "solo" {
		t.Errorf("status wrong: %+v", st)
	}
	if st.Weights != DefaultWeights() || st.Defaults != DefaultWeights() {
		t.Errorf("weights missing from the status")
	}
}

func TestParseFeatures(t *testing.T) {
	got := ParseFeatures(" cuda , ffmpeg ,, ")
	if len(got) != 2 || got[0] != "cuda" || got[1] != "ffmpeg" {
		t.Errorf("ParseFeatures = %v", got)
	}
}

func TestScoreSiteDiversity(t *testing.T) {
	s, _, _ := newScorer(t)
	n := node("n", membership.StateOnline, 10, 1, 8, 5)

	near, factors := s.Score(Candidate{Node: n, FreeDisk: -1, LatencyToData: -1, Diversity: 0})
	far, _ := s.Score(Candidate{Node: n, FreeDisk: -1, LatencyToData: -1, Diversity: 1})
	if far <= near {
		t.Errorf("a node far from the existing copies must score higher: %v vs %v", far, near)
	}
	found := false
	for _, f := range factors {
		if f.Name == "site diversity" {
			found = true
		}
	}
	if !found {
		t.Errorf("the explanation must name the site diversity factor")
	}

	//A negative value means the question does not apply and the factor is
	//left out entirely, so a job is never scored on it
	_, factors = s.Score(Candidate{Node: n, FreeDisk: -1, LatencyToData: -1, Diversity: -1})
	for _, f := range factors {
		if f.Name == "site diversity" {
			t.Errorf("site diversity must be left out when it does not apply")
		}
	}
}

func TestWeightsFromOlderRecordKeepDefaults(t *testing.T) {
	s, m, meta := newScorer(t)
	m.CreateCluster("Upgrade")
	//A record written before "diversity" existed
	old := []byte(`{"locality":0.5,"cpu":0.2,"memory":0.1,"disk":0.05,"queue":0.1,"latency":0.05,"degraded":0.05,"preferred":0.1}`)
	if err := meta.Submit(metadata.KindSetting, &metadata.Setting{Key: SettingKey, Value: old}); err != nil {
		t.Fatalf("Submit: %v", err)
	}
	got := s.Weights()
	if got.Locality != 0.5 {
		t.Errorf("stored weight lost: %+v", got)
	}
	if got.Diversity != DefaultWeights().Diversity {
		t.Errorf("a weight the record predates must keep its default, got %v", got.Diversity)
	}
}
