//go:build !linux && !darwin && !freebsd

package docker

/*
	console_other.go

	PTY-backed `docker exec` is only wired up for the PTY-capable hosts handled
	by console_unix.go (Linux / macOS / FreeBSD). On every other platform —
	Windows (ConPTY support via creack/pty varies by Windows build) and any GOOS
	without a supported pseudo-terminal — this catch-all stub keeps the package
	compiling and returns a clear runtime error instead, the same pattern
	wifi_windows.go uses for unsupported operations.
*/

import "errors"

// startDockerExecPTY is unsupported on this host platform.
func startDockerExecPTY(ref, shell string) (ptySession, error) {
	return nil, errors.New("interactive container console is not supported when ArozOS runs on this host platform")
}
