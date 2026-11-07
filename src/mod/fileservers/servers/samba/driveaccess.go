package samba

import (
	"path/filepath"
	"strings"

	"imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/filesystem/arozfs"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/user"
	"imuslab.com/arozos/mod/utils"
)

/*
	Drive access

	smbd reads smb.conf, not the access lists of the drives, so the shares
	have to be kept in line with them: a user activated for Samba has a share
	for every local drive they may use, and is on its read list when they may
	only read it. A share of one drive can have users of both kinds, so the
	level of each user goes in the read list rather than in "read only".
*/

// shareNameOf returns the share a user reaches a drive through
func shareNameOf(fsh *filesystem.FileSystemHandler, username string) string {
	fshID := fsh.UUID
	if fsh.RequierUserIsolation() {
		//User seperated storage. Only mount the user one
		fshID = username + "_" + fsh.UUID
	}
	return sanitizeShareName(fshID)
}

// drivePathOf returns the folder a user reaches a drive at
func drivePathOf(fsh *filesystem.FileSystemHandler, username string) string {
	if fsh.RequierUserIsolation() {
		return filepath.Join(fsh.Path, "/users/", username+"/")
	}
	return fsh.Path
}

// allDrives lists every drive of the host, whichever pool holds it
func (s *ShareManager) allDrives() []*filesystem.FileSystemHandler {
	drives := []*filesystem.FileSystemHandler{}
	if pool := s.UserHandler.GetStoragePool(); pool != nil {
		drives = append(drives, pool.Storages...)
	}
	for _, pg := range s.UserHandler.GetPermissionHandler().PermissionGroups {
		if pg.StoragePool != nil {
			drives = append(drives, pg.StoragePool.Storages...)
		}
	}
	return drives
}

// syncUserShares brings the shares of one user in line with the drives they
// may use now. Shares an admin made by hand are not named after a drive and
// stay as they are. The caller restarts smbd.
func (s *ShareManager) syncUserShares(userInfo *user.User) error {
	//The shares this user should have, and the level on each
	wanted := map[string]bool{}
	for _, fsh := range userInfo.GetAllAccessibleFileSystemHandler() {
		if fsh.IsNetworkDrive() {
			//Samba can only work with drives locally hosted on this server
			continue
		}
		level := userInfo.GetPathAccessPermission(fsh.UUID + ":/")
		if err := s.ensureUserShare(fsh, userInfo.Username, level == arozfs.FsReadOnly); err != nil {
			return err
		}
		wanted[strings.ToLower(shareNameOf(fsh, userInfo.Username))] = true
	}

	//Take the user off the shares of drives they lost
	currentShares, err := s.GetUsersShare(userInfo.Username)
	if err != nil {
		return err
	}
	driveShares := map[string]bool{}
	for _, fsh := range s.allDrives() {
		driveShares[strings.ToLower(shareNameOf(fsh, userInfo.Username))] = true
	}
	for _, share := range currentShares {
		name := strings.ToLower(share.Name)
		if !driveShares[name] || wanted[name] {
			continue
		}
		if err := s.RemoveUserFromSambaShare(share.Name, userInfo.Username); err != nil {
			return err
		}
	}
	return nil
}

// ensureUserShare gives a user the share of a drive, at the given level
func (s *ShareManager) ensureUserShare(fsh *filesystem.FileSystemHandler, username string, readOnly bool) error {
	shareName := shareNameOf(fsh, username)
	shareExists, err := s.ShareExists(shareName)
	if err != nil {
		return err
	}

	if !shareExists {
		//Try to create the share
		shareAbsolutePath, err := filepath.Abs(drivePathOf(fsh, username))
		if err != nil {
			logger.PrintAndLog("Samba", "[Samba] Unable to generate share config for path: "+drivePathOf(fsh, username), nil)
			return nil
		}
		if !utils.FileExists(shareAbsolutePath) {
			//Folder not exists. Continue
			logger.PrintAndLog("Samba", "[Samba] Path not exists for file system handler: "+shareAbsolutePath, nil)
			return nil
		}

		//Ok! Create the share with this username
		share := &ShareConfig{
			Name:       shareName,
			Path:       shareAbsolutePath,
			ValidUsers: []string{username},
			ReadOnly:   false,
			Browseable: !fsh.RequierUserIsolation(),
			GuestOk:    false,
		}
		if readOnly {
			share.ReadList = []string{username}
		}
		return s.CreateNewSambaShare(share)
	}

	//Share exists. Add this user to such share
	if err := s.AddUserToSambaShare(shareName, username); err != nil {
		return err
	}
	return s.setUserReadOnly(shareName, username, readOnly)
}

// setUserReadOnly puts a user on or off the read list of a share
func (s *ShareManager) setUserReadOnly(shareName string, username string, readOnly bool) error {
	share, err := s.GetShareByName(shareName)
	if err != nil {
		return err
	}

	listed := false
	readList := []string{}
	for _, name := range share.ReadList {
		if strings.EqualFold(name, username) {
			listed = true
			continue
		}
		readList = append(readList, name)
	}
	if listed == readOnly {
		return nil
	}
	if readOnly {
		readList = append(readList, username)
	}
	share.ReadList = readList

	//Delete the old one and create the new share with the updated list
	if err := s.RemoveSambaShareConfig(shareName); err != nil {
		return err
	}
	return s.CreateNewSambaShare(share)
}

// SyncDriveAccess brings the shares of every activated user in line with the
// drive access lists, after a list has changed
func (s *ShareManager) SyncDriveAccess() error {
	shares, err := s.ReadSambaShares()
	if err != nil {
		return err
	}

	//Everyone named in a share has activated their account
	activated := map[string]bool{}
	for _, share := range s.FilterSystemCreatedShares(shares) {
		for _, username := range share.ValidUsers {
			activated[username] = true
		}
	}

	for username := range activated {
		if !s.UserHandler.GetAuthAgent().UserExists(username) {
			//A unix account an admin added by hand
			continue
		}
		userInfo, err := s.UserHandler.GetUserInfoFromUsername(username)
		if err != nil {
			continue
		}
		if err := s.syncUserShares(userInfo); err != nil {
			return err
		}
	}

	if !s.IsEnabled() {
		return nil
	}
	return restartSmbd()
}
