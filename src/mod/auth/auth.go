package auth

/*
ArOZ Online Authentication Module
author: tobychui

This system make use of sessions (similar to PHP SESSION) to remember the user login.
See https://gowebexamples.com/sessions/ for detail.

Auth database are stored as the following key

auth/login/{username}/passhash => hashed password
auth/login/{username}/permission => permission level (wip)

Other system variables related to auth

auth/users/usercount => Number of users in the system

Pre-requirement: imuslab.com/aroz_online/mod/database
*/

import (
	"net/http"
	"errors"
	"strings"
    "crypto/sha512"
    //"encoding/json"
	"encoding/hex"
	"log"

	"github.com/gorilla/sessions"

	db "imuslab.com/aroz_online/mod/database"
)

type AuthAgent struct{
    SessionName string
	SessionStore *sessions.CookieStore
    Database *db.Database
    LoginRedirectionHandler func(http.ResponseWriter, *http.Request)
}

type AuthEndpoints struct{
    Login string
    Logout string
    Register string
    CheckLoggedIn string
}

//Constructor
func NewAuthenticationAgent(sessionName string, key []byte, sysdb *db.Database, allowReg bool, loginRedirectionHandler func(http.ResponseWriter, *http.Request)) *AuthAgent{
	store := sessions.NewCookieStore(key)
	err := sysdb.NewTable("auth")
	if err != nil{
		log.Println("Failed to create auth database. Terminating.")
		panic(err);
	}
	return &AuthAgent{
        SessionName: sessionName,
		SessionStore: store,
        Database: sysdb,
        LoginRedirectionHandler: loginRedirectionHandler,
	}
}

//This function will handle an http request and redirect to the given login address if not logged in
func (a *AuthAgent)HandleCheckAuth(w http.ResponseWriter, r *http.Request, handler func(http.ResponseWriter, *http.Request)){
    if a.CheckAuth(r){
        //User already logged in
        handler(w,r)
    }else{
        //User not logged in
        a.LoginRedirectionHandler(w,r)
    }
}

//Register APIs that requires public access
func (a *AuthAgent)RegisterPublicAPIs(ep AuthEndpoints){
    http.HandleFunc(ep.Login, a.HandleLogin)
    http.HandleFunc(ep.Logout, a.HandleLogout)
    http.HandleFunc(ep.Register, a.HandleRegister)
    http.HandleFunc(ep.CheckLoggedIn, a.CheckLogin)
}

//Handle login request, require POST username and password
func (a *AuthAgent)HandleLogin(w http.ResponseWriter, r *http.Request){
	session, _ := a.SessionStore.Get(r, a.SessionName)

	//Get username from request using POST mode
    username, err := mv(r, "username", true)
    if (err != nil){
        //Username not defined
        log.Println("[System Auth] Someone trying to login with username: " + username)
        sendErrorResponse(w,"Username not defined or empty.")
        return;
    }

    //Get password from request using POST mode
    password, err := mv(r, "password", true)
    if (err != nil){
        //Password not defined
        sendErrorResponse(w,"Password not defined or empty.")
        return;
    }

    //Get rememberme settings
    rememberme := false;
    rmbme, _ := mv(r, "rmbme", true)
    if (rmbme == "true"){
        rememberme = true;
    }

    //Check the database and see if this user is in the database
    hashedPassword := Hash(password)
    var passwordInDB string
    err = a.Database.Read("auth", "passhash/" + username, &passwordInDB)
    if (err != nil){
        //User not found or db exception
        log.Println("[System Auth] " + username + " login with incorrect password")
        sendErrorResponse(w,"Invalid username or password")
        return
    }

    //The database contain this user information. Check its password if it is correct
    if (passwordInDB == hashedPassword){
        //Password correct
        // Set user as authenticated
        session.Values["authenticated"] = true
        session.Values["username"] = username
        session.Values["rememberMe"] = rememberme

        //Check if remember me is clicked. If yes, set the maxage to 1 week.
        if (rememberme == true){
            session.Options = &sessions.Options{
                MaxAge: 3600 * 24 * 7, //One week
                Path: "/",
            }
        }else{
            session.Options = &sessions.Options{
                MaxAge: 3600 * 1, //One hour
                Path: "/",
            }
        }
        session.Save(r, w)
        
        //Print the login message to console
        log.Println( username + " logged in.");
        sendOK(w);
    }else{
        //Password incorrect
        sendErrorResponse(w, "Invalid username or password")
        return;
    }
}

