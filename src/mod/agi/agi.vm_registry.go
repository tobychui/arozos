package agi

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"sync"
	"time"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

/*
AGI VM Registry

Tracks every Otto VM that is actively executing a script so that
administrators (and users for their own scripts) can inspect running
VMs and force-stop any that are stuck in an infinite loop or
otherwise unresponsive.

Force-stop works by sending a function into the VM's interrupt
channel; Otto checks that channel between JS operations and, when a
value is found, calls the function — which panics with errForceStop.
The panic is caught by a deferred recovery block in each Execute*
function and results in a 503 response rather than a goroutine crash.
*/

// errForceStop is the sentinel value panicked inside a forcibly stopped VM.
var errForceStop = errors.New("errForceStop")

// VMRecord holds metadata about one live AGI VM instance.
type VMRecord struct {
	ExecID      string
	ScriptFile  string
	Username    string
	StartTime   time.Time
	interruptCh chan func() // alias to vm.Interrupt — never nil after registration
}

// VMInfo is the JSON-serialisable view of a VMRecord sent to API callers.
type VMInfo struct {
	ExecID         string `json:"execID"`
	ScriptFile     string `json:"scriptFile"`
	Username       string `json:"username"`
	StartTime      int64  `json:"startTime"`      // Unix seconds
	ElapsedSeconds int64  `json:"elapsedSeconds"` // seconds since StartTime
}

func toVMInfo(rec *VMRecord) VMInfo {
	logger.DebugTrace("agi", "toVMInfo")
	return VMInfo{
		ExecID:         rec.ExecID,
		ScriptFile:     rec.ScriptFile,
		Username:       rec.Username,
		StartTime:      rec.StartTime.Unix(),
		ElapsedSeconds: int64(time.Since(rec.StartTime).Seconds()),
	}
}

// vmRegistry is a goroutine-safe map of execID --> *VMRecord.
type vmRegistry struct {
	mu      sync.RWMutex
	records map[string]*VMRecord
}

func newVMRegistry() *vmRegistry {
	logger.DebugTrace("agi", "newVMRegistry")
	return &vmRegistry{records: make(map[string]*VMRecord)}
}

// register adds a record.  Called just before vm.Run() in each Execute* path.
func (r *vmRegistry) register(rec *VMRecord) {
	defer logger.Out0(logger.In2("agi", "vmRegistry.register", "r", r, "rec", rec))
	r.mu.Lock()
	r.records[rec.ExecID] = rec
	r.mu.Unlock()
}

// unregister removes a record.  Always called via defer so it fires even on panic.
func (r *vmRegistry) unregister(execID string) {
	defer logger.Out0(logger.In2("agi", "vmRegistry.unregister", "r", r, "execID", execID))
	r.mu.Lock()
	delete(r.records, execID)
	r.mu.Unlock()
}

// list returns VMInfo for every VM visible to the requester.
// Admins see all; regular users see only their own records.
func (r *vmRegistry) list(requesterUsername string, isAdmin bool) (out0 []VMInfo) {
	defer logger.Out1(logger.In3("agi", "vmRegistry.list", "r", r, "requesterUsername", requesterUsername, "isAdmin", isAdmin), &out0)
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := make([]VMInfo, 0, len(r.records))
	for _, rec := range r.records {
		if isAdmin || rec.Username == requesterUsername {
			result = append(result, toVMInfo(rec))
		}
	}
	return result
}

// forceStop sends an interrupt to the VM with the given execID.
// Regular users may only stop their own VMs; admins may stop any.
func (r *vmRegistry) forceStop(execID, requesterUsername string, isAdmin bool) (out0 error) {
	defer logger.Out1(logger.In4("agi", "vmRegistry.forceStop", "r", r, "execID", execID, "requesterUsername", requesterUsername, "isAdmin", isAdmin), &out0)
	r.mu.RLock()
	rec, ok := r.records[execID]
	r.mu.RUnlock()
	if !ok {
		return errors.New("VM not found: " + execID)
	}
	if !isAdmin && rec.Username != requesterUsername {
		return errors.New("permission denied: you can only stop your own VMs")
	}
	select {
	case rec.interruptCh <- func() { panic(errForceStop) }:
		log.Printf("[AGI] VM %s (script: %s, user: %s) force-stopped by %s",
			execID, rec.ScriptFile, rec.Username, requesterUsername)
		return nil
	default:
		return errors.New("interrupt channel full — VM may already be stopping")
	}
}

// ── HTTP Handlers ──────────────────────────────────────────────────────────

// HandleListRuntimes returns the list of running VMs visible to the caller.
// GET /system/ajgi/runtime/list
func (g *Gateway) HandleListRuntimes(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("agi", "Gateway.HandleListRuntimes", "g", g, "r", r))
	thisuser, err := g.Option.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		logger.DebugErr("agi", err)
		http.Error(w, "401 Unauthorized", http.StatusUnauthorized)
		return
	}

	infos := g.vmReg.list(thisuser.Username, thisuser.IsAdmin())
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(infos)
}

// HandleForceStopRuntime terminates a VM identified by the execid POST parameter.
// POST /system/ajgi/runtime/stop
func (g *Gateway) HandleForceStopRuntime(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("agi", "Gateway.HandleForceStopRuntime", "g", g, "r", r))
	thisuser, err := g.Option.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		logger.DebugErr("agi", err)
		http.Error(w, "401 Unauthorized", http.StatusUnauthorized)
		return
	}

	execID, err := utils.PostPara(r, "execid")
	if err != nil {
		logger.DebugErr("agi", err)
		utils.SendErrorResponse(w, "missing execid parameter")
		return
	}

	if stopErr := g.vmReg.forceStop(execID, thisuser.Username, thisuser.IsAdmin()); stopErr != nil {
		logger.DebugErr("agi", stopErr)
		utils.SendErrorResponse(w, stopErr.Error())
		return
	}

	w.Header().Set("Content-Type", "application/json")
	w.Write([]byte(`{"ok":true}`))
}
