package samba

import (
	"bufio"
	"encoding/hex"
	"fmt"
	"os/exec"
	"regexp"
	"strings"

	"imuslab.com/arozos/mod/info/logger"
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
func (s *ShareManager) AddSambaUser(username string, password string) (out0 error) {
	defer logger.Out1(logger.In3("fileservers/servers/samba", "ShareManager.AddSambaUser", "s", s, "username", username, "!password", password), &out0)
	// Check if the user already exists
	if !unixUserExists(username) {
		//Create unix user
		cmd := exec.Command("sudo", "adduser", "--no-create-home", "--disabled-password", "--disabled-login", "--force-badname", username)
		err := cmd.Run()
		if err != nil {
			logger.DebugErr("fileservers/servers/samba", err)
			return fmt.Errorf("failed to add unix user: %v", err)
		}
	}

	//Create samba user
	err := s.setupSmbUser(username, password)
	if err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
		return err
	}

	return nil
}

// userExists checks if a user exists
func unixUserExists(username string) (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/samba", "unixUserExists", "username", username), &out0)
	// Check if the user exists by attempting to get their home directory
	cmd := exec.Command("getent", "passwd", username)
	err := cmd.Run()
	return err == nil
}

// SetupSmbUser sets up a Samba user account with the given username and password
func (s *ShareManager) setupSmbUser(username, password string) (out0 error) {
	defer logger.Out1(logger.In3("fileservers/servers/samba", "ShareManager.setupSmbUser", "s", s, "username", username, "!password", password), &out0)
	// Execute the smbpasswd command with the specified username
	cmd := exec.Command("sudo", "smbpasswd", "-a", username)

	// Create a pipe for STDIN to pass the password to the smbpasswd command
	stdinPipe, err := cmd.StdinPipe()
	if err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
		return fmt.Errorf("failed to create STDIN pipe: %v", err)
	}

	// Start the command
	if err := cmd.Start(); err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
		return fmt.Errorf("failed to start smbpasswd command: %v", err)
	}

	// Pass the password twice to the smbpasswd command via STDIN
	password = fmt.Sprintf("%s\n%s\n", password, password)
	if _, err := stdinPipe.Write([]byte(password)); err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
		return fmt.Errorf("failed to write password to smbpasswd command: %v", err)
	}

	// Close the STDIN pipe to signal the end of input
	if err := stdinPipe.Close(); err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
		return fmt.Errorf("failed to close STDIN pipe: %v", err)
	}

	// Wait for the command to finish
	if err := cmd.Wait(); err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
		return fmt.Errorf("smbpasswd command failed: %v", err)
	}

	return nil
}

// RemoveSmbUser removes a Samba user account with the given username
func (s *ShareManager) RemoveSmbUser(username string) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/samba", "ShareManager.RemoveSmbUser", "s", s, "username", username), &out0)
	// Execute the smbpasswd command with the -x flag to delete the user
	cmd := exec.Command("sudo", "smbpasswd", "-x", username)

	// Run the command
	err := cmd.Run()
	if err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
		return fmt.Errorf("failed to remove Samba user account: %v", err)
	}

	return nil
}

// RemoveUnixUser removes a Unix user account with the given username
func (s *ShareManager) RemoveUnixUser(username string) (out0 error) {
	defer logger.Out1(logger.In2("fileservers/servers/samba", "ShareManager.RemoveUnixUser", "s", s, "username", username), &out0)
	// Execute the userdel command with the specified username
	cmd := exec.Command("sudo", "userdel", username)

	// Run the command
	err := cmd.Run()
	if err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
		return fmt.Errorf("failed to remove Unix user account: %v", err)
	}

	return nil
}

// ListSambaUsersInfo lists information about Samba users
func (s *ShareManager) ListSambaUsersInfo() (out0 []UserInfo, out1 error) {
	defer logger.Out2(logger.In1("fileservers/servers/samba", "ShareManager.ListSambaUsersInfo", "s", s), &out0, &out1)
	// Execute pdbedit -L -v command
	cmd := exec.Command("sudo", "pdbedit", "-L", "-v")
	output, err := cmd.CombinedOutput()
	if err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
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
		logger.DebugErr("fileservers/servers/samba", err)
		return nil, fmt.Errorf("error scanning pdbedit output: %v", err)
	}

	return usersInfo, nil
}

// ListNTHashes returns the NT hash of every Samba user, so that the built in
// SMB server can take them over without asking anyone for a new password.
func (s *ShareManager) ListNTHashes() (out0 map[string][]byte, out1 error) {
	defer logger.Out2(logger.In1("fileservers/servers/samba", "ShareManager.ListNTHashes", "s", s), &out0, &out1)
	out, err := exec.Command("sudo", "pdbedit", "-Lw").Output()
	if err != nil {
		logger.DebugErr("fileservers/servers/samba", err)
		return nil, fmt.Errorf("failed to execute pdbedit command: %v", err)
	}
	return parsePdbeditHashes(string(out)), nil
}

// parsePdbeditHashes reads the smbpasswd format of pdbedit -Lw:
// name:uid:LM hash:NT hash:[flags]:LCT-time:
func parsePdbeditHashes(output string) (out0 map[string][]byte) {
	defer logger.Out1(logger.In1("fileservers/servers/samba", "parsePdbeditHashes", "output", output), &out0)
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
func accountCanLogIn(flags string) (out0 bool) {
	defer logger.Out1(logger.In1("fileservers/servers/samba", "accountCanLogIn", "flags", flags), &out0)
	flags = strings.TrimSpace(flags)
	if len(flags) < 2 || flags[0] != '[' || flags[len(flags)-1] != ']' {
		return false
	}
	flags = flags[1 : len(flags)-1]
	return strings.ContainsRune(flags, 'U') && !strings.ContainsAny(flags, "DLWSI")
}
