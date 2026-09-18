package membership

/*
	ArozOS Cluster - node-facing (ACN) endpoints

	POST /cluster/acn/join           token-authenticated, joins a new node
	POST /cluster/acn/heartbeat      signed, exchanges liveness and membership
	GET  /cluster/acn/members        signed, full membership dump
	POST /cluster/acn/members/sync   signed, push of membership changes
	POST /cluster/acn/leave          signed, sender leaves
	POST /cluster/acn/evict          signed, sender removed this node
*/

import (
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"imuslab.com/arozos/mod/cluster/acn"
	"imuslab.com/arozos/mod/info/logger"
)

func (m *Manager) registerACNHandlers() {
	m.server.HandleRaw(acn.BasePath+"/join", m.handleJoin)
	m.server.HandleFunc(acn.BasePath+"/heartbeat", m.handleHeartbeat)
	m.server.HandleFunc(acn.BasePath+"/members", m.handleMembers)
	m.server.HandleFunc(acn.BasePath+"/members/sync", m.handleSync)
	m.server.HandleFunc(acn.BasePath+"/leave", m.handleLeave)
	m.server.HandleFunc(acn.BasePath+"/evict", m.handleEvict)
}

func sanitizeName(name string) string {
	name = strings.TrimSpace(name)
	if len(name) > 64 {
		name = name[:64]
	}
	return name
}

func (m *Manager) handleJoin(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		acn.WriteError(w, http.StatusMethodNotAllowed, "POST required")
		return
	}
	body, err := acn.ReadBody(r)
	if err != nil {
		acn.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}
	var req JoinRequest
	if err := json.Unmarshal(body, &req); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid join request")
		return
	}

	m.mu.Lock()
	if m.cluster == nil {
		m.mu.Unlock()
		acn.WriteError(w, http.StatusNotFound, "this node is not part of a cluster")
		return
	}
	if req.ClusterID != m.cluster.ID {
		m.mu.Unlock()
		acn.WriteError(w, http.StatusForbidden, "join token is for another cluster")
		return
	}
	token, ok := m.tokens[req.TokenID]
	if !ok || !token.Valid(req.Secret, time.Now()) {
		m.mu.Unlock()
		acn.WriteError(w, http.StatusForbidden, "join token is invalid or expired")
		return
	}
	node := req.Node
	node.Name = sanitizeName(node.Name)
	if node.ID == "" || node.ID == m.opt.NodeID || node.Name == "" {
		m.mu.Unlock()
		acn.WriteError(w, http.StatusBadRequest, "invalid node record")
		return
	}
	if _, err := acn.DecodePublicKey(node.PublicKey); err != nil {
		m.mu.Unlock()
		acn.WriteError(w, http.StatusBadRequest, "invalid node public key")
		return
	}
	node.AdvertiseURL = strings.TrimRight(strings.TrimSpace(node.AdvertiseURL), "/")
	if node.AdvertiseURL != "" && !strings.HasPrefix(node.AdvertiseURL, "http://") && !strings.HasPrefix(node.AdvertiseURL, "https://") {
		m.mu.Unlock()
		acn.WriteError(w, http.StatusBadRequest, "invalid node URL")
		return
	}
	now := time.Now().Unix()
	node.Removed = false
	node.AdminState = AdminStateNormal
	node.Joined = now
	node.Updated = nextVersion(0)
	node.LastSeen = now
	node.TunnelVia = ""
	if node.AdvertiseURL == "" {
		node.TunnelVia = m.opt.NodeID
	}
	m.nodes[node.ID] = &node
	m.store.saveNode(&node)
	token.Uses++
	m.store.saveJoinToken(token)
	resp := JoinResponse{Cluster: *m.cluster, Nodes: m.allRecordsLocked(), Via: m.opt.NodeID}
	peers := m.peerIDsLocked()
	m.mu.Unlock()

	logger.PrintAndLog("Cluster", "Node "+node.Name+" ("+node.ID+") joined the cluster", nil)
	acn.WriteJSON(w, resp)

	others := []string{}
	for _, id := range peers {
		if id != node.ID {
			others = append(others, id)
		}
	}
	go m.broadcast(others, acn.BasePath+"/members/sync", SyncRequest{Nodes: m.snapshotRecords()}, 15*time.Second)
}

func (m *Manager) handleHeartbeat(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var req HeartbeatRequest
	if err := json.Unmarshal(body, &req); err != nil || req.Node.ID != sender.NodeID {
		acn.WriteError(w, http.StatusBadRequest, "invalid heartbeat")
		return
	}
	req.Node.LastSeen = time.Now().Unix()
	m.mergeNodes([]NodeRecord{req.Node})
	m.markSeen(sender.NodeID)
	acn.WriteJSON(w, HeartbeatResponse{Nodes: m.snapshotRecords(), Time: time.Now().Unix()})
}

func (m *Manager) handleMembers(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	m.markSeen(sender.NodeID)
	acn.WriteJSON(w, SyncRequest{Nodes: m.snapshotRecords()})
}

func (m *Manager) handleSync(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var req SyncRequest
	if err := json.Unmarshal(body, &req); err != nil {
		acn.WriteError(w, http.StatusBadRequest, "invalid sync payload")
		return
	}
	m.markSeen(sender.NodeID)
	m.mergeNodes(req.Nodes)
	acn.WriteJSON(w, map[string]bool{"ok": true})
}

func (m *Manager) handleLeave(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	m.mu.Lock()
	rec, ok := m.nodes[sender.NodeID]
	if ok {
		rec.Removed = true
		rec.Updated = nextVersion(rec.Updated)
		m.store.saveNode(rec)
	}
	m.mu.Unlock()
	if ok {
		logger.PrintAndLog("Cluster", "Node "+rec.Name+" ("+rec.ID+") left the cluster", nil)
	}
	acn.WriteJSON(w, map[string]bool{"ok": true})
}

func (m *Manager) handleEvict(w http.ResponseWriter, r *http.Request, sender *acn.SignedIdentity, body []byte) {
	var req NodeIDRequest
	if err := json.Unmarshal(body, &req); err != nil || req.NodeID != m.opt.NodeID {
		acn.WriteError(w, http.StatusBadRequest, "evict notice is not for this node")
		return
	}
	acn.WriteJSON(w, map[string]bool{"ok": true})
	logger.PrintAndLog("Cluster", "Removed from the cluster by node "+sender.NodeID, nil)
	go m.wipeLocalState()
}
