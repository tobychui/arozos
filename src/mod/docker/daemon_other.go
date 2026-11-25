//go:build !linux

package docker

import (
	"os"
	"path/filepath"

	"imuslab.com/arozos/mod/info/logger"
)

// daemonConfigPath returns the daemon.json location for non-Linux hosts. Docker
// Desktop (macOS / Windows) keeps the daemon config under the user's ~/.docker
// directory rather than a system path.
func daemonConfigPath() (out0 string) {
	defer logger.Out1(logger.In0("docker", "daemonConfigPath"), &out0)
	home, err := os.UserHomeDir()
	if err != nil {
		logger.DebugErr("docker", err)
		// Fall back to a relative path; the editability probe will simply
		// report it as not editable when the directory is unavailable.
		return filepath.Join(".docker", "daemon.json")
	}
	return filepath.Join(home, ".docker", "daemon.json")
}
