package share

/*
	Share management operations

	Everything that creates, edits, removes or lists shares on behalf of a
	signed in user. The HTTP handlers in api.go and the AGI share library both
	go through these, so permission checks live here and only here.
*/

import (
	"errors"
	"fmt"
	"sort"
	"time"

	filesystem "imuslab.com/arozos/mod/filesystem"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/share/shareEntry"
	"imuslab.com/arozos/mod/user"
)

// Craete a new file or folder share, or return the existing first share of the path
func (s *Manager) CreateNewShare(userinfo *user.User, srcFsh *filesystem.FileSystemHandler, vpath string) (*shareEntry.ShareOption, error) {
	if srcFsh == nil {
		return nil, errors.New("Invalid vpath given")
	}
	//Translate the vpath to realpath
	return s.options.ShareEntryTable.CreateNewShare(srcFsh, vpath, userinfo.Username, userinfo.GetUserPermissionGroupNames())
}

// CreateShare always adds a new share with the given settings to the path
func (s *Manager) CreateShare(userinfo *user.User, vpath string, settings shareEntry.ShareSettings) (*shareEntry.ShareOption, error) {
	srcFsh := userinfo.GetRootFSHFromVpathInUserScope(vpath)
	if srcFsh == nil {
		return nil, errors.New("Invalid vpath given")
	}

	settings, err := s.resolveRecipients(userinfo, settings)
	if err != nil {
		return nil, err
	}

	so, err := s.options.ShareEntryTable.CreateShare(srcFsh, vpath, userinfo.Username, settings)
	if err != nil {
		return nil, err
	}

	//Invited users have access right away; let them know
	s.notifyInvitees(nil, so, userinfo.Username)
	return so, nil
}

// UpdateShare changes the settings of an existing share
func (s *Manager) UpdateShare(userinfo *user.User, uuid string, settings shareEntry.ShareSettings) (*shareEntry.ShareOption, error) {
	so := s.GetShareObjectFromUUID(uuid)
	if so == nil {
		return nil, errors.New("Share UUID not exists")
	}

	if !s.CanModifyShare(userinfo, so) {
		return nil, errors.New("Permission Denied")
	}

	//Same group shares snapshot the groups of the share owner, not the editor
	owner, err := s.options.UserHandler.GetUserInfoFromUsername(so.Owner)
	if err != nil {
		return nil, errors.New("Share owner not exists")
	}
	settings, err = s.resolveRecipients(owner, settings)
	if err != nil {
		return nil, err
	}

	updated, err := s.options.ShareEntryTable.UpdateShare(uuid, settings)
	if err != nil {
		return nil, err
	}

	//Only the users / groups added by this change are notified
	s.notifyInvitees(so, updated, userinfo.Username)
	return updated, nil
}

// resolveRecipients fills in the owner's groups for same group shares and
// checks that invited users and groups exist.
func (s *Manager) resolveRecipients(owner *user.User, settings shareEntry.ShareSettings) (shareEntry.ShareSettings, error) {
	if settings.Permission == nil {
		return settings, nil
	}

	switch *settings.Permission {
	case shareEntry.PermissionSameGroup:
		settings.Accessibles = owner.GetUserPermissionGroupNames()
	case shareEntry.PermissionUsers:
		authAgent := s.options.UserHandler.GetAuthAgent()
		for _, username := range settings.Accessibles {
			if username != "" && !authAgent.UserExists(username) {
				return settings, errors.New("User not exists: " + username)
			}
		}
	case shareEntry.PermissionGroups:
		permissionHandler := s.options.UserHandler.GetPermissionHandler()
		for _, group := range settings.Accessibles {
			if group != "" && !permissionHandler.GroupExists(group) {
				return settings, errors.New("Group not exists: " + group)
			}
		}
	}
	return settings, nil
}

