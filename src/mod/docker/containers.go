package docker

/*
	containers.go

	Container listing and lifecycle (start/stop/restart/remove/inspect). Every
	container reference coming from a request is validated against a strict
	charset before it is handed to the docker CLI: because args are passed as
	discrete exec.Command elements there is no shell to inject into, but the
	validation additionally prevents a value like "-x" from being interpreted as
	a docker flag.
*/

import (
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"imuslab.com/arozos/mod/utils"
)

// containerRefRegex matches valid docker container IDs and names. Names cannot
// start with a dash, which also blocks flag-injection through a reference.
var containerRefRegex = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`)

// ContainerInfo mirrors the subset of `docker ps -a --format "{{json .}}"`
// per-line output that the UI consumes. The docker CLI emits every value as a
// string.
type ContainerInfo struct {
	ID         string `json:"ID"`
	Names      string `json:"Names"`
	Image      string `json:"Image"`
	Command    string `json:"Command"`
	State      string `json:"State"`
	Status     string `json:"Status"`
	Ports      string `json:"Ports"`
	CreatedAt  string `json:"CreatedAt"`
	RunningFor string `json:"RunningFor"`
	Size       string `json:"Size"`
}

// validateContainerRef rejects empty or malformed container references.
func validateContainerRef(ref string) error {
	if ref == "" {
		return errors.New("empty container reference")
	}
	if !containerRefRegex.MatchString(ref) {
		return errors.New("invalid container reference")
	}
	return nil
}

// ListContainers returns all containers, running and stopped.
func (d *DockerManager) ListContainers() ([]ContainerInfo, error) {
	out, err := runDocker("ps", "-a", "--no-trunc", "--format", "{{json .}}")
	if err != nil {
		return nil, err
	}
	return parseContainerList(out)
}

// parseContainerList parses the line-delimited JSON of `docker ps`. Malformed
// lines are skipped defensively rather than failing the whole listing.
func parseContainerList(out []byte) ([]ContainerInfo, error) {
	results := []ContainerInfo{}
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		var c ContainerInfo
		if err := json.Unmarshal([]byte(line), &c); err != nil {
			continue
		}
		results = append(results, c)
	}
	return results, nil
}

// simpleContainerAction runs a one-argument docker subcommand (start/stop/
// restart) against a validated container reference.
func (d *DockerManager) simpleContainerAction(action, ref string) error {
	if err := validateContainerRef(ref); err != nil {
		return err
	}
	_, err := runDocker(action, ref)
	return err
}

// RemoveContainer force-removes a container (stopping it first if running).
func (d *DockerManager) RemoveContainer(ref string) error {
	if err := validateContainerRef(ref); err != nil {
		return err
	}
	_, err := runDocker("rm", "-f", ref)
	return err
}

// InspectContainer returns the raw `docker inspect` JSON for one container.
func (d *DockerManager) InspectContainer(ref string) ([]byte, error) {
	if err := validateContainerRef(ref); err != nil {
		return nil, err
	}
	return runDocker("inspect", ref)
}

/* ---------- HTTP handlers (registered admin-only in src/docker.go) ---------- */

// HandleContainerList serves the full container list as JSON.
func (d *DockerManager) HandleContainerList(w http.ResponseWriter, r *http.Request) {
	containers, err := d.ListContainers()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	js, _ := json.Marshal(containers)
	utils.SendJSONResponse(w, string(js))
}

// HandleContainerInspect serves raw inspect JSON for one container.
func (d *DockerManager) HandleContainerInspect(w http.ResponseWriter, r *http.Request) {
	ref, err := utils.GetPara(r, "id")
	if err != nil {
		utils.SendErrorResponse(w, "missing container id")
		return
	}
	out, err := d.InspectContainer(ref)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendJSONResponse(w, string(out))
}

// handleContainerAction is the shared POST handler body for start/stop/restart/
// remove. actionFn performs the work for the validated reference.
func (d *DockerManager) handleContainerAction(w http.ResponseWriter, r *http.Request, actionFn func(ref string) error) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	ref, err := utils.PostPara(r, "id")
	if err != nil {
		utils.SendErrorResponse(w, "missing container id")
		return
	}
	if err := actionFn(ref); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

func (d *DockerManager) HandleContainerStart(w http.ResponseWriter, r *http.Request) {
	d.handleContainerAction(w, r, func(ref string) error { return d.simpleContainerAction("start", ref) })
}

func (d *DockerManager) HandleContainerStop(w http.ResponseWriter, r *http.Request) {
	d.handleContainerAction(w, r, func(ref string) error { return d.simpleContainerAction("stop", ref) })
}

func (d *DockerManager) HandleContainerRestart(w http.ResponseWriter, r *http.Request) {
	d.handleContainerAction(w, r, func(ref string) error { return d.simpleContainerAction("restart", ref) })
}

func (d *DockerManager) HandleContainerRemove(w http.ResponseWriter, r *http.Request) {
	d.handleContainerAction(w, r, d.RemoveContainer)
}
