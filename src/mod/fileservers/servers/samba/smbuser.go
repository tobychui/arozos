package samba

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"os/exec"
	"regexp"
	"strings"
)

// samba user info
type UserInfo struct {
	UnixUsername     string
	UserSID          string
	Domain           string
	LastBadPassword  string
	BadPasswordCount int
}

// AddSambaUser adds a Samba user with the given username
func (s *ShareManager) AddSambaUser(username string, password string) error {
	// Check if the user already exists
	if !unixUserExists(username) {
		//Create unix user
		cmd := exec.Command("sudo", "adduser", "--no-create-home", "--disabled-password", "--disabled-login", "--force-badname", username)
		err := cmd.Run()
		if err != nil {
			return fmt.Errorf("failed to add unix user: %v", err)
		}
	}

	//Create samba user
	err := s.setupSmbUser(username, password)
	if err != nil {
		return err
	}

	return nil
}

// userExists checks if a user exists
func unixUserExists(username string) bool {
	// Check if the user exists by attempting to get their home directory
	cmd := exec.Command("getent", "passwd", username)
	err := cmd.Run()
	return err == nil
}

// SetupSmbUser sets up a Samba user account with the given username and password
func (s *ShareManager) setupSmbUser(username, password string) error {
	// Execute the smbpasswd command with the specified username
	cmd := exec.Command("sudo", "smbpasswd", "-a", username)

	// Create a pipe for STDIN to pass the password to the smbpasswd command
	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		return fmt.Errorf("failed to create STDIN pipe: %v", err)
	}

	// Start the command
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("failed to start smbpasswd command: %v", err)
	}

	// Pass the password twice to the smbpasswd command via STDIN
	password = fmt.Sprintf("%s\n%s\n", password, password)
	if _, err := stdinPipe.Write([]byte(password)); err != nil {
		return fmt.Errorf("failed to write password to smbpasswd command: %v", err)
	}

	// Close the STDIN pipe to signal the end of input
	if err := stdinPipe.Close(); err != nil {
		return fmt.Errorf("failed to close STDIN pipe: %v", err)
	}

	// Wait for the command to finish
	if err := cmd.Wait(); err != nil {
		return fmt.Errorf("smbpasswd command failed: %v", err)
	}

	return nil
}

// RemoveSmbUser removes a Samba user account with the given username
func (s *ShareManager) RemoveSmbUser(username string) error {
	// Execute the smbpasswd command with the -x flag to delete the user
	cmd := exec.Command("sudo", "smbpasswd", "-x", username)

	// Run the command
	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("failed to remove Samba user account: %v", err)
	}

	return nil
}

// RemoveUnixUser removes a Unix user account with the given username
func (s *ShareManager) RemoveUnixUser(username string) error {
	// Execute the userdel command with the specified username
	cmd := exec.Command("sudo", "userdel", username)

	// Run the command
	err := cmd.Run()
	if err != nil {
		return fmt.Errorf("failed to remove Unix user account: %v", err)
	}

	return nil
}

// ListSambaUsersInfo lists information about Samba users
func (s *ShareManager) ListSambaUsersInfo() ([]UserInfo, error) {
	// Execute pdbedit -L -v command
	cmd := exec.Command("sudo", "pdbedit", "-L", "-v")
	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("failed to execute pdbedit command: %v", err)
	}

	// Parse the output and extract user information
	var usersInfo []UserInfo
	scanner := bufio.NewScanner(strings.NewReader(string(output)))
	var userInfo UserInfo
	re := regexp.MustCompile(`^Unix username:\s+(.*)$`)
	for scanner.Scan() {
		line := scanner.Text()
		match := re.FindStringSubmatch(line)
		if len(match) > 0 {
			if userInfo.UnixUsername != "" {
				usersInfo = append(usersInfo, userInfo)
			}
			userInfo = UserInfo{UnixUsername: match[1]}
		} else if strings.HasPrefix(line, "User SID:") {
			userInfo.UserSID = strings.TrimSpace(strings.Split(line, ":")[1])
		} else if strings.HasPrefix(line, "Domain:") {
			userInfo.Domain = strings.TrimSpace(strings.Split(line, ":")[1])
		} else if strings.HasPrefix(line, "Last bad password") {
			info := strings.TrimSpace(strings.Split(line, ":")[1])
			if info != "never" {
				userInfo.LastBadPassword = info
			}
		} else if strings.HasPrefix(line, "Bad password count") {
			fmt.Sscanf(strings.TrimSpace(strings.Split(line, ":")[1]), "%d", &userInfo.BadPasswordCount)
		}
	}
	if userInfo.UnixUsername != "" {
		usersInfo = append(usersInfo, userInfo)
	}

	if err := scanner.Err(); err != nil {
		return nil, fmt.Errorf("error scanning pdbedit output: %v", err)
	}

	return usersInfo, nil
}

// ListNTHashes returns the NT hash of every Samba user, so that the built in
// SMB server can take them over without asking anyone for a new password.
func (s *ShareManager) ListNTHashes() (map[string][]byte, error) {
	out, err := exec.Command("sudo", "pdbedit", "-Lw").Output()
	if err != nil {
		return nil, fmt.Errorf("failed to execute pdbedit command: %v", err)
	}
	return parsePdbeditHashes(string(out)), nil
}

// parsePdbeditHashes reads the smbpasswd format of pdbedit -Lw:
// name:uid:LM hash:NT hash:[flags]:LCT-time:
func parsePdbeditHashes(output string) map[string][]byte {
	results := map[string][]byte{}
	for _, line := range strings.Split(output, "\n") {
		fields := strings.Split(strings.TrimSpace(line), ":")
		if len(fields) < 5 || fields[0] == "" {
			continue
		}
		if !accountCanLogIn(fields[4]) {
			continue
		}
		//An account with no password has X characters or NO PASSWORD here
		hash, err := hex.DecodeString(fields[3])
		if err != nil || len(hash) != 16 {
			continue
		}
		results[fields[0]] = hash
	}
	return results
}

// accountCanLogIn reads the account flags of an smbpasswd line, such as
// "[U          ]". Only a normal user account Samba would let log in is taken
// over: a disabled (D) or locked (L) account keeps its hash, and must not
// come back to life on the built in server, and machine or trust accounts
// (W, S, I) are not people. A field that cannot be read counts as refused.
func accountCanLogIn(flags string) bool {
	flags = strings.TrimSpace(flags)
	if len(flags) < 2 || flags[0] != '[' || flags[len(flags)-1] != ']' {
		return false
	}
	flags = flags[1 : len(flags)-1]
	return strings.ContainsRune(flags, 'U') && !strings.ContainsAny(flags, "DLWSI")
}
