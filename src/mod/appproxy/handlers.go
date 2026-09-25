package appproxy

import (
	"encoding/json"
	"net/http"

	"imuslab.com/arozos/mod/utils"
)

/*
	handlers.go

	HTTP API. The core registers the admin handlers behind an admin-only
	permission router and the user handlers behind a logged-in router.

	Admin (full records, create / edit / delete / probe):
		/system/appproxy/admin/list
		/system/appproxy/admin/save      POST data=<Endpoint JSON>, create=true|false
		/system/appproxy/admin/delete    POST slug
		/system/appproxy/admin/probe     target, tls, skipverify, image, slug

	User (only what launching needs, only apps the user may open):
		/system/appproxy/apps
		/system/appproxy/launch          slug
*/

// AppInfo is the simplified view of an app a normal user gets
type AppInfo struct {
	Slug   string
	Name   string
	Icon   string
	URL    string //Relative to the ArozOS root, always app/<slug>/
	OpenIn string
	Width  int
	Height int
}

// AdminAppInfo is an endpoint with its runtime counters
type AdminAppInfo struct {
	Endpoint
	AppOrigin string
	Stats     Stats
}

func toAppInfo(ep Endpoint) AppInfo {
	return AppInfo{
		Slug:   ep.Slug,
		Name:   ep.Name,
		Icon:   ep.Icon,
		URL:    "app/" + ep.Slug + "/",
		OpenIn: ep.OpenIn,
		Width:  ep.Width,
		Height: ep.Height,
	}
}

func sendJSON(w http.ResponseWriter, v interface{}) {
	js, err := json.Marshal(v)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendJSONResponse(w, string(js))
}

// HandleUserApps lists the apps the requesting user may open
func (m *Manager) HandleUserApps(w http.ResponseWriter, r *http.Request) {
	id := m.opts.ResolveUser(w, r)
	if id == nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	apps := []AppInfo{}
	for _, ep := range m.AccessibleBy(id) {
		apps = append(apps, toAppInfo(ep))
	}
	sendJSON(w, map[string]interface{}{
		"Apps":    apps,
		"IsAdmin": id.IsAdmin,
	})
}

// HandleLaunch returns how a desktop shortcut should open an app
func (m *Manager) HandleLaunch(w http.ResponseWriter, r *http.Request) {
	id := m.opts.ResolveUser(w, r)
	if id == nil {
		utils.SendErrorResponse(w, "User not logged in")
		return
	}
	slug, err := utils.GetPara(r, "slug")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid app given")
		return
	}
	ep, ok := m.Get(slug)
	if !ok || !ep.CanAccess(id) {
		utils.SendErrorResponse(w, "This app no longer exists or you do not have access to it")
		return
	}
	sendJSON(w, toAppInfo(ep))
}

// HandleAdminList lists every endpoint with its counters
func (m *Manager) HandleAdminList(w http.ResponseWriter, r *http.Request) {
	results := []AdminAppInfo{}
	for _, ep := range m.List() {
		info := AdminAppInfo{Endpoint: ep, Stats: m.Stats(ep.Slug)}
		if ep.Mode == ModeSubdomain {
			info.AppOrigin = ep.AppOrigin()
		}
		results = append(results, info)
	}
	sendJSON(w, results)
}

// HandleAdminSave creates or updates an endpoint
func (m *Manager) HandleAdminSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "POST required")
		return
	}
	data, err := utils.PostPara(r, "data")
	if err != nil {
		utils.SendErrorResponse(w, "Missing app data")
		return
	}
	ep := Endpoint{}
	if err := json.Unmarshal([]byte(data), &ep); err != nil {
		utils.SendErrorResponse(w, "Invalid app data")
		return
	}
	create, _ := utils.PostBool(r, "create")

	if ep.Mode == ModeSubdomain && ep.PortalOrigin == "" {
		ep.PortalOrigin = requestScheme(r) + "://" + r.Host
	}
	username := ""
	if id := m.opts.ResolveUser(w, r); id != nil {
		username = id.Username
	}

	saved, err := m.Save(ep, create, username, r.Host)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	action := "Updated"
	if create {
		action = "Published"
	}
	m.opts.Log(action+" container app "+saved.Name+" ("+saved.Mode+" mode) -> "+saved.Target, nil)
	sendJSON(w, saved)
}

// HandleAdminDelete removes an endpoint
func (m *Manager) HandleAdminDelete(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "POST required")
		return
	}
	slug, err := utils.PostPara(r, "slug")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid app given")
		return
	}
	if err := m.Delete(slug); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	m.opts.Log("Removed container app "+slug, nil)
	utils.SendOK(w)
}

// HandleAdminProbe analyses an upstream and recommends a mode
func (m *Manager) HandleAdminProbe(w http.ResponseWriter, r *http.Request) {
	target, err := utils.GetPara(r, "target")
	if err != nil {
		utils.SendErrorResponse(w, "Invalid target given")
		return
	}
	targetTLS, _ := utils.GetBool(r, "tls")
	skipVerify, _ := utils.GetBool(r, "skipverify")
	image, _ := utils.GetPara(r, "image")
	slug, _ := utils.GetPara(r, "slug")
	if !ValidSlug(slug) {
		slug = "<slug>"
	}
	sendJSON(w, m.Probe(target, targetTLS, skipVerify, image, slug))
}
