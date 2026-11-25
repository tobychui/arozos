package samba

import (
	"bytes"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"unicode"

	"imuslab.com/arozos/mod/info/logger"
)

// convertShareConfigToString converts a ShareConfig to its string representation for smb.conf
func convertShareConfigToString(share *ShareConfig) string {
	logger.Debug("fileservers/servers/samba", "convertShareConfigToString")
	var builder strings.Builder

	builder.WriteString(fmt.Sprintf("\n[%s]\n", share.Name))
	builder.WriteString(fmt.Sprintf("    path = %s\n", share.Path))
	if len(share.ValidUsers) > 0 {
		builder.WriteString(fmt.Sprintf("    valid users = %s\n", strings.Join(share.ValidUsers, " ")))
	}
	if len(share.ReadList) > 0 {
		builder.WriteString(fmt.Sprintf("    read list = %s\n", strings.Join(share.ReadList, " ")))
	}
	builder.WriteString(fmt.Sprintf("    read only = %s\n", boolToYesNo(share.ReadOnly)))
	builder.WriteString(fmt.Sprintf("    browseable = %s\n", boolToYesNo(share.Browseable)))
	builder.WriteString(fmt.Sprintf("    guest ok = %s\n", boolToYesNo(share.GuestOk)))
	builder.WriteString("    create mask = 0644\n")
	builder.WriteString("    directory mask = 0755\n")

	folderOwner, err := getOwner(share.Path)
	if err == nil {
		builder.WriteString(fmt.Sprintf("    force user = %s\n", folderOwner))
	}

	return builder.String()
}

// Get the folder owner for samba to know which user to use for accessing the folder permission
func getOwner(folderPath string) (string, error) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/samba", "getOwner: folderPath=%.120q", folderPath)
	}
	cmd := exec.Command("bash", "-c", fmt.Sprintf("ls -ld %s", folderPath))

	var out bytes.Buffer
	cmd.Stdout = &out

	err := cmd.Run()
	if err != nil {
		return "", fmt.Errorf("failed to execute command: %v", err)
	}

	output := out.String()
	fields := strings.Fields(output)
	if len(fields) < 3 {
		return "", fmt.Errorf("unexpected output format: %s", output)
	}

	owner := fields[2]
	return owner, nil
}

// boolToYesNo converts a boolean to "yes" or "no"
func boolToYesNo(value bool) string {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/samba", "boolToYesNo: value=%t", value)
	}
	if value {
		return "yes"
	}
	return "no"
}

// RestartSmbd restarts the smbd service using systemctl
func restartSmbd() error {
	logger.Debug("fileservers/servers/samba", "restartSmbd")
	cmd := exec.Command("sudo", "systemctl", "restart", "smbd")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("failed to restart smbd: %v - %s", err, output)
	}
	return nil
}

// Check if a samba username exists (unix username only)
func (s *ShareManager) SambaUserExists(username string) (bool, error) {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/samba", "ShareManager.SambaUserExists: username=%.120q", username)
	}
	userInfos, err := s.ListSambaUsersInfo()
	if err != nil {
		return false, err
	}

	for _, userInfo := range userInfos {
		if userInfo.UnixUsername == username {
			return true, nil
		}
	}

	return false, nil
}

// List of important folders not to be shared via SMB
var importantFolders = []string{
	"/bin",
	"/boot",
	"/dev",
	"/etc",
	"/lib",
	"/lib64",
	"/proc",
	"/root",
	"/sbin",
	"/sys",
	"/tmp",
	"/usr",
	"/var",
}

// IsPathInsideImportantFolders checks if the given path is inside one of the important folders
func isPathInsideImportantFolders(path string) bool {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/samba", "isPathInsideImportantFolders: path=%.120q", path)
	}
	// Clean the given path
	cleanedPath := filepath.Clean(path)

	// Iterate over the important folders
	for _, folder := range importantFolders {
		// Clean the important folder path
		cleanedFolder := filepath.Clean(folder)
		// Check if the cleaned path is inside the cleaned folder
		if strings.HasPrefix(cleanedPath, cleanedFolder) {
			return true
		}
	}
	return false
}

// Clean and make sure the share name is valid
func sanitizeShareName(input string) string {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/samba", "sanitizeShareName: input=%.120q", input)
	}
	var result strings.Builder
	for _, char := range input {
		if unicode.IsLetter(char) || unicode.IsDigit(char) {
			result.WriteRune(char)
		} else if unicode.IsSpace(char) {
			result.WriteRune(' ')
		} else if char == '_' {
			result.WriteRune('_')
		} else if char == '-' {
			result.WriteRune('-')
		}
	}
	return result.String()
}

// Sometime the share name in file doesnt match for sharename in smb.conf
// this function load the smb.conf and get the correct case for the name of the share
// return empty string if not found
func (s *ShareManager) getCorrectCaseForShareName(sharename string) string {
	if logger.IsDebug() {
		logger.Debugf("fileservers/servers/samba", "ShareManager.getCorrectCaseForShareName: sharename=%.120q", sharename)
	}
	targetShare, err := s.GetShareByName(sharename)
	if err != nil {
		return ""
	}

	return targetShare.Name
}
