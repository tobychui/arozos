//go:build linux

package docker

import "imuslab.com/arozos/mod/info/logger"

// daemonConfigPath returns the standard Docker Engine daemon config path on
// Linux. This is a fixed, well-known OS location for the docker daemon.
func daemonConfigPath() string {
	logger.DebugTrace("docker", "daemonConfigPath")
	return "/etc/docker/daemon.json" // arozos-lint-ignore: fixed Linux docker daemon config location, isolated in a linux-only build-tagged file
}
