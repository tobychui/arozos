package docker

/*
	prune.go

	Docker disk usage reporting (`docker system df`) and reclamation
	(`docker system prune`). Prune is destructive — it removes stopped
	containers, unused networks, dangling images and (optionally) unused volumes
	— so the settings UI gates it behind the standard re-auth confirmation flow.
*/

import (
	"encoding/json"
	"net/http"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

// SystemDF returns the human-readable `docker system df` output.
func (d *DockerManager) SystemDF() (out0 string, out1 error) {
	defer logger.Out2(logger.In1("docker", "DockerManager.SystemDF", "d", d), &out0, &out1)
	out, err := runDocker("system", "df")
	return string(out), err
}

// SystemPrune reclaims unused docker data. When volumes is true, unused volumes
// are pruned too (additionally destructive).
func (d *DockerManager) SystemPrune(volumes bool) (out0 string, out1 error) {
	defer logger.Out2(logger.In2("docker", "DockerManager.SystemPrune", "d", d, "volumes", volumes), &out0, &out1)
	args := []string{"system", "prune", "-f"}
	if volumes {
		args = append(args, "--volumes")
	}
	out, err := runDocker(args...)
	return string(out), err
}

/* ---------- HTTP handlers ---------- */

// HandleDiskUsage serves `docker system df` output as JSON {output}.
func (d *DockerManager) HandleDiskUsage(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("docker", "DockerManager.HandleDiskUsage", "d", d, "r", r))
	out, err := d.SystemDF()
	if err != nil {
		logger.DebugErr("docker", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	js, _ := json.Marshal(map[string]string{"output": out})
	utils.SendJSONResponse(w, string(js))
}

// HandlePrune runs `docker system prune` (POST: volumes bool) and returns the
// reclamation output as JSON {output}.
func (d *DockerManager) HandlePrune(w http.ResponseWriter, r *http.Request) {
	defer logger.Out0(logger.In2("docker", "DockerManager.HandlePrune", "d", d, "r", r))
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	volumes, _ := utils.PostBool(r, "volumes")
	out, err := d.SystemPrune(volumes)
	if err != nil {
		logger.DebugErr("docker", err)
		utils.SendErrorResponse(w, err.Error())
		return
	}
	js, _ := json.Marshal(map[string]string{"output": out})
	utils.SendJSONResponse(w, string(js))
}
