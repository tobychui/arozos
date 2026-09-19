package jobs

/*
	ArozOS Cluster Job Runtime (AJR) and Scheduler (AJS)

	An application submits a job; the cluster picks a node that satisfies the
	job's requirements and preferably already holds its input data; that node
	runs the job as the submitting user and publishes the result. Jobs are
	AGI scripts (JavaScript) because that is the only payload portable across
	nodes of different OS and CPU architecture.

	Every job is one replicated record (metadata.KindJob), so any node can
	answer status queries locally and a new leader can resume scheduling.
	The scheduler loop runs on the metadata leader only; execution happens
	anywhere.
*/

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/cluster/capability"
	"imuslab.com/arozos/mod/cluster/membership"
	"imuslab.com/arozos/mod/cluster/metadata"
	"imuslab.com/arozos/mod/cluster/scheduling"
	"imuslab.com/arozos/mod/info/logger"
)

// Job statuses.
const (
	StatusQueued    = "queued"
	StatusScheduled = "scheduled"
	StatusRunning   = "running"
	StatusSucceeded = "succeeded"
	StatusFailed    = "failed"
	StatusCancelled = "cancelled"
)

// Job kinds.
const (
	KindRun       = "run"
	KindMap       = "map"
	KindReduce    = "reduce"
	KindMapReduce = "mapreduce"
)

const maxLogLines = 200

// Spec is what the submitter asks for.
type Spec struct {
	ID           string                  `json:"id"`
	Name         string                  `json:"name"`
	Owner        string                  `json:"owner"`
	Script       string                  `json:"script"`     //full JS source, captured at submit time
	ScriptName   string                  `json:"scriptName"` //for logs
	Args         json.RawMessage         `json:"args,omitempty"`
	Inputs       []string                `json:"inputs,omitempty"`
	Requirements capability.Requirements `json:"requirements"`
	//Nodes limits placement to these node ids; empty means any node. Map
	//and reduce children inherit it.
	Nodes       []string `json:"nodes,omitempty"`
	Priority    int      `json:"priority"`
	TimeoutSec  int      `json:"timeoutSec"`
	MaxAttempts int      `json:"maxAttempts"`
	Kind        string   `json:"kind"`
	ParentID    string   `json:"parentId,omitempty"`
	//Map/reduce only: the dataset glob and how many files one map task takes
	Dataset      string `json:"dataset,omitempty"`
	PartitionMax int    `json:"partitionMax,omitempty"`
	Created      int64  `json:"created"`
}

// State is what happened to it.
type State struct {
	Status       string          `json:"status"`
	Node         string          `json:"node,omitempty"`
	Attempts     int             `json:"attempts"`
	LeaseExpires int64           `json:"leaseExpires,omitempty"`
	Progress     float64         `json:"progress"`
	Output       json.RawMessage `json:"output,omitempty"`
	Log          []string        `json:"log,omitempty"`
	Error        string          `json:"error,omitempty"`
	Started      int64           `json:"started,omitempty"`
	Finished     int64           `json:"finished,omitempty"`
	Reason       string          `json:"reason,omitempty"`  //why it is still queued
	Blocked      []string        `json:"blocked,omitempty"` //nodes that refused this job
}

// Record is the replicated job (spec + state in one document, so the two can
// never disagree after a merge).
type Record struct {
	Spec  Spec  `json:"spec"`
	State State `json:"state"`
}

// Done reports whether the job reached a terminal state.
func (r *Record) Done() bool {
	switch r.State.Status {
	case StatusSucceeded, StatusFailed, StatusCancelled:
		return true
	}
	return false
}

// Option configures the job service.
type Option struct {
	Membership *membership.Manager
	Metadata   *metadata.Manager
	Executor   Executor
	//Scheduler scores the candidate nodes; nil falls back to the defaults.
	Scheduler *scheduling.Manager
	// LocalityBytes reports how many bytes of the given cluster:/ paths have a
	// healthy copy on nodeID, and the total size of those paths.
	LocalityBytes func(paths []string, nodeID string) (onNode int64, total int64)

	ScheduleInterval time.Duration
	TaskLease        time.Duration
	LeaseRenew       time.Duration
	MaxParallel      int
	RetentionHours   int
}

// Executor runs one job's script on this node. It is implemented by the core
// on top of the AGI gateway.
type Executor interface {
	// UserExists reports whether the job's owner has an account on this node.
	UserExists(owner string) bool
	// Run executes source as owner and returns what the script produced.
	// The context is cancelled on timeout or cancellation.
	Run(ctx context.Context, rec Record, source string, hooks ExecHooks) (output json.RawMessage, err error)
}

