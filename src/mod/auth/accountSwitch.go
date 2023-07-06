package auth

import (
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/sessions"
	uuid "github.com/satori/go.uuid"
	"imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/utils"
)

/*
	Account Switch

	This script handle account switching logic

	The switchable account pools work like this
	Let say user A want to switch to user B account

	A will create a pool with user A and B username inside the pool
	The pool UUID will be returned to the client, and stored in local storage

	The client can always switch between A and B as both are in the pool and the
	client is logged in either A or B's account.
*/

type SwitchableAccount struct {
	Username   string //Username of the account
	LastSwitch int64  //Last time this account is accessed
}

type SwitchableAccountsPool struct {
	UUID     string               //UUID of this pool, one pool per browser instance
	Creator  string               //The user who created the pool. When logout, the pool is discarded
	Accounts []*SwitchableAccount //Accounts that is cross switchable in this pool
	parent   *SwitchableAccountPoolManager
}

type SwitchableAccountPoolManager struct {
	SessionStore *sessions.CookieStore
	SessionName  string
	Database     *database.Database
	ExpireTime   int64 //Expire time of the switchable account
	authAgent    *AuthAgent
}

// Create a new switchable account pool manager
func NewSwitchableAccountPoolManager(sysdb *database.Database, parent *AuthAgent, key []byte) *SwitchableAccountPoolManager {
	//Create new database table
	sysdb.NewTable("auth_acswitch")

	//Create new session store
	thisManager := SwitchableAccountPoolManager{
		SessionStore: sessions.NewCookieStore(key),
		SessionName:  "ao_acc",
		Database:     sysdb,
		ExpireTime:   604800,
		authAgent:    parent,
	}

	//Do an initialization cleanup
	go func() {
		thisManager.RunNightlyCleanup()
	}()

	//Return the manager
	return &thisManager
}

// When called, this will clear the account switching pool in which all users session has expired
func (m *SwitchableAccountPoolManager) RunNightlyCleanup() {
	pools, err := m.GetAllPools()
	if err != nil {
		log.Println("[auth] Unable to load account switching pools. Cleaning skipped: " + err.Error())
		return
	}

	for _, pool := range pools {
		pool.DeletePoolIfAllUserSessionExpired()
	}
}

