package docker

/*
	manager.go

	Core DockerManager type and its constructor. Mirrors the constructor-error
	pattern used by mod/disk/raid (NewRaidManager): NewDockerManager returns a
	non-nil error whenever Docker is not actually usable on this host (CLI
	missing or daemon unreachable), so the caller in src/docker.go can leave the
	package-level dockerManager nil and skip registering any endpoints/UI — the
	exact same shape as `if raidManager != nil { ... }`.

	Everything in this package shells out to the locally installed `docker` CLI
	rather than importing the Docker Engine SDK, matching how the project already
	wraps lsblk / smartctl / mdadm.
*/

import (
	"bytes"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"os/exec"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

type Options struct {
	Logger       *logger.Logger //System logger (kept for API symmetry with other managers)
	StackBaseDir string         //Base directory for compose stack storage, e.g. "./system/docker/stacks"
}

type DockerManager struct {
	Options          *Options
	composeAvailable bool   //Whether `docker compose` v2 plugin is usable
	composeVersion   string //Compose plugin version string, empty if unavailable
	serverVersion    string //Cached docker engine version from construction-time detection
}

// NewDockerManager probes the host for a usable Docker installation and returns
// a manager only when the CLI is present AND the daemon is reachable. A non-nil
// error means Docker management should stay disabled on this host.
func NewDockerManager(options Options) (*DockerManager, error) {
	if err := detectDockerCLI(); err != nil {
		return nil, err
	}

	serverVersion, err := detectDockerEngine()
	if err != nil {
		return nil, err
	}

	//Compose detection is non-fatal: the engine is still usable for plain
	//container/image management even when the compose plugin is missing.
	composeVersion, composeErr := detectComposePlugin()

	manager := &DockerManager{
		Options:          &options,
		composeAvailable: composeErr == nil,
		composeVersion:   composeVersion,
		serverVersion:    serverVersion,
	}

	if options.StackBaseDir != "" {
		os.MkdirAll(options.StackBaseDir, 0755)
	}

	return manager, nil
}

// ComposeAvailable reports whether the docker compose v2 plugin was detected.
func (d *DockerManager) ComposeAvailable() bool {
	return d.composeAvailable
}

// GetEngineStatus returns the current engine capability summary. The cached
// construction-time values are used as a fallback; a fresh `docker version`
// call enriches them with API version / OS / arch when the daemon answers.
func (d *DockerManager) GetEngineStatus() EngineStatus {
	status := EngineStatus{
		Available:        true,
		ServerVersion:    d.serverVersion,
		ComposeAvailable: d.composeAvailable,
		ComposeVersion:   d.composeVersion,
	}

	out, err := runDocker("version", "--format", "{{json .}}")
	if err == nil {
		if parsed, perr := parseDockerVersionJSON(out); perr == nil {
			if parsed.Server.Version != "" {
				status.ServerVersion = parsed.Server.Version
			}
			status.APIVersion = parsed.Server.APIVersion
			status.OS = parsed.Server.Os
			status.Arch = parsed.Server.Arch
		}
	}

	return status
}

// HandleEngineStatus serves the engine status as JSON (admin-only endpoint,
// registered in src/docker.go).
func (d *DockerManager) HandleEngineStatus(w http.ResponseWriter, r *http.Request) {
	status := d.GetEngineStatus()
	js, _ := json.Marshal(status)
	utils.SendJSONResponse(w, string(js))
}

// parseDockerVersionJSON unmarshals `docker version --format "{{json .}}"`
// output. Factored out as a pure function so it is unit-testable without a
// running docker daemon.
func parseDockerVersionJSON(out []byte) (dockerVersionOutput, error) {
	var parsed dockerVersionOutput
	err := json.Unmarshal(out, &parsed)
	return parsed, err
}

// runDocker runs the docker CLI with the given args and returns stdout. On a
// non-zero exit the trimmed stderr (or the raw exec error if stderr was empty)
// is returned as the error so callers can surface a meaningful message.
func runDocker(args ...string) ([]byte, error) {
	cmd := exec.Command("docker", args...)
	var stdout, stderr bytes.Buffer
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err := cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return stdout.Bytes(), errors.New(msg)
	}
	return stdout.Bytes(), nil
}
