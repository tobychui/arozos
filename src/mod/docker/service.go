package docker

/*
	service.go

	Docker daemon lifecycle control via the host init system. The actual
	implementation is platform-specific (service_linux.go uses systemctl;
	service_other.go returns "unsupported"). These actions require ArozOS to run
	with sufficient privilege (root) to manage the docker unit.

	Stopping or restarting the daemon stops every running container, so the
	settings UI gates those actions behind the standard re-auth confirmation.
*/

import (
	"encoding/json"
	"net/http"

	"imuslab.com/arozos/mod/utils"
)

// ServiceStatus describes the docker daemon's init-system service state.
type ServiceStatus struct {
	Available bool   `json:"available"`         // service control usable on this host
	Active    bool   `json:"active"`            // daemon currently running
	Enabled   bool   `json:"enabled"`           // starts automatically on boot
	State     string `json:"state"`             // raw is-active value (active/inactive/failed...)
	Message   string `json:"message,omitempty"` // explanation when not available
}

// validServiceActions is the whitelist of permitted service operations.
var validServiceActions = map[string]bool{
	"start":   true,
	"stop":    true,
	"restart": true,
	"enable":  true,
	"disable": true,
}

// HandleServiceStatus serves the docker service status as JSON.
func (d *DockerManager) HandleServiceStatus(w http.ResponseWriter, r *http.Request) {
	js, _ := json.Marshal(dockerServiceStatus())
	utils.SendJSONResponse(w, string(js))
}

// HandleServiceAction performs a whitelisted service action (POST: action).
func (d *DockerManager) HandleServiceAction(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	action, err := utils.PostPara(r, "action")
	if err != nil || !validServiceActions[action] {
		utils.SendErrorResponse(w, "invalid or missing action")
		return
	}
	if err := dockerServiceAction(action); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}