// Handle switchable account listing for this browser
func (m *SwitchableAccountPoolManager) HandleSwitchableAccountListing(w http.ResponseWriter, r *http.Request) {
	//Get username and pool id
	currentUsername, err := m.authAgent.GetUserName(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	session, _ := m.SessionStore.Get(r, m.SessionName)
	poolid, ok := session.Values["poolid"].(string)
	if !ok {
		utils.SendErrorResponse(w, "invalid pool id given")
		return
	}

	//Check pool exists
	targetPool, err := m.GetPoolByID(poolid)
	if err != nil {
		//Pool expired. Unset the session
		session.Values["poolid"] = nil
		session.Save(r, w)
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Check if the user can access this pool
	if !targetPool.IsAccessibleBy(currentUsername) {
		//Unset the session
		session.Values["poolid"] = nil
		session.Save(r, w)
		utils.SendErrorResponse(w, "access denied")
		return
	}

	//Update the user Last Switch Time
	targetPool.UpdateUserLastSwitchTime(currentUsername)

	//OK. List all the information about the pool
	type AccountInfo struct {
		Username  string
		IsExpired bool
	}

	results := []*AccountInfo{}
	for _, acc := range targetPool.Accounts {
		results = append(results, &AccountInfo{
			Username:  acc.Username,
			IsExpired: (time.Now().Unix() > acc.LastSwitch+m.ExpireTime),
		})
	}
	js, _ := json.Marshal(results)
	utils.SendJSONResponse(w, string(js))
}

// Handle logout of the current user, return the fallback user if any
func (m *SwitchableAccountPoolManager) HandleLogoutforUser(w http.ResponseWriter, r *http.Request) (string, error) {
	currentUsername, err := m.authAgent.GetUserName(w, r)
	if err != nil {
		return "", err
	}

	session, _ := m.SessionStore.Get(r, m.SessionName)
	poolid, ok := session.Values["poolid"].(string)
	if !ok {
		return "", errors.New("user not in a any switchable account pool")
	}

	//Get the target pool
	targetpool, err := m.GetPoolByID(poolid)
	if err != nil {
		return "", err
	}

	//Remove the user from the pool
	targetpool.RemoveUser(currentUsername)

	//Check if the logout user is the creator. If yes, remove the pool
	if targetpool.Creator == currentUsername {
		targetpool.Delete()

		//Unset the session
		session.Values["poolid"] = nil
		session.Save(r, w)

		return "", nil
	}

	//return the creator so after logout, the client is switched back to the master account
	return targetpool.Creator, nil
}

// Logout all the accounts in the pool
func (m *SwitchableAccountPoolManager) HandleLogoutAllAccounts(w http.ResponseWriter, r *http.Request) {
	currentUsername, err := m.authAgent.GetUserName(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	session, _ := m.SessionStore.Get(r, m.SessionName)
	poolid, ok := session.Values["poolid"].(string)
	if !ok {
		utils.SendErrorResponse(w, "invalid pool id given")
		return
	}

	//Get the target pool
	targetpool, err := m.GetPoolByID(poolid)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	if !targetpool.IsAccessibleBy(currentUsername) {
		utils.SendErrorResponse(w, "permission denied")
		return
	}

	//Remove the pool
	targetpool.Delete()

	//Unset the session
	session.Values["poolid"] = nil
	session.Save(r, w)

	utils.SendOK(w)
}

// Handle account switching
func (m *SwitchableAccountPoolManager) HandleAccountSwitch(w http.ResponseWriter, r *http.Request) {
	previousUserName, err := m.authAgent.GetUserName(w, r)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	session, _ := m.SessionStore.Get(r, m.SessionName)
	poolid, ok := session.Values["poolid"].(string)
	if !ok {
		//No pool is given. Generate a pool for this request
		poolid = uuid.NewV4().String()
		newPool := SwitchableAccountsPool{
			UUID:    poolid,
			Creator: previousUserName,
			Accounts: []*SwitchableAccount{
				{
					Username:   previousUserName,
					LastSwitch: time.Now().Unix(),
				},
			},
			parent: m,
		}

		newPool.Save()

		session.Values["poolid"] = poolid
		session.Options = &sessions.Options{
			MaxAge: 3600 * 24 * 30, //One month
			Path:   "/",
		}
		session.Save(r, w)
	}

	//Get switchable pool from manager
	targetPool, err := m.GetPoolByID(poolid)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	//Check if this user can access this pool
	if !targetPool.IsAccessibleByRequest(w, r) {
		utils.SendErrorResponse(w, "access request denied: user not belongs to this account pool")
		return
	}

	//OK! Switch the user to alternative account
	username, err := utils.PostPara(r, "username")
	if err != nil {
		utils.SendErrorResponse(w, "invalid or empty username given")
		return
	}
	password, err := utils.PostPara(r, "password")
	if err != nil {
		//Password not given. Check for direct switch
		switchToTargetAlreadySwitchedBefore := targetPool.UserAlreadyInPool(username)
		if !switchToTargetAlreadySwitchedBefore {
			utils.SendErrorResponse(w, "account must be added before it can switch without password")
			return
		}

		//Check if the switching is expired
		lastSwitchTime := targetPool.GetLastSwitchTimeFromUsername(username)
		if time.Now().Unix() > lastSwitchTime+m.ExpireTime {
			//Already expired
			utils.SendErrorResponse(w, "target account session has expired")
			return
		}

		//Not expired. Switch over directly
		m.authAgent.LoginUserByRequest(w, r, username, true)
	} else {
		//Password given. Use Add User Account routine
		ok, reason := m.authAgent.ValidateUsernameAndPasswordWithReason(username, password)
		if !ok {
			utils.SendErrorResponse(w, reason)
			return
		}

		m.authAgent.LoginUserByRequest(w, r, username, true)

	}

	//Update the pool account info
	targetPool.UpdateUserPoolAccountInfo(username)
	targetPool.Save()

	js, _ := json.Marshal(poolid)
	utils.SendJSONResponse(w, string(js))

	//Debug print
	//js, _ = json.MarshalIndent(targetPool, "", " ")
	//fmt.Println("Switching Pool Updated", string(js))
}

func (m *SwitchableAccountPoolManager) GetAllPools() ([]*SwitchableAccountsPool, error) {
	results := []*SwitchableAccountsPool{}
	entries, err := m.Database.ListTable("auth_acswitch")
	if err != nil {
		return results, err
	}
	for _, keypairs := range entries {
		//thisPoolID := string(keypairs[0])
		thisPool := SwitchableAccountsPool{}
		err = json.Unmarshal(keypairs[1], &thisPool)
		if err == nil {
			thisPool.parent = m
			results = append(results, &thisPool)
		}
	}

	return results, nil
}

// Get a switchable account pool by its id
func (m *SwitchableAccountPoolManager) GetPoolByID(uuid string) (*SwitchableAccountsPool, error) {
	targetPool := SwitchableAccountsPool{}
	err := m.authAgent.Database.Read("auth_acswitch", uuid, &targetPool)
	if err != nil {
		return nil, errors.New("pool with given uuid not found")
	}
	targetPool.parent = m
	return &targetPool, nil
}

// Remove user from all switch pool, which should be called when a user is logged out or removed
func (p *SwitchableAccountPoolManager) RemoveUserFromAllSwitchableAccountPool(username string) error {
	allAccountPool, err := p.GetAllPools()
	if err != nil {
		return err
	}
	for _, accountPool := range allAccountPool {
		if accountPool.IsAccessibleBy(username) {
			//aka this user is in the pool
			accountPool.RemoveUser(username)
		}
	}
	return nil
}

func (p *SwitchableAccountPoolManager) ExpireUserFromAllSwitchableAccountPool(username string) error {
	allAccountPool, err := p.GetAllPools()
	if err != nil {
		return err
	}
	for _, accountPool := range allAccountPool {
		fmt.Println(allAccountPool)
		if accountPool.IsAccessibleBy(username) {
			//aka this user is in the pool
			accountPool.ExpireUser(username)
		}
	}
	return nil
}

/*
	Switachable Account Pool functions
*/

// Check if the requester can switch within target pool
func (p *SwitchableAccountsPool) IsAccessibleByRequest(w http.ResponseWriter, r *http.Request) bool {
	username, err := p.parent.authAgent.GetUserName(w, r)
	if err != nil {
		return false
	}
	return p.IsAccessibleBy(username)
}

// Check if a given username can switch within this pool
func (p *SwitchableAccountsPool) IsAccessibleBy(username string) bool {
	for _, account := range p.Accounts {
		if account.Username == username {
			return true
		}
	}
	return false
}

func (p *SwitchableAccountsPool) UserAlreadyInPool(username string) bool {
	for _, acc := range p.Accounts {
		if acc.Username == username {
			return true
		}
	}
	return false
}

func (p *SwitchableAccountsPool) UpdateUserLastSwitchTime(username string) bool {
	for _, acc := range p.Accounts {
		if acc.Username == username {
			acc.LastSwitch = time.Now().Unix()
		}
	}
	return false
}

func (p *SwitchableAccountsPool) GetLastSwitchTimeFromUsername(username string) int64 {
	for _, acc := range p.Accounts {
		if acc.Username == username {
			return acc.LastSwitch
		}
	}
	return 0
}

// Everytime switching to a given user in a pool, call this update function to
// update contents inside the pool
func (p *SwitchableAccountsPool) UpdateUserPoolAccountInfo(username string) {
	if !p.UserAlreadyInPool(username) {
		p.Accounts = append(p.Accounts, &SwitchableAccount{
			Username:   username,
			LastSwitch: time.Now().Unix(),
		})
	} else {
		p.UpdateUserLastSwitchTime(username)
	}
}

// Expire the session of a user manually
func (p *SwitchableAccountsPool) ExpireUser(username string) {
	for _, acc := range p.Accounts {
		if acc.Username == username {
			acc.LastSwitch = 0
		}
	}
	p.Save()
}

// Remove a user from the pool
func (p *SwitchableAccountsPool) RemoveUser(username string) {
	newAccountList := []*SwitchableAccount{}
	for _, acc := range p.Accounts {
		if acc.Username != username {
			newAccountList = append(newAccountList, acc)
		}
	}

	p.Accounts = newAccountList
	p.Save()
}

// Save changes of this pool to database
func (p *SwitchableAccountsPool) DeletePoolIfAllUserSessionExpired() {
	allExpred := true
	for _, acc := range p.Accounts {
		if !p.IsAccountExpired(acc) {
			allExpred = false
		}
	}

	if allExpred {
		//All account expired. Remove this pool
		p.Delete()
	}
}

// Save changes of this pool to database
func (p *SwitchableAccountsPool) Save() {
	p.parent.Database.Write("auth_acswitch", p.UUID, p)
}

// Delete this pool from database
func (p *SwitchableAccountsPool) Delete() error {
	return p.parent.Database.Delete("auth_acswitch", p.UUID)
}

// Check if an account is expired
func (p *SwitchableAccountsPool) IsAccountExpired(acc *SwitchableAccount) bool {
	return time.Now().Unix() > acc.LastSwitch+p.parent.ExpireTime
}
