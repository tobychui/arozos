package user

import (
	"errors"
	"log"
	"net/http"
	"os"

	"golang.org/x/sync/syncmap"

	auth "imuslab.com/aroz_online/mod/auth"
	db "imuslab.com/aroz_online/mod/database"
	permission "imuslab.com/aroz_online/mod/permission"
	quota "imuslab.com/aroz_online/mod/quota"
	storage "imuslab.com/aroz_online/mod/storage"
)

var (
	//Create a buffer to put the pointers to created user quota managers, mapped by username
	//quotaManagerBuffer map[string]*quota.QuotaHandler = map[string]*quota.QuotaHandler{}
	quotaManagerBuffer = syncmap.Map{}
)

type User struct {
	Username        string
	StorageQuota    *quota.QuotaHandler
	PermissionGroup []*permission.PermissionGroup
	HomeDirectories *storage.StoragePool

	parent *UserHandler
}

type UserHandler struct {
	authAgent *auth.AuthAgent
	database  *db.Database
	phandler  *permission.PermissionHandler
	basePool  *storage.StoragePool
}

//Initiate a new user handler
func NewUserHandler(systemdb *db.Database, authAgent *auth.AuthAgent, permissionHandler *permission.PermissionHandler, baseStoragePool *storage.StoragePool) (*UserHandler, error) {
	return &UserHandler{
		authAgent: authAgent,
		database:  systemdb,
		phandler:  permissionHandler,
		basePool:  baseStoragePool,
	}, nil
}

//Return the user handler's auth agent
func (u *UserHandler) GetAuthAgent() *auth.AuthAgent {
	return u.authAgent
}

func (u *UserHandler) GetPermissionHandler() *permission.PermissionHandler {
	return u.phandler
}

func (u *UserHandler) GetStoragePool() *storage.StoragePool {
	return u.basePool
}

func (u *UserHandler) GetDatabase() *db.Database {
	return u.database
}

func (u *User) Parent() *UserHandler {
	return u.parent
}

//Get User object from username
func (u *UserHandler) GetUserInfoFromUsername(username string) (*User, error) {
	//Check if user exists
	if !u.authAgent.UserExists(username) {
		return &User{}, errors.New("User not exists")
	}

	//Get the user's permission group
	permissionGroups, err := u.phandler.GetUsersPermissionGroup(username)
	if err != nil {
		return &User{}, err
	}

	//Create user directories in the Home Directories
	if u.basePool.Storages == nil {
		//This userhandler do not have a basepool?
		log.Println("USER HANDLER DO NOT HAVE BASEPOOL")
	} else {
		for _, store := range u.basePool.Storages {
			if store.Hierarchy == "user" {
				os.MkdirAll(store.Path+"/users/"+username, 0755)
			}
		}
	}

	thisUser := User{
		Username:        username,
		PermissionGroup: permissionGroups,
		HomeDirectories: u.basePool,

		parent: u,
	}

	//Get the storage quota manager for thus user
	var thisUserQuotaManager *quota.QuotaHandler
	if val, ok := quotaManagerBuffer.Load(username); ok {
		//user quota manager exists
		thisUserQuotaManager = val.(*quota.QuotaHandler)
	} else {
		//Get the largest quota from the user's group
		maxQuota := int64(0)
		for _, group := range permissionGroups {
			if group.DefaultStorageQuota == -1 {
				//Admin
				maxQuota = -1
				break
			} else if group.DefaultStorageQuota > maxQuota {
				//Other groups. Get the largest one
				maxQuota = group.DefaultStorageQuota
			}
		}

		//Create a new manager for this user
		allFsHandlers := thisUser.GetAllFileSystemHandler()
		thisUserQuotaManager = quota.NewUserQuotaHandler(u.database, username, allFsHandlers, maxQuota)

		//Push the manger to buffer
		quotaManagerBuffer.Store(username, thisUserQuotaManager)
	}

	thisUser.StorageQuota = thisUserQuotaManager

	//Return the user object
	return &thisUser, nil
}

//Get user obejct from session
func (u *UserHandler) GetUserInfoFromRequest(w http.ResponseWriter, r *http.Request) (*User, error) {
	username, err := u.authAgent.GetUserName(w, r)
	if err != nil {
		return &User{}, err
	}

	userObject, err := u.GetUserInfoFromUsername(username)
	if err != nil {
		return &User{}, err
	}
	return userObject, nil
}

//Remove the current user
func (u *User) RemoveUser() {
	//Remove the user storage quota settings
	log.Println("Removing User Quota", u.StorageQuota)
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
	return
}
