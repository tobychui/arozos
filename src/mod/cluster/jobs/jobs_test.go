package jobs

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync"
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

// fakeExecutor pretends to run scripts: it looks for markers in the source.
type fakeExecutor struct {
	mu      sync.Mutex
	ran     []string
	users   map[string]bool
	block   chan struct{} // when set, Run waits on it (or on ctx)
	failAll bool
}

func newExec(users ...string) *fakeExecutor {
	f := &fakeExecutor{users: map[string]bool{}}
	for _, u := range users {
		f.users[u] = true
	}
	return f
}

func (f *fakeExecutor) UserExists(owner string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.users[owner]
}

func (f *fakeExecutor) Run(ctx context.Context, rec Record, source string, hooks ExecHooks) (json.RawMessage, error) {
	f.mu.Lock()
	f.ran = append(f.ran, rec.Spec.ID)
	block := f.block
	fail := f.failAll
	f.mu.Unlock()
	if hooks.Log != nil {
		hooks.Log("started " + rec.Spec.Name)
	}
	if hooks.Progress != nil {
		hooks.Progress(0.5)
	}
	if block != nil {
		select {
		case <-block:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	if fail {
		return nil, context.Canceled
	}
	if !strings.Contains(source, "function run(") {
		return nil, ErrScriptNoRun
	}
	return json.RawMessage(`{"ok":true,"node":"` + rec.State.Node + `"}`), nil
}

func (f *fakeExecutor) count() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return len(f.ran)
}

type testNode struct {
	id   string
	m    *membership.Manager
	meta *metadata.Manager
	jobs *Manager
	exec Executor
	srv  *httptest.Server
}

func newTestNode(t *testing.T, id string, exec Executor, caps capability.Manifest) *testNode {
	t.Helper()
	dir := t.TempDir()
	m, err := membership.NewManager(membership.Option{
		NodeID: id, DBFile: filepath.Join(dir, "c.db"), KeyFile: filepath.Join(dir, "k"),
		Version: "t", DefaultName: "Node " + id,
		Capabilities: func() capability.Manifest { return caps },
		Health:       func() membership.Health { return membership.Health{CPUUsage: 10, RAMUsed: 1, RAMTotal: 4} },
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
	jm, err := New(Option{
		Membership: m, Metadata: meta, Executor: exec,
		ScheduleInterval: 300 * time.Millisecond, TaskLease: 2 * time.Second, LeaseRenew: 500 * time.Millisecond,
	})
	if err != nil {
		t.Fatalf("jobs.New: %v", err)
	}
	srv := httptest.NewServer(m.ACNHandler())
	cfg := m.Config()
	cfg.AdvertiseURL = srv.URL
	m.UpdateConfig(cfg)
	t.Cleanup(func() { jm.Close(); meta.Close(); m.Close(); srv.Close() })
	return &testNode{id: id, m: m, meta: meta, jobs: jm, exec: exec, srv: srv}
}

func manifest(os, arch string, features ...string) capability.Manifest {
	f := map[string]bool{}
	for _, x := range features {
		f[x] = true
	}
	return capability.Manifest{OS: os, Arch: arch, CPUCores: 4, TotalRAM: 8 << 30, Features: f, DetectedAt: 1}
}

func waitFor(t *testing.T, what string, d time.Duration, cond func() bool) {
	t.Helper()
	deadline := time.Now().Add(d)
	for !cond() {
		if time.Now().After(deadline) {
			t.Fatalf("timed out waiting for %s", what)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

func cluster2(t *testing.T, execA, execB *fakeExecutor, capsA, capsB capability.Manifest) (*testNode, *testNode) {
	t.Helper()
	a := newTestNode(t, "node-a", execA, capsA)
	b := newTestNode(t, "node-b", execB, capsB)
	if _, err := a.m.CreateCluster("Jobs"); err != nil {
		t.Fatalf("CreateCluster: %v", err)
	}
	time.Sleep(1100 * time.Millisecond)
	token, _, _ := a.m.NewJoinToken(time.Hour)
	if _, err := b.m.JoinCluster(token); err != nil {
		t.Fatalf("join: %v", err)
	}
	waitFor(t, "leader", 10*time.Second, func() bool { return a.meta.IsLeader() && b.meta.Leader() == "node-a" })
	return a, b
}

const goodScript = "function run(job) { return {ok: true}; }"

func TestBuildSourceWrapsScript(t *testing.T) {
	src := buildSource(goodScript)
	for _, want := range []string{"_job_spec()", "JOB.log", "JOB.abortIfCancelled", goodScript, "_job_output", "run(JOB)"} {
		if !strings.Contains(src, want) {
			t.Errorf("wrapped source missing %q", want)
		}
	}
}

func TestSubmitValidation(t *testing.T) {
	a := newTestNode(t, "solo", newExec("toby"), manifest("linux", "amd64"))
	if _, err := a.jobs.Submit(Spec{Owner: "toby", Script: goodScript}); err != metadata.ErrNotInCluster {
		t.Errorf("submit outside cluster: %v", err)
	}
	a.m.CreateCluster("Solo")
	waitFor(t, "leader", 5*time.Second, func() bool { return a.meta.IsLeader() })
	if _, err := a.jobs.Submit(Spec{Owner: "toby"}); err == nil {
		t.Errorf("empty script accepted")
	}
	if _, err := a.jobs.Submit(Spec{Script: goodScript}); err == nil {
		t.Errorf("missing owner accepted")
	}
	rec, err := a.jobs.Submit(Spec{Owner: "toby", Script: goodScript, ScriptName: "x.agi", Inputs: []string{"cluster:/a/../b"}})
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	if rec.Spec.ID == "" || rec.Spec.Name != "x.agi" || rec.Spec.TimeoutSec != 3600 || rec.Spec.MaxAttempts != 3 || rec.Spec.Kind != KindRun {
		t.Errorf("defaults wrong: %+v", rec.Spec)
	}
	if rec.Spec.Inputs[0] != "/b" {
		t.Errorf("inputs not normalised: %v", rec.Spec.Inputs)
	}
}

func TestJobRunsAndReplicates(t *testing.T) {
	execA, execB := newExec("toby"), newExec("toby")
	a, b := cluster2(t, execA, execB, manifest("linux", "amd64"), manifest("linux", "amd64"))
	rec, err := a.jobs.Submit(Spec{Owner: "toby", Name: "hello", Script: goodScript})
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	waitFor(t, "job to succeed", 15*time.Second, func() bool {
		r, ok := a.jobs.Get(rec.Spec.ID)
		return ok && r.State.Status == StatusSucceeded
	})
	final, _ := a.jobs.Get(rec.Spec.ID)
	if final.State.Node == "" || final.State.Progress != 1 || len(final.State.Log) == 0 {
		t.Errorf("final state incomplete: %+v", final.State)
	}
	var out map[string]interface{}
	if json.Unmarshal(final.State.Output, &out) != nil || out["ok"] != true {
		t.Errorf("output wrong: %s", final.State.Output)
	}
	if execA.count()+execB.count() != 1 {
		t.Errorf("job should run exactly once, ran %d times", execA.count()+execB.count())
	}
	//The record reaches the other node
	waitFor(t, "b to see the finished job", 5*time.Second, func() bool {
		r, ok := b.jobs.Get(rec.Spec.ID)
		return ok && r.State.Status == StatusSucceeded
	})
	//Listing is owner scoped
	if len(b.jobs.List("toby")) != 1 || len(b.jobs.List("someone")) != 0 {
		t.Errorf("owner filtering wrong")
	}
	st := a.jobs.Status("")
	if st.Succeeded != 1 || !st.IsLeader || st.LocalSlots < 1 {
		t.Errorf("status wrong: %+v", st)
	}
}

func TestRequirementsPickTheRightNode(t *testing.T) {
	execA, execB := newExec("toby"), newExec("toby")
	//Only b has ffmpeg
	a, b := cluster2(t, execA, execB, manifest("linux", "amd64"), manifest("linux", "amd64", "ffmpeg"))
	rec, err := a.jobs.Submit(Spec{Owner: "toby", Name: "transcode", Script: goodScript,
		Requirements: capability.Requirements{Features: []string{"ffmpeg"}}})
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	waitFor(t, "job to run on b", 15*time.Second, func() bool {
		r, ok := a.jobs.Get(rec.Spec.ID)
		return ok && r.State.Status == StatusSucceeded
	})
	final, _ := a.jobs.Get(rec.Spec.ID)
	if final.State.Node != "node-b" {
		t.Errorf("job should run on the node with ffmpeg, ran on %s", final.State.Node)
	}
	if execA.count() != 0 || execB.count() != 1 {
		t.Errorf("wrong executor ran the job: a=%d b=%d", execA.count(), execB.count())
	}

	//A requirement nobody satisfies stays queued with an explanation
	rec2, _ := a.jobs.Submit(Spec{Owner: "toby", Name: "cuda", Script: goodScript,
		Requirements: capability.Requirements{Features: []string{"cuda"}}})
	waitFor(t, "queued reason", 10*time.Second, func() bool {
		r, ok := a.jobs.Get(rec2.Spec.ID)
		return ok && r.State.Status == StatusQueued && strings.Contains(r.State.Reason, "cuda")
	})
	_ = b
}

func TestCancelRunningJob(t *testing.T) {
	execA := newExec("toby")
	execA.block = make(chan struct{})
	a := newTestNode(t, "solo", execA, manifest("linux", "amd64"))
	a.m.CreateCluster("Solo")
	waitFor(t, "leader", 5*time.Second, func() bool { return a.meta.IsLeader() })
	rec, err := a.jobs.Submit(Spec{Owner: "toby", Name: "slow", Script: goodScript})
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	waitFor(t, "job running", 10*time.Second, func() bool {
		r, ok := a.jobs.Get(rec.Spec.ID)
		return ok && r.State.Status == StatusRunning
	})
	if err := a.jobs.Cancel(rec.Spec.ID, "someone-else", false); err == nil {
		t.Errorf("another user cancelled the job")
	}
	if err := a.jobs.Cancel(rec.Spec.ID, "toby", false); err != nil {
		t.Fatalf("Cancel: %v", err)
	}
	waitFor(t, "cancelled", 10*time.Second, func() bool {
		r, ok := a.jobs.Get(rec.Spec.ID)
		return ok && r.State.Status == StatusCancelled && r.State.Finished > 0
	})
	close(execA.block)
}

func TestWaitAndOwnerMissing(t *testing.T) {
	execA, execB := newExec(), newExec("toby") //a has no account for toby
	a, b := cluster2(t, execA, execB, manifest("linux", "amd64"), manifest("linux", "amd64"))
	rec, err := a.jobs.Submit(Spec{Owner: "toby", Name: "wait-me", Script: goodScript})
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	final, err := a.jobs.Wait(rec.Spec.ID, 20*time.Second)
	if err != nil {
		t.Fatalf("Wait: %v", err)
	}
	if final.State.Status != StatusSucceeded || final.State.Node != "node-b" {
		t.Errorf("job should have run on the node that knows the user: %+v", final.State)
	}
	if _, err := a.jobs.Wait("no-such-job", time.Second); err != ErrNotFound {
		t.Errorf("waiting for an unknown job: %v", err)
	}
	_ = b
}

func TestNodesPinAJob(t *testing.T) {
	execA, execB := newExec("toby"), newExec("toby")
	a, _ := cluster2(t, execA, execB, manifest("linux", "amd64"), manifest("linux", "amd64"))

	//One job per node, each pinned to its node, lands exactly there
	for _, id := range []string{"node-a", "node-b"} {
		rec, err := a.jobs.Submit(SpecFrom(SubmitRequest{Name: "hello " + id, Script: goodScript, Nodes: []string{id}}, "toby"))
		if err != nil {
			t.Fatalf("Submit(%s): %v", id, err)
		}
		waitFor(t, "pinned job on "+id, 15*time.Second, func() bool {
			r, ok := a.jobs.Get(rec.Spec.ID)
			return ok && r.State.Status == StatusSucceeded
		})
		if r, _ := a.jobs.Get(rec.Spec.ID); r.State.Node != id {
			t.Errorf("job pinned to %s ran on %s", id, r.State.Node)
		}
	}
	if execA.count() != 1 || execB.count() != 1 {
		t.Errorf("each node should run exactly one job: a=%d b=%d", execA.count(), execB.count())
	}

	//A job pinned to a node that is not in the cluster waits and says why
	rec, _ := a.jobs.Submit(SpecFrom(SubmitRequest{Name: "nowhere", Script: goodScript, Nodes: []string{"node-z"}}, "toby"))
	waitFor(t, "queued reason", 10*time.Second, func() bool {
		r, ok := a.jobs.Get(rec.Spec.ID)
		return ok && r.State.Status == StatusQueued && strings.Contains(r.State.Reason, "limited to other nodes")
	})
}

func TestRefusalIsPermanent(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"no error", nil, false},
		{"owner missing locally", ErrNoUser, true},
		{"cannot execute locally", ErrNoExecutor, true},
		{"owner missing on a remote node", errors.New("remote node returned Conflict: {\"error\":\"" + ErrNoUser.Error() + "\"}"), true},
		{"record not replicated yet", errors.New("remote node returned Not Found: {\"error\":\"job not found\"}"), false},
		{"tunnel still reconnecting", errors.New("target node is not connected through a tunnel on this node"), false},
		{"request timed out", context.DeadlineExceeded, false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := refusalIsPermanent(tc.err); got != tc.want {
				t.Errorf("refusalIsPermanent(%v) = %v; want %v", tc.err, got, tc.want)
			}
		})
	}
}

func TestBurstRunsEachJobOnce(t *testing.T) {
	execA, execB := newExec("toby"), newExec("toby")
	a, _ := cluster2(t, execA, execB, manifest("linux", "amd64"), manifest("linux", "amd64"))

	//Every Submit starts its own scheduling pass, so a burst of submissions
	//runs many passes at once; each job must still run exactly one time
	const total = 30
	ids := make(chan string, total)
	var wg sync.WaitGroup
	for i := 0; i < total; i++ {
		wg.Add(1)
		go func(i int) {
			defer wg.Done()
			pin := []string{"node-a", "node-b"}[i%2]
			rec, err := a.jobs.Submit(SpecFrom(SubmitRequest{Name: "burst", Script: goodScript, Nodes: []string{pin}}, "toby"))
			if err != nil {
				t.Errorf("Submit: %v", err)
				return
			}
			ids <- rec.Spec.ID
		}(i)
	}
	wg.Wait()
	close(ids)
	all := []string{}
	for id := range ids {
		all = append(all, id)
	}
	waitFor(t, "every job to finish", 30*time.Second, func() bool {
		for _, id := range all {
			if r, ok := a.jobs.Get(id); !ok || r.State.Status != StatusSucceeded {
				return false
			}
		}
		return true
	})
	runs := map[string]int{}
	for _, f := range []*fakeExecutor{execA, execB} {
		f.mu.Lock()
		for _, id := range f.ran {
			runs[id]++
		}
		f.mu.Unlock()
	}
	for _, id := range all {
		if runs[id] != 1 {
			t.Errorf("job %s ran %d times, want exactly once", id, runs[id])
		}
	}
}
