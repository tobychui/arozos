package main

/*
	Cluster job execution on this node.

	The jobs package decides what to run and where; this file is the bridge
	to the AGI runtime: it resolves the owner, injects the job helper
	functions into the VM and captures the script's output.
*/

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"time"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi"
	"imuslab.com/arozos/mod/cluster/jobs"
	"imuslab.com/arozos/mod/cluster/metadata"
	"imuslab.com/arozos/mod/utils"
)

// clusterJobExecutor runs job scripts through the AGI gateway.
type clusterJobExecutor struct{}

func (e *clusterJobExecutor) UserExists(owner string) bool {
	if authAgent == nil {
		return false
	}
	return authAgent.UserExists(owner)
}

// Run executes the wrapped job source as the job owner.
func (e *clusterJobExecutor) Run(ctx context.Context, rec jobs.Record, source string, hooks jobs.ExecHooks) (json.RawMessage, error) {
	if AGIGateway == nil {
		return nil, errors.New("AGI gateway not ready")
	}
	u, err := userHandler.GetUserInfoFromUsername(rec.Spec.Owner)
	if err != nil {
		return nil, err
	}

	jobCtx := jobs.ContextFor(rec, clusterManager.NodeID())
	ctxJSON, _ := json.Marshal(jobCtx)

	var mu sync.Mutex
	var output json.RawMessage
	var stopper *agi.JobStopper

	//The AGI runtime needs a request object for its serverless helpers
	req := httptest.NewRequest(http.MethodPost, "/system/cluster/jobs/exec", strings.NewReader(""))
	rw := httptest.NewRecorder()

	inject := func(vm *otto.Otto) {
		vm.Set("_job_spec", func(call otto.FunctionCall) otto.Value {
			v, _ := vm.ToValue(string(ctxJSON))
			return v
		})
		vm.Set("_job_log", func(call otto.FunctionCall) otto.Value {
			line, _ := call.Argument(0).ToString()
			if hooks.Log != nil {
				hooks.Log(line)
			}
			return otto.TrueValue()
		})
		vm.Set("_job_progress", func(call otto.FunctionCall) otto.Value {
			p, _ := call.Argument(0).ToFloat()
			if hooks.Progress != nil {
				hooks.Progress(p)
			}
			return otto.TrueValue()
		})
		vm.Set("_job_cancelled", func(call otto.FunctionCall) otto.Value {
			cancelled := hooks.Cancelled != nil && hooks.Cancelled()
			v, _ := vm.ToValue(cancelled)
			return v
		})
		vm.Set("_job_output", func(call otto.FunctionCall) otto.Value {
			raw, _ := call.Argument(0).ToString()
			mu.Lock()
			if json.Valid([]byte(raw)) {
				output = json.RawMessage(raw)
			} else {
				js, _ := json.Marshal(raw)
				output = js
			}
			mu.Unlock()
			return otto.TrueValue()
		})
	}

	done := make(chan error, 1)
	go func() {
		done <- AGIGateway.ExecuteJobScript(source, rec.Spec.ScriptName, u, rw, req, inject, func(s *agi.JobStopper) {
			mu.Lock()
			stopper = s
			mu.Unlock()
		})
	}()

	select {
	case runErr := <-done:
		mu.Lock()
		defer mu.Unlock()
		return output, runErr
	case <-ctx.Done():
		//Timeout or cancellation: interrupt the VM and wait for it to unwind
		mu.Lock()
		s := stopper
		mu.Unlock()
		s.Stop()
		select {
		case <-done:
		case <-time.After(10 * time.Second):
		}
		mu.Lock()
		defer mu.Unlock()
		if ctx.Err() == context.DeadlineExceeded {
			return output, errors.New("job timed out")
		}
		return output, errors.New("job cancelled")
	}
}

// clusterJobLocality reports how many bytes of the given cluster paths have a
// healthy copy on a node, and their total size.
func clusterJobLocality(paths []string, nodeID string) (int64, int64) {
	if clusterMetadata == nil {
		return 0, 0
	}
	var onNode, total int64
	for _, p := range paths {
		rec, err := clusterMetadata.Stat(p)
		if err != nil {
			continue
		}
		if rec.IsDir {
			for _, child := range clusterMetadata.ListSubtree(rec.Path) {
				if child.IsDir {
					continue
				}
				total += child.Size
				if locationOnNode(&child, nodeID) {
					onNode += child.Size
				}
			}
			continue
		}
		total += rec.Size
		if locationOnNode(rec, nodeID) {
			onNode += rec.Size
		}
	}
	return onNode, total
}