//Handle logout, reply OK after logged out. WILL NOT DO REDIRECTION
func (a *AuthAgent)HandleLogout(w http.ResponseWriter, r *http.Request){
    username, _ := a.GetUserName(w,r);
    log.Println(username + " logged out.");
    // Revoke users authentication
    err := a.Logout(w,r)
    if err != nil{
        sendErrorResponse(w, "Logout failed")
        return
    }
    
    w.Write([]byte("OK"))
}

func (a *AuthAgent)Logout(w http.ResponseWriter, r *http.Request) error{
    session, err := a.SessionStore.Get(r, a.SessionName)
    if err != nil{
        return err
    }
    session.Values["authenticated"] = false
    session.Values["username"] = nil
    session.Save(r, w)
    return nil
}

//Get the current session username from request
func (a *AuthAgent)GetUserName(w http.ResponseWriter, r *http.Request) (string, error){
	if (a.CheckAuth(r)){
        //This user has logged in.
        session, _ := a.SessionStore.Get(r, a.SessionName)
        return session.Values["username"].(string), nil
    }else{
        //This user has not logged in.
        return "", errors.New("User not logged in");
    }
}

//Check if the user has logged in, return true / false in JSON
func (a *AuthAgent)CheckLogin(w http.ResponseWriter, r *http.Request){
	if a.CheckAuth(r) != false{
		sendJSONResponse(w, "true")
	}else{
		sendJSONResponse(w, "false")
	}
}


//Handle new user register. Require POST username, password, group. 
func (a *AuthAgent)HandleRegister(w http.ResponseWriter, r *http.Request){
	userCount := a.GetUserCounts();

    //Get username from request
    newusername,err :=  mv(r, "username", true)
    if (err != nil){
        sendTextResponse(w,"Error. Missing 'username' paramter")
        return;
    }

    //Get password from request
    password,err :=  mv(r, "password", true)
    if (err != nil){
        sendTextResponse(w,"Error. Missing 'password' paramter")
        return;
    }

    //Set permission group to default
    group, err :=  mv(r, "group", true)
    if (err != nil){
        sendTextResponse(w,"Error. Missing 'group' paramter")
        return;
    }
    
    //Check if the number of users in the system is == 0. If yes, there are no need to login before registering new user
    if (userCount > 0){
        //Require login to create new user
        if (a.CheckAuth(r) == false){
            //System have more than one person and this user is not logged in
            sendErrorResponse(w,"Login is needed to create new user")
            return;
        }

    }

    //Ok to proceed create this user
    err = a.CreateUserAccount(newusername, password, []string{group})
    if (err != nil){
        sendErrorResponse(w, err.Error())
        return
    }

    //Return to the client with OK
    sendOK(w)
    log.Println("[System Auth] New user " + newusername + " added to system.");
    return;
}

//Check authentication from request header's session value
func (a *AuthAgent)CheckAuth(r *http.Request) bool{
	session, _ := a.SessionStore.Get(r, a.SessionName)
    // Check if user is authenticated
    if auth, ok := session.Values["authenticated"].(bool); !ok || !auth {
        return false
    }
	return true
}

