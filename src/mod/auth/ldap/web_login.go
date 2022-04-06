package ldap

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"imuslab.com/arozos/mod/common"
)

//LOGIN related function
//functions basically same as arozos's original function
func (ldap *ldapHandler) HandleLoginPage(w http.ResponseWriter, r *http.Request) {
	checkLDAPenabled := ldap.readSingleConfig("enabled")
	if checkLDAPenabled == "false" {
		common.SendTextResponse(w, "LDAP not enabled.")
		return
	}
	//load the template from file and inject necessary variables
	red, _ := common.Mv(r, "redirect", false)

	//Append the redirection addr into the template
	imgsrc := "./web/" + ldap.iconSystem
	if !common.FileExists(imgsrc) {
		imgsrc = "./web/img/public/auth_icon.png"
	}
	imageBase64, _ := common.LoadImageAsBase64(imgsrc)
	parsedPage, err := common.Templateload("web/login.system", map[string]interface{}{
		"redirection_addr": red,
		"usercount":        strconv.Itoa(ldap.ag.GetUserCounts()),
		"service_logo":     imageBase64,
		"login_addr":       "system/auth/ldap/login",
	})
	if err != nil {
		panic("Error. Unable to parse login page. Is web directory data exists?")
	}
	w.Header().Add("Content-Type", "text/html; charset=UTF-8")
	w.Write([]byte(parsedPage))
}

func (ldap *ldapHandler) HandleNewPasswordPage(w http.ResponseWriter, r *http.Request) {
	checkLDAPenabled := ldap.readSingleConfig("enabled")
	if checkLDAPenabled == "false" {
		common.SendTextResponse(w, "LDAP not enabled.")
		return
	}
	//get the parameter from the request
	acc, err := common.Mv(r, "username", false)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	displayname, err := common.Mv(r, "displayname", false)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	key, err := common.Mv(r, "authkey", false)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	//init the web interface
	imgsrc := "./web/" + ldap.iconSystem
	if !common.FileExists(imgsrc) {
		imgsrc = "./web/img/public/auth_icon.png"
	}
	imageBase64, _ := common.LoadImageAsBase64(imgsrc)
	template, err := common.Templateload("system/ldap/newPasswordTemplate.html", map[string]interface{}{
		"vendor_logo":  imageBase64,
		"username":     acc,
		"display_name": displayname,
		"key":          key,
	})
	if err != nil {
		log.Fatal(err)
	}
	w.Header().Set("Content-Type", "text/html; charset=UTF-8")
	w.Write([]byte(template))
}

func (ldap *ldapHandler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	checkLDAPenabled := ldap.readSingleConfig("enabled")
	if checkLDAPenabled == "false" {
		common.SendTextResponse(w, "LDAP not enabled.")
		return
	}
	//Get username from request using POST mode
	username, err := common.Mv(r, "username", true)
	if err != nil {
		//Username not defined
		log.Println("[System Auth] Someone trying to login with username: " + username)
		//Write to log
		ldap.ag.Logger.LogAuth(r, false)
		common.SendErrorResponse(w, "Username not defined or empty.")
		return
	}

	//Get password from request using POST mode
	password, err := common.Mv(r, "password", true)
	if err != nil {
		//Password not defined
		ldap.ag.Logger.LogAuth(r, false)
		common.SendErrorResponse(w, "Password not defined or empty.")
		return
	}

	//Get rememberme settings
	rememberme := false
	rmbme, _ := common.Mv(r, "rmbme", true)
	if rmbme == "true" {
		rememberme = true
	}

	//Check the database and see if this user is in the database
	passwordCorrect, err := ldap.ldapreader.Authenticate(username, password)
	if err != nil {
		ldap.ag.Logger.LogAuth(r, false)
		common.SendErrorResponse(w, "Unable to connect to LDAP server")
		log.Println("LDAP Authentication error, " + err.Error())
		return
	}
	//The database contain this user information. Check its password if it is correct
	if passwordCorrect {
		//Password correct
		//if user not exist then redirect to create pwd screen
		if !ldap.ag.UserExists(username) {
			authkey := ldap.syncdb.Store(username)
			common.SendJSONResponse(w, "{\"redirect\":\"system/auth/ldap/newPassword?username="+username+"&displayname="+username+"&authkey="+authkey+"\"}")
		} else {
			// Set user as authenticated
			ldap.ag.LoginUserByRequest(w, r, username, rememberme)
			//Print the login message to console
			log.Println(username + " logged in.")
			ldap.ag.Logger.LogAuth(r, true)
			common.SendOK(w)
		}
	} else {
		//Password incorrect
		log.Println(username + " has entered an invalid username or password")
		common.SendErrorResponse(w, "Invalid username or password")
		ldap.ag.Logger.LogAuth(r, false)
		return
	}
}

func (ldap *ldapHandler) HandleSetPassword(w http.ResponseWriter, r *http.Request) {
	checkLDAPenabled := ldap.readSingleConfig("enabled")
	if checkLDAPenabled == "false" {
		common.SendTextResponse(w, "LDAP not enabled.")
		return
	}
	//get paramters from request
	username, err := common.Mv(r, "username", true)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	password, err := common.Mv(r, "password", true)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}
	authkey, err := common.Mv(r, "authkey", true)
	if err != nil {
		common.SendErrorResponse(w, err.Error())
		return
	}

	//check if the input key matches the database's username
	isValid := ldap.syncdb.Read(authkey) == username
	ldap.syncdb.Delete(authkey) // remove the key, aka key is one time use only
	//if db data match the username, proceed
	if isValid {
		//if not exists
		if !ldap.ag.UserExists(username) {
			//get the user from ldap server
			ldapUser, err := ldap.ldapreader.GetUser(username)
			if err != nil {
				common.SendErrorResponse(w, err.Error())
				return
			}
			//convert the ldap usergroup to arozos usergroup
			convertedInfo := ldap.convertGroup(ldapUser)
			//create user account and login
			ldap.ag.CreateUserAccount(username, password, convertedInfo.EquivGroup)
			ldap.ag.Logger.LogAuth(r, true)
			ldap.ag.LoginUserByRequest(w, r, username, false)
			common.SendOK(w)
			return
		} else {
			//if exist then return error
			common.SendErrorResponse(w, "User exists, please contact the system administrator if you believe this is an error.")
			return
		}
	} else {
		common.SendErrorResponse(w, "Improper key detected")
		log.Println(r.RemoteAddr + " attempted to use invaild key to create new user but failed")
		return
	}
}

//HandleCheckLDAP check if ldap is enabled
func (ldap *ldapHandler) HandleCheckLDAP(w http.ResponseWriter, r *http.Request) {
	enabledB := false
	enabled := ldap.readSingleConfig("enabled")
	if enabled == "true" {
		enabledB = true
	}

	type returnFormat struct {
		Enabled bool `json:"enabled"`
	}
	json, err := json.Marshal(returnFormat{Enabled: enabledB})
	if err != nil {
		common.SendErrorResponse(w, "Error occurred while marshalling JSON response")
	}
	common.SendJSONResponse(w, string(json))
}
