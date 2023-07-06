package auth

/*
	ArOZ Online Authentication Module
	author: tobychui

	This system make use of sessions (similar to PHP SESSION) to remember the user login.
	See https://gowebexamples.com/sessions/ for detail.

	Auth database are stored as the following key

	auth/login/{username}/passhash => hashed password
	auth/login/{username}/permission => permission level

	Other system variables related to auth

	auth/users/usercount => Number of users in the system

	Pre-requirement: imuslab.com/arozos/mod/database
*/

import (
	"crypto/sha512"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"

	"encoding/hex"
	"log"
	"time"

	"github.com/gorilla/sessions"

	"imuslab.com/arozos/mod/auth/accesscontrol/blacklist"
	"imuslab.com/arozos/mod/auth/accesscontrol/whitelist"
	"imuslab.com/arozos/mod/auth/authlogger"
	"imuslab.com/arozos/mod/auth/explogin"
	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/network"
	"imuslab.com/arozos/mod/utils"
)

type AuthAgent struct {
	//Session related
	SessionName             string
	SessionStore            *sessions.CookieStore
	Database                *db.Database
	LoginRedirectionHandler func(http.ResponseWriter, *http.Request)

	//Token related
	ExpireTime             int64 //Set this to 0 to disable token access
	tokenStore             sync.Map
	terminateTokenListener chan bool
	mutex                  *sync.Mutex

	//Autologin Related
	AllowAutoLogin  bool
	autoLoginTokens []*AutoLoginToken

	//Exponential Delay Retry Handler
	ExpDelayHandler *explogin.ExpLoginHandler

	//IPLists manager
	WhitelistManager *whitelist.WhiteList
	BlacklistManager *blacklist.BlackList

	//Account Switcher
	SwitchableAccountManager *SwitchableAccountPoolManager

	//Logger
	Logger *authlogger.Logger
}

type AuthEndpoints struct {
	Login         string
	Logout        string
	Register      string
	CheckLoggedIn string
	Autologin     string
}

// Constructor
func NewAuthenticationAgent(sessionName string, key []byte, sysdb *db.Database, allowReg bool, loginRedirectionHandler func(http.ResponseWriter, *http.Request)) *AuthAgent {
	store := sessions.NewCookieStore(key)
	err := sysdb.NewTable("auth")
	if err != nil {
		log.Println("Failed to create auth database. Terminating.")
		panic(err)
	}

	//Creat a ticker to clean out outdated token every 5 minutes
	ticker := time.NewTicker(300 * time.Second)
	done := make(chan bool)

	//Create a exponential login delay handler
	expLoginHandler := explogin.NewExponentialLoginHandler(2, 10800)

	//Create a new whitelist manager
	thisWhitelistManager := whitelist.NewWhitelistManager(sysdb)

	//Create a new blacklist manager
	thisBlacklistManager := blacklist.NewBlacklistManager(sysdb)

	//Create a new logger for logging all login request
	newLogger, err := authlogger.NewLogger()
	if err != nil {
		panic(err)
	}

	//Create a new AuthAgent object
	newAuthAgent := AuthAgent{
		SessionName:             sessionName,
		SessionStore:            store,
		Database:                sysdb,
		LoginRedirectionHandler: loginRedirectionHandler,
		tokenStore:              sync.Map{},
		ExpireTime:              120,
		terminateTokenListener:  done,
		mutex:                   &sync.Mutex{},

		//Auto login management
		AllowAutoLogin:  false,
		autoLoginTokens: []*AutoLoginToken{},

		//Blacklist management
		WhitelistManager: thisWhitelistManager,
		BlacklistManager: thisBlacklistManager,
		ExpDelayHandler:  expLoginHandler,

		//Switchable Account Pool Manager
		Logger: newLogger,
	}

	poolManager := NewSwitchableAccountPoolManager(sysdb, &newAuthAgent, key)
	newAuthAgent.SwitchableAccountManager = poolManager

	//Create a timer to listen to its token storage
	go func(listeningAuthAgent *AuthAgent) {
		for {
			select {
			case <-done:
				return
			case <-ticker.C:
				listeningAuthAgent.ClearTokenStore()
			}
		}
	}(&newAuthAgent)

	//Return the authAgent
	return &newAuthAgent
}

