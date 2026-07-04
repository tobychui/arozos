package docker

/*
	daemon.go

	Docker daemon configuration (daemon.json) view/edit. The on-disk location is
	resolved per-platform (daemon_linux.go / daemon_other.go). Editing is only
	offered when the arozos process can actually write to the config directory;
	otherwise the config is exposed read-only.

	This feature deliberately does NOT restart the Docker daemon after a change
	(an explicit non-goal) — applying daemon.json requires `systemctl restart
	docker` or equivalent, which the UI tells the admin to run manually.
*/

import (
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"

	"imuslab.com/arozos/mod/utils"
)

// DaemonConfig is the daemon.json view returned to the settings page.
type DaemonConfig struct {
	Path     string `json:"path"`     // resolved daemon.json path for this host
	Content  string `json:"content"`  // current file content ("" if absent)
	Exists   bool   `json:"exists"`   // whether the file currently exists
	Editable bool   `json:"editable"` // whether arozos can write the config dir
}

// daemonConfigSaveRequest is the JSON body for saving daemon.json.
type daemonConfigSaveRequest struct {
	Content string `json:"content"`
}

// daemonConfigEditable reports whether the config directory is writable by the
// arozos process, by creating and removing a probe file.
func daemonConfigEditable(path string) bool {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".arozos-docker-*")
	if err != nil {
		return false
	}
	tmp.Close()
	os.Remove(tmp.Name())
	return true
}

// GetDaemonConfig reads the current daemon.json (if any) and reports editability.
func (d *DockerManager) GetDaemonConfig() DaemonConfig {
	path := daemonConfigPath()
	cfg := DaemonConfig{Path: path}
	if data, err := os.ReadFile(path); err == nil {
		cfg.Content = string(data)
		cfg.Exists = true
	}
	cfg.Editable = daemonConfigEditable(path)
	return cfg
}

// SaveDaemonConfig validates and writes daemon.json. It does NOT restart the
// daemon — callers/UI must surface that the change applies on the next daemon
// restart.
func (d *DockerManager) SaveDaemonConfig(content string) error {
	path := daemonConfigPath()
	if !daemonConfigEditable(path) {
		return errors.New("daemon.json is not editable on this host (insufficient permission)")
	}
	if !json.Valid([]byte(content)) {
		return errors.New("daemon.json must be valid JSON")
	}
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(content), 0644)
}

/* ---------- HTTP handlers ---------- */

// HandleDaemonGet serves the daemon config view as JSON.
func (d *DockerManager) HandleDaemonGet(w http.ResponseWriter, r *http.Request) {
	js, _ := json.Marshal(d.GetDaemonConfig())
	utils.SendJSONResponse(w, string(js))
}

// HandleDaemonSave persists daemon.json (POST JSON: content). Returns a clear
// "not editable" error when the host does not permit it.
func (d *DockerManager) HandleDaemonSave(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	var req daemonConfigSaveRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		utils.SendErrorResponse(w, "invalid request body")
		return
	}
	if err := d.SaveDaemonConfig(req.Content); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}