/*
Check if the user can open the share in File Manager

There are two conditions where the user can open the file in file manager
1. If the user is the owner of the file
2. If the user is NOT the owner of the file but the target fsh is public accessible and in user's fsh list
*/
func (s *Manager) UserCanOpenShareInFileManager(share *shareEntry.ShareOption, userinfo *user.User) bool {
	if share.Owner == userinfo.Username {
		return true
	}

	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(share.FileVirtualPath)
	if err != nil {
		//User do not have permission to access this fsh
		return false
	}

	rpath, _ := fsh.FileSystemAbstraction.VirtualPathToRealPath(share.FileVirtualPath, userinfo.Username)
	if fsh.Hierarchy == "public" && fsh.FileSystemAbstraction.FileExists(rpath) {
		return true
	}

	return false
}

func (s *Manager) ListAllShareByFshId(fshId string, userinfo *user.User) []*shareEntry.ShareOption {
	results := []*shareEntry.ShareOption{}
	for _, thisShareOption := range s.options.ShareEntryTable.ListAllShares() {
		if userinfo.IsAdmin() || thisShareOption.IsAccessibleBy(userinfo.Username, userinfo.GetUserPermissionGroupNames()) {
			id, _, _ := filesystem.GetIDFromVirtualPath(thisShareOption.FileVirtualPath)
			if id == fshId {
				results = append(results, thisShareOption)
			}
		}
	}
	return results
}

// ListSharesOfPath returns the shares on the given path that the user can
// manage, oldest first.
func (s *Manager) ListSharesOfPath(userinfo *user.User, vpath string) []*shareEntry.ShareOption {
	ps, err := getPathHashFromUsernameAndVpath(userinfo, vpath)
	if err != nil {
		return []*shareEntry.ShareOption{}
	}

	results := []*shareEntry.ShareOption{}
	for _, so := range s.options.ShareEntryTable.GetSharesFromPathHash(ps) {
		if s.CanModifyShare(userinfo, so) {
			results = append(results, so)
		}
	}

	sort.SliceStable(results, func(i, j int) bool {
		return results[i].CreatedAt < results[j].CreatedAt
	})
	return results
}

func (s *Manager) ShareIsValid(thisShareOption *shareEntry.ShareOption) bool {
	vpath := thisShareOption.FileVirtualPath
	userinfo, err := s.options.UserHandler.GetUserInfoFromUsername(thisShareOption.Owner)
	if err != nil {
		return false
	}
	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(vpath)
	if err != nil {
		return false
	}

	fshAbs := fsh.FileSystemAbstraction
	rpath, _ := fshAbs.VirtualPathToRealPath(vpath, userinfo.Username)

	if !fshAbs.FileExists(rpath) {
		return false
	}

	return true
}

func (s *Manager) GetPathHashFromShare(thisShareOption *shareEntry.ShareOption) (string, error) {
	vpath := thisShareOption.FileVirtualPath
	userinfo, err := s.options.UserHandler.GetUserInfoFromUsername(thisShareOption.Owner)
	if err != nil {
		return "", err
	}
	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(vpath)
	if err != nil {
		return "", err
	}
	return shareEntry.GetPathHash(fsh, vpath, userinfo.Username)
}

/*
Nightly share maintenance. Registered on the system nightly task ticker.

1. Remove shares that have expired
2. Remove shares whose shared file no longer exists in the system
*/
func (s *Manager) ValidateAndClearShares() {
	for _, expired := range s.options.ShareEntryTable.RemoveExpiredShares(time.Now()) {
		logger.PrintAndLog("Share", "Removing expired share "+expired.UUID+" to file: "+expired.FileVirtualPath, nil)
	}

	//Iterate through all shares within the system
	for _, thisShareOption := range s.options.ShareEntryTable.ListAllShares() {
		if _, err := s.GetPathHashFromShare(thisShareOption); err != nil {
			//Unable to resolve path hash. Filesystem handler (or owner) is gone,
			//maybe only temporarily (e.g. an unmounted drive). Keep the share.
			continue
		}
		if !s.ShareIsValid(thisShareOption) {
			//This share source file don't exists anymore. Remove it
			err := s.options.ShareEntryTable.DeleteShareByUUID(thisShareOption.UUID)
			if err != nil {
				logger.PrintAndLog("Share", fmt.Sprint("Failed to remove share ", thisShareOption.UUID), err)
				continue
			}
			logger.PrintAndLog("Share", "Removing share to file: "+thisShareOption.FileRealPath+" as it no longer exists", nil)
		}
	}
}

