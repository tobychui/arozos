package jobs

import (
	"context"
	"encoding/json"
	"path"
	"strings"
	"testing"
	"time"

	"imuslab.com/arozos/mod/cluster/metadata"
)

/*
mrExecutor pretends to be the AGI runtime for map/reduce: it recognises
the wrappers the runner builds and produces what the real scripts would.
Map tasks emit (extension, 1) per input; the reducer sums the values.
*/
type mrExecutor struct {
	base *fakeExecutor
	node string
}

func (m *mrExecutor) UserExists(owner string) bool { return m.base.UserExists(owner) }

func (m *mrExecutor) Run(ctx context.Context, rec Record, source string, hooks ExecHooks) (json.RawMessage, error) {
	m.base.mu.Lock()
	m.base.ran = append(m.base.ran, rec.Spec.ID)
	fail := m.base.failAll
	m.base.mu.Unlock()
	if fail {
		return nil, ErrNoMapper
	}
	switch {
	case strings.Contains(source, "mapper(JOB.inputs, emit)"):
		if !strings.Contains(source, "function mapper(") {
			return nil, ErrNoMapper
		}
		pairs := [][]interface{}{}
		for _, in := range rec.Spec.Inputs {
			ext := strings.TrimPrefix(path.Ext(in), ".")
			pairs = append(pairs, []interface{}{ext, 1})
		}
		js, _ := json.Marshal(pairs)
		if hooks.Log != nil {
			hooks.Log("mapped " + itoa(len(rec.Spec.Inputs)) + " files on " + rec.State.Node)
		}
		return js, nil
	case strings.Contains(source, "reducer(__keys["):
		var args struct {
			Groups map[string][]json.RawMessage `json:"groups"`
		}
		if json.Unmarshal(rec.Spec.Args, &args) != nil {
			return nil, ErrNoMapper
		}
		out := map[string]int{}
		for k, vals := range args.Groups {
			out[k] = len(vals)
		}
		js, _ := json.Marshal(out)
		return js, nil
	}
	return json.RawMessage(`null`), nil
}

const mrScript = `function mapper(files, emit) { files.forEach(function(f){ emit(f, 1); }); }
function reducer(key, values) { return values.length; }`

// addFile publishes a file record with a healthy copy on the given node.
func addFile(t *testing.T, n *testNode, p string, node string, volume string) {
	t.Helper()
	rec := &metadata.FileRecord{ID: "file:" + p, Path: p, Size: 10, Checksum: "x"}
	rec.SetLocation(metadata.Location{VolumeID: volume, NodeID: node, State: metadata.LocVerified, Checksum: "x"})
	rec.Primary = volume
	if err := n.meta.Submit(metadata.KindFile, rec); err != nil {
		t.Fatalf("submit file: %v", err)
	}
}

func addVolume(t *testing.T, n *testNode, id string, node string) {
	t.Helper()
	if err := n.meta.Submit(metadata.KindVolume, &metadata.Volume{ID: id, NodeID: node, Name: id}); err != nil {
		t.Fatalf("submit volume: %v", err)
	}
}

func TestMapReduceSourceWrappers(t *testing.T) {
	m := sourceFor(Record{Spec: Spec{Kind: KindMap, Script: mrScript}})
	if !strings.Contains(m, "mapper(JOB.inputs, emit)") || !strings.Contains(m, "__emitted") {
		t.Errorf("map wrapper wrong")
	}
	r := sourceFor(Record{Spec: Spec{Kind: KindReduce, Script: mrScript}})
	if !strings.Contains(r, "reducer(__keys[") || !strings.Contains(r, "JOB.args.groups") {
		t.Errorf("reduce wrapper wrong")
	}
	plain := sourceFor(Record{Spec: Spec{Kind: KindRun, Script: goodScript}})
	if !strings.Contains(plain, "run(JOB)") {
		t.Errorf("run wrapper wrong")
	}
}

