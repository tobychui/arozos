package replication

/*
	ArozOS Cluster - replication

	Keeps every file at the number of healthy copies its folder policy (or
	the record's own Replicas field) asks for, on different nodes.

	The planner runs on the metadata leader only. Every PlanInterval it walks
	the namespace and, for each file:
	  - fewer healthy copies than wanted  -> one pull task to another node
	  - more healthy copies than wanted   -> drop the copy on the fullest volume
	  - copies on an evacuating volume    -> re-created elsewhere, then dropped
	  - copies on a node offline too long -> marked stale (never deleted)
	Tasks are ephemeral: the metadata records are the source of truth, so a
	new leader simply plans again. Any node can execute a pull (the worker);
	it renews a task lease while copying and reports back to the leader.
*/

import (
	"context"
	"errors"
	"net/http"
	"sort"
	"sync"
	"time"

	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/cluster/membership"
	"imuslab.com/arozos/mod/cluster/metadata"
	"imuslab.com/arozos/mod/cluster/storage"
	"imuslab.com/arozos/mod/info/logger"
)

const (
	TaskQueued  = "queued"
	TaskRunning = "running"
	TaskDone    = "done"
	TaskFailed  = "failed"

	placementHeadroom = 64 << 20
	historyKeep       = 50
)

// Task is one copy the leader asked a node to make.
type Task struct {
	ID           string `json:"id"`
	FileID       string `json:"fileId"`
	Path         string `json:"path"`
	Size         int64  `json:"size"`
	Checksum     string `json:"checksum"`
	SourceNode   string `json:"sourceNode"`
	SourceVolume string `json:"sourceVolume"`
	TargetNode   string `json:"targetNode"`
	TargetVolume string `json:"targetVolume"`
	Reason       string `json:"reason"` // "replica", "repair", "evacuate"
	State        string `json:"state"`
	Attempts     int    `json:"attempts"`
	LeaseExpires int64  `json:"leaseExpires"`
	NotBefore    int64  `json:"notBefore"`
	Created      int64  `json:"created"`
	Updated      int64  `json:"updated"`
	Error        string `json:"error,omitempty"`
}

// Option configures the replication service.
type Option struct {
	Membership *membership.Manager
	Metadata   *metadata.Manager
	Storage    *storage.Service

	PlanInterval       time.Duration
	TaskLease          time.Duration
	LeaseRenew         time.Duration
	OfflineStale       time.Duration
	MaxInFlightPerNode int
	MaxInFlight        int
	MaxAttempts        int
	MaxWorkers         int
}

// Manager is the replication service of this node.
type Manager struct {
	m    *membership.Manager
	meta *metadata.Manager
	st   *storage.Service
	opt  Option

	mu       sync.Mutex
	tasks    map[string]*Task //leader side, by task ID
	byFile   map[string]string
	history  []Task
	lastPlan int64
	lastRes  PlanResult
	backoff  map[string]int64 //fileID -> not before

	workers chan struct{}
	stop    chan struct{}
	wg      sync.WaitGroup
	once    sync.Once
}

// PlanResult summarises one planner pass.
type PlanResult struct {
	Files           int   `json:"files"`
	UnderReplicated int   `json:"underReplicated"`
	OverReplicated  int   `json:"overReplicated"`
	Queued          int   `json:"queued"`
	Dropped         int   `json:"dropped"`
	MarkedStale     int   `json:"markedStale"`
	Evacuating      int   `json:"evacuating"`
	Retired         int   `json:"retired"`
	Time            int64 `json:"time"`
}

var ErrNotLeader = errors.New("this node is not the metadata leader")

// New creates the service, registers its endpoints and starts the loops.
func New(opt Option) (*Manager, error) {
	if opt.Membership == nil || opt.Metadata == nil || opt.Storage == nil {
		return nil, errors.New("membership, metadata and storage are required")
	}
	if opt.PlanInterval <= 0 {
		opt.PlanInterval = 60 * time.Second
	}
	if opt.TaskLease <= 0 {
		opt.TaskLease = 30 * time.Second
	}
	if opt.LeaseRenew <= 0 {
		opt.LeaseRenew = 10 * time.Second
	}
	if opt.OfflineStale <= 0 {
		opt.OfflineStale = 10 * time.Minute
	}
	if opt.MaxInFlightPerNode <= 0 {
		opt.MaxInFlightPerNode = 4
	}
	if opt.MaxInFlight <= 0 {
		opt.MaxInFlight = 16
	}
	if opt.MaxAttempts <= 0 {
		opt.MaxAttempts = 5
	}
	if opt.MaxWorkers <= 0 {
		opt.MaxWorkers = 4
	}
	r := &Manager{
		m:       opt.Membership,
		meta:    opt.Metadata,
		st:      opt.Storage,
		opt:     opt,
		tasks:   map[string]*Task{},
		byFile:  map[string]string{},
		backoff: map[string]int64{},
		workers: make(chan struct{}, opt.MaxWorkers),
		stop:    make(chan struct{}),
	}
	r.registerACNHandlers()
	r.wg.Add(1)
	go r.loop()
	return r, nil
}

