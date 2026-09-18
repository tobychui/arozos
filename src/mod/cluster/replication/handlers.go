package replication

/*
	Replication endpoints.

	Node-facing (signed):
		POST /cluster/acn/repl/pull    leader -> worker: make this copy
		POST /cluster/acn/repl/lease   worker -> leader: still copying
		POST /cluster/acn/repl/done    worker -> leader: result
		POST /cluster/acn/repl/plan    any -> leader: run the planner now

	Admin (/system/cluster/repl/* and volume evacuation, admin only).
*/

import (
	"encoding/json"
	"net/http"

	"imuslab.com/arozos/mod/cluster/acn"
	"imuslab.com/arozos/mod/utils"
)

const (
	pathPull  = acn.BasePath + "/repl/pull"
	pathLease = acn.BasePath + "/repl/lease"
	pathDone  = acn.BasePath + "/repl/done"
	pathPlan  = acn.BasePath + "/repl/plan"
)

// TaskReport is what a worker sends back to the leader.
type TaskReport struct {
	TaskID string `json:"taskId"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
}

func (r *Manager) registerACNHandlers() {
	srv := r.m.Server()
	srv.HandleFunc(pathPull, r.handlePull)
	srv.HandleFunc(pathLease, r.handleLease)
	srv.HandleFunc(pathDone, r.handleDone)
	srv.HandleFunc(pathPlan, r.handlePlan)
}

func (r *Manager) handlePull(w http.ResponseWriter, req *http.Request, sender *acn.SignedIdentity, body []byte) {
	if sender.NodeID != r.meta.Leader() {
		acn.WriteError(w, http.StatusForbidden, "only the metadata leader assigns replication tasks")
		return
	}
	var t Task
	if err := json.Unmarshal(body, &t); err != nil || t.ID == "" || t.FileID == "" {
		acn.WriteError(w, http.StatusBadRequest, "invalid task")
		return
	}
	if t.TargetNode != r.m.NodeID() {
		acn.WriteError(w, http.StatusBadRequest, "task is for another node")
		return
	}
	go r.runTask(t)
	acn.WriteJSON(w, map[string]bool{"ok": true})
}

func (r *Manager) handleLease(w http.ResponseWriter, req *http.Request, sender *acn.SignedIdentity, body []byte) {
	if !r.meta.IsLeader() {
		acn.WriteError(w, http.StatusConflict, ErrNotLeader.Error())
		return
	}
	var rep TaskReport
	if err := json.Unmarshal(body, &rep); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid report")
		return
	}
	acn.WriteJSON(w, map[string]bool{"ok": r.renewLease(rep.TaskID)})
}

func (r *Manager) handleDone(w http.ResponseWriter, req *http.Request, sender *acn.SignedIdentity, body []byte) {
	if !r.meta.IsLeader() {
		acn.WriteError(w, http.StatusConflict, ErrNotLeader.Error())
		return
	}
	var rep TaskReport
	if err := json.Unmarshal(body, &rep); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid report")
		return
	}
	r.mu.Lock()
	r.finishLocked(rep.TaskID, rep.OK, rep.Error)
	r.mu.Unlock()
	acn.WriteJSON(w, map[string]bool{"ok": true})
}

func (r *Manager) handlePlan(w http.ResponseWriter, req *http.Request, sender *acn.SignedIdentity, body []byte) {
	if !r.meta.IsLeader() {
		acn.WriteError(w, http.StatusConflict, ErrNotLeader.Error())
		return
	}
	acn.WriteJSON(w, r.plan())
}

/*
	Admin handlers
*/

func sendJSON(w http.ResponseWriter, v interface{}) {
	js, _ := json.Marshal(v)
	utils.SendJSONResponse(w, string(js))
}

// HandleStatus returns the replication picture.
func (r *Manager) HandleStatus(w http.ResponseWriter, req *http.Request) {
	sendJSON(w, r.Status())
}

// HandlePlan runs the planner now (forwarded to the leader when needed).
func (r *Manager) HandlePlan(w http.ResponseWriter, req *http.Request) {
	res, err := r.PlanNow()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, res)
}

// HandleVerify re-checksums this node's copies now. Optional budget in MB.
func (r *Manager) HandleVerify(w http.ResponseWriter, req *http.Request) {
	var budget int64
	if mb, err := utils.PostInt(req, "budget"); err == nil && mb > 0 {
		budget = int64(mb) << 20
	}
	sendJSON(w, r.st.VerifyLocalCopies(budget))
}

// HandleEvacuate starts moving everything off a local volume.
func (r *Manager) HandleEvacuate(w http.ResponseWriter, req *http.Request) {
	id, err := utils.PostPara(req, "id")
	if err != nil {
		utils.SendErrorResponse(w, "volume id required")
		return
	}
	if err := r.st.StartEvacuation(id); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	go r.PlanNow()
	sendJSON(w, r.st.EvacuationStatus(id))
}

// HandleEvacuateCancel makes an evacuating volume writable again.
func (r *Manager) HandleEvacuateCancel(w http.ResponseWriter, req *http.Request) {
	id, err := utils.PostPara(req, "id")
	if err != nil {
		utils.SendErrorResponse(w, "volume id required")
		return
	}
	if err := r.st.CancelEvacuation(id); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleEvacuateStatus reports evacuation progress: id=
func (r *Manager) HandleEvacuateStatus(w http.ResponseWriter, req *http.Request) {
	id, err := utils.GetPara(req, "id")
	if err != nil {
		utils.SendErrorResponse(w, "volume id required")
		return
	}
	sendJSON(w, r.st.EvacuationStatus(id))
}

// RegisterAdminRoutes mounts the admin handlers.
func (r *Manager) RegisterAdminRoutes(register func(pattern string, handler func(http.ResponseWriter, *http.Request))) {
	register("/system/cluster/repl/status", r.HandleStatus)
	register("/system/cluster/repl/plan", r.HandlePlan)
	register("/system/cluster/repl/verify", r.HandleVerify)
	register("/system/cluster/storage/volume/evacuate", r.HandleEvacuate)
	register("/system/cluster/storage/volume/evacuate/cancel", r.HandleEvacuateCancel)
	register("/system/cluster/storage/volume/evacuate/status", r.HandleEvacuateStatus)
}
