package user

import "log"

//Get the user's handler
func (u *User) Parent() *UserHandler {
	return u.parent
}

//Remove the current user
func (u *User) RemoveUser() {
	//Remove the user storage quota settings
	log.Println("Removing User Quota: ", u.Username)
	u.StorageQuota.RemoveUserQuota()

	//Remove the user authentication register
	u.parent.authAgent.UnregisterUser(u.Username)
}

//Get the current user icon
func (u *User) GetUserIcon() string {
	var userIconpath []byte
	u.parent.database.Read("auth", "profilepic/"+u.Username, &userIconpath)
	return string(userIconpath)
}

//Set the current user icon
func (u *User) SetUserIcon(base64data string) {
	u.parent.database.Write("auth", "profilepic/"+u.Username, []byte(base64data))
}