// Close the authAgent listener
func (a *AuthAgent) Close() {
	//Stop the token listening
	a.terminateTokenListener <- true

	//Close the auth logger database
	a.Logger.Close()
}

// This function will handle an http request and redirect to the given login address if not logged in
func (a *AuthAgent) HandleCheckAuth(w http.ResponseWriter, r *http.Request, handler func(http.ResponseWriter, *http.Request)) {
	if a.CheckAuth(r) {
		//User already logged in
		handler(w, r)
	} else {
		//User not logged in
		a.LoginRedirectionHandler(w, r)
	}
}

// Handle login request, require POST username and password
func (a *AuthAgent) HandleLogin(w http.ResponseWriter, r *http.Request) {

	//Get username from request using POST mode
	username, err := utils.PostPara(r, "username")
	if err != nil {
		//Username not defined
		log.Println("[System Auth] Someone trying to login with username: " + username)
		//Write to log
		a.Logger.LogAuth(r, false)
		sendErrorResponse(w, "Username not defined or empty.")
		return
	}

	//Get password from request using POST mode
	password, err := utils.PostPara(r, "password")
	if err != nil {
		//Password not defined
		a.Logger.LogAuth(r, false)
		sendErrorResponse(w, "Password not defined or empty.")
		return
	}

	//Get rememberme settings
	rememberme := false
	rmbme, _ := utils.PostPara(r, "rmbme")
	if rmbme == "true" {
		rememberme = true
	}

	//Check Exponential Login Handler
	ok, nextRetryIn := a.ExpDelayHandler.AllowImmediateAccess(username, r)
	if !ok {
		//Too many request! (maybe the account is under brute force attack?)
		a.ExpDelayHandler.AddUserRetrycount(username, r)
		sendErrorResponse(w, "Too many request! Next retry in "+strconv.Itoa(int(nextRetryIn))+" seconds")
		return
	}

	//Check the database and see if this user is in the database
	passwordCorrect, rejectionReason := a.ValidateUsernameAndPasswordWithReason(username, password)
	//The database contain this user information. Check its password if it is correct
	if passwordCorrect {
		//Password correct
		//Check if this request origin is allowed to access
		ok, reasons := a.ValidateLoginRequest(w, r)
		if !ok {
			sendErrorResponse(w, reasons.Error())
			return
		}

		// Set user as authenticated
		a.LoginUserByRequest(w, r, username, rememberme)

		//Reset user retry count if any
		a.ExpDelayHandler.ResetUserRetryCount(username, r)

		//Print the login message to console
		log.Println(username + " logged in.")
		a.Logger.LogAuth(r, true)
		sendOK(w)
	} else {
		//Password incorrect
		log.Println(username + " login request rejected: " + rejectionReason)

		//Add to retry count
		a.ExpDelayHandler.AddUserRetrycount(username, r)
		sendErrorResponse(w, rejectionReason)
		a.Logger.LogAuth(r, false)
		return
	}
}

func (a *AuthAgent) ValidateUsernameAndPassword(username string, password string) bool {
	succ, _ := a.ValidateUsernameAndPasswordWithReason(username, password)
	return succ
}

// validate the username and password, return reasons if the auth failed
func (a *AuthAgent) ValidateUsernameAndPasswordWithReason(username string, password string) (bool, string) {
	hashedPassword := Hash(password)
	var passwordInDB string
	err := a.Database.Read("auth", "passhash/"+username, &passwordInDB)
	if err != nil {
		//User not found or db exception
		//log.Println("[System Auth] " + username + " login with incorrect password")
		return false, "Invalid username or password"
	}

	if passwordInDB == hashedPassword {
		return true, ""
	} else {
		return false, "Invalid username or password"
	}
}

// Validate the user request for login, return true if the target request original is not blocked
func (a *AuthAgent) ValidateLoginRequest(w http.ResponseWriter, r *http.Request) (bool, error) {
	//Get the ip address of the request
	clientIP, err := network.GetIpFromRequest(r)
	if err != nil {
		return false, nil
	}

	return a.ValidateLoginIpAccess(clientIP)
}

