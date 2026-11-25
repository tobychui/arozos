package metadata

/*
	ACMS admin endpoints (/system/cluster/meta/*, mounted admin-only by the core).
*/

import (
	"encoding/json"
	"net/http"
	"strconv"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

func sendJSON(w http.ResponseWriter, v interface{}) {
	defer logger.Out0(logger.In1("cluster/metadata", "sendJSON", "v", v))
	js, _ := json.Marshal(v)
	utils.SendJSONResponse(w, string(js))
}

// HandleStatus returns the store status.
func (mgr *Manager) HandleStatus(w http.ResponseWriter, r *http.Request) {
	logger.DebugTrace("cluster/metadata", "Manager.HandleStatus")
	sendJSON(w, mgr.Status())
}

// HandleList lists a directory of the namespace.
func (mgr *Manager) HandleList(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("cluster/metadata", "Manager.HandleList", "mgr", mgr, "r", r))
	p, _ := utils.GetPara(r, "path")
	if p == "" {
		p = "/"
	}
	entries, err := mgr.ListDir(p)
	if err != nil {
		logger.DebugErr("cluster/metadata", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, entries)
}

// HandleStat returns one record with its locations.
func (mgr *Manager) HandleStat(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("cluster/metadata", "Manager.HandleStat", "mgr", mgr, "r", r))
	p, err := utils.GetPara(r, "path")
	if err != nil {
		logger.DebugErr("cluster/metadata", err)
		utils.SendErrorResponse(w, "path required")
		return
	}
	rec, err := mgr.Stat(p)
	if err != nil {
		logger.DebugErr("cluster/metadata", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, rec)
}

// HandlePolicyList lists folder policies.
func (mgr *Manager) HandlePolicyList(w http.ResponseWriter, r *http.Request) {
	logger.DebugTrace("cluster/metadata", "Manager.HandlePolicyList")
	sendJSON(w, mgr.Policies())
}

// HandlePolicySet sets the replica count of a top-level folder.
func (mgr *Manager) HandlePolicySet(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("cluster/metadata", "Manager.HandlePolicySet", "mgr", mgr, "r", r))
	folder, err := utils.PostPara(r, "folder")
	if err != nil {
		logger.DebugErr("cluster/metadata", err)
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
		logger.DebugErr("cluster/metadata", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, mgr.Policies())
}

// RegisterAdminRoutes mounts the admin handlers.
func (mgr *Manager) RegisterAdminRoutes(register func(pattern string, handler func(http.ResponseWriter, *http.Request))) {
	defer logger.Out0(logger.In2("cluster/metadata", "Manager.RegisterAdminRoutes", "mgr", mgr, "register", register))
	register("/system/cluster/meta/status", mgr.HandleStatus)
	register("/system/cluster/meta/ls", mgr.HandleList)
	register("/system/cluster/meta/stat", mgr.HandleStat)
	register("/system/cluster/meta/policy/list", mgr.HandlePolicyList)
	register("/system/cluster/meta/policy/set", mgr.HandlePolicySet)
}
