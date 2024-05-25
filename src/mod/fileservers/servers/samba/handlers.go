package samba

import (
	"encoding/json"
	"log"
	"net/http"
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/utils"
)

// Get current samba service status
func (s *ShareManager) SmbdStates(w http.ResponseWriter, r *http.Request) {
	set, err := utils.PostPara(r, "set")
	if err != nil {
		//return the current smbd states
		smbdRunning, err := IsSmbdRunning()
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		js, _ := json.Marshal(smbdRunning)
		utils.SendJSONResponse(w, string(js))
		return
	} else if set == "enable" {
		//Set smbd to enable
		err = SetSmbdEnableState(true)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		utils.SendOK(w)
		return
	} else if set == "disable" {
		//Set smbd to disable
		err = SetSmbdEnableState(false)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		utils.SendOK(w)
		return
	}

	utils.SendErrorResponse(w, "not support set state: "+set+". Only support enable /disable")
}

// List all the samba shares
func (s *ShareManager) ListSambaShares(w http.ResponseWriter, r *http.Request) {
	shares, err := s.ReadSambaShares()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Remove those shares that is reserved by systems
	shares = s.FilterSystemCreatedShares(shares)

	js, _ := json.Marshal(shares)
	utils.SendJSONResponse(w, string(js))
}

// Add a samba share
func (s *ShareManager) AddSambaShare(w http.ResponseWriter, r *http.Request) {
	shareName, err := utils.PostPara(r, "name")
	if err != nil {
		utils.SendErrorResponse(w, "share name not given")
		return
	}

	shareName = strings.TrimSpace(shareName)

	//Check if this share name already been used
	shareNameExists, err := s.ShareNameExists(shareName)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	if shareNameExists {
		utils.SendErrorResponse(w, "share with identical name already exists")
		return
	}

	sharePath, err := utils.PostPara(r, "path")
	if err != nil {
		utils.SendErrorResponse(w, "share path not given")
		return
	}

	//Parse the path to absolute path
	absoluteSharePath, err := filepath.Abs(sharePath)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Check if path exists
	if !utils.FileExists(absoluteSharePath) {
		utils.SendErrorResponse(w, "target path not exists")
		return
	}

	//Check if target path is a folder
	if !utils.IsDir(absoluteSharePath) {
		utils.SendErrorResponse(w, "target path is not a directory")
		return
	}

	//Check if it is a reserved / protected path
	if isPathInsideImportantFolders(absoluteSharePath) {
		utils.SendErrorResponse(w, "system reserved path cannot be shared")
		return
	}

	validUsersJSON, err := utils.PostPara(r, "users")
	if err != nil {
		utils.SendErrorResponse(w, "no valid user givens")
		return
	}

	//Parse valid users into string slice
	validUsers := []string{}
	err = json.Unmarshal([]byte(validUsersJSON), &validUsers)
	if err != nil {
		utils.SendErrorResponse(w, "unable to parse JSON for valid users")
		return
	}

	//Check if all the users exists in the host OS
	for _, validUser := range validUsers {
		thisUnixUserExists, err := s.SambaUserExists(validUser)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}

		if !thisUnixUserExists {
			//This user not exists
			utils.SendErrorResponse(w, validUser+" is not a valid unix user")
			return
		}
	}

	readOnly, err := utils.PostBool(r, "readonly")
	if err != nil {
		readOnly = false
	}

	browseable, err := utils.PostBool(r, "browseable")
	if err != nil {
		browseable = true
	}

	allowGuest, err := utils.PostBool(r, "guestok")
	if err != nil {
		allowGuest = false
	}

	shareToCreate := ShareConfig{
		Name:       shareName,
		Path:       absoluteSharePath,
		ValidUsers: validUsers,
		ReadOnly:   readOnly,
		Browseable: browseable,
		GuestOk:    allowGuest,
	}

	//Add the new share to smb.conf
	err = s.CreateNewSambaShare(&shareToCreate)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Restart smbd
	err = restartSmbd()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

// Delete a user samba share, that share must only contains the current user / owner
func (s *ShareManager) DelUserSambaShare(w http.ResponseWriter, r *http.Request) {
	//Get the user info
	userInfo, err := s.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, "permission denied")
		return
	}

	shareName, err := utils.PostPara(r, "name")
	if err != nil {
		utils.SendErrorResponse(w, "share name not given")
		return
	}

	//Check if share exists
	targetShare, err := s.GetShareByName(shareName)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Check if the user can access this share
	if !s.UserCanAccessShare(targetShare, userInfo.Username) {
		utils.SendErrorResponse(w, "share access denied")
		return
	}

	//Check if the user is the only user in the share access list
	if len(targetShare.ValidUsers) == 1 && strings.EqualFold(targetShare.ValidUsers[0], userInfo.Username) {
		//This share is own by this user and this user is the only one who can access it
		//remove user access will create trash in the smb.conf folder. Remove the whole folder entirely.
		err = s.RemoveSambaShareConfig(targetShare.Name)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
		utils.SendOK(w)
		return
	}

	//Share also contains other users. Only remove user to that share
	err = s.RemoveUserFromSambaShare(targetShare.Name, userInfo.Username)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	utils.SendOK(w)

}

