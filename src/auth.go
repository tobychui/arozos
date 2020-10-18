package main

import (
	"github.com/gorilla/sessions"
    "net/http"
    "errors"
    "crypto/sha512"
    //"io/ioutil"
    "strings"
    "log"
    "encoding/json"
    "encoding/hex"
)

/*
ArOZ Online Authentication System

This system make use of sessions (similar to PHP SESSION) to remember the user login.
See https://gowebexamples.com/sessions/ for detail.

Auth database are stored as the following key

auth/login/{username}/passhash => hashed password
auth/login/{username}/permission => permission level (wip)

Other system variables related to auth

auth/users/usercount => Number of users in the system
*/


var (
    // key must be 16, 24 or 32 bytes long (AES-128, AES-192 or AES-256)
    key = []byte("super-secret-key") //To be migrated to input flags
    store = sessions.NewCookieStore(key)
)


/*
    Initiation of web services endpoints from main()

    This function should be the preparation of auth services and register the url for auth services only
    Do not put in any computational algorithms
*/
func system_auth_service_init(){
    //Handle auth API
    http.HandleFunc("/system/auth/login", system_auth_login)
    http.HandleFunc("/system/auth/logout", system_auth_logout)
    http.HandleFunc("/system/auth/checkLogin", system_auth_extCheckLogin)
    http.HandleFunc("/system/auth/register", system_auth_register)
    http.HandleFunc("/system/auth/unregister", system_auth_unregister)
    http.HandleFunc("/system/auth/reflectIP", system_auth_getIPAddress)
    http.HandleFunc("/system/auth/checkPublicRegister", system_auth_checkPublicRegister)
    log.Println("ArOZ Online Authentication Service Loaded");

    //Create a new auth database
    system_db_newTable(sysdb, "auth")

    if (*allow_public_registry){
        //Allow public registry. Create setting interface for this page
        registerSetting(settingModule{
            Name:     "Public Register",
            Desc:     "Settings for public registration",
            IconPath: "SystemAO/auth/img/small_icon.png",
            Group:    "Users",
            StartDir: "SystemAO/auth/regsetting.html",
            RequireAdmin: true,
        })


        //Register the direct link for template serving
        http.HandleFunc("/public/register", system_auth_serveRegisterInterface);
        http.HandleFunc("/public/register/settings", system_auth_handleRegisterInterfaceUpdate);
    }
}

func system_auth_checkPublicRegister(w http.ResponseWriter, r *http.Request){
    if (!*allow_public_registry){
        sendJSONResponse(w, "false");
        return
    }else{
        AllowPublicRegisterValue := false
        system_db_read(sysdb, "auth", "public/register/settings/allowRegistry", &AllowPublicRegisterValue)
        jsonString, _ := json.Marshal(AllowPublicRegisterValue)
        sendJSONResponse(w, string(jsonString))
        return
    }
    sendJSONResponse(w, "false");
}