// ExecHooks are the callbacks the script drives through the job object.
type ExecHooks struct {
	Log       func(line string)
	Progress  func(p float64)
	Cancelled func() bool
}

// Manager is the job service of this node.
type Manager struct {
	m     *membership.Manager
	meta  *metadata.Manager
	exec  Executor
	sched *scheduling.Manager
	opt   Option

	mu       sync.Mutex
	running  map[string]*runState
	starting map[string]bool //map/reduce parents currently being expanded
	accepted map[string]bool //jobs this node took on and has not finished

	//schedMu serialises scheduling passes. Every submission, completion and
	//refusal starts a pass, and two passes running at once would both see a
	//job as queued and hand it out twice.
	schedMu sync.Mutex

	sem  chan struct{}
	stop chan struct{}
	wg   sync.WaitGroup
	once sync.Once

	// OnFinished fires when a job reaches a terminal state on this node.
	OnFinished func(rec Record)
}

type runState struct {
	cancel context.CancelFunc
	logs   []string
	prog   float64
	mu     sync.Mutex
}

var (
	ErrNotLeader  = errors.New("this node is not the metadata leader")
	ErrNotFound   = errors.New("job not found")
	ErrNoUser     = errors.New("the job owner has no account on this node")
	ErrNoExecutor = errors.New("this node cannot execute jobs")
)

// New creates the job service and starts its loops.
func New(opt Option) (*Manager, error) {
	if opt.Membership == nil || opt.Metadata == nil {
		return nil, errors.New("membership and metadata are required")
	}
	if opt.ScheduleInterval <= 0 {
		opt.ScheduleInterval = 3 * time.Second
	}
	if opt.TaskLease <= 0 {
		opt.TaskLease = 30 * time.Second
	}
	if opt.LeaseRenew <= 0 {
		opt.LeaseRenew = 10 * time.Second
	}
	if opt.MaxParallel <= 0 {
		opt.MaxParallel = runtime.NumCPU()
	}
	if opt.RetentionHours <= 0 {
		opt.RetentionHours = 72
	}
	if opt.Scheduler == nil {
		sc, err := scheduling.New(opt.Membership, opt.Metadata)
		if err != nil {
			return nil, err
		}
		opt.Scheduler = sc
	}
	j := &Manager{
		m:        opt.Membership,
		meta:     opt.Metadata,
		exec:     opt.Executor,
		sched:    opt.Scheduler,
		opt:      opt,
		running:  map[string]*runState{},
		starting: map[string]bool{},
		accepted: map[string]bool{},
		sem:      make(chan struct{}, opt.MaxParallel),
		stop:     make(chan struct{}),
	}
	j.registerACNHandlers()
	j.wg.Add(1)
	go j.loop()
	return j, nil
}

// Close stops the scheduler and cancels local jobs.
func (j *Manager) Close() {
	j.once.Do(func() { close(j.stop) })
	j.mu.Lock()
	for _, rs := range j.running {
		rs.cancel()
	}
	j.mu.Unlock()
	j.wg.Wait()
}

func (j *Manager) loop() {
	defer j.wg.Done()
	ticker := time.NewTicker(j.opt.ScheduleInterval)
	defer ticker.Stop()
	gc := time.NewTicker(time.Hour)
	defer gc.Stop()
	for {
		select {
		case <-j.stop:
			return
		case <-ticker.C:
			if j.meta.IsLeader() {
				j.schedule()
			}
		case <-gc.C:
			if j.meta.IsLeader() {
				cutoff := time.Now().Add(-time.Duration(j.opt.RetentionHours) * time.Hour).Unix()
				j.meta.GCJobs(cutoff, map[string]bool{StatusQueued: true, StatusScheduled: true, StatusRunning: true})
			}
		}
	}
}

/*
	Record helpers
*/

func (j *Manager) decode(mj *metadata.Job) (Record, bool) {
	var rec Record
	if mj == nil || json.Unmarshal(mj.Body, &rec) != nil {
		return rec, false
	}
	return rec, true
}

// Get returns one job record.
func (j *Manager) Get(id string) (Record, bool) {
	mj, ok := j.meta.Job(id)
	if !ok || mj.Removed {
		return Record{}, false
	}
	return j.decode(mj)
}

// List returns jobs, newest first; owner "" lists every job.
func (j *Manager) List(owner string) []Record {
	out := []Record{}
	for _, mj := range j.meta.Jobs() {
		if mj.Removed || (owner != "" && mj.Owner != owner) {
			continue
		}
		if rec, ok := j.decode(&mj); ok {
			out = append(out, rec)
		}
	}
	sort.Slice(out, func(a, b int) bool { return out[a].Spec.Created > out[b].Spec.Created })
	return out
}