// Remove a samba share by name, can remove any share by name, should be for admin only
// call to DelUserSambaShare for non-admin uses
func (s *ShareManager) DelSambaShare(w http.ResponseWriter, r *http.Request) {
	shareName, err := utils.PostPara(r, "name")
	if err != nil {
		utils.SendErrorResponse(w, "share name not given")
		return
	}

	//Check if share exists
	shareExists, err := s.ShareExists(shareName)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	if !shareExists {
		utils.SendErrorResponse(w, "share to be remove not exists")
		return
	}

	//Remove the share from config file
	err = s.RemoveSambaShareConfig(shareName)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Restart smbd
	err = restartSmbd()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

// Add a new samba user
func (s *ShareManager) NewSambaUser(w http.ResponseWriter, r *http.Request) {
	username, err := utils.PostPara(r, "username")
	if err != nil {
		utils.SendErrorResponse(w, "username not given")
		return
	}

	password, err := utils.PostPara(r, "password")
	if err != nil {
		utils.SendErrorResponse(w, "password not set")
		return
	}

	err = s.AddSambaUser(username, password)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

// Remove a samba user, check for admin before calling
func (s *ShareManager) DelSambaUser(w http.ResponseWriter, r *http.Request) {
	username, err := utils.PostPara(r, "username")
	if err != nil {
		utils.SendErrorResponse(w, "username not given")
		return
	}

	//Remove the samba user
	err = s.RemoveSmbUser(username)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

// List all samba users info
func (s *ShareManager) ListSambaUsers(w http.ResponseWriter, r *http.Request) {
	type SimplifiedUserInfo struct {
		UnixUsername string
		Domain       string
		IsArozOSUser bool
	}
	results := []*SimplifiedUserInfo{}
	userInfo, err := s.ListSambaUsersInfo()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	for _, thisUserInfo := range userInfo {
		thisIsArozOSUser := s.UserHandler.GetAuthAgent().UserExists(strings.TrimSpace(thisUserInfo.UnixUsername))
		results = append(results, &SimplifiedUserInfo{
			UnixUsername: strings.TrimSpace(thisUserInfo.UnixUsername),
			Domain:       thisUserInfo.Domain,
			IsArozOSUser: thisIsArozOSUser,
		})
	}

	js, _ := json.Marshal(results)
	utils.SendJSONResponse(w, string(js))
}

// Activate a user account from arozos into samba user
func (s *ShareManager) ActivateUserAccount(w http.ResponseWriter, r *http.Request, password string) {
	userInfo, _ := s.UserHandler.GetUserInfoFromRequest(w, r)

	//Register this user to samba if not exists
	sambaUserExists, err := s.SambaUserExists(userInfo.Username)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	if !sambaUserExists {
		//This user account not activated yet. Activate it
		err = s.AddSambaUser(userInfo.Username, password)
		if err != nil {
			utils.SendErrorResponse(w, err.Error())
			return
		}
	}

	//Create the user root share folders
	for _, fsh := range userInfo.GetAllAccessibleFileSystemHandler() {
		if fsh.IsNetworkDrive() {
			//Samba can only work with drives locally hosted on this server
			//Skip network drives
			continue
		}

		fshID := fsh.UUID
		fshSharePath := fsh.Path
		if fsh.RequierUserIsolation() {
			//User seperated storage. Only mount the user one
			fshID = userInfo.Username + "_" + fsh.UUID
			fshSharePath = filepath.Join(fsh.Path, "/users/", userInfo.Username+"/")
		}

		fshID = sanitizeShareName(fshID)

		//Check if the share already exists
		shareExists, err := s.ShareExists(fshID)
		if err != nil {
			continue
		}

		if !shareExists {
			//Try to create the share
			fshShareAbsolutePath, err := filepath.Abs(fshSharePath)
			if err != nil {
				log.Println("[Samba] Unable to generate share config for path: " + fshSharePath)
				continue
			}

			//Check if that folder exists
			if !utils.FileExists(fshShareAbsolutePath) {
				//Folder not exists. Continue
				log.Println("[Samba] Path not exists for file system handler: " + fshSharePath)
				continue
			}

			//Ok! Create the share with this username
			err = s.CreateNewSambaShare(&ShareConfig{
				Name:       fshID,
				Path:       fshShareAbsolutePath,
				ValidUsers: []string{userInfo.Username},
				ReadOnly:   false,
				Browseable: !fsh.RequierUserIsolation(),
				GuestOk:    false,
			})

			if err != nil {
				log.Println("[Samba] Failed to create share: " + err.Error())
				utils.SendErrorResponse(w, err.Error())
				return
			}
		} else {
			//Share exists. Add this user to such share
			err = s.AddUserToSambaShare(fshID, userInfo.Username)
			if err != nil {
				log.Println("[Samba] Failed to add user " + userInfo.Username + " to share " + fshID + ": " + err.Error())
				utils.SendErrorResponse(w, err.Error())
				return
			}
		}
	}

	err = restartSmbd()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

// Get if the user share has been enabled
func (s *ShareManager) HandleUserSmbStatusList(w http.ResponseWriter, r *http.Request) {
	type UserStatus struct {
		SmbdEnabled         bool
		UserSmbShareEnabled bool
		UserSmbShareList    []*ShareConfig
	}

	result := UserStatus{
		SmbdEnabled:         s.IsEnabled(),
		UserSmbShareEnabled: false,
		UserSmbShareList:    []*ShareConfig{},
	}

	userInfo, err := s.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	userAccessibleShares, err := s.GetUsersShare(userInfo.Username)
	if err != nil {
		//User never used smb service
		js, _ := json.Marshal(result)
		utils.SendJSONResponse(w, string(js))
		return
	}

	if len(userAccessibleShares) == 0 {
		result.UserSmbShareEnabled = false
	} else {
		result.UserSmbShareEnabled = true
		result.UserSmbShareList = userAccessibleShares
	}

	js, _ := json.Marshal(result)
	utils.SendJSONResponse(w, string(js))
}

// Deactivate the user account by removing user access to all shares
func (s *ShareManager) DeactiveUserAccount(w http.ResponseWriter, r *http.Request) {
	userInfo, err := s.UserHandler.GetUserInfoFromRequest(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	userAccessibleShares, err := s.GetUsersShare(userInfo.Username)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//For each of the shares this user can access, remove his name from the share
	for _, userAccessibleShare := range userAccessibleShares {
		err = s.RemoveUserFromSambaShare(userAccessibleShare.Name, userInfo.Username)
		if err != nil {
			log.Println("[Samba] Unable to remove user " + userInfo.Username + " from share: " + err.Error())
			continue
		}
	}

	//Remove this samba user
	err = s.RemoveSmbUser(userInfo.Username)
	if err != nil {
		utils.SendErrorResponse(w, "Samba user remove failed: "+err.Error())
		return
	}

	err = restartSmbd()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)

}

// Handle update to accessible users
func (s *ShareManager) HandleAccessUserUpdate(w http.ResponseWriter, r *http.Request) {
	shareName, err := utils.PostPara(r, "name")
	if err != nil {
		utils.SendErrorResponse(w, "share name not given")
		return
	}

	newUserListJSON, err := utils.PostPara(r, "users")
	if err != nil {
		utils.SendErrorResponse(w, "list of new users not given")
		return
	}

	//Parse the user list from json string to string slice
	newUserList := []string{}
	err = json.Unmarshal([]byte(newUserListJSON), &newUserList)
	if err != nil {
		log.Println("[Samba] Parse new user list failed: " + err.Error())
		utils.SendErrorResponse(w, "failed to parse the new user list")
		return
	}

	//read the target share from smb.conf
	targetShare, err := s.GetShareByName(shareName)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	for _, originalUser := range targetShare.ValidUsers {
		if !utils.StringInArray(newUserList, originalUser) {
			//This user is not longer allowed to access this share
			//remove this user from this share
			s.RemoveUserFromSambaShare(shareName, originalUser)
		}
	}

	for _, newUsername := range newUserList {
		if !s.UserCanAccessShare(targetShare, newUsername) {
			err = s.AddUserToSambaShare(targetShare.Name, newUsername)
			if err != nil {
				utils.SendErrorResponse(w, err.Error())
				return
			}
		}
	}

	err = restartSmbd()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)
}

// Handle changing path of share
func (s *ShareManager) HandleSharePathChange(w http.ResponseWriter, r *http.Request) {
	shareName, err := utils.PostPara(r, "name")
	if err != nil {
		utils.SendErrorResponse(w, "share name not given")
		return
	}

	newSharePath, err := utils.PostPara(r, "path")
	if err != nil {
		utils.SendErrorResponse(w, "list of new users not given")
		return
	}

	//Convert path to absolute and check if folder exists
	newSharePathAbsolute, err := filepath.Abs(newSharePath)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	if !utils.FileExists(newSharePathAbsolute) {
		utils.SendErrorResponse(w, "target folder not exists")
		return
	}

	//Check if path sharing is allowed
	if isPathInsideImportantFolders(newSharePathAbsolute) {
		utils.SendErrorResponse(w, "path is or inside protected folders")
		return
	}

	//read the target share from smb.conf
	targetShare, err := s.GetShareByName(shareName)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Update and save share to smb.conf
	targetShare.Path = newSharePathAbsolute
	err = targetShare.SaveToConfig()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Restart smbd
	err = restartSmbd()
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	utils.SendOK(w)

}