func system_auth_serveRegisterInterface(w http.ResponseWriter, r *http.Request){
    username, err := mv(r, "username", true)
    if (err != nil){
        //Serve WebUI
        //Prepare contents for templating
        base64Image, _ := LoadImageAsBase64("./web/" + iconVendor)
        requireInvitationCode := false
        system_db_read(sysdb, "auth", "public/register/settings/enableInvitationCode", &requireInvitationCode)
        eic := "false"
        if (requireInvitationCode){
            eic = "true"
        }
        //registerUI, _ := ioutil.ReadFile("./web/" + "SystemAO/auth/register.system");
        registerUI, _ := template_load("./web/" + "SystemAO/auth/register.system",map[string]interface{}{
            "vendor_logo": base64Image,
            "host_name": *host_name,
            "require_invitationCode": eic,
        })
        w.Write([]byte(registerUI))
    }else{
        //Data incoming. Register this user if data is valid
        requireInvitationCode := false
        system_db_read(sysdb, "auth", "public/register/settings/enableInvitationCode", &requireInvitationCode)

        //Validate Invitation Code if enabled
        if (requireInvitationCode){
            //Validate the Invitation Code
            userInputCode, _ := mv(r, "invitationcode", true)
            correctCode := ""
            system_db_read(sysdb, "auth", "public/register/settings/invitationCode", &correctCode)
            if (correctCode == ""){
                panic("Invalid Invitation Code")
            }
            if (userInputCode != correctCode){
                sendErrorResponse(w, "Invalid Invitation Code")
                return
            }
        }

        //validate if this username already occupied
        if system_auth_userExists(username){
            sendErrorResponse(w, "This username already occupied.")
            return
        }

        //Validate password
        password, err := mv(r, "password", true)
        if (err != nil){
            sendErrorResponse(w, "Invalid password")
            return
        }

        if len(password) < 8{
            sendErrorResponse(w, "Password too short. Password must be equal or longer than 8 characters")
            return
        }

        //Validate default usergroup
        DefaultUserGroupValue := ""
        err = system_db_read(sysdb, "auth", "public/register/settings/defaultUserGroup", &DefaultUserGroupValue)
        if (err != nil){
            log.Println(err.Error())
            sendErrorResponse(w, "Internal Server Error")
            return
        }

        if (DefaultUserGroupValue == "" || !system_permission_groupExists(DefaultUserGroupValue)){
            log.Println("Invalid group given or group not exists: " + DefaultUserGroupValue)
            sendErrorResponse(w, "Internal Server Error")
            return
        }

        //Ok to create user
        err = system_auth_createUserAccount(username, password, DefaultUserGroupValue)
        if (err != nil){
            log.Println(err.Error())
            sendErrorResponse(w, "Internal Server Error")
            return
        }
        sendOK(w);
    }
    
}

func system_auth_handleRegisterInterfaceUpdate(w http.ResponseWriter, r *http.Request){
    isAdmin := system_permission_checkUserIsAdmin(w,r)
    if !isAdmin{
        sendErrorResponse(w, "Permission denied")
        return
    }

    //keys for access the properties
    var (
        rootKey string = "public/register/settings/"
        allowPublicRegister string = rootKey + "allowRegistry"
        enableInvitationCode string = rootKey + "enableInvitationCode"
        invitationCode string = rootKey + "invitationCode"
        defaultUserGroup string = rootKey + "defaultUserGroup"
    )

    opr, _ := mv(r,"opr",true);
    if (opr == "write"){
        //Write settings to db
        config, err := mv(r,"config",true);
        if err != nil{
            sendErrorResponse(w, "config not defined");
            return
        }

        type configStruct struct {
            Apr   bool   `json:"apr"`
            Eivc  bool   `json:"eivc"`
            Icode string `json:"icode"`
            Group string `json:"group"`
        }

        newConfig := new(configStruct)
        err = json.Unmarshal([]byte(config), &newConfig)
        if (err != nil){
            sendErrorResponse(w, err.Error())
            return
        }

        if (newConfig.Group == "" || !system_permission_groupExists(newConfig.Group)){
            //Group is not set. Reject update
            sendErrorResponse(w, "Invalid group selected");
            return
        }

        //Write the configuration to file
        system_db_write(sysdb, "auth", allowPublicRegister, newConfig.Apr)
        system_db_write(sysdb, "auth", enableInvitationCode, newConfig.Eivc)
        system_db_write(sysdb, "auth", invitationCode, newConfig.Icode)
        system_db_write(sysdb, "auth", defaultUserGroup, newConfig.Group)

        sendOK(w)
    }else{
        //Read the current settings
        type replyStruct struct{
            AllowPublicRegister bool
            EnableInvitationCode bool
            InvitationCode string
            DefaultUserGroup string
        }

        var AllowPublicRegisterValue bool = false
        var EnableInvitationCodeValue bool = false
        var InvitationCodeValue string = ""
        var DefaultUserGroupValue string = ""

        system_db_read(sysdb, "auth", allowPublicRegister, &AllowPublicRegisterValue)
        system_db_read(sysdb, "auth", enableInvitationCode, &EnableInvitationCodeValue)
        system_db_read(sysdb, "auth", invitationCode, &InvitationCodeValue)
        system_db_read(sysdb, "auth", defaultUserGroup, &DefaultUserGroupValue)

        jsonString, _ := json.Marshal(replyStruct{
            AllowPublicRegister:AllowPublicRegisterValue,
            EnableInvitationCode:EnableInvitationCodeValue,
            InvitationCode:InvitationCodeValue,
            DefaultUserGroup:DefaultUserGroupValue,
        })

        sendJSONResponse(w, string(jsonString))
    }
}