func (a *AuthAgent) ValidateLoginIpAccess(ipv4 string) (bool, error) {
	ipv4 = strings.ReplaceAll(ipv4, " ", "")
	//Check if the account is whitelisted
	if a.WhitelistManager.Enabled && !a.WhitelistManager.IsWhitelisted(ipv4) {
		//Whitelist enabled but this IP is not whitelisted
		return false, errors.New("Your IP is not whitelisted on this host")
	}

	//Check if the account is banned
	if a.BlacklistManager.Enabled && a.BlacklistManager.IsBanned(ipv4) {
		//This user is banned
		return false, errors.New("Your IP is banned by this host")
	}
	return true, nil
}

// Login the user by creating a valid session for this user
func (a *AuthAgent) LoginUserByRequest(w http.ResponseWriter, r *http.Request, username string, rememberme bool) {
	session, _ := a.SessionStore.Get(r, a.SessionName)

	session.Values["authenticated"] = true
	session.Values["username"] = username
	session.Values["rememberMe"] = rememberme

	//Check if remember me is clicked. If yes, set the maxage to 1 week.
	if rememberme {
		session.Options = &sessions.Options{
			MaxAge: 3600 * 24 * 7, //One week
			Path:   "/",
		}
	} else {
		session.Options = &sessions.Options{
			MaxAge: 3600 * 1, //One hour
			Path:   "/",
		}
	}
	session.Save(r, w)
}

// Handle logout, reply OK after logged out. WILL NOT DO REDIRECTION
func (a *AuthAgent) HandleLogout(w http.ResponseWriter, r *http.Request) {
	username, _ := a.GetUserName(w, r)
	if username != "" {
		log.Println(username + " logged out.")
	}

	//Clear user switchable account pools
	fallbackAccount, _ := a.SwitchableAccountManager.HandleLogoutforUser(w, r)

	// Revoke users authentication
	err := a.Logout(w, r)
	if err != nil {
		sendErrorResponse(w, "Logout failed")
		return
	}

	if fallbackAccount != "" {
		//Switch to fallback account
		a.LoginUserByRequest(w, r, fallbackAccount, true)
	}

	w.Write([]byte("OK"))
}

func (a *AuthAgent) Logout(w http.ResponseWriter, r *http.Request) error {
	session, err := a.SessionStore.Get(r, a.SessionName)
	if err != nil {
		return err
	}
	session.Values["authenticated"] = false
	session.Values["username"] = nil
	session.Save(r, w)

	return nil
}

// Get the current session username from request
func (a *AuthAgent) GetUserName(w http.ResponseWriter, r *http.Request) (string, error) {
	if a.CheckAuth(r) {
		//This user has logged in.
		session, _ := a.SessionStore.Get(r, a.SessionName)
		return session.Values["username"].(string), nil
	} else {
		//This user has not logged in.
		return "", errors.New("User not logged in")
	}
}

// Check if the user has logged in, return true / false in JSON
func (a *AuthAgent) CheckLogin(w http.ResponseWriter, r *http.Request) {
	if a.CheckAuth(r) {
		sendJSONResponse(w, "true")
	} else {
		sendJSONResponse(w, "false")
	}
}

// Handle new user register. Require POST username, password, group.
func (a *AuthAgent) HandleRegister(w http.ResponseWriter, r *http.Request) {
	userCount := a.GetUserCounts()

	//Get username from request
	newusername, err := utils.PostPara(r, "username")
	if err != nil {
		sendTextResponse(w, "Error. Missing 'username' paramter")
		return
	}

	//Get password from request
	password, err := utils.PostPara(r, "password")
	if err != nil {
		sendTextResponse(w, "Error. Missing 'password' paramter")
		return
	}

	//Set permission group to default
	group, err := utils.PostPara(r, "group")
	if err != nil {
		sendTextResponse(w, "Error. Missing 'group' paramter")
		return
	}

	//Check if the number of users in the system is == 0. If yes, there are no need to login before registering new user
	if userCount > 0 {
		//Require login to create new user
		if a.CheckAuth(r) == false {
			//System have more than one person and this user is not logged in
			sendErrorResponse(w, "Login is needed to create new user")
			return
		}

	}

	//Ok to proceed create this user
	err = a.CreateUserAccount(newusername, password, []string{group})
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Return to the client with OK
	sendOK(w)
	log.Println("[System Auth] New user " + newusername + " added to system.")
	return
}

// Check authentication from request header's session value
func (a *AuthAgent) CheckAuth(r *http.Request) bool {
	session, _ := a.SessionStore.Get(r, a.SessionName)
	// Check if user is authenticated
	if auth, ok := session.Values["authenticated"].(bool); !ok || !auth {
		return false
	}
	return true
}

