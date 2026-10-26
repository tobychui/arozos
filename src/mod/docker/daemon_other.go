//go:build !linux

package docker

import (
	"os"
	"path/filepath"
)

// daemonConfigPath returns the daemon.json location for non-Linux hosts. Docker
// Desktop (macOS / Windows) keeps the daemon config under the user's ~/.docker
// directory rather than a system path.
func daemonConfigPath() string {
	home, err := os.UserHomeDir()
	if err != nil {
		// Fall back to a relative path; the editability probe will simply
		// report it as not editable when the directory is unavailable.
		return filepath.Join(".docker", "daemon.json")
	}
	return filepath.Join(home, ".docker", "daemon.json")
}