// put replicates a record.
func (j *Manager) put(rec Record) error {
	body, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	return j.meta.Submit(metadata.KindJob, &metadata.Job{
		ID:      rec.Spec.ID,
		Owner:   rec.Spec.Owner,
		Node:    rec.State.Node,
		Status:  rec.State.Status,
		Created: rec.Spec.Created,
		Body:    body,
	})
}

/*
	Submission
*/

// Submit validates and queues a job. The caller supplies the script source.
func (j *Manager) Submit(spec Spec) (Record, error) {
	if !j.m.InCluster() {
		return Record{}, metadata.ErrNotInCluster
	}
	if strings.TrimSpace(spec.Script) == "" {
		return Record{}, errors.New("job script is empty")
	}
	if spec.Owner == "" {
		return Record{}, errors.New("job owner is required")
	}
	if spec.ID == "" {
		spec.ID = uuid.NewV4().String()
	}
	if strings.TrimSpace(spec.Name) == "" {
		spec.Name = spec.ScriptName
	}
	if spec.ScriptName == "" {
		spec.ScriptName = "job.agi"
	}
	if spec.Kind == "" {
		spec.Kind = KindRun
	}
	if spec.Kind == KindMapReduce && strings.TrimSpace(spec.Dataset) == "" {
		return Record{}, errors.New("a map/reduce job needs a dataset pattern")
	}
	if spec.TimeoutSec <= 0 {
		spec.TimeoutSec = 3600
	}
	if spec.MaxAttempts <= 0 {
		spec.MaxAttempts = 3
	}
	spec.Created = time.Now().Unix()
	for i, in := range spec.Inputs {
		spec.Inputs[i] = metadata.NormalizePath(in)
	}
	rec := Record{Spec: spec, State: State{Status: StatusQueued}}
	if err := j.put(rec); err != nil {
		return Record{}, err
	}
	logger.PrintAndLog("Cluster", "Job queued: "+spec.Name+" ("+spec.ID+")", nil)
	//Schedule immediately when we are the leader; otherwise the leader picks
	//it up on its next pass.
	if j.meta.IsLeader() {
		go j.schedule()
	}
	return rec, nil
}

// Cancel marks a job cancelled; a running node notices within a second.
func (j *Manager) Cancel(id string, requester string, isAdmin bool) error {
	rec, ok := j.Get(id)
	if !ok {
		return ErrNotFound
	}
	if !isAdmin && rec.Spec.Owner != requester {
		return errors.New("permission denied")
	}
	if rec.Done() {
		return nil
	}
	rec.State.Status = StatusCancelled
	rec.State.Finished = time.Now().Unix()
	rec.State.Error = "cancelled by " + requester
	if err := j.put(rec); err != nil {
		return err
	}
	j.mu.Lock()
	if rs, running := j.running[id]; running {
		rs.cancel()
	}
	j.mu.Unlock()
	return nil
}

// Wait blocks until the job finishes or the timeout expires.
func (j *Manager) Wait(id string, timeout time.Duration) (Record, error) {
	deadline := time.Now().Add(timeout)
	for {
		rec, ok := j.Get(id)
		if !ok {
			return Record{}, ErrNotFound
		}
		if rec.Done() {
			return rec, nil
		}
		if time.Now().After(deadline) {
			return rec, errors.New("timed out waiting for the job to finish")
		}
		select {
		case <-j.stop:
			return rec, errors.New("shutting down")
		case <-time.After(time.Second):
		}
	}
}

/*
	Scheduler (leader)
*/

func usableState(s membership.NodeState) bool {
	return s == membership.StateOnline || s == membership.StateDegraded
}

