package jobs

/*
	Job endpoints.

	Node-facing (signed):
		POST /cluster/acn/jobs/run     leader -> node: start this job
		POST /cluster/acn/jobs/done    node -> leader: it finished
		POST /cluster/acn/jobs/submit  node -> leader: queue a job

	User-facing (/system/cluster/jobs/*, any logged-in user; a user only sees
	and controls their own jobs unless they are an administrator).
*/

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"
	"time"

	"imuslab.com/arozos/mod/cluster/acn"
	"imuslab.com/arozos/mod/cluster/capability"
	"imuslab.com/arozos/mod/utils"
)

const (
	pathRun    = acn.BasePath + "/jobs/run"
	pathDone   = acn.BasePath + "/jobs/done"
	pathSubmit = acn.BasePath + "/jobs/submit"
)

// RunRequest asks a node to start a job it was assigned.
type RunRequest struct {
	JobID string `json:"jobId"`
}

// DoneReport tells the leader a job reached a terminal state.
type DoneReport struct {
	JobID  string `json:"jobId"`
	Status string `json:"status"`
}

func (j *Manager) registerACNHandlers() {
	srv := j.m.Server()
	srv.HandleFunc(pathRun, j.handleRun)
	srv.HandleFunc(pathDone, j.handleDone)
	srv.HandleFunc(pathSubmit, j.handleSubmitNode)
}

func (j *Manager) handleRun(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	if sender.NodeID != j.meta.Leader() {
		acn.WriteError(w, http.StatusForbidden, "only the metadata leader assigns jobs")
		return
	}
	var req RunRequest
	if err := json.Unmarshal(body, &req); err != nil || req.JobID == "" {
		acn.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if err := j.Start(req.JobID); err != nil {
		status := http.StatusInternalServerError
		if err == ErrNoUser {
			status = http.StatusConflict
		} else if err == ErrNotFound {
			status = http.StatusNotFound
		}
		acn.WriteError(w, status, err.Error())
		return
	}
	acn.WriteJSON(w, map[string]bool{"ok": true})
}

func (j *Manager) handleDone(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var rep DoneReport
	if err := json.Unmarshal(body, &rep); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid report")
		return
	}
	if j.meta.IsLeader() {
		go j.schedule()
	}
	acn.WriteJSON(w, map[string]bool{"ok": true})
}

func (j *Manager) handleSubmitNode(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var spec Spec
	if err := json.Unmarshal(body, &spec); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid job spec")
		return
	}
	rec, err := j.Submit(spec)
	if err != nil {
		acn.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	acn.WriteJSON(w, rec)
}

/*
	User-facing handlers
*/

func sendJSON(w http.ResponseWriter, v interface{}) {
	js, _ := json.Marshal(v)
	utils.SendJSONResponse(w, string(js))
}

// Caller identifies who is asking; the core supplies it from the session.
type Caller struct {
	Username string
	IsAdmin  bool
}

// CallerResolver maps a request to the logged-in user.
type CallerResolver func(w http.ResponseWriter, r *http.Request) (Caller, error)

// HandleStatus lists jobs and counters for the caller.
func (j *Manager) HandleStatus(resolve CallerResolver) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := resolve(w, r)
		if err != nil {
			utils.SendErrorResponse(w, "not logged in")
			return
		}
		owner := c.Username
		if c.IsAdmin {
			owner = ""
		}
		sendJSON(w, j.Status(owner))
	}
}

// HandleGet returns one job: id=
func (j *Manager) HandleGet(resolve CallerResolver) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := resolve(w, r)
		if err != nil {
			utils.SendErrorResponse(w, "not logged in")
			return
		}
		id, err := utils.GetPara(r, "id")
		if err != nil {
			utils.SendErrorResponse(w, "job id required")
			return
		}
		rec, ok := j.Get(id)
		if !ok || (!c.IsAdmin && rec.Spec.Owner != c.Username) {
			utils.SendErrorResponse(w, ErrNotFound.Error())
			return
		}
		sendJSON(w, rec)
	}
}

