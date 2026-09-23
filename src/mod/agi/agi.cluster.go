package agi

/*
	AGI Cluster Library
	Author: tobychui

	Exposes the ArozOS cluster (nodes, namespace metadata, replica policies,
	event hooks) to AGI scripts. Ordinary file access does not need this
	library: filelib already works on cluster:/ paths through the mounted
	drive. Only present when the host wired a ClusterProvider in.

	Usage in AGI:
	    requirelib("cluster");
	    cluster.inCluster()                       // bool
	    cluster.self()                            // this node
	    cluster.nodes()                           // [ {id, name, state, ...} ]
	    cluster.status()                          // cluster, leader, identity origin, volumes
	    cluster.stat("cluster:/photos/a.jpg")     // record with copies
	    cluster.list("cluster:/photos")           // records
	    cluster.setReplicas(path, n)              // admin, per file
	    cluster.policy("/photos", n)              // admin, per top-level folder
	    cluster.on("file.created", "user:/hook.agi")   -> hook id
	    cluster.off(hookId)
	    cluster.hooks()                           // this user's hooks
	    cluster.emit("app.custom", {any: "json"})
*/

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"strings"

	"github.com/robertkrimen/otto"
	"imuslab.com/arozos/mod/agi/static"
	"imuslab.com/arozos/mod/info/logger"
)

// ClusterProvider is implemented by the core on top of the cluster packages.
type ClusterProvider interface {
	InCluster() bool
	Self() interface{}
	Nodes() interface{}
	Status() interface{}
	Stat(path string) (interface{}, error)
	List(path string) (interface{}, error)
	SetReplicas(path string, n int) error
	SetPolicy(folder string, n int) error
	AddHook(owner string, types []string, script string) (interface{}, error)
	RemoveHook(id string, owner string) error
	Hooks(owner string) interface{}
	Emit(user string, evType string, data []byte) error
	SubmitJob(owner string, name string, scriptVpath string, args []byte, inputs []string, features []string, nodes []string, timeoutSec int, dataset string, partitionMax int) (interface{}, error)
	JobStatus(id string, requester string, isAdmin bool) (interface{}, error)
	JobList(owner string) interface{}
	CancelJob(id string, requester string, isAdmin bool) error
	WaitJob(id string, timeoutSec int, requester string, isAdmin bool) (interface{}, error)
}

func (g *Gateway) ClusterLibRegister() {
	err := g.RegisterLib("cluster", g.injectClusterLibFunctions)
	if err != nil {
		logger.PrintAndLog("Agi", fmt.Sprint(err), nil)
		os.Exit(1)
	}
}