// schedule is one scheduling pass.
func (j *Manager) schedule() {
	if !j.meta.IsLeader() {
		return
	}
	j.schedMu.Lock()
	defer j.schedMu.Unlock()
	now := time.Now()
	nodes := j.m.NodeViews()
	loadPerNode := map[string]int{}
	pending := []Record{}

	for _, mj := range j.meta.Jobs() {
		if mj.Removed {
			continue
		}
		rec, ok := j.decode(&mj)
		if !ok || rec.Done() {
			continue
		}
		if rec.Spec.Kind == KindMapReduce && rec.State.Status == StatusRunning {
			continue //handled below, it runs on no node
		}
		switch rec.State.Status {
		case StatusScheduled, StatusRunning:
			if rec.State.LeaseExpires > 0 && rec.State.LeaseExpires < now.Unix() {
				//The worker went silent: requeue or give up
				if rec.State.Attempts >= rec.Spec.MaxAttempts {
					rec.State.Status = StatusFailed
					rec.State.Error = "node lost while running the job"
					rec.State.Finished = now.Unix()
					j.put(rec)
					j.finishedEvent(rec)
					continue
				}
				rec.State.Status = StatusQueued
				rec.State.Node = ""
				rec.State.LeaseExpires = 0
				rec.State.Reason = "previous node stopped reporting"
				j.put(rec)
				pending = append(pending, rec)
				continue
			}
			loadPerNode[rec.State.Node]++
		case StatusQueued:
			if rec.Spec.Kind == KindMapReduce {
				j.startMapReduce(rec)
				continue
			}
			pending = append(pending, rec)
		}
	}
	//Move running map/reduce parents forward
	for _, mj := range j.meta.Jobs() {
		if mj.Removed || mj.Status != StatusRunning {
			continue
		}
		if rec, ok := j.decode(&mj); ok && rec.Spec.Kind == KindMapReduce {
			j.advanceMapReduce(rec)
		}
	}
	if len(pending) == 0 {
		return
	}
	sort.Slice(pending, func(a, b int) bool {
		if pending[a].Spec.Priority != pending[b].Spec.Priority {
			return pending[a].Spec.Priority > pending[b].Spec.Priority
		}
		return pending[a].Spec.Created < pending[b].Spec.Created
	})

	for _, rec := range pending {
		node, reason := j.pick(rec, nodes, loadPerNode)
		if node == "" {
			if rec.State.Reason != reason {
				rec.State.Reason = reason
				j.put(rec)
			}
			continue
		}
		rec.State.Status = StatusScheduled
		rec.State.Node = node
		rec.State.Attempts++
		rec.State.LeaseExpires = now.Add(j.opt.TaskLease).Unix()
		rec.State.Reason = ""
		if err := j.put(rec); err != nil {
			continue
		}
		loadPerNode[node]++
		go j.assign(rec)
	}
}

// locality reports how many of the input bytes already sit on a node. The
// host may supply a richer implementation (which also expands directories);
// otherwise the metadata records answer it directly.
func (j *Manager) locality(paths []string, nodeID string) (int64, int64) {
	if j.opt.LocalityBytes != nil {
		return j.opt.LocalityBytes(paths, nodeID)
	}
	var onNode, total int64
	for _, p := range paths {
		rec, err := j.meta.Stat(p)
		if err != nil || rec.IsDir {
			continue
		}
		size := rec.Size
		if size == 0 {
			size = 1 //count the file even when it is empty
		}
		total += size
		for _, loc := range rec.HealthyLocations() {
			if loc.NodeID == nodeID {
				onNode += size
				break
			}
		}
	}
	return onNode, total
}

// pick scores the eligible nodes and returns the best one, or a reason why
// nothing fits. It also returns the full ranking, which the explain endpoint
// shows to administrators.
func (j *Manager) pick(rec Record, nodes []membership.NodeView, load map[string]int) (string, string) {
	results := j.rank(rec, nodes, load)
	return scheduling.Best(results)
}

// rank scores every node for a job.
func (j *Manager) rank(rec Record, nodes []membership.NodeView, load map[string]int) []scheduling.Result {
	blocked := map[string]bool{}
	for _, id := range rec.State.Blocked {
		blocked[id] = true
	}
	candidates := []scheduling.Candidate{}
	for _, n := range nodes {
		c := scheduling.Candidate{Node: n, Queue: load[n.ID], FreeDisk: -1, LatencyToData: -1, Diversity: -1}
		if len(rec.Spec.Inputs) > 0 {
			onNode, total := j.locality(rec.Spec.Inputs, n.ID)
			if total > 0 {
				c.Locality = float64(onNode) / float64(total)
			}
		}
		candidates = append(candidates, c)
	}
	return j.sched.Rank(candidates, func(c scheduling.Candidate) (bool, string) {
		if !usableState(c.Node.State) {
			return false, "node is " + strings.ToLower(string(c.Node.State))
		}
		if blocked[c.Node.ID] {
			return false, "node refused this job earlier"
		}
		if len(rec.Spec.Nodes) > 0 && !contains(rec.Spec.Nodes, c.Node.ID) {
			return false, "job is limited to other nodes"
		}
		if ok, why := c.Node.Capabilities.Satisfies(rec.Spec.Requirements); !ok {
			return false, why
		}
		return true, ""
	})
}

