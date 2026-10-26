package docker

/*
	detect.go

	Host capability detection. Three independent checks:

	  1. detectDockerCLI    — is the `docker` binary on PATH at all
	  2. detectDockerEngine — is the daemon actually reachable (the real gate;
	                          the binary can exist while the daemon is stopped or
	                          the current user lacks socket permission)
	  3. detectComposePlugin — is the `docker compose` v2 plugin usable
	                          (independent + non-fatal)

	Only the docker CLI talking to a local daemon is supported. The standalone
	legacy `docker-compose` (v1, the Python binary) is intentionally never probed
	or used as a fallback.
*/

import (
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// detectDockerCLI checks whether the docker client binary is resolvable on PATH.
func detectDockerCLI() error {
	if _, err := exec.LookPath("docker"); err != nil {
		return errors.New("docker CLI not found in system PATH")
	}
	return nil
}

// detectDockerEngine confirms the daemon is reachable by asking it for its
// server version. `docker info` (unlike `docker version` alone) returns a
// non-zero exit when the daemon socket can't be reached, which is exactly the
// "installed but not usable" case we must catch. Returns the server version on
// success.
func detectDockerEngine() (string, error) {
	out, err := runDocker("info", "--format", "{{json .ServerVersion}}")
	if err != nil {
		return "", fmt.Errorf("docker daemon not reachable: %s", err.Error())
	}

	version := strings.TrimSpace(string(out))
	version = strings.Trim(version, "\"")
	if version == "" || version == "null" {
		return "", errors.New("docker daemon not reachable: empty server version")
	}
	return version, nil
}

// detectComposePlugin reports the docker compose v2 plugin version, or an error
// when the plugin is not installed. `docker compose version --short` prints just
// the version number (e.g. "2.20.2").
func detectComposePlugin() (string, error) {
	out, err := runDocker("compose", "version", "--short")
	if err != nil {
		return "", errors.New("docker compose v2 plugin not available")
	}
	return strings.TrimSpace(string(out)), nil
}
