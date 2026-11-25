package samba

import (
	"fmt"
	"os/exec"

	"strings"

	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/user"
)

/*
Functions requested by the file server service router
*/
func (m *ShareManager) ServerToggle(enabled bool) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/samba", "ShareManager.ServerToggle", "m", m, "enabled", enabled), &out0)
	return SetSmbdEnableState(enabled)
}

func (m *ShareManager) IsEnabled() (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/samba", "ShareManager.IsEnabled", "m", m), &out0)
	smbdRunning, err := checkSmbdRunning()
	if err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
		logger.PrintAndLog("Samba", "Unable to get smbd state: "+err.Error(), nil)
		return false
	}

	return smbdRunning
}

func (m *ShareManager) GetEndpoints(userInfo *user.User) (out0 []*fileservers.Endpoint) {
	defer logger.Out1(logger.In2("fileservers/servers/samba", "ShareManager.GetEndpoints", "m", m, "userInfo", userInfo), &out0)
	//Get a list of connection endpoint for this user
	eps := []*fileservers.Endpoint{}
	for _, fsh := range userInfo.GetAllAccessibleFileSystemHandler() {
		if fsh.IsNetworkDrive() {
			continue
		}
		fshID := fsh.UUID
		if fsh.RequierUserIsolation() {
			//User seperated storage. Only mount the user one
			fshID = userInfo.Username + "_" + fsh.UUID
		}

		targetShare, err := m.GetShareByName(fshID)
		if err != nil {
			logger.DebugErr("fileservers/servers/samba", err)
			continue
		}
		userCanAccess := m.UserCanAccessShare(targetShare, userInfo.Username)
		if err != nil || !userCanAccess {
			continue
		}

		eps = append(eps, &fileservers.Endpoint{
			ProtocolName: "//",
			Port:         0,
			Subpath:      "/" + fshID,
		})
	}

	return eps
}

func checkSmbdRunning() (out0 bool, out1 error) {
	defer logger.Out2(logger.In0("fileservers/servers/samba", "checkSmbdRunning"), &out0, &out1)
	// Run the system command to check the smbd service status
	cmd := exec.Command("systemctl", "is-active", "--quiet", "smbd")
	err := cmd.Run()

	// If the command exits with status 0, smbd is running
	if err == nil {
		return true, nil
	}

	// If the command exits with a non-zero status, smbd is not running
	// We can check the error message to be sure it's not another issue
	if exitError, ok := err.(*exec.ExitError); ok {
		if strings.TrimSpace(string(exitError.Stderr)) == "" {
			return false, nil
		}
		return false, fmt.Errorf("error checking smbd status: %s", exitError.Stderr)
	}

	return false, fmt.Errorf("unexpected error checking smbd status: %v", err)
}
