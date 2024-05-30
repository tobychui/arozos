package samba

import (
	"fmt"
	"log"
	"os/exec"

	"strings"

	"imuslab.com/arozos/mod/fileservers"
	"imuslab.com/arozos/mod/user"
)

/*
Functions requested by the file server service router
*/
func (m *ShareManager) ServerToggle(enabled bool) error {
	return SetSmbdEnableState(enabled)
}

func (m *ShareManager) IsEnabled() bool {
	smbdRunning, err := checkSmbdRunning()
	if err != nil {
		log.Println("Unable to get smbd state: " + err.Error())
		return false
	}

	return smbdRunning
}

func (m *ShareManager) GetEndpoints(userInfo *user.User) []*fileservers.Endpoint {
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

func checkSmbdRunning() (bool, error) {
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