// Explain returns the ranking the scheduler would use for a job right now.
func (j *Manager) Explain(jobID string) ([]scheduling.Result, error) {
	rec, ok := j.Get(jobID)
	if !ok {
		return nil, ErrNotFound
	}
	load := map[string]int{}
	for _, mj := range j.meta.Jobs() {
		if mj.Removed {
			continue
		}
		if r, ok := j.decode(&mj); ok && (r.State.Status == StatusRunning || r.State.Status == StatusScheduled) {
			load[r.State.Node]++
		}
	}
	return j.rank(rec, j.m.NodeViews(), load), nil
}

// assign tells the chosen node to run the job (or runs it here). A node that
// refuses (no account for the owner, cannot execute) is remembered so the
// scheduler does not offer it the same job again.
func (j *Manager) assign(rec Record) {
	node := rec.State.Node
	var err error
	if node == j.m.NodeID() {
		err = j.Start(rec.Spec.ID)
	} else {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		err = j.m.Transport().DoJSON(ctx, node, http.MethodPost, pathRun, RunRequest{JobID: rec.Spec.ID}, nil)
		cancel()
	}
	if err == nil {
		return
	}
	//Could not hand it over: put it back in the queue right away
	latest, ok := j.Get(rec.Spec.ID)
	if !ok || latest.Done() || latest.State.Status == StatusRunning {
		return
	}
	latest.State.Status = StatusQueued
	latest.State.Node = ""
	latest.State.LeaseExpires = 0
	latest.State.Reason = "node " + j.m.NodeName(node) + " could not take the job: " + err.Error()
	//Only a real refusal keeps the node away from this job for good. A
	//hiccup (a tunnel still reconnecting after a restart, a record that has
	//not reached the node yet) is retried on the next pass; blocking on it
	//would strand a job that is pinned to that node.
	if refusalIsPermanent(err) && !contains(latest.State.Blocked, node) {
		latest.State.Blocked = append(latest.State.Blocked, node)
	}
	//A refusal is not a failed attempt by the job itself
	if latest.State.Attempts > 0 {
		latest.State.Attempts--
	}
	j.put(latest)
	if j.meta.IsLeader() {
		go j.schedule()
	}
}

// refusalIsPermanent reports whether a node's answer to "run this job" means
// it will never be able to run it: the owner has no account there, or it
// cannot execute jobs at all. The error may come straight from Start or, for
// a remote node, as the text the node sent back.
func refusalIsPermanent(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, ErrNoUser) || errors.Is(err, ErrNoExecutor) {
		return true
	}
	msg := err.Error()
	return strings.Contains(msg, ErrNoUser.Error()) || strings.Contains(msg, ErrNoExecutor.Error())
}

func contains(list []string, v string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

func (j *Manager) finishedEvent(rec Record) {
	if j.OnFinished != nil {
		j.OnFinished(rec)
	}
}

/*
	Status
*/

// Status summarises the job system for the UI.
type Status struct {
	InCluster  bool     `json:"inCluster"`
	IsLeader   bool     `json:"isLeader"`
	LeaderName string   `json:"leaderName"`
	Queued     int      `json:"queued"`
	Scheduled  int      `json:"scheduled"`
	Running    int      `json:"running"`
	Succeeded  int      `json:"succeeded"`
	Failed     int      `json:"failed"`
	Cancelled  int      `json:"cancelled"`
	LocalSlots int      `json:"localSlots"`
	LocalBusy  int      `json:"localBusy"`
	Jobs       []Record `json:"jobs"`
}

// Status builds the picture, filtered to owner when non-empty.
func (j *Manager) Status(owner string) Status {
	st := Status{InCluster: j.m.InCluster(), IsLeader: j.meta.IsLeader(), LocalSlots: j.opt.MaxParallel, Jobs: []Record{}}
	if l := j.meta.Leader(); l != "" {
		st.LeaderName = j.m.NodeName(l)
	}
	for _, rec := range j.List(owner) {
		switch rec.State.Status {
		case StatusQueued:
			st.Queued++
		case StatusScheduled:
			st.Scheduled++
		case StatusRunning:
			st.Running++
		case StatusSucceeded:
			st.Succeeded++
		case StatusFailed:
			st.Failed++
		case StatusCancelled:
			st.Cancelled++
		}
		if len(st.Jobs) < 100 {
			st.Jobs = append(st.Jobs, rec)
		}
	}
	j.mu.Lock()
	st.LocalBusy = len(j.running)
	j.mu.Unlock()
	return st
}