//Handle de-register of users. Require POST username. 
//THIS FUNCTION WILL NOT CHECK FOR PERMISSION. PLEASE USE WITH PERMISSION HANDLER
func (a *AuthAgent)HandleUnregister(w http.ResponseWriter, r *http.Request){
	//Check if the user is logged in
	if (a.CheckAuth(r) == false){
		//This user has not logged in
		sendErrorResponse(w, "Login required to remove user from the system.");
		return;
	}

	//Check for permission of this user.
	/*
	if !system_permission_checkUserIsAdmin(w,r){
		//This user is not admin. No permission to access this function
		sendErrorResponse(w, "Permission denied")
	}
	*/

	//Get username from request
	username,err :=  mv(r, "username", true)
	if (err != nil){
		sendErrorResponse(w,"Missing 'username' paramter")
		return;
	}

    err = a.UnregisterUser(username)
    if err != nil{
        sendErrorResponse(w, err.Error())
        return
    }

	//Return to the client with OK
	sendOK(w)
	log.Println("[system_auth] User " + username + " has been removed from the system.");
	return;
}

func (a *AuthAgent)UnregisterUser(username string) error{
	//Check if the user exists in the system database.
	if (!a.Database.KeyExists("auth", "passhash/" + username)){
		//This user do not exists.
		return errors.New("This user does not exists.")
	}

	//OK! Remove the user from the database
	a.Database.Delete("auth","passhash/" + username);
	a.Database.Delete("auth","group/" + username);
	a.Database.Delete("auth","acstatus/" + username);
    a.Database.Delete("auth","profilepic/" + username);
    
    return nil
}

//Get the number of users in the system
func (a *AuthAgent)GetUserCounts() int{
	entries, _ := a.Database.ListTable("auth")
    usercount := 0;
	for _, keypairs := range entries{
        if strings.Contains(string(keypairs[0]), "passhash/"){
            //This is a user registry
            usercount++;
        }
    }
    
    if (usercount == 0){
        log.Println("There are no user in the database.")
    }
    return usercount
}

//List all username within the system
func (a *AuthAgent)ListUsers() []string{
    entries, _ := a.Database.ListTable("auth")
    results := []string{}
    for _, keypairs := range entries{
        if (strings.Contains(string(keypairs[0]), "group/")){
            username:= strings.Split(string(keypairs[0]),"/")[1]
            results = append(results, username)
        }
    }
    return results
}

//Check if the given username exists
func (a *AuthAgent)UserExists(username string) bool{
	userpasswordhash := ""
    err := a.Database.Read("auth", "passhash/" + username, &userpasswordhash);
    if (err != nil || userpasswordhash == ""){
        return false
    }
    return true
}

//Update the session expire time given the request header.
func (a *AuthAgent)UpdateSessionExpireTime(w http.ResponseWriter, r *http.Request) bool{
	session, _ := a.SessionStore.Get(r, a.SessionName)
    if (session.Values["authenticated"].(bool) == true){
        //User authenticated. Extend its expire time
        rememberme := session.Values["rememberMe"].(bool)
        //Extend the session expire time
        if (rememberme == true){
            session.Options = &sessions.Options{
                MaxAge: 3600 * 24 * 7, //One week
                Path: "/",
            }
        }else{
            session.Options = &sessions.Options{
                MaxAge: 3600 * 1, //One hour
                Path: "/",
            }
        }
        session.Save(r, w)
        return true;
    }else{
        return false;
    }
}

//Create user account
func (a *AuthAgent)CreateUserAccount(newusername string, password string, group []string) error{
	key := newusername
    hashedPassword := Hash(password);
    err := a.Database.Write("auth", "passhash/" + key, hashedPassword)
    if err != nil{
        return err
    }
    //Store this user's usergroup settings
    err = a.Database.Write("auth", "group/" + newusername, group)
    if err != nil{
        return err
    }
    return nil
}

//Hash the given raw string into sha512 hash
func Hash(raw string) string{
    h := sha512.New()
    h.Write([]byte(raw))
    return hex.EncodeToString(h.Sum(nil))
}


