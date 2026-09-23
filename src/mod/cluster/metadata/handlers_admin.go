package metadata

/*
	ACMS admin endpoints (/system/cluster/meta/*, mounted admin-only by the core).
*/

import (
	"encoding/json"
	"net/http"
	"strconv"

	"imuslab.com/arozos/mod/utils"
)

func sendJSON(w http.ResponseWriter, v interface{}) {
	js, _ := json.Marshal(v)
	utils.SendJSONResponse(w, string(js))
}

// HandleStatus returns the store status.
func (mgr *Manager) HandleStatus(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, mgr.Status())
}

// HandleList lists a directory of the namespace.
func (mgr *Manager) HandleList(w http.ResponseWriter, r *http.Request) {
	p, _ := utils.GetPara(r, "path")
	if p == "" {
		p = "/"
	}
	entries, err := mgr.ListDir(p)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, entries)
}

// HandleStat returns one record with its locations.
func (mgr *Manager) HandleStat(w http.ResponseWriter, r *http.Request) {
	p, err := utils.GetPara(r, "path")
	if err != nil {
		utils.SendErrorResponse(w, "path required")
		return
	}
	rec, err := mgr.Stat(p)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, rec)
}

// HandlePolicyList lists folder policies.
func (mgr *Manager) HandlePolicyList(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, mgr.Policies())
}

// HandlePolicySet sets the replica count of a top-level folder.
func (mgr *Manager) HandlePolicySet(w http.ResponseWriter, r *http.Request) {
	folder, err := utils.PostPara(r, "folder")
	if err != nil {
		utils.SendErrorResponse(w, "folder required")
		return
	}
	replicasStr, _ := utils.PostPara(r, "replicas")
	replicas, err := strconv.Atoi(replicasStr)
	if err != nil || replicas < 1 || replicas > 16 {
		utils.SendErrorResponse(w, "replicas must be between 1 and 16")
		return
	}
	if err := mgr.Submit(KindPolicy, &Policy{Folder: folder, Replicas: replicas}); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, mgr.Policies())
}

// RegisterAdminRoutes mounts the admin handlers.
func (mgr *Manager) RegisterAdminRoutes(register func(pattern string, handler func(http.ResponseWriter, *http.Request))) {
	register("/system/cluster/meta/status", mgr.HandleStatus)
	register("/system/cluster/meta/ls", mgr.HandleList)
	register("/system/cluster/meta/stat", mgr.HandleStat)
	register("/system/cluster/meta/policy/list", mgr.HandlePolicyList)
	register("/system/cluster/meta/policy/set", mgr.HandlePolicySet)
}
