//go:build !linux

package docker

/*
	service_other.go

	Docker daemon service control is only implemented for Linux/systemd hosts.
	On other platforms (Windows / macOS, typically Docker Desktop) the daemon is
	managed by that platform's own tooling, so these return a clear unsupported
	state rather than attempting anything.
*/

import "errors"

const serviceUnsupportedMsg = "Docker daemon service control is only available on Linux (systemd) hosts"

func dockerServiceStatus() ServiceStatus {
	return ServiceStatus{Message: serviceUnsupportedMsg}
}

func dockerServiceAction(action string) error {
	return errors.New(serviceUnsupportedMsg)
}
