package user

import (
	"fmt"

	"imuslab.com/arozos/mod/info/logger"
)

// Get the user's handler
func (u *User) Parent() *UserHandler {
	logger.DebugTrace("user", "User.Parent")
	return u.parent
}

// Remove the current user
func (u *User) RemoveUser() {
	logger.Debug("user", "User.RemoveUser")
	//Remove the user storage quota settings
	logger.PrintAndLog("User", fmt.Sprint("Removing User Quota: ", u.Username), nil)
	u.StorageQuota.RemoveUserQuota()

	//Remove the user authentication register
	u.parent.authAgent.UnregisterUser(u.Username)
}

// Get the target user icon
func (u *User) GetUserIcon() string {
	logger.Debug("user", "User.GetUserIcon")
	var userIconpath []byte
	u.parent.database.Read("auth", "profilepic/"+u.Username, &userIconpath)
	return string(userIconpath)
}

// Set the current user icon
func (u *User) SetUserIcon(base64data string) {
	if logger.IsDebugTrace() {
		logger.DebugTracef("user", "User.SetUserIcon: base64data=%.120q", base64data)
	}
	u.parent.database.Write("auth", "profilepic/"+u.Username, []byte(base64data))
}