// Close stops the planner.
func (r *Manager) Close() {
	r.once.Do(func() { close(r.stop) })
	r.wg.Wait()
}

func (r *Manager) loop() {
	defer r.wg.Done()
	ticker := time.NewTicker(r.opt.PlanInterval)
	defer ticker.Stop()
	for {
		select {
		case <-r.stop:
			return
		case <-ticker.C:
			if r.meta.IsLeader() {
				r.plan()
			} else {
				r.mu.Lock()
				if len(r.tasks) > 0 {
					//Lost leadership: forget tasks, the new leader plans again
					r.tasks = map[string]*Task{}
					r.byFile = map[string]string{}
				}
				r.mu.Unlock()
			}
		}
	}
}

/*
	Planner (leader)
*/

func (r *Manager) nodeView(id string) (membership.NodeView, bool) {
	for _, n := range r.m.NodeViews() {
		if n.ID == id {
			return n, true
		}
	}
	return membership.NodeView{}, false
}

func usableState(s membership.NodeState) bool {
	return s == membership.StateOnline || s == membership.StateDegraded
}

// wanted returns the desired copy count of a record.
func (r *Manager) wanted(rec *metadata.FileRecord) int {
	want := rec.Replicas
	if want <= 0 {
		want = r.meta.PolicyFor(rec.Path).Replicas
	}
	if want < 1 {
		want = 1
	}
	return want
}

