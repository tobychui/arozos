package identity

/*
	ArozOS Cluster - identity endpoints

	Node-facing (signed, served only by the identity origin):
		POST /cluster/acn/auth/verify        check a username + password hash
		GET  /cluster/acn/auth/directory     full account directory
		POST /cluster/acn/auth/setpassword   password change forwarded by a member

	Admin-facing (/system/cluster/identity/*, mounted admin-only by the core):
		status, origin, sync
*/

import (
	"encoding/json"
	"net/http"
	"strings"

	"imuslab.com/arozos/mod/cluster/acn"
	"imuslab.com/arozos/mod/utils"
)

func (i *Manager) registerACNHandlers() {
	srv := i.m.Server()
	srv.HandleFunc(acn.BasePath+"/auth/verify", i.handleVerify)
	srv.HandleFunc(acn.BasePath+"/auth/directory", i.handleDirectory)
	srv.HandleFunc(acn.BasePath+"/auth/setpassword", i.handleSetPassword)
}

// requireOrigin rejects node requests when this node is not the identity origin.
func (i *Manager) requireOrigin(w http.ResponseWriter) bool {
	if _, self := i.Origin(); !self {
		acn.WriteError(w, http.StatusConflict, "this node is not the identity origin of the cluster")
		return false
	}
	return true
}

func (i *Manager) handleVerify(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	if !i.requireOrigin(w) {
		return
	}
	var req VerifyRequest
	if err := json.Unmarshal(body, &req); err != nil || !validUsername(req.Username) || req.PasswordHash == "" {
		acn.WriteJSON(w, VerifyResponse{OK: false, Reason: "Invalid username or password"})
		return
	}
	stored, err := i.acc.PasswordHash(req.Username)
	if err != nil || stored == "" || !constantTimeEqual(stored, req.PasswordHash) {
		acn.WriteJSON(w, VerifyResponse{OK: false, Reason: "Invalid username or password"})
		return
	}
	groups, _ := i.acc.Groups(req.Username)
	if groups == nil {
		groups = []string{}
	}
	acn.WriteJSON(w, VerifyResponse{OK: true, Groups: groups})
}

func (i *Manager) handleDirectory(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	if !i.requireOrigin(w) {
		return
	}
	acn.WriteJSON(w, i.buildDirectory())
}

func (i *Manager) handleSetPassword(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	if !i.requireOrigin(w) {
		return
	}
	var req SetPasswordRequest
	if err := json.Unmarshal(body, &req); err != nil || !validUsername(req.Username) || req.PasswordHash == "" {
		acn.WriteError(w, http.StatusBadRequest, "invalid request")
		return
	}
	if !i.acc.UserExists(req.Username) {
		acn.WriteError(w, http.StatusNotFound, "user not found on the identity origin")
		return
	}
	if err := i.acc.SetPasswordHash(req.Username, req.PasswordHash); err != nil {
		acn.WriteError(w, http.StatusInternalServerError, err.Error())
		return
	}
	acn.WriteJSON(w, map[string]bool{"ok": true})
}

func constantTimeEqual(a string, b string) bool {
	if len(a) != len(b) {
		return false
	}
	var diff byte
	for k := 0; k < len(a); k++ {
		diff |= a[k] ^ b[k]
	}
	return diff == 0
}

/*
	Admin handlers
*/

// HandleStatus returns the identity status.
func (i *Manager) HandleStatus(w http.ResponseWriter, r *http.Request) {
	js, _ := json.Marshal(i.Status())
	utils.SendJSONResponse(w, string(js))
}

// HandleOrigin sets the identity origin: id=self, id=<node id>, or id= (disable).
func (i *Manager) HandleOrigin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "POST required")
		return
	}
	id := strings.TrimSpace(r.PostFormValue("id"))
	if id == "self" {
		id = i.m.NodeID()
	}
	if err := i.m.SetIdentityOrigin(id); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleSync pulls the origin directory immediately.
func (i *Manager) HandleSync(w http.ResponseWriter, r *http.Request) {
	if err := i.SyncNow(); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	js, _ := json.Marshal(i.Status())
	utils.SendJSONResponse(w, string(js))
}

// RegisterAdminRoutes mounts the admin handlers on the given register function.
func (i *Manager) RegisterAdminRoutes(register func(pattern string, handler func(http.ResponseWriter, *http.Request))) {
	register("/system/cluster/identity/status", i.HandleStatus)
	register("/system/cluster/identity/origin", i.HandleOrigin)
	register("/system/cluster/identity/sync", i.HandleSync)
}
