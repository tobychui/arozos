//go:build linux

package docker

/*
	service_linux.go

	Docker daemon service control on Linux via systemctl. Isolated behind a
	build tag so non-systemd platforms compile against service_other.go.

	These operations require root; when ArozOS is not privileged enough,
	systemctl's own error message is surfaced back to the caller.
*/

import (
	"errors"
	"os/exec"
	"strings"
)

func systemctlAvailable() bool {
	_, err := exec.LookPath("systemctl")
	return err == nil
}

// dockerServiceStatus reports the docker unit's active/enabled state.
func dockerServiceStatus() ServiceStatus {
	st := ServiceStatus{}
	if !systemctlAvailable() {
		st.Message = "systemctl is not available on this host"
		return st
	}
	st.Available = true

	// `is-active` exits non-zero when inactive, but still prints the state on
	// stdout — parse the output rather than relying on the exit code.
	out, _ := exec.Command("systemctl", "is-active", "docker").CombinedOutput()
	st.State = strings.TrimSpace(string(out))
	st.Active = st.State == "active"

	outEnabled, _ := exec.Command("systemctl", "is-enabled", "docker").CombinedOutput()
	st.Enabled = strings.TrimSpace(string(outEnabled)) == "enabled"

	return st
}

// dockerServiceAction runs `systemctl <action> docker` for a whitelisted action.
func dockerServiceAction(action string) error {
	if !systemctlAvailable() {
		return errors.New("systemctl is not available on this host")
	}
	out, err := exec.Command("systemctl", action, "docker").CombinedOutput()
	if err != nil {
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return errors.New(msg)
	}
	return nil
}
