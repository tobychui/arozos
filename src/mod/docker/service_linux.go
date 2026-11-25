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

	"imuslab.com/arozos/mod/info/logger"
)

func systemctlAvailable() (out0 bool) {
	defer logger.Out1(logger.In0("docker", "systemctlAvailable"), &out0)
	_, err := exec.LookPath("systemctl")
	return err == nil
}

// dockerServiceStatus reports the docker unit's active/enabled state.
func dockerServiceStatus() (out0 ServiceStatus) {
	defer logger.Out1(logger.In0("docker", "dockerServiceStatus"), &out0)
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
func dockerServiceAction(action string) (out0 error) {
	defer logger.Out1(logger.In1("docker", "dockerServiceAction", "action", action), &out0)
	if !systemctlAvailable() {
		return errors.New("systemctl is not available on this host")
	}
	out, err := exec.Command("systemctl", action, "docker").CombinedOutput()
	if err != nil {
		logger.DebugErr("docker", err)
		msg := strings.TrimSpace(string(out))
		if msg == "" {
			msg = err.Error()
		}
		return errors.New(msg)
	}
	return nil
}
