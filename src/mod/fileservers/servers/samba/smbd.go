package samba

import (
	"fmt"
	"os/exec"
)

// IsSmbdRunning checks if smbd is running on the current Linux host
func IsSmbdRunning() (bool, error) {
	cmd := exec.Command("systemctl", "is-active", "--quiet", "smbd")
	err := cmd.Run()
	if err != nil {
		// If the command returns a non-zero exit code, smbd is not running
		if exitErr, ok := err.(*exec.ExitError); ok {
			return exitErr.ExitCode() == 0, nil
		}
		return false, fmt.Errorf("failed to check smbd status: %v", err)
	}
	// If the command returns a zero exit code, smbd is running
	return true, nil
}

// SetSmbdEnableState enables or disables smbd via systemctl
func SetSmbdEnableState(enable bool) error {
	var cmd *exec.Cmd
	if enable {
		//Enable smbd
		cmd = exec.Command("sudo", "systemctl", "enable", "smbd")

		err := cmd.Run()
		if err != nil {
			return fmt.Errorf("failed to start smbd: %v", err)
		}

		//Start smbd now
		cmd = exec.Command("sudo", "systemctl", "start", "smbd")

		err = cmd.Run()
		if err != nil {
			return fmt.Errorf("failed to set smbd enable state: %v", err)
		}
	} else {
		//Stop smbd
		cmd = exec.Command("sudo", "systemctl", "stop", "smbd")
		err := cmd.Run()
		if err != nil {
			return fmt.Errorf("failed to stop smbd: %v", err)
		}
		cmd = exec.Command("sudo", "systemctl", "disable", "smbd")

		//Disable service
		err = cmd.Run()
		if err != nil {
			return fmt.Errorf("failed to set smbd enable state: %v", err)
		}

	}

	return nil
}