func (g *Gateway) injectClusterLibFunctions(payload *static.AgiLibInjectionPayload) {
	vm := payload.VM
	u := payload.User
	p := g.Option.ClusterProvider
	if p == nil {
		return
	}
	username := ""
	if u != nil {
		username = u.Username
	}
	isAdmin := func() bool { return u != nil && u.IsAdmin() }
	fail := func(err error) otto.Value {
		panic(vm.MakeCustomError("ClusterError", err.Error()))
	}
	toJSON := func(v interface{}) otto.Value {
		js, err := json.Marshal(v)
		if err != nil {
			return fail(err)
		}
		r, _ := vm.ToValue(string(js))
		return r
	}
	// paths accept cluster:/x or /x; normalise to a vpath for permission checks
	vpathArg := func(call otto.FunctionCall, i int) string {
		raw, _ := call.Argument(i).ToString()
		raw = strings.TrimSpace(raw)
		if !strings.HasPrefix(strings.ToLower(raw), "cluster:") {
			raw = "cluster:" + strings.TrimPrefix(raw, "/")
			raw = strings.Replace(raw, "cluster:", "cluster:/", 1)
		}
		return raw
	}

	vm.Set("_cluster_inCluster", func(call otto.FunctionCall) otto.Value {
		r, _ := vm.ToValue(p.InCluster())
		return r
	})
	vm.Set("_cluster_self", func(call otto.FunctionCall) otto.Value { return toJSON(p.Self()) })
	vm.Set("_cluster_nodes", func(call otto.FunctionCall) otto.Value { return toJSON(p.Nodes()) })
	vm.Set("_cluster_status", func(call otto.FunctionCall) otto.Value { return toJSON(p.Status()) })
	vm.Set("_cluster_stat", func(call otto.FunctionCall) otto.Value {
		vpath := vpathArg(call, 0)
		if u != nil && !u.CanRead(vpath) {
			return fail(errors.New("path access denied: " + vpath))
		}
		rec, err := p.Stat(vpath)
		if err != nil {
			return fail(err)
		}
		return toJSON(rec)
	})
	vm.Set("_cluster_list", func(call otto.FunctionCall) otto.Value {
		vpath := vpathArg(call, 0)
		if u != nil && !u.CanRead(vpath) {
			return fail(errors.New("path access denied: " + vpath))
		}
		recs, err := p.List(vpath)
		if err != nil {
			return fail(err)
		}
		return toJSON(recs)
	})
	vm.Set("_cluster_setReplicas", func(call otto.FunctionCall) otto.Value {
		if !isAdmin() {
			return fail(errors.New("admin permission required"))
		}
		n, _ := call.Argument(1).ToInteger()
		if err := p.SetReplicas(vpathArg(call, 0), int(n)); err != nil {
			return fail(err)
		}
		return otto.TrueValue()
	})
	vm.Set("_cluster_policy", func(call otto.FunctionCall) otto.Value {
		if !isAdmin() {
			return fail(errors.New("admin permission required"))
		}
		folder, _ := call.Argument(0).ToString()
		n, _ := call.Argument(1).ToInteger()
		if err := p.SetPolicy(folder, int(n)); err != nil {
			return fail(err)
		}
		return otto.TrueValue()
	})
	vm.Set("_cluster_on", func(call otto.FunctionCall) otto.Value {
		types, _ := call.Argument(0).ToString()
		script, _ := call.Argument(1).ToString()
		if payload.ScriptFsh != nil && u != nil {
			script = static.RelativeVpathRewrite(payload.ScriptFsh, script, vm, u)
		}
		if u != nil && !u.CanRead(script) {
			return fail(errors.New("script access denied: " + script))
		}
		h, err := p.AddHook(username, strings.Split(types, ","), script)
		if err != nil {
			return fail(err)
		}
		return toJSON(h)
	})
	vm.Set("_cluster_off", func(call otto.FunctionCall) otto.Value {
		id, _ := call.Argument(0).ToString()
		owner := username
		if isAdmin() {
			owner = ""
		}
		if err := p.RemoveHook(id, owner); err != nil {
			return fail(err)
		}
		return otto.TrueValue()
	})
	vm.Set("_cluster_hooks", func(call otto.FunctionCall) otto.Value {
		owner := username
		if isAdmin() {
			owner = ""
		}
		return toJSON(p.Hooks(owner))
	})
	vm.Set("_cluster_emit", func(call otto.FunctionCall) otto.Value {
		evType, _ := call.Argument(0).ToString()
		data, _ := call.Argument(1).ToString()
		if err := p.Emit(username, evType, []byte(data)); err != nil {
			return fail(err)
		}
		return otto.TrueValue()
	})

	vm.Set("_cluster_jobSubmit", func(call otto.FunctionCall) otto.Value {
		raw, _ := call.Argument(0).ToString()
		var req struct {
			Name         string          `json:"name"`
			Script       string          `json:"script"`
			Args         json.RawMessage `json:"args"`
			Inputs       []string        `json:"inputs"`
			Features     []string        `json:"features"`
			Nodes        []string        `json:"nodes"`
			Timeout      int             `json:"timeout"`
			Dataset      string          `json:"dataset"`
			PartitionMax int             `json:"partitionMax"`
		}
		if err := json.Unmarshal([]byte(raw), &req); err != nil {
			return fail(err)
		}
		if payload.ScriptFsh != nil && u != nil {
			req.Script = static.RelativeVpathRewrite(payload.ScriptFsh, req.Script, vm, u)
		}
		if u != nil && !u.CanRead(req.Script) {
			return fail(errors.New("script access denied: " + req.Script))
		}
		rec, err := p.SubmitJob(username, req.Name, req.Script, req.Args, req.Inputs, req.Features, req.Nodes, req.Timeout, req.Dataset, req.PartitionMax)
		if err != nil {
			return fail(err)
		}
		return toJSON(rec)
	})
	vm.Set("_cluster_jobStatus", func(call otto.FunctionCall) otto.Value {
		id, _ := call.Argument(0).ToString()
		rec, err := p.JobStatus(id, username, isAdmin())
		if err != nil {
			return fail(err)
		}
		return toJSON(rec)
	})
	vm.Set("_cluster_jobList", func(call otto.FunctionCall) otto.Value {
		owner := username
		if isAdmin() {
			owner = ""
		}
		return toJSON(p.JobList(owner))
	})
	vm.Set("_cluster_jobCancel", func(call otto.FunctionCall) otto.Value {
		id, _ := call.Argument(0).ToString()
		if err := p.CancelJob(id, username, isAdmin()); err != nil {
			return fail(err)
		}
		return otto.TrueValue()
	})
	vm.Set("_cluster_jobWait", func(call otto.FunctionCall) otto.Value {
		id, _ := call.Argument(0).ToString()
		secs, _ := call.Argument(1).ToInteger()
		rec, err := p.WaitJob(id, int(secs), username, isAdmin())
		if err != nil {
			return fail(err)
		}
		return toJSON(rec)
	})

	vm.Run(`
		var cluster = {};
		cluster.inCluster = function() { return _cluster_inCluster(); };
		cluster.self = function() { return JSON.parse(_cluster_self()); };
		cluster.nodes = function() { return JSON.parse(_cluster_nodes()); };
		cluster.status = function() { return JSON.parse(_cluster_status()); };
		cluster.stat = function(p) { return JSON.parse(_cluster_stat(p)); };
		cluster.list = function(p) { return JSON.parse(_cluster_list(p)); };
		cluster.setReplicas = function(p, n) { return _cluster_setReplicas(p, n); };
		cluster.policy = function(folder, n) { return _cluster_policy(folder, n); };
		cluster.on = function(types, script) { var h = JSON.parse(_cluster_on(Array.isArray(types) ? types.join(",") : types, script)); return h.id; };
		cluster.off = function(id) { return _cluster_off(id); };
		cluster.hooks = function() { return JSON.parse(_cluster_hooks()); };
		cluster.emit = function(type, data) { return _cluster_emit(type, JSON.stringify(data === undefined ? {} : data)); };
		cluster.jobs = {};
		cluster.jobs.submit = function(spec) { return JSON.parse(_cluster_jobSubmit(JSON.stringify(spec))).spec.id; };
		cluster.jobs.status = function(id) { return JSON.parse(_cluster_jobStatus(id)); };
		cluster.jobs.list = function() { return JSON.parse(_cluster_jobList()); };
		cluster.jobs.cancel = function(id) { return _cluster_jobCancel(id); };
		cluster.jobs.wait = function(id, timeoutSec) { return JSON.parse(_cluster_jobWait(id, timeoutSec === undefined ? 300 : timeoutSec)); };
		cluster.jobs.mapreduce = function(spec) { spec = spec || {}; if (!spec.dataset) { throw new Error("a map/reduce job needs a dataset pattern"); } return cluster.jobs.submit(spec); };
	`)
}
