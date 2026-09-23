package storage

/*
	Storage admin endpoints (/system/cluster/storage/*, mounted admin-only).
*/

import (
	"encoding/json"
	"net/http"
	"sort"

	"imuslab.com/arozos/mod/cluster/metadata"
	"imuslab.com/arozos/mod/utils"
)

func sendJSON(w http.ResponseWriter, v interface{}) {
	js, _ := json.Marshal(v)
	utils.SendJSONResponse(w, string(js))
}

// VolumeView is a volume plus derived figures for the UI.
type VolumeView struct {
	metadata.Volume
	NodeName string `json:"nodeName"`
	Local    bool   `json:"local"`
	Files    int    `json:"files"`
	Bytes    int64  `json:"bytes"`
	Online   bool   `json:"online"`
}

// StatusView is the storage picture for the settings page.
type StatusView struct {
	Ready        bool         `json:"ready"`
	AutoReadOnly bool         `json:"autoReadOnly"` //nearly full volumes become read only
	Volumes      []VolumeView `json:"volumes"`
	LocalRoots   []RootView   `json:"localRoots"`
	Sessions     int          `json:"sessions"`
}

// RootView is a local drive the admin may contribute a folder from.
type RootView struct {
	UUID string `json:"uuid"`
	Path string `json:"path"`
}

// Status builds the storage status.
func (s *Service) Status() StatusView {
	st := StatusView{Ready: s.Ready(), AutoReadOnly: s.AutoReadOnly(), Volumes: []VolumeView{}, LocalRoots: []RootView{}}
	me := s.m.NodeID()
	for _, v := range s.meta.Volumes() {
		if v.Removed {
			continue
		}
		view := VolumeView{Volume: v, NodeName: s.m.NodeName(v.NodeID), Local: v.NodeID == me, Online: usable(s.nodeState(v.NodeID))}
		view.Files, view.Bytes = s.VolumeStats(v.ID)
		st.Volumes = append(st.Volumes, view)
	}
	sort.Slice(st.Volumes, func(i, j int) bool {
		if st.Volumes[i].Local != st.Volumes[j].Local {
			return st.Volumes[i].Local
		}
		return st.Volumes[i].Name < st.Volumes[j].Name
	})
	for id, root := range s.opt.LocalRoots() {
		st.LocalRoots = append(st.LocalRoots, RootView{UUID: id, Path: root})
	}
	sort.Slice(st.LocalRoots, func(i, j int) bool { return st.LocalRoots[i].UUID < st.LocalRoots[j].UUID })
	s.sessMu.Lock()
	st.Sessions = len(s.sessions)
	s.sessMu.Unlock()
	return st
}

// HandleStatus returns volumes and local drives.
func (s *Service) HandleStatus(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, s.Status())
}

// HandleVolumeAdd contributes a folder: fsh=<uuid>&path=<subpath>&name=
func (s *Service) HandleVolumeAdd(w http.ResponseWriter, r *http.Request) {
	fsh, err := utils.PostPara(r, "fsh")
	if err != nil {
		utils.SendErrorResponse(w, "drive required")
		return
	}
	sub, err := utils.PostPara(r, "path")
	if err != nil {
		utils.SendErrorResponse(w, "folder path required")
		return
	}
	name, _ := utils.PostPara(r, "name")
	vol, err := s.AddVolume(fsh, sub, name)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	sendJSON(w, vol)
}

// HandleVolumeRemove stops contributing a folder.
func (s *Service) HandleVolumeRemove(w http.ResponseWriter, r *http.Request) {
	id, err := utils.PostPara(r, "id")
	if err != nil {
		utils.SendErrorResponse(w, "volume id required")
		return
	}
	if err := s.RemoveVolume(id); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleVolumeReadOnly toggles placement on a volume: id=&readonly=true|false
func (s *Service) HandleVolumeReadOnly(w http.ResponseWriter, r *http.Request) {
	id, err := utils.PostPara(r, "id")
	if err != nil {
		utils.SendErrorResponse(w, "volume id required")
		return
	}
	ro, _ := utils.PostBool(r, "readonly")
	if err := s.SetVolumeReadOnly(id, ro); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleRescan reconciles every local volume now.
func (s *Service) HandleRescan(w http.ResponseWriter, r *http.Request) {
	sendJSON(w, s.ReconcileAll())
}

// RegisterAdminRoutes mounts the admin handlers.
func (s *Service) RegisterAdminRoutes(register func(pattern string, handler func(http.ResponseWriter, *http.Request))) {
	register("/system/cluster/storage/status", s.HandleStatus)
	register("/system/cluster/storage/volume/add", s.HandleVolumeAdd)
	register("/system/cluster/storage/volume/remove", s.HandleVolumeRemove)
	register("/system/cluster/storage/volume/readonly", s.HandleVolumeReadOnly)
	register("/system/cluster/storage/rescan", s.HandleRescan)
	register("/system/cluster/storage/autoreadonly", s.HandleAutoReadOnly)
}

// HandleAutoReadOnly reads (GET) or sets (POST enabled=true|false) whether
// nearly full volumes are made read only automatically.
func (s *Service) HandleAutoReadOnly(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost {
		raw, err := utils.PostPara(r, "enabled")
		if err != nil || (raw != "true" && raw != "false") {
			utils.SendErrorResponse(w, "enabled must be true or false")
			return
		}
		if err := s.SetAutoReadOnly(raw == "true"); err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
	}
	sendJSON(w, map[string]bool{"enabled": s.AutoReadOnly()})
}
