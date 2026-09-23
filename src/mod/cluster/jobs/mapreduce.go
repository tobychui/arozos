package jobs

/*
	Map / Reduce on top of the job runtime.

	A map/reduce job carries one script that defines both halves:

		function mapper(files, emit) {       // files = paths of this partition
		    files.forEach(function(f){ emit(keyFor(f), 1); });
		}
		function reducer(key, values) { return values.length; }

	The leader expands the dataset glob over the namespace, groups the files
	by the node that already holds a healthy copy (so map work runs where the
	bytes are), splits each group into partitions and submits one child map
	job per partition. When every map child has succeeded it groups the
	emitted pairs by key and submits a single reduce child; the reduce output
	becomes the parent's output.

	Parent jobs are coordinated by the leader and never assigned to a node.
*/

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"imuslab.com/arozos/mod/cluster/metadata"
	"imuslab.com/arozos/mod/info/logger"
)

const defaultPartitionMax = 50

// mapOutput is one emitted pair from a mapper.
type mapOutput [2]json.RawMessage

// reduceArgs is what a reduce child receives.
type reduceArgs struct {
	Groups map[string][]json.RawMessage `json:"groups"`
}

// buildMapSource wraps a script for the map half.
func buildMapSource(script string) string {
	return jobPrelude + "\n" + script + `
if (typeof mapper !== "function") { throw new Error("this map/reduce script defines no mapper(files, emit) function"); }
var __emitted = [];
function emit(k, v) { __emitted.push([String(k), v === undefined ? null : v]); }
mapper(JOB.inputs, emit);
_job_output(JSON.stringify(__emitted));
`
}

// buildReduceSource wraps a script for the reduce half.
func buildReduceSource(script string) string {
	return jobPrelude + "\n" + script + `
if (typeof reducer !== "function") { throw new Error("this map/reduce script defines no reducer(key, values) function"); }
var __groups = (JOB.args && JOB.args.groups) ? JOB.args.groups : {};
var __out = {};
var __keys = Object.keys(__groups);
for (var __i = 0; __i < __keys.length; __i++) {
    JOB.progress(__i / Math.max(1, __keys.length));
    __out[__keys[__i]] = reducer(__keys[__i], __groups[__keys[__i]]);
}
_job_output(JSON.stringify(__out));
`
}

// sourceFor picks the right wrapper for a job kind.
func sourceFor(rec Record) string {
	switch rec.Spec.Kind {
	case KindMap:
		return buildMapSource(rec.Spec.Script)
	case KindReduce:
		return buildReduceSource(rec.Spec.Script)
	}
	return buildSource(rec.Spec.Script)
}

// children returns the child jobs of a parent.
func (j *Manager) children(parentID string) []Record {
	out := []Record{}
	for _, mj := range j.meta.Jobs() {
		if mj.Removed {
			continue
		}
		rec, ok := j.decode(&mj)
		if !ok || rec.Spec.ParentID != parentID {
			continue
		}
		out = append(out, rec)
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Spec.Created < out[b].Spec.Created })
	return out
}

// expandDataset lists the files of a dataset and groups them by the node
// holding a healthy copy (files with no reachable copy are reported).
func (j *Manager) expandDataset(pattern string) (byNode map[string][]metadata.FileRecord, orphans []string) {
	byNode = map[string][]metadata.FileRecord{}
	for _, rec := range j.meta.Glob(pattern) {
		best := ""
		for _, loc := range rec.HealthyLocations() {
			for _, n := range j.m.NodeViews() {
				if n.ID == loc.NodeID && usableState(n.State) {
					best = loc.NodeID
					break
				}
			}
			if best != "" {
				break
			}
		}
		if best == "" {
			orphans = append(orphans, rec.Path)
			continue
		}
		byNode[best] = append(byNode[best], rec)
	}
	return
}

// startMapReduce expands the dataset and submits the map children. It runs
// once per parent: submitting a child re-enters the scheduler, so the parent
// is marked running before any child exists.
func (j *Manager) startMapReduce(parent Record) {
	id := parent.Spec.ID
	j.mu.Lock()
	if j.starting[id] {
		j.mu.Unlock()
		return
	}
	j.starting[id] = true
	j.mu.Unlock()
	defer func() {
		j.mu.Lock()
		delete(j.starting, id)
		j.mu.Unlock()
	}()

	latest, ok := j.Get(id)
	if !ok || latest.State.Status != StatusQueued {
		return //another pass already expanded it
	}
	parent = latest
	pattern := strings.TrimSpace(parent.Spec.Dataset)
	if pattern == "" {
		j.failParent(parent, "the job has no dataset pattern")
		return
	}
	byNode, orphans := j.expandDataset(pattern)
	if len(orphans) > 0 {
		list := strings.Join(orphans, ", ")
		if len(list) > 300 {
			list = list[:300] + "..."
		}
		j.failParent(parent, "no reachable copy of: "+list)
		return
	}
	partitionMax := parent.Spec.PartitionMax
	if partitionMax <= 0 {
		partitionMax = defaultPartitionMax
	}

	nodes := make([]string, 0, len(byNode))
	for id := range byNode {
		nodes = append(nodes, id)
	}
	sort.Strings(nodes)

	//Claim the parent before creating children, so the scheduler pass that
	//that each child submission triggers cannot start it a second time.
	parent.State.Status = StatusRunning
	parent.State.Started = time.Now().Unix()
	parent.State.Progress = 0
	if err := j.put(parent); err != nil {
		return
	}

	created := 0
	for _, node := range nodes {
		files := byNode[node]
		for start := 0; start < len(files); start += partitionMax {
			end := start + partitionMax
			if end > len(files) {
				end = len(files)
			}
			inputs := []string{}
			for _, f := range files[start:end] {
				inputs = append(inputs, f.Path)
			}
			child := parent.Spec
			child.ID = ""
			child.Kind = KindMap
			child.ParentID = parent.Spec.ID
			child.Name = parent.Spec.Name + " map " + itoa(created+1)
			child.Inputs = inputs
			child.Dataset = ""
			if _, err := j.Submit(child); err != nil {
				j.failParent(parent, "could not create a map task: "+err.Error())
				return
			}
			created++
		}
	}
	if created == 0 {
		//Nothing matched: succeed with an empty result
		parent, _ = j.Get(parent.Spec.ID)
		parent.State.Status = StatusSucceeded
		parent.State.Progress = 1
		parent.State.Output = json.RawMessage(`{}`)
		parent.State.Finished = time.Now().Unix()
		parent.State.Log = append(parent.State.Log, "dataset matched no files")
		j.put(parent)
		j.finishedEvent(parent)
		return
	}
	parent, _ = j.Get(parent.Spec.ID)
	parent.State.Log = append(parent.State.Log, "expanded "+pattern+" into "+itoa(created)+" map task(s) across "+itoa(len(nodes))+" node(s)")
	j.put(parent)
	logger.PrintAndLog("Cluster", "Map/reduce "+parent.Spec.Name+" started with "+itoa(created)+" map tasks", nil)
}