// plan is one planner pass. Safe to call on the leader only.
func (r *Manager) plan() PlanResult {
	res := PlanResult{Time: time.Now().Unix()}
	if !r.meta.IsLeader() {
		return res
	}
	now := time.Now()
	volumes := map[string]metadata.Volume{}
	for _, v := range r.meta.Volumes() {
		volumes[v.ID] = v
	}
	nodes := map[string]membership.NodeView{}
	for _, n := range r.m.NodeViews() {
		nodes[n.ID] = n
	}
	nodeUsable := func(id string) bool {
		n, ok := nodes[id]
		return ok && usableState(n.State)
	}

	r.requeueExpired(now)
	inFlight, perNode := r.inFlight()

	for _, rec := range r.meta.AllFiles() {
		if rec.Removed || rec.IsDir {
			continue
		}
		res.Files++
		want := r.wanted(&rec)

		var healthy, evac []metadata.Location
		var retired []string
		staleMarked := false
		for _, loc := range rec.Locations {
			vol, ok := volumes[loc.VolumeID]
			if !ok || vol.Removed {
				//Housekeeping: a retired volume never comes back, forget the copy
				retired = append(retired, loc.VolumeID)
				continue
			}
			//Offline too long: downgrade healthy copies to stale (never delete)
			if loc.Healthy() {
				if n, ok := nodes[loc.NodeID]; ok && n.State == membership.StateOffline && n.LastSeen > 0 && now.Sub(time.Unix(n.LastSeen, 0)) > r.opt.OfflineStale {
					loc.State = metadata.LocStale
					rec.SetLocation(loc)
					staleMarked = true
					continue
				}
			}
			if !loc.Healthy() || !nodeUsable(loc.NodeID) {
				continue
			}
			if vol.Evacuating {
				evac = append(evac, loc)
			} else {
				healthy = append(healthy, loc)
			}
		}
		for _, id := range retired {
			rec.RemoveLocation(id)
		}
		if staleMarked {
			res.MarkedStale++
		}
		if staleMarked || len(retired) > 0 {
			r.meta.Submit(metadata.KindFile, &rec)
		}
		have := len(healthy)
		if len(evac) > 0 {
			res.Evacuating++
		}

		switch {
		case have < want && (have > 0 || len(evac) > 0):
			res.UnderReplicated++
			if inFlight >= r.opt.MaxInFlight {
				continue
			}
			if r.hasTask(rec.ID) || r.inBackoff(rec.ID, now) {
				continue
			}
			source := pickSource(healthy, evac, nodes)
			target := r.pickTarget(&rec, volumes, nodes, perNode)
			if target == nil {
				//Nowhere to put another copy. An evacuating copy may still be
				//released when at least one healthy copy exists elsewhere, so
				//the volume can be retired even if the policy cannot be met.
				if have >= 1 {
					for _, loc := range evac {
						if r.st.DropCopy(rec.ID, loc.VolumeID) == nil {
							res.Dropped++
						}
					}
				}
				continue
			}
			reason := "replica"
			if len(evac) > 0 && have == 0 {
				reason = "evacuate"
			} else if _, has := rec.Location(target.ID); has {
				reason = "repair"
			}
			t := &Task{
				ID: uuid.NewV4().String(), FileID: rec.ID, Path: rec.Path, Size: rec.Size, Checksum: rec.Checksum,
				SourceNode: source.NodeID, SourceVolume: source.VolumeID,
				TargetNode: target.NodeID, TargetVolume: target.ID,
				Reason: reason, State: TaskQueued, Created: now.Unix(), Updated: now.Unix(),
			}
			r.addTask(t)
			inFlight++
			perNode[target.NodeID]++
			res.Queued++
			go r.dispatch(t)

		case have > want:
			res.OverReplicated++
			//Drop the extra copy on the fullest volume, never the primary if avoidable
			sort.Slice(healthy, func(i, j int) bool {
				vi, vj := volumes[healthy[i].VolumeID], volumes[healthy[j].VolumeID]
				if (healthy[i].VolumeID == rec.Primary) != (healthy[j].VolumeID == rec.Primary) {
					return healthy[j].VolumeID == rec.Primary
				}
				return vi.Free < vj.Free
			})
			if err := r.st.DropCopy(rec.ID, healthy[0].VolumeID); err == nil {
				res.Dropped++
			}
			//Evacuating copies are redundant once enough copies exist elsewhere
			for _, loc := range evac {
				if r.st.DropCopy(rec.ID, loc.VolumeID) == nil {
					res.Dropped++
				}
			}

		case have >= want && len(evac) > 0:
			for _, loc := range evac {
				if r.st.DropCopy(rec.ID, loc.VolumeID) == nil {
					res.Dropped++
				}
			}
		}
	}

	//Retire evacuated volumes that nothing references any more
	for _, v := range volumes {
		if v.Evacuating && !v.Removed {
			if done, _ := r.st.FinishEvacuation(v.ID); done {
				res.Retired++
			}
		}
	}

	r.mu.Lock()
	r.lastPlan = res.Time
	r.lastRes = res
	r.mu.Unlock()
	return res
}

// pickSource prefers a healthy copy on an ONLINE node, then evacuating copies.
func pickSource(healthy []metadata.Location, evac []metadata.Location, nodes map[string]membership.NodeView) metadata.Location {
	all := append(append([]metadata.Location{}, healthy...), evac...)
	sort.SliceStable(all, func(i, j int) bool {
		si, sj := nodes[all[i].NodeID].State, nodes[all[j].NodeID].State
		return si == membership.StateOnline && sj != membership.StateOnline
	})
	return all[0]
}

// pickTarget chooses where the next copy goes: a node without a healthy copy,
// preferring an existing stale location (in-place repair), then most free.
func (r *Manager) pickTarget(rec *metadata.FileRecord, volumes map[string]metadata.Volume, nodes map[string]membership.NodeView, perNode map[string]int) *metadata.Volume {
	need := rec.Size + rec.Size/10 + placementHeadroom
	nodesWithHealthy := map[string]bool{}
	staleVolumes := map[string]bool{}
	for _, loc := range rec.Locations {
		if v, ok := volumes[loc.VolumeID]; ok && !v.Removed && loc.Healthy() && !v.Evacuating {
			nodesWithHealthy[loc.NodeID] = true
		}
		if loc.State == metadata.LocStale {
			staleVolumes[loc.VolumeID] = true
		}
	}
	var candidates []metadata.Volume
	for _, v := range volumes {
		if v.Removed || v.ReadOnly || v.Evacuating || nodesWithHealthy[v.NodeID] {
			continue
		}
		n, ok := nodes[v.NodeID]
		if !ok || !usableState(n.State) || perNode[v.NodeID] >= r.opt.MaxInFlightPerNode {
			continue
		}
		if v.Free < need && !staleVolumes[v.ID] {
			continue
		}
		candidates = append(candidates, v)
	}
	if len(candidates) == 0 {
		return nil
	}
	sort.Slice(candidates, func(i, j int) bool {
		a, b := candidates[i], candidates[j]
		if staleVolumes[a.ID] != staleVolumes[b.ID] {
			return staleVolumes[a.ID]
		}
		if (nodes[a.NodeID].State == membership.StateOnline) != (nodes[b.NodeID].State == membership.StateOnline) {
			return nodes[a.NodeID].State == membership.StateOnline
		}
		if a.Free != b.Free {
			return a.Free > b.Free
		}
		return a.ID < b.ID
	})
	return &candidates[0]
}