//This function check if the auth status of the current user, return true if logged in
func system_auth_chkauth(w http.ResponseWriter, r *http.Request) bool {
    session, _ := store.Get(r, "ao_auth")
    // Check if user is authenticated
    if auth, ok := session.Values["authenticated"].(bool); !ok || !auth {
        return false
    }
	return true
}

//Get the IP address of the current authentication user
func system_auth_getIPAddress(w http.ResponseWriter, r *http.Request) {
    if (*disable_ip_resolve_services == true){
        sendTextResponse(w, "0.0.0.0")
        return
    }
    requestPort,_ :=  mv(r, "port", false)
    showPort := false;
    if (requestPort == "true"){
        //Show port as well
        showPort = true;
    }
    IPAddress := r.Header.Get("X-Real-Ip")
    if IPAddress == "" {
        IPAddress = r.Header.Get("X-Forwarded-For")
    }
    if IPAddress == "" {
        IPAddress = r.RemoteAddr
    }
    if (!showPort){
        IPAddress = IPAddress[:strings.LastIndex(IPAddress, ":")]

    }
    w.Write([]byte(IPAddress))
    return;
}

//This function return the username of the logged in user, or empty string if the user is not logged in
func system_auth_getUserName(w http.ResponseWriter, r *http.Request) (string, error){
    if (system_auth_chkauth(w,r)){
        //This user has logged in.
        session, _ := store.Get(r, "ao_auth")
        return session.Values["username"].(string), nil
    }else{
        //This user has not logged in.
        return "", errors.New("User not logged in");
    }
}

//This function return the total number of users registered in the system
func system_auth_getUserCounts() int{
    //Get username using table listing method 
    entries := system_db_listTable(sysdb, "auth")
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

    /*
    //Deprecated method for getting user count
    var count string
    system_db_read(sysdb, "auth", "usercount", &count)
    if (len(count) == 0 || count == ""){
        //The value is not set yet. Initiate it as 0
        log.Println("There are no user in database. Initializing system user account services.");
        system_db_write(sysdb,"auth", "usercount","0")
        return 0;
    }
    //The counter exists. Convert it to int and return its value
    i, err := strconv.Atoi(count);
    if (err != nil){
        log.Fatal("ERROR! Database corrupted. Unable to access user count from auth database entry.")
        os.Exit(1);
    }
    */
}

//This function will return if the current user has logged in or not.
func system_auth_extCheckLogin(w http.ResponseWriter, r *http.Request){
    if (system_auth_chkauth(w,r)){
        sendJSONResponse(w,"true");
    }else{
        sendJSONResponse(w,"false");
    }
}

//This function convert raw string into sha512 string (aka hash("sha512",raw) in php)
func system_auth_hash(raw string) string{
    h := sha512.New()
    h.Write([]byte(raw))
    return hex.EncodeToString(h.Sum(nil))
}

//User register function, allow everyone to register if the total number of user in the system = 0
func system_auth_register(w http.ResponseWriter, r *http.Request){
    userCount := system_auth_getUserCounts();

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

    //Get permission group from request
    group,err :=  mv(r, "group", true)
    if (err != nil){
        sendTextResponse(w,"Error. Missing 'group' paramter")
        return;
    }
    
    //Check if the number of users in the system is == 0. If yes, there are no need to login before registering new user
    if (userCount > 0){
        //Require login to create new user
        if (system_auth_chkauth(w,r) == false){
            //System have more than one person and this user is not logged in
            sendTextResponse(w,"Error. Login is needed to create new user")
            return;
        }

    }

    //Check if the target group exists.
    if (!system_permission_groupExists(group)){
        sendTextResponse(w,"Error. Target group not exists.")
        return;
    }

    //Ok to proceed create this user
    err = system_auth_createUserAccount(newusername, password, group)
    if (err != nil){
        sendErrorResponse(w, err.Error())
        return
    }

    //Return to the client with OK
    w.Write([]byte("OK"))
    log.Println("[System Auth] New user " + newusername + " added to system.");
    return;
}

