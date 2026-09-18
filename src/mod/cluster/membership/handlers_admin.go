package membership

/*
	ArozOS Cluster - admin (System Settings) endpoints

	These handlers are mounted by the core under /system/cluster/* through the
	permission router with AdminOnly set, so they never check auth themselves.
*/

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"imuslab.com/arozos/mod/cluster/acn"
	"imuslab.com/arozos/mod/utils"
)

func sendJSON(w http.ResponseWriter, v interface{}) {
	js, _ := json.Marshal(v)
	utils.SendJSONResponse(w, string(js))
}

// HandleStatus returns the whole cluster picture for the settings page.
func (m *Manager) HandleStatus(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, m.Status())
}

// HandleCreate creates a new cluster with this node as first member.
func (m *Manager) HandleCreate(w http.ResponseWriter, r *http.Request) {
	name, err := utils.PostPara(r, "name")
	if err != nil {
		utils.SendErrorResponse(w, "cluster name required")
		return
	}
	info, err := m.CreateCluster(name)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, info)
}

// HandleJoin joins the cluster described by a pasted join token.
func (m *Manager) HandleJoin(w http.ResponseWriter, r *http.Request) {
	token, err := utils.PostPara(r, "token")
	if err != nil {
		utils.SendErrorResponse(w, "join token required")
		return
	}
	info, err := m.JoinCluster(token)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, info)
}

// HandleLeave leaves the current cluster.
func (m *Manager) HandleLeave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "POST required")
		return
	}
	if err := m.LeaveCluster(); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleConfig reads (GET) or updates (POST) the local node configuration.
func (m *Manager) HandleConfig(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		sendJSON(w, m.Config())
		return
	}
	cfg := m.Config()
	if name, err := utils.PostPara(r, "name"); err == nil {
		cfg.Name = name
	}
	if url, err := utils.PostPara(r, "url"); err == nil {
		cfg.AdvertiseURL = url
	} else if r.PostFormValue("url") == "" && r.PostForm.Has("url") {
		cfg.AdvertiseURL = ""
	}
	if via, err := utils.PostPara(r, "tunnelvia"); err == nil {
		cfg.TunnelVia = via
	} else if r.PostForm.Has("tunnelvia") {
		cfg.TunnelVia = ""
	}
	if insecure, err := utils.PostBool(r, "insecure"); err == nil {
		cfg.InsecureTLS = insecure
	}
	if err := m.UpdateConfig(cfg); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, m.Config())
}

// HandleTestURL checks that a URL reaches THIS node's ACN endpoint, which is
// how an admin validates the advertised URL before saving it.
func (m *Manager) HandleTestURL(w http.ResponseWriter, r *http.Request) {
	url, err := utils.PostPara(r, "url")
	if err != nil {
		utils.SendErrorResponse(w, "url required")
		return
	}
	url = strings.TrimRight(strings.TrimSpace(url), "/")
	if !strings.HasPrefix(url, "http://") && !strings.HasPrefix(url, "https://") {
		utils.SendErrorResponse(w, "URL must start with http:// or https://")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	start := time.Now()
	resp, err := m.transport.DoURL(ctx, url, http.MethodGet, acn.BasePath+"/hello", nil, false)
	if err != nil {
		utils.SendErrorResponse(w, "unreachable: "+err.Error())
		return
	}
	var hello acn.HelloResponse
	if resp.Status != http.StatusOK || json.Unmarshal(resp.Body, &hello) != nil || !hello.ACN {
		utils.SendErrorResponse(w, "the URL answered but it is not an ArozOS cluster endpoint")
		return
	}
	sendJSON(w, map[string]interface{}{
		"ok":        true,
		"latencyMs": time.Since(start).Milliseconds(),
		"version":   hello.Version,
		"inCluster": hello.InCluster,
	})
}

// HandleTokenNew issues a join token. Optional ttl in hours (default 24).
func (m *Manager) HandleTokenNew(w http.ResponseWriter, r *http.Request) {
	ttl := 24 * time.Hour
	if hours, err := utils.PostInt(r, "ttl"); err == nil && hours > 0 && hours <= 24*30 {
		ttl = time.Duration(hours) * time.Hour
	}
	encoded, token, err := m.NewJoinToken(ttl)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, map[string]interface{}{"token": encoded, "id": token.ID, "expires": token.Expires})
}

// HandleTokenList lists active join tokens.
func (m *Manager) HandleTokenList(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, m.ListJoinTokens())
}

// HandleTokenRevoke deletes a join token.
func (m *Manager) HandleTokenRevoke(w http.ResponseWriter, r *http.Request) {
	id, err := utils.PostPara(r, "id")
	if err != nil {
		utils.SendErrorResponse(w, "token id required")
		return
	}
	if err := m.RevokeJoinToken(id); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleNodeRemove evicts a member.
func (m *Manager) HandleNodeRemove(w http.ResponseWriter, r *http.Request) {
	id, err := utils.PostPara(r, "id")
	if err != nil {
		utils.SendErrorResponse(w, "node id required")
		return
	}
	if err := m.RemoveNode(id); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleNodeState sets a member to normal / maintenance / draining.
func (m *Manager) HandleNodeState(w http.ResponseWriter, r *http.Request) {
	id, err := utils.PostPara(r, "id")
	if err != nil {
		utils.SendErrorResponse(w, "node id required")
		return
	}
	state, _ := utils.PostPara(r, "state")
	if err := m.SetNodeAdminState(id, state); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleNodeProbe pings a member on demand.
func (m *Manager) HandleNodeProbe(w http.ResponseWriter, r *http.Request) {
	id, err := utils.GetPara(r, "id")
	if err != nil {
		utils.SendErrorResponse(w, "node id required")
		return
	}
	sendJSON(w, m.ProbeNode(id))
}

// HandleCapabilities returns (and with refresh=true re-detects) the local manifest.
func (m *Manager) HandleCapabilities(w http.ResponseWriter, r *http.Request) {
	if refresh, _ := utils.GetBool(r, "refresh"); refresh {
		sendJSON(w, m.RefreshCapabilities())
		return
	}
	sendJSON(w, m.Status().Local.Capabilities)
}

// HandleNodes returns just the member list, handy for other settings pages.
func (m *Manager) HandleNodes(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, m.NodeViews())
}

// RegisterAdminRoutes mounts every admin handler on the given register
// function (typically a permission router's HandleFunc).
func (m *Manager) RegisterAdminRoutes(register func(pattern string, handler func(http.ResponseWriter, *http.Request))) {
	register("/system/cluster/status", m.HandleStatus)
	register("/system/cluster/create", m.HandleCreate)
	register("/system/cluster/join", m.HandleJoin)
	register("/system/cluster/leave", m.HandleLeave)
	register("/system/cluster/config", m.HandleConfig)
	register("/system/cluster/testurl", m.HandleTestURL)
	register("/system/cluster/token/new", m.HandleTokenNew)
	register("/system/cluster/token/list", m.HandleTokenList)
	register("/system/cluster/token/revoke", m.HandleTokenRevoke)
	register("/system/cluster/node/remove", m.HandleNodeRemove)
	register("/system/cluster/node/state", m.HandleNodeState)
	register("/system/cluster/node/probe", m.HandleNodeProbe)
	register("/system/cluster/nodes", m.HandleNodes)
	register("/system/cluster/capabilities", m.HandleCapabilities)
}
