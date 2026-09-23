package jobs

/*
	Job execution on one node.

	The runtime wraps the submitted script with a prelude that exposes the
	job object and an epilogue that calls run(JOB) and publishes the result:

		function run(job) {          // job = {id, name, args, inputs, node}
		    job.log("starting");
		    job.progress(0.5);
		    job.abortIfCancelled();
		    return {ok: true};       // becomes the job output
		}

	An optional setup(ctx) runs once before run(). Normal AGI libraries work
	inside the script, so cluster:/ paths behave like any other file path.
*/

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"imuslab.com/arozos/mod/info/logger"
)

const jobPrelude = `var JOB = JSON.parse(_job_spec());
JOB.log = function(m){ _job_log(String(m)); };
JOB.progress = function(p){ _job_progress(p); };
JOB.cancelled = function(){ return _job_cancelled(); };
JOB.abortIfCancelled = function(){ if (_job_cancelled()) { throw new Error("job cancelled"); } };
`

// buildSource assembles what the VM executes. run() is called once and its
// value captured, so the epilogue cannot run the job twice.
func buildSource(script string) string {
	return jobPrelude + "\n" + script + `
if (typeof setup === "function") { setup({node: JOB.node}); }
if (typeof run !== "function") { throw new Error("this job script defines no run(job) function"); }
var __jobResult = run(JOB);
_job_output(JSON.stringify(__jobResult === undefined ? null : __jobResult));
`
}

// JobContext is what the script sees as JOB (before the helper functions are
// attached by the prelude).
type JobContext struct {
	ID     string          `json:"id"`
	Name   string          `json:"name"`
	Kind   string          `json:"kind"`
	Args   json.RawMessage `json:"args,omitempty"`
	Inputs []string        `json:"inputs"`
	Node   string          `json:"node"`
	Owner  string          `json:"owner"`
}

// RecordWait bounds how long a node waits for a job record that the leader
// has assigned to it but that has not replicated to it yet.
var RecordWait = 5 * time.Second

// awaitRecord polls the local store for a job record until it appears or the
// wait runs out.
func (j *Manager) awaitRecord(jobID string, wait time.Duration) (Record, bool) {
	deadline := time.Now().Add(wait)
	for time.Now().Before(deadline) {
		time.Sleep(100 * time.Millisecond)
		if rec, ok := j.Get(jobID); ok {
			return rec, true
		}
	}
	return Record{}, false
}

// Start runs a job that was assigned to this node.
func (j *Manager) Start(jobID string) error {
	if j.exec == nil {
		return ErrNoExecutor
	}
	rec, ok := j.Get(jobID)
	if !ok {
		//The leader can hand a job over a moment before its record has
		//replicated here; give the log a chance to catch up
		rec, ok = j.awaitRecord(jobID, RecordWait)
		if !ok {
			return ErrNotFound
		}
	}
	if rec.Done() {
		return nil
	}
	if !j.exec.UserExists(rec.Spec.Owner) {
		return ErrNoUser
	}
	//Accept each job once. A job only shows up in running after it gets an
	//execution slot, so that alone cannot stop a second hand-over (from a
	//retry or a new leader) from starting it again.
	j.mu.Lock()
	if _, busy := j.running[jobID]; busy || j.accepted[jobID] {
		j.mu.Unlock()
		return nil
	}
	j.accepted[jobID] = true
	j.mu.Unlock()
	go j.run(rec)
	return nil
}

