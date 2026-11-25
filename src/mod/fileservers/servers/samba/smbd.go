package samba

import (
	"fmt"
	"os/exec"

	"imuslab.com/arozos/mod/info/logger"
)

// IsSmbdRunning checks if smbd is running on the current Linux host
func IsSmbdRunning() (out0 bool, out1 error) {
	defer logger.Out2(logger.In0("fileservers/servers/samba", "IsSmbdRunning"), &out0, &out1)
	cmd := exec.Command("systemctl", "is-active", "--quiet", "smbd")
	err := cmd.Run()
	if err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
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
func SetSmbdEnableState(enable bool) (out0 error) {
	defer logger.Out1(logger.In1("fileservers/servers/samba", "SetSmbdEnableState", "enable", enable), &out0)
	var cmd *exec.Cmd
	if enable {
		//Enable smbd
		cmd = exec.Command("sudo", "systemctl", "enable", "smbd")

		err := cmd.Run()
		if err != nil {
			logger.DebugErr("fileservers/servers/samba", err)
			return fmt.Errorf("failed to start smbd: %v", err)
		}

		//Start smbd now
		cmd = exec.Command("sudo", "systemctl", "start", "smbd")

		err = cmd.Run()
		if err != nil {
			logger.DebugErr("fileservers/servers/samba", err)
			return fmt.Errorf("failed to set smbd enable state: %v", err)
		}
	} else {
		//Stop smbd
		cmd = exec.Command("sudo", "systemctl", "stop", "smbd")
		err := cmd.Run()
		if err != nil {
			logger.DebugErr("fileservers/servers/samba", err)
			return fmt.Errorf("failed to stop smbd: %v", err)
		}
		cmd = exec.Command("sudo", "systemctl", "disable", "smbd")

		//Disable service
		err = cmd.Run()
		if err != nil {
			logger.DebugErr("fileservers/servers/samba", err)
			return fmt.Errorf("failed to set smbd enable state: %v", err)
		}

	}

	return nil
}