// advanceMapReduce moves a running parent forward: it checks the children,
// creates the reduce task when the map half is complete, and publishes the
// final result.
func (j *Manager) advanceMapReduce(parent Record) {
	kids := j.children(parent.Spec.ID)
	if len(kids) == 0 {
		return
	}
	var maps, reduces []Record
	for _, k := range kids {
		if k.Spec.Kind == KindReduce {
			reduces = append(reduces, k)
		} else {
			maps = append(maps, k)
		}
	}

	//A failed or cancelled child fails the whole job
	for _, k := range kids {
		if k.State.Status == StatusFailed || k.State.Status == StatusCancelled {
			j.failParent(parent, k.Spec.Name+": "+firstNonEmpty(k.State.Error, k.State.Status))
			return
		}
	}

	doneMaps := 0
	for _, k := range maps {
		if k.State.Status == StatusSucceeded {
			doneMaps++
		}
	}
	total := len(maps) + 1 //the reduce task counts as one more step
	progress := float64(doneMaps) / float64(total)

	//Reduce already running or finished?
	if len(reduces) > 0 {
		red := reduces[0]
		switch red.State.Status {
		case StatusSucceeded:
			parent.State.Status = StatusSucceeded
			parent.State.Progress = 1
			parent.State.Output = red.State.Output
			parent.State.Finished = time.Now().Unix()
			parent.State.Node = red.State.Node
			j.put(parent)
			j.finishedEvent(parent)
			logger.PrintAndLog("Cluster", "Map/reduce "+parent.Spec.Name+" finished", nil)
		default:
			parent.State.Progress = float64(len(maps)) / float64(total)
			j.put(parent)
		}
		return
	}

	if doneMaps < len(maps) {
		if parent.State.Progress != progress {
			parent.State.Progress = progress
			j.put(parent)
		}
		return
	}

	//Every map task is done: group the emitted pairs by key
	groups := map[string][]json.RawMessage{}
	for _, k := range maps {
		var emitted []mapOutput
		if len(k.State.Output) == 0 {
			continue
		}
		if err := json.Unmarshal(k.State.Output, &emitted); err != nil {
			j.failParent(parent, k.Spec.Name+" produced an unreadable result")
			return
		}
		for _, pair := range emitted {
			key := strings.Trim(string(pair[0]), `"`)
			groups[key] = append(groups[key], pair[1])
		}
	}
	args, err := json.Marshal(reduceArgs{Groups: groups})
	if err != nil {
		j.failParent(parent, "could not assemble the reduce input: "+err.Error())
		return
	}
	if len(args) > 8<<20 {
		j.failParent(parent, "the mappers emitted more than 8 MB; narrow the dataset or emit fewer values")
		return
	}
	child := parent.Spec
	child.ID = ""
	child.Kind = KindReduce
	child.ParentID = parent.Spec.ID
	child.Name = parent.Spec.Name + " reduce"
	child.Inputs = nil
	child.Dataset = ""
	child.Args = json.RawMessage(args)
	if _, err := j.Submit(child); err != nil {
		j.failParent(parent, "could not create the reduce task: "+err.Error())
		return
	}
	parent.State.Progress = float64(len(maps)) / float64(total)
	parent.State.Log = append(parent.State.Log, "mapped "+itoa(len(groups))+" key(s), reducing")
	j.put(parent)
}

func (j *Manager) failParent(parent Record, reason string) {
	parent.State.Status = StatusFailed
	parent.State.Error = reason
	parent.State.Finished = time.Now().Unix()
	j.put(parent)
	j.finishedEvent(parent)
	//Cancel anything still pending underneath
	for _, k := range j.children(parent.Spec.ID) {
		if !k.Done() {
			j.Cancel(k.Spec.ID, k.Spec.Owner, true)
		}
	}
	logger.PrintAndLog("Cluster", "Map/reduce "+parent.Spec.Name+" failed: "+reason, nil)
}

// ErrNoMapper is returned when a map/reduce script is incomplete.
var ErrNoMapper = errors.New("a map/reduce script must define mapper(files, emit) and reducer(key, values)")