func system_auth_createUserAccount(newusername string, password string, group string) error{
    key := newusername
    hashedPassword := system_auth_hash(password);
    err := system_db_write(sysdb, "auth", "passhash/" + key, hashedPassword)
    if err != nil{
        return err
    }
    //Store this user's usergroup settings
    err = system_db_write(sysdb, "auth", "group/" + newusername, group)
    if err != nil{
        return err
    }
    return nil
}

//Unregister a user from the system
func system_auth_unregister(w http.ResponseWriter, r *http.Request){
    //Check if the user is logged in
    if (system_auth_chkauth(w,r) == false){
        //This user has not logged in
        sendErrorResponse(w, "Login required to remove user from the system.");
        return;
    }

    //Check for permission of this user.
    if !system_permission_checkUserIsAdmin(w,r){
        //This user is not admin. No permission to access this function
        sendErrorResponse(w, "Permission denied")
    }

    //Get username from request
    username,err :=  mv(r, "username", true)
    if (err != nil){
        sendErrorResponse(w,"Missing 'username' paramter")
        return;
    }

    //Check if the user exists in the system database.
    userpasswordhash := ""
    system_db_read(sysdb, "auth", "passhash/" + username, &userpasswordhash);
    if (err != nil || userpasswordhash == ""){
        //This user do not exists.
        sendErrorResponse(w, "This user does not exists.");
    }
    
    //OK! Remove the user from the database
    system_db_delete(sysdb,"auth","passhash/" + username);
    system_db_delete(sysdb,"auth","group/" + username);
    system_db_delete(sysdb,"auth","acstatus/" + username);
    system_db_delete(sysdb,"auth","profilepic/" + username);

    /*
    //Deprecated since 26-5-2020, process automated
    //Reduce 1 from the system user count and save it to database
    userCount := system_auth_getUserCounts();
    userCount = userCount - 1
    newUserCount := strconv.Itoa(userCount)
    system_db_write(sysdb, "auth", "usercount", newUserCount)
    */

    //Return to the client with OK
    w.Write([]byte("OK"))
    log.Println("[system_auth] User " + username + " has been removed from the system.");
    return;
}

func system_auth_userExists(username string) bool{
    userpasswordhash := ""
    err := system_db_read(sysdb, "auth", "passhash/" + username, &userpasswordhash);
    if (err != nil || userpasswordhash == ""){
        return false
    }
    return true
}

//System login API
func system_auth_login(w http.ResponseWriter, r *http.Request) {
    session, _ := store.Get(r, "ao_auth")

	//Get username from request using POST mode
    username, err := mv(r, "username", true)
    if (err != nil){
        //Username not defined
        log.Println("[System Auth] Someone trying to login with username: " + username)
        sendTextResponse(w,"Error. Username not defined or empty.")
        return;
    }

    //Get password from request using POST mode
    password, err := mv(r, "password", true)
    if (err != nil){
        //Password not defined
        sendTextResponse(w,"Error. Password not defined or empty.")
        return;
    }

    //Get rememberme settings
    rememberme := false;
    rmbme, _ := mv(r, "rmbme", true)
    if (rmbme == "true"){
        rememberme = true;
    }

    //Check the database and see if this user is in the database
    hashedPassword := system_auth_hash(password)
    var passwordInDB string
    err = system_db_read(sysdb, "auth", "passhash/" + username, &passwordInDB)
    if (err != nil){
        //User not found or db exception
        log.Println("[System Auth] " + username + " login with incorrect password")
        sendTextResponse(w,"Error. Invalid username or password")
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
        w.Write([]byte("OK"))
    }else{
        //Password incorrect
        sendTextResponse(w,"Error. Invalid username or password")
        return;
    }
 
}

//Update the session expire time if there are active connections
func system_auth_extendSessionExpireTime(w http.ResponseWriter, r *http.Request) bool{
    session, _ := store.Get(r, "ao_auth")
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

//System Logout API
func system_auth_logout(w http.ResponseWriter, r *http.Request) {
    session, _ := store.Get(r, "ao_auth")
    username, _ := system_auth_getUserName(w,r);
    log.Println(username + " logged out.");
    // Revoke users authentication
    session.Values["authenticated"] = false
    session.Values["username"] = nil
    //log.Println(session.Values["authenticated"])
    session.Save(r, w)
    w.Write([]byte("OK"))
}

