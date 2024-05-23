package samba

import (
	"bufio"
	"errors"
	"fmt"
	"os"
	"runtime"
	"strings"

	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

/*

	Samba Share Warpper

	Note that this module only provide exposing of local disk / storage.
	This module do not handle providing the virtualized interface for samba

*/

type ShareManager struct {
	SambaConfigPath string //Config file for samba, aka smb.conf
	UserHandler     *user.UserHandler
}

type ShareConfig struct {
	Name       string
	Path       string
	ValidUsers []string
	ReadOnly   bool
	Browseable bool
	GuestOk    bool
	parent     *ShareManager
}

func NewSambaShareManager(userHandler *user.UserHandler) (*ShareManager, error) {
	if runtime.GOOS == "linux" {
		//Check if samba installed
		if !utils.FileExists("/bin/smbcontrol") {
			return nil, errors.New("samba not installed")
		}
	} else {
		return nil, errors.New("platform not supported")
	}
	return &ShareManager{
		SambaConfigPath: "/etc/samba/smb.conf",
		UserHandler:     userHandler,
	}, nil
}

// ReadSambaShares reads  / lists the smb.conf file and extracts all existing shares
func (s *ShareManager) ReadSambaShares() ([]ShareConfig, error) {
	file, err := os.Open(s.SambaConfigPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var shares []ShareConfig
	var currentShare *ShareConfig

	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())

		// Check for section headers
		if strings.HasPrefix(line, "[") && strings.HasSuffix(line, "]") {
			if currentShare != nil {
				currentShare.parent = s
				shares = append(shares, *currentShare)
			}
			currentShare = &ShareConfig{
				Name: strings.Trim(line, "[]"),
			}
			continue
		}

		// Check if we are currently processing a share section
		if currentShare != nil {
			tokens := strings.SplitN(line, "=", 2)
			if len(tokens) != 2 {
				continue
			}
			key := strings.TrimSpace(tokens[0])
			value := strings.TrimSpace(tokens[1])

			switch key {
			case "path":
				currentShare.Path = value
			case "valid users":
				currentShare.ValidUsers = strings.Fields(value)
			case "read only":
				currentShare.ReadOnly = (value == "yes")
			case "browseable":
				currentShare.Browseable = (value == "yes")
			case "guest ok":
				currentShare.GuestOk = (value == "yes")
			}
		}
	}

	// Add the last share if there is one
	if currentShare != nil {
		currentShare.parent = s
		shares = append(shares, *currentShare)
	}

	// Check for scanner errors
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return shares, nil
}

// Check if a share name is already used
func (s *ShareManager) ShareNameExists(sharename string) (bool, error) {
	allShares, err := s.ReadSambaShares()
	if err != nil {
		return false, err
	}

	for _, share := range allShares {
		if strings.EqualFold(share.Name, sharename) {
			return true, nil
		}
	}

	return false, nil
}

// A basic filter to remove system created smb shares entry in the list
func (s *ShareManager) FilterSystemCreatedShares(shares []ShareConfig) []ShareConfig {
	namesToRemove := []string{"global", "printers", "print$"}
	filteredShares := []ShareConfig{}
	for _, share := range shares {
		if !utils.StringInArray(namesToRemove, share.Name) {
			filteredShares = append(filteredShares, share)
		}
	}
	return filteredShares
}

// CreateNewSambaShare converts the shareConfig to string and appends it to smb.conf if the share name does not already exist
func (s *ShareManager) CreateNewSambaShare(shareToCreate *ShareConfig) error {
	// Path to smb.conf
	smbConfPath := s.SambaConfigPath

	// Open the smb.conf file for reading
	file, err := os.Open(smbConfPath)
	if err != nil {
		return fmt.Errorf("failed to open smb.conf: %v", err)
	}
	defer file.Close()

	// Check if the share already exists
	scanner := bufio.NewScanner(file)
	shareExists := false
	shareNameSection := fmt.Sprintf("[%s]", shareToCreate.Name)
	for scanner.Scan() {
		if strings.EqualFold(strings.TrimSpace(scanner.Text()), shareNameSection) {
			shareExists = true
			break
		}
	}

	if err := scanner.Err(); err != nil {
		return fmt.Errorf("failed to read smb.conf: %v", err)
	}

	if shareExists {
		return fmt.Errorf("share %s already exists", shareToCreate.Name)
	}

	// Convert ShareConfig to string
	shareConfigString := convertShareConfigToString(shareToCreate)

	// Open the smb.conf file for appending
	file, err = os.OpenFile(smbConfPath, os.O_APPEND|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("failed to open smb.conf for writing: %v", err)
	}
	defer file.Close()

	// Append the new share configuration
	if _, err := file.WriteString(shareConfigString); err != nil {
		return fmt.Errorf("failed to write to smb.conf: %v", err)
	}

	return nil
}

