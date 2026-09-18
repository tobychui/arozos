package metadata

/*
	ACMS node-facing endpoints (all signed):

		POST /cluster/acn/meta/append    leader -> follower: apply entries
		POST /cluster/acn/meta/submit    follower -> leader: accept a change
		GET  /cluster/acn/meta/log?after=N   follower -> leader: catch up
		GET  /cluster/acn/meta/snapshot      follower -> leader: full state
		POST /cluster/acn/meta/lease         leader -> everyone: claim / renew
		GET  /cluster/acn/meta/stat?path=    any -> any: one record
*/

import (
	"encoding/json"
	"net/http"
	"strconv"

	"imuslab.com/arozos/mod/cluster/acn"
)

func (mgr *Manager) registerACNHandlers() {
	srv := mgr.m.Server()
	srv.HandleFunc(pathAppend, mgr.handleAppend)
	srv.HandleFunc(pathSubmit, mgr.handleSubmit)
	srv.HandleFunc(pathLog, mgr.handleLog)
	srv.HandleFunc(pathSnapshot, mgr.handleSnapshot)
	srv.HandleFunc(pathLease, mgr.handleLease)
	srv.HandleFunc(pathStat, mgr.handleStat)
}

func (mgr *Manager) handleAppend(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var req AppendRequest
	if err := json.Unmarshal(body, &req); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid append payload")
		return
	}
	if sender.NodeID != mgr.Leader() {
		//Not from the leader we know: still apply (LWW is safe) but do not
		//advance the applied counter
		for _, e := range req.Entries {
			mgr.apply(e)
		}
		acn.WriteJSON(w, map[string]interface{}{"ok": true, "leader": mgr.Leader()})
		return
	}
	mgr.followerReceive(req.Entries)
	applied, _ := mgr.st.getApplied()
	acn.WriteJSON(w, map[string]interface{}{"ok": true, "applied": applied})
}

func (mgr *Manager) handleSubmit(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	if !mgr.IsLeader() {
		acn.WriteError(w, http.StatusConflict, "this node is not the metadata leader")
		return
	}
	var e Entry
	if err := json.Unmarshal(body, &e); err != nil || e.Kind == "" {
		acn.WriteError(w, http.StatusBadRequest, "invalid entry")
		return
	}
	mgr.apply(e)
	assigned := mgr.leaderAccept(e)
	acn.WriteJSON(w, map[string]interface{}{"ok": true, "seq": assigned.Seq})
}

func (mgr *Manager) handleLog(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	if !mgr.IsLeader() {
		acn.WriteError(w, http.StatusConflict, "this node is not the metadata leader")
		return
	}
	after, _ := strconv.ParseUint(r.URL.Query().Get("after"), 10, 64)
	entries, ok := mgr.st.logAfter(after, logPageSize)
	if !ok {
		acn.WriteError(w, http.StatusGone, "requested log range was compacted, take a snapshot")
		return
	}
	lease := mgr.st.getLease()
	acn.WriteJSON(w, LogResponse{Entries: entries, LastSeq: mgr.st.getLastSeq(), Term: lease.Term})
}

func (mgr *Manager) handleSnapshot(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	if !mgr.IsLeader() {
		acn.WriteError(w, http.StatusConflict, "this node is not the metadata leader")
		return
	}
	snap := mgr.st.snapshot()
	snap.Term = mgr.st.getLease().Term
	acn.WriteJSON(w, snap)
}

func (mgr *Manager) handleLease(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var req LeaseRequest
	if err := json.Unmarshal(body, &req); err != nil || req.Lease.Holder != sender.NodeID {
		acn.WriteError(w, http.StatusBadRequest, "invalid lease")
		return
	}
	cur := mgr.st.getLease()
	if mgr.acceptLease(req.Lease, req.LastSeq) {
		acn.WriteJSON(w, LeaseResponse{Lease: mgr.st.getLease(), LastSeq: mgr.st.getLastSeq()})
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusConflict)
	js, _ := json.Marshal(LeaseResponse{Lease: cur, LastSeq: mgr.st.getLastSeq()})
	w.Write(js)
}

func (mgr *Manager) handleStat(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	rec, err := mgr.Stat(r.URL.Query().Get("path"))
	if err != nil {
		acn.WriteError(w, http.StatusNotFound, err.Error())
		return
	}
	acn.WriteJSON(w, rec)
}