// HandleCancel cancels a job: id=
func (j *Manager) HandleCancel(resolve CallerResolver) func(http.ResponseWriter, *http.Request) {
	return func(w http.ResponseWriter, r *http.Request) {
		c, err := resolve(w, r)
		if err != nil {
			utils.SendErrorResponse(w, "not logged in")
			return
		}
		id, err := utils.PostPara(r, "id")
		if err != nil {
			id, err = utils.GetPara(r, "id")
			if err != nil {
				utils.SendErrorResponse(w, "job id required")
				return
			}
		}
		if err := j.Cancel(id, c.Username, c.IsAdmin); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		utils.SendOK(w)
	}
}

// SubmitFromRequest is what the core calls for /system/cluster/jobs/submit
// after it has read the script source from the submitter's file system.
type SubmitRequest struct {
	Name         string          `json:"name"`
	ScriptVpath  string          `json:"scriptVpath"`
	Script       string          `json:"script"`
	Args         json.RawMessage `json:"args,omitempty"`
	Inputs       []string        `json:"inputs,omitempty"`
	Features     []string        `json:"features,omitempty"`
	MinRAM       int64           `json:"minRam,omitempty"`
	MinCores     int             `json:"minCores,omitempty"`
	OS           []string        `json:"os,omitempty"`
	Arch         []string        `json:"arch,omitempty"`
	Priority     int             `json:"priority,omitempty"`
	TimeoutSec   int             `json:"timeoutSec,omitempty"`
	MaxAttempts  int             `json:"maxAttempts,omitempty"`
	WaitSeconds  int             `json:"waitSeconds,omitempty"`
	ScriptName   string          `json:"scriptName,omitempty"`
	Dataset      string          `json:"dataset,omitempty"`
	PartitionMax int             `json:"partitionMax,omitempty"`
	Nodes        []string        `json:"nodes,omitempty"`
}

// SpecFrom builds a Spec from a submit request for the given owner. A
// request carrying a dataset becomes a map/reduce job.
func SpecFrom(req SubmitRequest, owner string) Spec {
	spec := Spec{
		Name:         req.Name,
		Owner:        owner,
		Script:       req.Script,
		ScriptName:   firstNonEmpty(req.ScriptName, req.ScriptVpath, "job.agi"),
		Args:         req.Args,
		Inputs:       req.Inputs,
		Nodes:        req.Nodes,
		Priority:     req.Priority,
		TimeoutSec:   req.TimeoutSec,
		MaxAttempts:  req.MaxAttempts,
		Kind:         KindRun,
		Dataset:      req.Dataset,
		PartitionMax: req.PartitionMax,
		Requirements: capabilityRequirements(req),
	}
	if strings.TrimSpace(req.Dataset) != "" {
		spec.Kind = KindMapReduce
	}
	return spec
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if v != "" {
			return v
		}
	}
	return ""
}

// WaitFor is the HTTP-friendly form of Wait.
func (j *Manager) WaitFor(id string, seconds int) (Record, error) {
	if seconds <= 0 {
		seconds = 60
	}
	return j.Wait(id, time.Duration(seconds)*time.Second)
}

// RegisterUserRoutes mounts the user-facing handlers. submit is supplied by
// the core because it must read the script from the caller's file system.
func (j *Manager) RegisterUserRoutes(register func(pattern string, handler func(http.ResponseWriter, *http.Request)), resolve CallerResolver, submit func(http.ResponseWriter, *http.Request)) {
	register("/system/cluster/jobs/status", j.HandleStatus(resolve))
	register("/system/cluster/jobs/get", j.HandleGet(resolve))
	register("/system/cluster/jobs/cancel", j.HandleCancel(resolve))
	register("/system/cluster/jobs/submit", submit)
}

// parseIntDefault is a small helper for query parameters.
func parseIntDefault(s string, def int) int {
	if v, err := strconv.Atoi(s); err == nil {
		return v
	}
	return def
}

// capabilityRequirements maps a submit request onto the scheduler's
// requirement matcher.
func capabilityRequirements(req SubmitRequest) capability.Requirements {
	return capability.Requirements{
		Features: req.Features,
		MinRAM:   req.MinRAM,
		MinCores: req.MinCores,
		OS:       req.OS,
		Arch:     req.Arch,
	}
}