// Check if the user has the permission to modify the shares on this path
func (s *Manager) CanModifyShareEntry(userinfo *user.User, vpath string) bool {
	shareEntry := s.GetShareObjectFromUserAndVpath(userinfo, vpath)
	if shareEntry == nil {
		//Share entry not found
		return false
	}
	return s.CanModifyShare(userinfo, shareEntry)
}

// CanModifyShare reports whether the user can edit or remove the given share:
// admins, the share owner, and writers of a public storage the file sits on.
func (s *Manager) CanModifyShare(userinfo *user.User, so *shareEntry.ShareOption) bool {
	//Check if the user is the share owner or the user is admin
	if userinfo.IsAdmin() {
		return true
	} else if userinfo.Username == so.Owner {
		return true
	}

	//Public fsh where the user and owner both can access
	vpath := so.FileVirtualPath
	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(vpath)
	if err != nil {
		return false
	}
	rpath, _ := fsh.FileSystemAbstraction.VirtualPathToRealPath(vpath, userinfo.Username)
	if userinfo.CanWrite(vpath) && fsh.Hierarchy == "public" && fsh.FileSystemAbstraction.FileExists(rpath) {
		return true
	}

	return false
}

// Remove all the shares on the given path that the user can modify
func (s *Manager) DeleteShareByVpath(userinfo *user.User, vpath string) error {
	shares := s.ListSharesOfPath(userinfo, vpath)
	if len(shares) == 0 {
		if s.FileIsShared(userinfo, vpath) {
			return errors.New("Permission denied")
		}
		return nil
	}
	for _, so := range shares {
		if err := s.options.ShareEntryTable.DeleteShareByUUID(so.UUID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Manager) DeleteShareByUUID(userinfo *user.User, uuid string) error {
	so := s.GetShareObjectFromUUID(uuid)
	if so == nil {
		return errors.New("Invalid share uuid")
	}

	if !s.CanModifyShare(userinfo, so) {
		return errors.New("Permission denied")
	}

	return s.options.ShareEntryTable.DeleteShareByUUID(uuid)
}

func (s *Manager) GetShareUUIDFromUserAndVpath(userinfo *user.User, vpath string) string {
	ps, err := getPathHashFromUsernameAndVpath(userinfo, vpath)
	if err != nil {
		return ""
	}
	return s.options.ShareEntryTable.GetShareUUIDFromPathHash(ps)
}

// GetShareObjectFromUserAndVpath returns the first share on the path, or nil
func (s *Manager) GetShareObjectFromUserAndVpath(userinfo *user.User, vpath string) *shareEntry.ShareOption {
	ps, err := getPathHashFromUsernameAndVpath(userinfo, vpath)
	if err != nil {
		return nil
	}
	return s.options.ShareEntryTable.GetShareObjectFromPathHash(ps)
}

func (s *Manager) GetShareObjectFromUUID(uuid string) *shareEntry.ShareOption {
	return s.options.ShareEntryTable.GetShareObjectFromUUID(uuid)
}

// FileIsShared reports whether the path has at least one active share
func (s *Manager) FileIsShared(userinfo *user.User, vpath string) bool {
	ps, err := getPathHashFromUsernameAndVpath(userinfo, vpath)
	if err != nil {
		return false
	}

	return s.options.ShareEntryTable.FileIsShared(ps)
}

func (s *Manager) RemoveShareByUUID(userinfo *user.User, uuid string) error {
	shareObject := s.GetShareObjectFromUUID(uuid)
	if shareObject == nil {
		return errors.New("Share entry not found")
	}
	if !s.CanModifyShare(userinfo, shareObject) {
		return errors.New("Permission denied")
	}
	return s.options.ShareEntryTable.RemoveShareByUUID(uuid)
}

func getPathHashFromUsernameAndVpath(userinfo *user.User, vpath string) (string, error) {
	fsh, err := userinfo.GetFileSystemHandlerFromVirtualPath(vpath)
	if err != nil {
		return "", err
	}
	return shareEntry.GetPathHash(fsh, vpath, userinfo.Username)
}