func locationOnNode(rec *metadata.FileRecord, nodeID string) bool {
	for _, l := range rec.HealthyLocations() {
		if l.NodeID == nodeID {
			return true
		}
	}
	return false
}

// clusterJobCaller maps a request to the logged-in user for the jobs API.
func clusterJobCaller(w http.ResponseWriter, r *http.Request) (jobs.Caller, error) {
	u, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		return jobs.Caller{}, err
	}
	return jobs.Caller{Username: u.Username, IsAdmin: u.IsAdmin()}, nil
}

// clusterJobSubmit reads the script from the caller's file system and queues
// the job. POST: name, script (vpath), args (JSON), inputs (JSON array),
// features (comma separated), timeout, priority.
func clusterJobSubmit(w http.ResponseWriter, r *http.Request) {
	if clusterJobs == nil {
		utils.SendErrorResponse(w, "cluster jobs not available")
		return
	}
	u, err := userHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "not logged in")
		return
	}
	scriptVpath, err := utils.PostPara(r, "script")
	if err != nil {
		utils.SendErrorResponse(w, "script path required")
		return
	}
	source, err := clusterReadScript(u.Username, scriptVpath)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	req := jobs.SubmitRequest{
		Name:        r.PostFormValue("name"),
		ScriptVpath: scriptVpath,
		Script:      source,
	}
	if args := r.PostFormValue("args"); strings.TrimSpace(args) != "" {
		if !json.Valid([]byte(args)) {
			utils.SendErrorResponse(w, "args must be valid JSON")
			return
		}
		req.Args = json.RawMessage(args)
	}
	if inputs := r.PostFormValue("inputs"); strings.TrimSpace(inputs) != "" {
		if err := json.Unmarshal([]byte(inputs), &req.Inputs); err != nil {
			req.Inputs = splitList(inputs)
		}
	}
	if features := r.PostFormValue("features"); features != "" {
		req.Features = splitList(features)
	}
	if nodes := r.PostFormValue("nodes"); nodes != "" {
		req.Nodes = splitList(nodes)
	}
	if n, err := utils.PostInt(r, "timeout"); err == nil {
		req.TimeoutSec = n
	}
	if n, err := utils.PostInt(r, "priority"); err == nil {
		req.Priority = n
	}
	if n, err := utils.PostInt(r, "cores"); err == nil {
		req.MinCores = n
	}
	if ds := strings.TrimSpace(r.PostFormValue("dataset")); ds != "" {
		req.Dataset = ds
	}
	if n, err := utils.PostInt(r, "partition"); err == nil {
		req.PartitionMax = n
	}
	rec, err := clusterJobs.Submit(jobs.SpecFrom(req, u.Username))
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	js, _ := json.Marshal(rec)
	utils.SendJSONResponse(w, string(js))
}

func splitList(s string) []string {
	out := []string{}
	for _, part := range strings.Split(s, ",") {
		if p := strings.TrimSpace(part); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// clusterSchedExplain answers /system/cluster/sched/explain?job=<id> with the
// ranking the scheduler would have used for that job.
func clusterSchedExplain(r *http.Request) (interface{}, error) {
	if clusterJobs == nil {
		return nil, errors.New("cluster jobs not available")
	}
	id, err := utils.GetPara(r, "job")
	if err != nil {
		return nil, errors.New("a job id is required")
	}
	results, err := clusterJobs.Explain(id)
	if err != nil {
		return nil, err
	}
	rec, _ := clusterJobs.Get(id)
	return map[string]interface{}{
		"job":     rec.Spec.Name,
		"status":  rec.State.Status,
		"node":    rec.State.Node,
		"ranking": results,
	}, nil
}

// clusterReadScript loads a script from a user's file system.
func clusterReadScript(username string, vpath string) (string, error) {
	u, err := userHandler.GetUserInfoFromUsername(username)
	if err != nil {
		return "", err
	}
	if !u.CanRead(vpath) {
		return "", errors.New("permission denied: " + vpath)
	}
	fsh, err := u.GetFileSystemHandlerFromVirtualPath(vpath)
	if err != nil {
		return "", err
	}
	rpath, err := fsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, u.Username)
	if err != nil {
		return "", err
	}
	if !fsh.FileSystemAbstraction.FileExists(rpath) {
		return "", errors.New("script not found: " + vpath)
	}
	content, err := fsh.FileSystemAbstraction.ReadFile(rpath)
	if err != nil {
		return "", err
	}
	return string(content), nil
}