func (j *Manager) run(rec Record) {
	defer func() {
		j.mu.Lock()
		delete(j.accepted, rec.Spec.ID)
		j.mu.Unlock()
	}()
	//Wait for a local execution slot; the job stays "scheduled" until then
	select {
	case j.sem <- struct{}{}:
	case <-j.stop:
		return
	}
	defer func() { <-j.sem }()

	id := rec.Spec.ID
	timeout := time.Duration(rec.Spec.TimeoutSec) * time.Second
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	rs := &runState{cancel: cancel}
	j.mu.Lock()
	j.running[id] = rs
	j.mu.Unlock()
	defer func() {
		cancel()
		j.mu.Lock()
		delete(j.running, id)
		j.mu.Unlock()
	}()

	//Publish "running" and keep the lease alive while we work
	rec.State.Status = StatusRunning
	rec.State.Node = j.m.NodeID()
	rec.State.Started = time.Now().Unix()
	rec.State.LeaseExpires = time.Now().Add(j.opt.TaskLease).Unix()
	j.put(rec)
	stopRenew := make(chan struct{})
	go j.renewLoop(id, stopRenew)

	hooks := ExecHooks{
		Log: func(line string) {
			rs.mu.Lock()
			rs.logs = append(rs.logs, line)
			if len(rs.logs) > maxLogLines {
				rs.logs = rs.logs[len(rs.logs)-maxLogLines:]
			}
			rs.mu.Unlock()
		},
		Progress: func(p float64) {
			if p < 0 {
				p = 0
			}
			if p > 1 {
				p = 1
			}
			rs.mu.Lock()
			rs.prog = p
			rs.mu.Unlock()
		},
		Cancelled: func() bool {
			if ctx.Err() != nil {
				return true
			}
			cur, ok := j.Get(id)
			return ok && cur.State.Status == StatusCancelled
		},
	}

	output, err := j.exec.Run(ctx, rec, sourceFor(rec), hooks)
	close(stopRenew)

	rs.mu.Lock()
	logs := append([]string{}, rs.logs...)
	prog := rs.prog
	rs.mu.Unlock()

	final, ok := j.Get(id)
	if !ok {
		return
	}
	final.State.Log = logs
	final.State.Node = j.m.NodeID()
	final.State.Finished = time.Now().Unix()
	final.State.LeaseExpires = 0
	switch {
	case final.State.Status == StatusCancelled:
		//Left as cancelled; keep whatever the script logged
	case err != nil && ctx.Err() == context.DeadlineExceeded:
		final.State.Status = StatusFailed
		final.State.Error = "job timed out after " + itoa(rec.Spec.TimeoutSec) + "s"
	case err != nil:
		final.State.Status = StatusFailed
		final.State.Error = err.Error()
	default:
		final.State.Status = StatusSucceeded
		final.State.Progress = 1
		final.State.Output = output
		final.State.Error = ""
	}
	if final.State.Status != StatusSucceeded {
		final.State.Progress = prog
	}
	j.put(final)
	j.reportDone(final)
	j.finishedEvent(final)
	if final.State.Status == StatusFailed {
		logger.PrintAndLog("Cluster", "Job "+final.Spec.Name+" failed: "+final.State.Error, nil)
	}
}

// renewLoop keeps the lease alive and pushes progress while the job runs.
func (j *Manager) renewLoop(id string, stop chan struct{}) {
	ticker := time.NewTicker(j.opt.LeaseRenew)
	defer ticker.Stop()
	for {
		select {
		case <-stop:
			return
		case <-j.stop:
			return
		case <-ticker.C:
			rec, ok := j.Get(id)
			if !ok || rec.Done() {
				return
			}
			j.mu.Lock()
			rs := j.running[id]
			j.mu.Unlock()
			if rs != nil {
				rs.mu.Lock()
				rec.State.Progress = rs.prog
				if len(rs.logs) > 0 {
					rec.State.Log = append([]string{}, rs.logs...)
				}
				rs.mu.Unlock()
			}
			rec.State.LeaseExpires = time.Now().Add(j.opt.TaskLease).Unix()
			j.put(rec)
		}
	}
}

// reportDone lets the leader know immediately (the record is replicated
// anyway; this only shortens the delay when the leader is elsewhere).
func (j *Manager) reportDone(rec Record) {
	if j.meta.IsLeader() {
		return
	}
	leader := j.meta.Leader()
	if leader == "" {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	j.m.Transport().DoJSON(ctx, leader, "POST", pathDone, DoneReport{JobID: rec.Spec.ID, Status: rec.State.Status}, nil)
}

func itoa(v int) string {
	if v == 0 {
		return "0"
	}
	neg := v < 0
	if neg {
		v = -v
	}
	buf := [20]byte{}
	i := len(buf)
	for v > 0 {
		i--
		buf[i] = byte('0' + v%10)
		v /= 10
	}
	if neg {
		i--
		buf[i] = '-'
	}
	return string(buf[i:])
}

// ContextFor builds the JOB object handed to the script.
func ContextFor(rec Record, nodeID string) JobContext {
	inputs := rec.Spec.Inputs
	if inputs == nil {
		inputs = []string{}
	}
	return JobContext{
		ID: rec.Spec.ID, Name: rec.Spec.Name, Kind: rec.Spec.Kind,
		Args: rec.Spec.Args, Inputs: inputs, Node: nodeID, Owner: rec.Spec.Owner,
	}
}

// ErrScriptNoRun is returned when a script defines no run() function.
var ErrScriptNoRun = errors.New("this job script defines no run(job) function")

// IsCancelled reports whether an execution error means "cancelled".
func IsCancelled(err error) bool {
	return err != nil && strings.Contains(strings.ToLower(err.Error()), "cancel")
}
