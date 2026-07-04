//go:build windows

package docker

/*
	console_windows.go

	PTY-backed `docker exec` is not wired up for Windows hosts in this version
	(ConPTY support via creack/pty varies by Windows build). This stub keeps the
	package compiling on Windows and returns a clear runtime error instead, the
	same pattern wifi_windows.go uses for unsupported operations.
*/

import "errors"

// startDockerExecPTY is unsupported on Windows hosts.
func startDockerExecPTY(ref, shell string) (ptySession, error) {
	return nil, errors.New("interactive container console is not supported when ArozOS runs on a Windows host")
}