// RemoveSambaShareConfig removes the Samba share configuration from smb.conf
func (s *ShareManager) RemoveSambaShareConfig(shareName string) error {
	// Check if the share exists
	shareExists, err := s.ShareExists(shareName)
	if err != nil {
		return err
	}
	if !shareExists {
		return errors.New("share not exists")
	}

	//Convert the sharename to correct case for matching
	shareName = s.getCorrectCaseForShareName(shareName)

	// Open the smb.conf file for reading
	file, err := os.Open(s.SambaConfigPath)
	if err != nil {
		return err
	}
	defer file.Close()

	// Create a temporary file to store modified smb.conf
	tmpFile, err := os.CreateTemp("", "smb.conf.*.tmp")
	if err != nil {
		return err
	}
	defer tmpFile.Close()

	// Create a scanner to read the smb.conf file line by line
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := scanner.Text()

		// Check if the line contains the share name
		if strings.HasPrefix(line, "["+shareName+"]") {
			// Skip the lines until the next section
			for scanner.Scan() {
				checkingLine := scanner.Text()
				if strings.HasPrefix(checkingLine, "[") {
					//The header of the next section is also need to be kept
					fmt.Fprintln(tmpFile, checkingLine)
					break
				}
			}
			continue // Skip writing the share configuration to the temporary file
		}

		// Write the line to the temporary file
		_, err := fmt.Fprintln(tmpFile, line)
		if err != nil {
			return err
		}
	}

	// Check for scanner errors
	if err := scanner.Err(); err != nil {
		return err
	}

	// Close the original smb.conf file
	if err := file.Close(); err != nil {
		return err
	}

	// Close the temporary file
	if err := tmpFile.Close(); err != nil {
		return err
	}

	// Replace the original smb.conf file with the temporary file
	if err := os.Rename(tmpFile.Name(), "/etc/samba/smb.conf"); err != nil {
		return err
	}

	return nil
}

// ShareExists checks if a given share name exists in smb.conf
func (s *ShareManager) ShareExists(shareName string) (bool, error) {
	// Path to smb.conf
	smbConfPath := s.SambaConfigPath

	// Open the smb.conf file for reading
	file, err := os.Open(smbConfPath)
	if err != nil {
		return false, fmt.Errorf("failed to open smb.conf: %v", err)
	}
	defer file.Close()

	// Check if the share already exists
	scanner := bufio.NewScanner(file)
	shareNameSection := fmt.Sprintf("[%s]", shareName)
	for scanner.Scan() {
		if strings.EqualFold(shareNameSection, strings.TrimSpace(scanner.Text())) {
			return true, nil
		}
	}

	if err := scanner.Err(); err != nil {
		return false, fmt.Errorf("failed to read smb.conf: %v", err)
	}

	return false, nil
}

// Add a new user to smb.conf share by name
func (s *ShareManager) AddUserToSambaShare(shareName, username string) error {
	targetShare, err := s.GetShareByName(shareName)
	if err != nil {
		return err
	}

	if s.UserCanAccessShare(targetShare, username) {
		//User already have no access to this share, no need to delete
		return nil
	}

	//User not in this share. Append user name in this valid users
	targetShare.ValidUsers = append(targetShare.ValidUsers, username)

	//Delete the old one and create the new share with updated user list
	err = s.RemoveSambaShareConfig(shareName)
	if err != nil {
		return err
	}

	err = s.CreateNewSambaShare(targetShare)
	if err != nil {
		return err
	}

	return nil
}

// Return if the user can access this samba share
func (s *ShareManager) UserCanAccessShare(targetSmbShare *ShareConfig, username string) bool {
	return utils.StringInArray(targetSmbShare.ValidUsers, username)
}

// Get a list of shares that this user have access to
func (s *ShareManager) GetUsersShare(username string) ([]*ShareConfig, error) {
	allShares, err := s.ReadSambaShares()
	if err != nil {
		return nil, err
	}

	userAccessibleShares := []*ShareConfig{}
	for _, thisShare := range allShares {
		if s.UserCanAccessShare(&thisShare, username) {
			thisShareObject := thisShare
			userAccessibleShares = append(userAccessibleShares, &thisShareObject)
		}
	}

	return userAccessibleShares, nil
}

// Remove a user from smb.conf share by name
func (s *ShareManager) RemoveUserFromSambaShare(shareName, username string) error {
	targetShare, err := s.GetShareByName(shareName)
	if err != nil {
		return err
	}

	if !s.UserCanAccessShare(targetShare, username) {
		//User already have no access to this share, no need to delete
		return nil
	}

	if len(targetShare.ValidUsers) == 1 && strings.EqualFold(targetShare.ValidUsers[0], username) {
		//This user is the only person who can access this share
		//Remove the share entirely
		//Delete the old one and create the new share with updated user list
		err = s.RemoveSambaShareConfig(shareName)
		if err != nil {
			return err
		}

		return nil
	}

	//User is in this share but this share contain other users.
	err = s.RemoveSambaShareConfig(shareName)
	if err != nil {
		return err
	}

	//Create a new valid user list
	newShareValidUsers := []string{}
	for _, validUser := range targetShare.ValidUsers {
		if !strings.EqualFold(validUser, username) {
			newShareValidUsers = append(newShareValidUsers, validUser)
		}
	}
	targetShare.ValidUsers = newShareValidUsers

	//Create the share
	err = s.CreateNewSambaShare(targetShare)
	if err != nil {
		return err
	}

	return nil
}

// Get a share by name
func (s *ShareManager) GetShareByName(shareName string) (*ShareConfig, error) {
	allShares, err := s.ReadSambaShares()
	if err != nil {
		return nil, err

	}

	for _, thisShare := range allShares {
		if strings.EqualFold(shareName, thisShare.Name) {
			return &thisShare, nil
		}
	}

	return nil, errors.New("target share not found")

}
