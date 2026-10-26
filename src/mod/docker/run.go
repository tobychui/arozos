package docker

/*
	run.go

	Direct single-image run/create (the "run an online-pulled image without
	writing compose YAML" path) plus live container config changes (docker
	update / rename) and recreate.

	Security: the docker argv is built element-by-element from a validated
	RunConfig and passed to exec.Command as discrete arguments — there is no
	shell line, so port/volume/env values cannot inject extra flags or commands.
	Each field is additionally format-validated so a value cannot be mistaken for
	a docker flag.

	Note on bind mounts: a volume's host path is a REAL path on the Docker host,
	resolved by the daemon, entirely outside ArozOS's virtual filesystem sandbox.
	That is by design — an admin running containers already has host-level reach
	(see the security section of the feature plan) — so we validate the format
	but deliberately do not try to sandbox/rewrite host paths.
*/

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"

	"imuslab.com/arozos/mod/utils"
)

var (
	portMapRegex     = regexp.MustCompile(`^(\d{1,3}(\.\d{1,3}){3}:)?\d{1,5}(:\d{1,5})?(/(tcp|udp|sctp))?$`)
	envVarRegex      = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*=[^\n\r]*$`)
	networkNameRegex = regexp.MustCompile(`^[a-zA-Z0-9][a-zA-Z0-9_.-]*$`)
	restartPolicyRe  = regexp.MustCompile(`^(no|always|unless-stopped|on-failure(:\d+)?)$`)
	memoryLimitRegex = regexp.MustCompile(`^\d+[bkmgBKMG]?$`)
	cpuLimitRegex    = regexp.MustCompile(`^\d+(\.\d+)?$`)
)

// RunConfig is the form-supplied configuration for launching one container.
type RunConfig struct {
	Image         string   `json:"image"`
	Name          string   `json:"name"`
	Ports         []string `json:"ports"`   // "8080:80", "127.0.0.1:443:443/tcp"
	Volumes       []string `json:"volumes"` // "src:dst[:mode]" — dst must be absolute
	Env           []string `json:"env"`     // "KEY=value"
	RestartPolicy string   `json:"restartPolicy"`
	Network       string   `json:"network"`
	Command       string   `json:"command"` // optional command override, whitespace-split
}

// UpdateConfig holds the live-updatable container settings.
type UpdateConfig struct {
	Ref           string `json:"id"`
	RestartPolicy string `json:"restartPolicy"`
	Memory        string `json:"memory"` // e.g. "512m"
	CPUs          string `json:"cpus"`   // e.g. "1.5"
}

// validateVolume checks a bind/volume spec format without sandboxing host paths.
func validateVolume(v string) error {
	if strings.HasPrefix(v, "-") || strings.ContainsAny(v, "\n\r") {
		return errors.New("invalid volume: " + v)
	}
	parts := strings.Split(v, ":")
	if len(parts) < 2 || len(parts) > 3 {
		return errors.New("invalid volume format (want src:dst[:mode]): " + v)
	}
	if !strings.HasPrefix(parts[1], "/") {
		return errors.New("container path must be absolute: " + v)
	}
	return nil
}

// buildRunArgs assembles the docker argv for `run` (create=false) or `create`
// (create=true). Pure function so it is fully unit-testable without a daemon.
func buildRunArgs(cfg RunConfig, create bool) ([]string, error) {
	if err := validateImageRef(cfg.Image); err != nil {
		return nil, err
	}

	verb := "run"
	if create {
		verb = "create"
	}
	args := []string{verb}

	//API-launched containers always run in the background; an attached run
	//would block the request.
	if !create {
		args = append(args, "-d")
	}

	if cfg.Name != "" {
		if !containerRefRegex.MatchString(cfg.Name) {
			return nil, errors.New("invalid container name")
		}
		args = append(args, "--name", cfg.Name)
	}

	for _, p := range cfg.Ports {
		p = strings.TrimSpace(p)
		if p == "" {
			continue
		}
		if !portMapRegex.MatchString(p) {
			return nil, fmt.Errorf("invalid port mapping: %s", p)
		}
		args = append(args, "-p", p)
	}

	for _, v := range cfg.Volumes {
		v = strings.TrimSpace(v)
		if v == "" {
			continue
		}
		if err := validateVolume(v); err != nil {
			return nil, err
		}
		args = append(args, "-v", v)
	}

	for _, e := range cfg.Env {
		e = strings.TrimSpace(e)
		if e == "" {
			continue
		}
		if !envVarRegex.MatchString(e) {
			return nil, fmt.Errorf("invalid environment variable (want KEY=value): %s", e)
		}
		args = append(args, "-e", e)
	}

	if cfg.RestartPolicy != "" {
		if !restartPolicyRe.MatchString(cfg.RestartPolicy) {
			return nil, errors.New("invalid restart policy")
		}
		args = append(args, "--restart", cfg.RestartPolicy)
	}

	if cfg.Network != "" {
		if !networkNameRegex.MatchString(cfg.Network) {
			return nil, errors.New("invalid network name")
		}
		args = append(args, "--network", cfg.Network)
	}

	args = append(args, cfg.Image)

	if strings.TrimSpace(cfg.Command) != "" {
		args = append(args, strings.Fields(cfg.Command)...)
	}

	return args, nil
}

// RunContainer launches a container in the background and returns its new ID.
func (d *DockerManager) RunContainer(cfg RunConfig) (string, error) {
	args, err := buildRunArgs(cfg, false)
	if err != nil {
		return "", err
	}
	out, err := runDocker(args...)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// CreateContainer creates (but does not start) a container, returning its ID.
func (d *DockerManager) CreateContainer(cfg RunConfig) (string, error) {
	args, err := buildRunArgs(cfg, true)
	if err != nil {
		return "", err
	}
	out, err := runDocker(args...)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// UpdateContainer applies live config changes (restart policy / memory / cpus).
func (d *DockerManager) UpdateContainer(cfg UpdateConfig) error {
	if err := validateContainerRef(cfg.Ref); err != nil {
		return err
	}
	args := []string{"update"}
	if cfg.RestartPolicy != "" {
		if !restartPolicyRe.MatchString(cfg.RestartPolicy) {
			return errors.New("invalid restart policy")
		}
		args = append(args, "--restart", cfg.RestartPolicy)
	}
	if cfg.Memory != "" {
		if !memoryLimitRegex.MatchString(cfg.Memory) {
			return errors.New("invalid memory limit")
		}
		args = append(args, "--memory", cfg.Memory)
	}
	if cfg.CPUs != "" {
		if !cpuLimitRegex.MatchString(cfg.CPUs) {
			return errors.New("invalid cpu limit")
		}
		args = append(args, "--cpus", cfg.CPUs)
	}
	if len(args) == 1 {
		return errors.New("no updatable fields provided")
	}
	args = append(args, cfg.Ref)
	_, err := runDocker(args...)
	return err
}

// RenameContainer renames a container.
func (d *DockerManager) RenameContainer(ref, newName string) error {
	if err := validateContainerRef(ref); err != nil {
		return err
	}
	if !containerRefRegex.MatchString(newName) {
		return errors.New("invalid new name")
	}
	_, err := runDocker("rename", ref, newName)
	return err
}

// RecreateContainer force-removes oldRef and launches a fresh container from
// cfg. This is destructive (the old container is deleted) and is used for
// settings docker cannot change on a live container (ports, mounts, env).
func (d *DockerManager) RecreateContainer(oldRef string, cfg RunConfig) (string, error) {
	if err := validateContainerRef(oldRef); err != nil {
		return "", err
	}
	//Validate the new config BEFORE removing anything, so a bad config does not
	//leave the host with the old container already deleted.
	if _, err := buildRunArgs(cfg, false); err != nil {
		return "", err
	}
	if _, err := runDocker("rm", "-f", oldRef); err != nil {
		return "", err
	}
	return d.RunContainer(cfg)
}

/* ---------- HTTP handlers ---------- */

// readRunConfig decodes a RunConfig from a JSON request body.
func readRunConfig(r *http.Request) (RunConfig, error) {
	var cfg RunConfig
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return cfg, err
	}
	if err := json.Unmarshal(body, &cfg); err != nil {
		return cfg, errors.New("invalid request body")
	}
	return cfg, nil
}

// HandleContainerRun launches a container from a JSON RunConfig body.
func (d *DockerManager) HandleContainerRun(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	cfg, err := readRunConfig(r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	id, err := d.RunContainer(cfg)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	js, _ := json.Marshal(map[string]string{"id": id})
	utils.SendJSONResponse(w, string(js))
}

// HandleContainerCreate creates (without starting) a container from a JSON body.
func (d *DockerManager) HandleContainerCreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	cfg, err := readRunConfig(r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	id, err := d.CreateContainer(cfg)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	js, _ := json.Marshal(map[string]string{"id": id})
	utils.SendJSONResponse(w, string(js))
}

// HandleContainerUpdate applies live config changes (POST form: id, restartPolicy,
// memory, cpus).
func (d *DockerManager) HandleContainerUpdate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	ref, err := utils.PostPara(r, "id")
	if err != nil {
		utils.SendErrorResponse(w, "missing container id")
		return
	}
	restartPolicy, _ := utils.PostPara(r, "restartPolicy")
	memory, _ := utils.PostPara(r, "memory")
	cpus, _ := utils.PostPara(r, "cpus")
	if err := d.UpdateContainer(UpdateConfig{Ref: ref, RestartPolicy: restartPolicy, Memory: memory, CPUs: cpus}); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleContainerRename renames a container (POST form: id, name).
func (d *DockerManager) HandleContainerRename(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	ref, err := utils.PostPara(r, "id")
	if err != nil {
		utils.SendErrorResponse(w, "missing container id")
		return
	}
	newName, err := utils.PostPara(r, "name")
	if err != nil {
		utils.SendErrorResponse(w, "missing new name")
		return
	}
	if err := d.RenameContainer(ref, newName); err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)
}

// HandleContainerRecreate removes oldId and launches a new container from the
// JSON RunConfig in the body. The old container id is taken from the "oldId"
// query parameter.
func (d *DockerManager) HandleContainerRecreate(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		utils.SendErrorResponse(w, "method not allowed")
		return
	}
	oldRef, err := utils.GetPara(r, "oldId")
	if err != nil {
		utils.SendErrorResponse(w, "missing oldId")
		return
	}
	cfg, err := readRunConfig(r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	id, err := d.RecreateContainer(oldRef, cfg)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	js, _ := json.Marshal(map[string]string{"id": id})
	utils.SendJSONResponse(w, string(js))
}