func TestMapReduceEndToEnd(t *testing.T) {
	base := newExec("toby")
	execA := &mrExecutor{base: base, node: "node-a"}
	execB := &mrExecutor{base: newExec("toby"), node: "node-b"}
	a := newTestNode(t, "node-a", execA, manifest("linux", "amd64"))
	b := newTestNode(t, "node-b", execB, manifest("linux", "amd64"))
	if _, err := a.m.CreateCluster("MR"); err != nil {
		t.Fatalf("CreateCluster: %v", err)
	}
	time.Sleep(1100 * time.Millisecond)
	token, _, _ := a.m.NewJoinToken(time.Hour)
	if _, err := b.m.JoinCluster(token); err != nil {
		t.Fatalf("join: %v", err)
	}
	waitFor(t, "leader", 10*time.Second, func() bool { return a.meta.IsLeader() && b.meta.Leader() == "node-a" })

	//Six jpg on a, three png on b
	addVolume(t, a, "vol-a", "node-a")
	addVolume(t, a, "vol-b", "node-b")
	for i := 0; i < 6; i++ {
		addFile(t, a, "/data/a"+itoa(i)+".jpg", "node-a", "vol-a")
	}
	for i := 0; i < 3; i++ {
		addFile(t, a, "/data/b"+itoa(i)+".png", "node-b", "vol-b")
	}
	waitFor(t, "files replicated", 5*time.Second, func() bool { return len(b.meta.Glob("/data/**")) == 9 })

	rec, err := a.jobs.Submit(Spec{
		Owner: "toby", Name: "count", Script: mrScript, Kind: KindMapReduce,
		Dataset: "cluster:/data/**", PartitionMax: 4,
	})
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	waitFor(t, "map/reduce to finish", 30*time.Second, func() bool {
		r, ok := a.jobs.Get(rec.Spec.ID)
		return ok && r.Done()
	})
	final, _ := a.jobs.Get(rec.Spec.ID)
	if final.State.Status != StatusSucceeded {
		t.Fatalf("parent failed: %+v", final.State)
	}
	var out map[string]int
	if err := json.Unmarshal(final.State.Output, &out); err != nil {
		t.Fatalf("output: %v (%s)", err, final.State.Output)
	}
	if out["jpg"] != 6 || out["png"] != 3 {
		t.Errorf("counts wrong: %+v", out)
	}
	if final.State.Progress != 1 {
		t.Errorf("progress should be 1, got %v", final.State.Progress)
	}

	//Children: map tasks ran where their inputs are, plus one reduce
	kids := a.jobs.children(rec.Spec.ID)
	mapCount, reduceCount := 0, 0
	for _, k := range kids {
		switch k.Spec.Kind {
		case KindMap:
			mapCount++
			if len(k.Spec.Inputs) > 4 {
				t.Errorf("partition larger than PartitionMax: %d", len(k.Spec.Inputs))
			}
			//Every input of a map task has a copy on the node that ran it
			for _, in := range k.Spec.Inputs {
				fr, err := a.meta.Stat(in)
				if err != nil {
					t.Fatalf("stat %s: %v", in, err)
				}
				onNode := false
				for _, l := range fr.HealthyLocations() {
					if l.NodeID == k.State.Node {
						onNode = true
					}
				}
				if !onNode {
					t.Errorf("map task ran on %s but %s has no copy there", k.State.Node, in)
				}
			}
		case KindReduce:
			reduceCount++
		}
	}
	//6 jpg on a -> 2 partitions (max 4), 3 png on b -> 1 partition
	if mapCount != 3 || reduceCount != 1 {
		t.Errorf("expected 3 map tasks and 1 reduce, got %d and %d", mapCount, reduceCount)
	}
}

func TestMapReduceValidationAndOrphans(t *testing.T) {
	a := newTestNode(t, "solo", newExec("toby"), manifest("linux", "amd64"))
	a.m.CreateCluster("MR")
	waitFor(t, "leader", 5*time.Second, func() bool { return a.meta.IsLeader() })

	if _, err := a.jobs.Submit(Spec{Owner: "toby", Script: mrScript, Kind: KindMapReduce}); err == nil {
		t.Errorf("map/reduce without a dataset accepted")
	}

	//A dataset that matches nothing succeeds with an empty result
	rec, err := a.jobs.Submit(Spec{Owner: "toby", Name: "empty", Script: mrScript, Kind: KindMapReduce, Dataset: "/nothing/**"})
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	waitFor(t, "empty dataset job", 10*time.Second, func() bool {
		r, ok := a.jobs.Get(rec.Spec.ID)
		return ok && r.Done()
	})
	final, _ := a.jobs.Get(rec.Spec.ID)
	if final.State.Status != StatusSucceeded || string(final.State.Output) != "{}" {
		t.Errorf("empty dataset: %+v", final.State)
	}

	//A file whose only copy is on an unknown node fails the job with a reason
	addVolume(t, a, "ghost-vol", "ghost-node")
	addFile(t, a, "/data/lost.jpg", "ghost-node", "ghost-vol")
	rec2, _ := a.jobs.Submit(Spec{Owner: "toby", Name: "orphan", Script: mrScript, Kind: KindMapReduce, Dataset: "/data/**"})
	waitFor(t, "orphan job to fail", 10*time.Second, func() bool {
		r, ok := a.jobs.Get(rec2.Spec.ID)
		return ok && r.State.Status == StatusFailed
	})
	failed, _ := a.jobs.Get(rec2.Spec.ID)
	if !strings.Contains(failed.State.Error, "lost.jpg") {
		t.Errorf("failure should name the unreachable file: %q", failed.State.Error)
	}
}

func TestMapFailureFailsParent(t *testing.T) {
	base := newExec("toby")
	base.failAll = true
	a := newTestNode(t, "solo", &mrExecutor{base: base}, manifest("linux", "amd64"))
	a.m.CreateCluster("MR")
	waitFor(t, "leader", 5*time.Second, func() bool { return a.meta.IsLeader() })
	addVolume(t, a, "vol", "solo")
	addFile(t, a, "/data/x.jpg", "solo", "vol")
	rec, err := a.jobs.Submit(Spec{Owner: "toby", Name: "boom", Script: mrScript, Kind: KindMapReduce, Dataset: "/data/**", MaxAttempts: 1})
	if err != nil {
		t.Fatalf("Submit: %v", err)
	}
	waitFor(t, "parent to fail", 30*time.Second, func() bool {
		r, ok := a.jobs.Get(rec.Spec.ID)
		return ok && r.State.Status == StatusFailed
	})
	final, _ := a.jobs.Get(rec.Spec.ID)
	if !strings.Contains(final.State.Error, "map") {
		t.Errorf("parent error should name the failing task: %q", final.State.Error)
	}
	for _, k := range a.jobs.children(rec.Spec.ID) {
		if !k.Done() {
			t.Errorf("child %s left running after the parent failed", k.Spec.Name)
		}
	}
}
