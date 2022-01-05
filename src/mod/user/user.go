package user

import (
	"errors"
	"log"
	"net/http"
	"os"

	"golang.org/x/sync/syncmap"

	auth "imuslab.com/arozos/mod/auth"
	db "imuslab.com/arozos/mod/database"
	permission "imuslab.com/arozos/mod/permission"
	quota "imuslab.com/arozos/mod/quota"
	"imuslab.com/arozos/mod/share/shareEntry"
	storage "imuslab.com/arozos/mod/storage"
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
	authAgent       *auth.AuthAgent
	database        *db.Database
	phandler        *permission.PermissionHandler
	basePool        *storage.StoragePool
	shareEntryTable **shareEntry.ShareEntryTable
}

//Initiate a new user handler
func NewUserHandler(systemdb *db.Database, authAgent *auth.AuthAgent, permissionHandler *permission.PermissionHandler, baseStoragePool *storage.StoragePool, shareEntryTable **shareEntry.ShareEntryTable) (*UserHandler, error) {
	return &UserHandler{
		authAgent:       authAgent,
		database:        systemdb,
		phandler:        permissionHandler,
		basePool:        baseStoragePool,
		shareEntryTable: shareEntryTable,
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

func (u *UserHandler) UpdateStoragePool(newpool *storage.StoragePool) {
	u.basePool = newpool
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

		if !thisUserQuotaManager.IsQuotaInitialized() {
			//This user quota hasn't been initalized. Initalize it now to match its group
			userMaxDefaultStorageQuota := permission.GetLargestStorageQuotaFromGroups(permissionGroups)
			thisUserQuotaManager.SetUserStorageQuota(userMaxDefaultStorageQuota)
		}
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