// Handle de-register of users. Require POST username.
// THIS FUNCTION WILL NOT CHECK FOR PERMISSION. PLEASE USE WITH PERMISSION HANDLER
func (a *AuthAgent) HandleUnregister(w http.ResponseWriter, r *http.Request) {
	//Check if the user is logged in
	if !a.CheckAuth(r) {
		//This user has not logged in
		sendErrorResponse(w, "Login required to remove user from the system.")
		return
	}

	//Check for permission of this user.
	/*
		if !system_permission_checkUserIsAdmin(w,r){
			//This user is not admin. No permission to access this function
			sendErrorResponse(w, "Permission denied")
		}
	*/

	//Get username from request
	username, err := utils.PostPara(r, "username")
	if err != nil {
		sendErrorResponse(w, "Missing 'username' paramter")
		return
	}

	err = a.UnregisterUser(username)
	if err != nil {
		sendErrorResponse(w, err.Error())
		return
	}

	//Return to the client with OK
	sendOK(w)
	log.Println("[system_auth] User " + username + " has been removed from the system.")
	return
}

func (a *AuthAgent) UnregisterUser(username string) error {
	//Check if the user exists in the system database.
	if !a.Database.KeyExists("auth", "passhash/"+username) {
		//This user do not exists.
		return errors.New("This user does not exists.")
	}

	//OK! Remove the user from the database
	a.Database.Delete("auth", "passhash/"+username)
	a.Database.Delete("auth", "group/"+username)
	a.Database.Delete("auth", "acstatus/"+username)
	a.Database.Delete("auth", "profilepic/"+username)

	//Remove the user's autologin tokens
	a.RemoveAutologinTokenByUsername(username)

	//Remove user from switchable accounts
	a.SwitchableAccountManager.RemoveUserFromAllSwitchableAccountPool(username)
	return nil
}

// Get the number of users in the system
func (a *AuthAgent) GetUserCounts() int {
	entries, _ := a.Database.ListTable("auth")
	usercount := 0
	for _, keypairs := range entries {
		if strings.Contains(string(keypairs[0]), "passhash/") {
			//This is a user registry
			usercount++
		}
	}

	if usercount == 0 {
		log.Println("There are no user in the database.")
	}
	return usercount
}

// List all username within the system
func (a *AuthAgent) ListUsers() []string {
	entries, _ := a.Database.ListTable("auth")
	results := []string{}
	for _, keypairs := range entries {
		if strings.Contains(string(keypairs[0]), "group/") {
			username := strings.Split(string(keypairs[0]), "/")[1]
			results = append(results, username)
		}
	}
	return results
}

// Check if the given username exists
func (a *AuthAgent) UserExists(username string) bool {
	userpasswordhash := ""
	err := a.Database.Read("auth", "passhash/"+username, &userpasswordhash)
	if err != nil || userpasswordhash == "" {
		return false
	}
	return true
}

// Update the session expire time given the request header.
func (a *AuthAgent) UpdateSessionExpireTime(w http.ResponseWriter, r *http.Request) bool {
	session, _ := a.SessionStore.Get(r, a.SessionName)
	if session.Values["authenticated"].(bool) {
		//User authenticated. Extend its expire time
		rememberme := session.Values["rememberMe"].(bool)
		//Extend the session expire time
		if rememberme {
			session.Options = &sessions.Options{
				MaxAge: 3600 * 24 * 7, //One week
				Path:   "/",
			}
		} else {
			session.Options = &sessions.Options{
				MaxAge: 3600 * 1, //One hour
				Path:   "/",
			}
		}
		session.Save(r, w)
		return true
	} else {
		return false
	}
}

// Create user account
func (a *AuthAgent) CreateUserAccount(newusername string, password string, group []string) error {
	key := newusername

	hashedPassword := Hash(password)
	err := a.Database.Write("auth", "passhash/"+key, hashedPassword)
	if err != nil {
		return err
	}

	//Store this user's usergroup settings
	err = a.Database.Write("auth", "group/"+newusername, group)
	if err != nil {
		return err
	}
	return nil
}

// Hash the given raw string into sha512 hash
func Hash(raw string) string {
	h := sha512.New()
	h.Write([]byte(raw))
	return hex.EncodeToString(h.Sum(nil))
}