/*
	Task bookkeeping (leader)
*/

func (r *Manager) addTask(t *Task) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.tasks[t.ID] = t
	r.byFile[t.FileID] = t.ID
}

func (r *Manager) hasTask(fileID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	_, ok := r.byFile[fileID]
	return ok
}

func (r *Manager) inBackoff(fileID string, now time.Time) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	until, ok := r.backoff[fileID]
	if !ok {
		return false
	}
	if now.Unix() >= until {
		delete(r.backoff, fileID)
		return false
	}
	return true
}

func (r *Manager) inFlight() (int, map[string]int) {
	r.mu.Lock()
	defer r.mu.Unlock()
	per := map[string]int{}
	n := 0
	for _, t := range r.tasks {
		if t.State == TaskQueued || t.State == TaskRunning {
			n++
			per[t.TargetNode]++
		}
	}
	return n, per
}

// requeueExpired returns tasks whose worker went silent to the pool.
func (r *Manager) requeueExpired(now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for id, t := range r.tasks {
		if t.State == TaskRunning && t.LeaseExpires > 0 && t.LeaseExpires < now.Unix() {
			r.finishLocked(id, false, "worker lease expired")
		}
	}
}

// finishLocked closes a task; failures back off the file so the planner does
// not hammer a broken copy.
func (r *Manager) finishLocked(id string, ok bool, errMsg string) {
	t, exists := r.tasks[id]
	if !exists {
		return
	}
	t.Updated = time.Now().Unix()
	if ok {
		t.State = TaskDone
		delete(r.backoff, t.FileID)
	} else {
		t.State = TaskFailed
		t.Attempts++
		t.Error = errMsg
		wait := time.Duration(30<<uint(t.Attempts)) * time.Second
		if t.Attempts >= r.opt.MaxAttempts {
			wait = time.Hour
			logger.PrintAndLog("Cluster", "Giving up on replicating "+t.Path+" for now: "+errMsg, nil)
		}
		r.backoff[t.FileID] = time.Now().Add(wait).Unix()
	}
	delete(r.tasks, id)
	delete(r.byFile, t.FileID)
	r.history = append([]Task{*t}, r.history...)
	if len(r.history) > historyKeep {
		r.history = r.history[:historyKeep]
	}
}

func (r *Manager) markRunning(id string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if t, ok := r.tasks[id]; ok {
		t.State = TaskRunning
		t.LeaseExpires = time.Now().Add(r.opt.TaskLease).Unix()
		t.Updated = time.Now().Unix()
	}
}

func (r *Manager) renewLease(id string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	t, ok := r.tasks[id]
	if !ok || t.State != TaskRunning {
		return false
	}
	t.LeaseExpires = time.Now().Add(r.opt.TaskLease).Unix()
	return true
}

// dispatch hands a task to its target node (or runs it here).
func (r *Manager) dispatch(t *Task) {
	r.markRunning(t.ID)
	if t.TargetNode == r.m.NodeID() {
		go r.runTask(*t)
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	if err := r.m.Transport().DoJSON(ctx, t.TargetNode, http.MethodPost, pathPull, t, nil); err != nil {
		r.mu.Lock()
		r.finishLocked(t.ID, false, "dispatch: "+err.Error())
		r.mu.Unlock()
	}
}

/*
	Worker (any node)
*/

// runTask executes one pull on this node and reports to the leader.
func (r *Manager) runTask(t Task) {
	r.workers <- struct{}{}
	defer func() { <-r.workers }()

	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Hour)
	defer cancel()
	stopRenew := make(chan struct{})
	go func() {
		ticker := time.NewTicker(r.opt.LeaseRenew)
		defer ticker.Stop()
		for {
			select {
			case <-stopRenew:
				return
			case <-ticker.C:
				r.reportLease(t.ID)
			}
		}
	}()
	err := r.st.PullCopy(ctx, storage.PullRequest{
		FileID: t.FileID, Path: t.Path, SourceNode: t.SourceNode, SourceVolume: t.SourceVolume,
		TargetVolume: t.TargetVolume, Checksum: t.Checksum, Size: t.Size,
	})
	close(stopRenew)
	msg := ""
	if err != nil {
		msg = err.Error()
	}
	r.reportDone(t.ID, err == nil, msg)
}

func (r *Manager) reportLease(taskID string) {
	if r.meta.IsLeader() {
		r.renewLease(taskID)
		return
	}
	leader := r.meta.Leader()
	if leader == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	r.m.Transport().DoJSON(ctx, leader, http.MethodPost, pathLease, TaskReport{TaskID: taskID}, nil)
}

func (r *Manager) reportDone(taskID string, ok bool, errMsg string) {
	if r.meta.IsLeader() {
		r.mu.Lock()
		r.finishLocked(taskID, ok, errMsg)
		r.mu.Unlock()
		return
	}
	leader := r.meta.Leader()
	if leader == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	r.m.Transport().DoJSON(ctx, leader, http.MethodPost, pathDone, TaskReport{TaskID: taskID, OK: ok, Error: errMsg}, nil)
}

/*
	Public API
*/

// PlanNow runs a planner pass, forwarding to the leader when needed.
func (r *Manager) PlanNow() (PlanResult, error) {
	if r.meta.IsLeader() {
		return r.plan(), nil
	}
	leader := r.meta.Leader()
	if leader == "" {
		return PlanResult{}, ErrNotLeader
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var res PlanResult
	err := r.m.Transport().DoJSON(ctx, leader, http.MethodPost, pathPlan, nil, &res)
	return res, err
}

// Status is the replication picture for the settings UI.
type Status struct {
	InCluster       bool       `json:"inCluster"`
	IsLeader        bool       `json:"isLeader"`
	Leader          string     `json:"leader"`
	LeaderName      string     `json:"leaderName"`
	Files           int        `json:"files"`
	UnderReplicated int        `json:"underReplicated"`
	OverReplicated  int        `json:"overReplicated"`
	StaleCopies     int        `json:"staleCopies"`
	NoHealthyCopy   int        `json:"noHealthyCopy"`
	Evacuating      int        `json:"evacuating"`
	Queued          int        `json:"queued"`
	Running         int        `json:"running"`
	Tasks           []Task     `json:"tasks"`
	History         []Task     `json:"history"`
	LastPlan        int64      `json:"lastPlan"`
	LastResult      PlanResult `json:"lastResult"`
}

// Status computes the current picture from the metadata store.
func (r *Manager) Status() Status {
	st := Status{InCluster: r.m.InCluster(), IsLeader: r.meta.IsLeader(), Leader: r.meta.Leader(), Tasks: []Task{}, History: []Task{}}
	if st.Leader != "" {
		st.LeaderName = r.m.NodeName(st.Leader)
	}
	volumes := map[string]metadata.Volume{}
	for _, v := range r.meta.Volumes() {
		volumes[v.ID] = v
		if v.Evacuating && !v.Removed {
			st.Evacuating++
		}
	}
	for _, rec := range r.meta.AllFiles() {
		if rec.Removed || rec.IsDir {
			continue
		}
		st.Files++
		want := r.wanted(&rec)
		have := 0
		for _, loc := range rec.Locations {
			v, ok := volumes[loc.VolumeID]
			if !ok || v.Removed {
				continue
			}
			if loc.State == metadata.LocStale {
				st.StaleCopies++
			}
			if loc.Healthy() && !v.Evacuating && r.nodeUsable(loc.NodeID) {
				have++
			}
		}
		switch {
		case have == 0:
			st.NoHealthyCopy++
		case have < want:
			st.UnderReplicated++
		case have > want:
			st.OverReplicated++
		}
	}
	r.mu.Lock()
	for _, t := range r.tasks {
		st.Tasks = append(st.Tasks, *t)
		if t.State == TaskRunning {
			st.Running++
		} else if t.State == TaskQueued {
			st.Queued++
		}
	}
	st.History = append(st.History, r.history...)
	st.LastPlan = r.lastPlan
	st.LastResult = r.lastRes
	r.mu.Unlock()
	sort.Slice(st.Tasks, func(i, j int) bool { return st.Tasks[i].Created < st.Tasks[j].Created })
	return st
}

func (r *Manager) nodeUsable(id string) bool {
	n, ok := r.nodeView(id)
	return ok && usableState(n.State)
}
