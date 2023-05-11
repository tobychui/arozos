package ldap

import (
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"imuslab.com/arozos/mod/utils"
)

//LOGIN related function
//functions basically same as arozos's original function
func (ldap *ldapHandler) HandleLoginPage(w http.ResponseWriter, r *http.Request) {
	checkLDAPenabled := ldap.readSingleConfig("enabled")
	if checkLDAPenabled == "false" {
		utils.SendTextResponse(w, "LDAP not enabled.")
		return
	}
	//load the template from file and inject necessary variables
	red, _ := utils.GetPara(r, "redirect")

	//Append the redirection addr into the template
	imgsrc := "./web/" + ldap.iconSystem
	if !utils.FileExists(imgsrc) {
		imgsrc = "./web/img/public/auth_icon.png"
	}
	imageBase64, _ := utils.LoadImageAsBase64(imgsrc)
	parsedPage, err := utils.Templateload("web/login.system", map[string]interface{}{
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
		utils.SendTextResponse(w, "LDAP not enabled.")
		return
	}
	//get the parameter from the request
	acc, err := utils.GetPara(r, "username")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	displayname, err := utils.GetPara(r, "displayname")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	key, err := utils.GetPara(r, "authkey")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	//init the web interface
	imgsrc := "./web/" + ldap.iconSystem
	if !utils.FileExists(imgsrc) {
		imgsrc = "./web/img/public/auth_icon.png"
	}
	imageBase64, _ := utils.LoadImageAsBase64(imgsrc)
	template, err := utils.Templateload("system/ldap/newPasswordTemplate.html", map[string]interface{}{
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
		utils.SendTextResponse(w, "LDAP not enabled.")
		return
	}
	//Get username from request using POST mode
	username, err := utils.PostPara(r, "username")
	if err != nil {
		//Username not defined
		log.Println("[System Auth] Someone trying to login with username: " + username)
		//Write to log
		ldap.ag.Logger.LogAuth(r, false)
		utils.SendErrorResponse(w, "Username not defined or empty.")
		return
	}

	//Get password from request using POST mode
	password, err := utils.PostPara(r, "password")
	if err != nil {
		//Password not defined
		ldap.ag.Logger.LogAuth(r, false)
		utils.SendErrorResponse(w, "Password not defined or empty.")
		return
	}

	//Get rememberme settings
	rememberme := false
	rmbme, _ := utils.PostPara(r, "rmbme")
	if rmbme == "true" {
		rememberme = true
	}

	//Check the database and see if this user is in the database
	passwordCorrect, err := ldap.ldapreader.Authenticate(username, password)
	if err != nil {
		ldap.ag.Logger.LogAuth(r, false)
		utils.SendErrorResponse(w, "Unable to connect to LDAP server")
		log.Println("LDAP Authentication error, " + err.Error())
		return
	}
	//The database contain this user information. Check its password if it is correct
	if passwordCorrect {
		//Password correct
		//if user not exist then redirect to create pwd screen
		if !ldap.ag.UserExists(username) {
			authkey := ldap.syncdb.Store(username)
			utils.SendJSONResponse(w, "{\"redirect\":\"system/auth/ldap/newPassword?username="+username+"&displayname="+username+"&authkey="+authkey+"\"}")
		} else {
			// Set user as authenticated
			ldap.ag.LoginUserByRequest(w, r, username, rememberme)
			//Print the login message to console
			log.Println(username + " logged in.")
			ldap.ag.Logger.LogAuth(r, true)
			utils.SendOK(w)
		}
	} else {
		//Password incorrect
		log.Println(username + " has entered an invalid username or password")
		utils.SendErrorResponse(w, "Invalid username or password")
		ldap.ag.Logger.LogAuth(r, false)
		return
	}
}

func (ldap *ldapHandler) HandleSetPassword(w http.ResponseWriter, r *http.Request) {
	checkLDAPenabled := ldap.readSingleConfig("enabled")
	if checkLDAPenabled == "false" {
		utils.SendTextResponse(w, "LDAP not enabled.")
		return
	}
	//get paramters from request
	username, err := utils.PostPara(r, "username")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	password, err := utils.PostPara(r, "password")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}
	authkey, err := utils.PostPara(r, "authkey")
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
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
				utils.SendErrorResponse(w, err.Error())
				return
			}
			//convert the ldap usergroup to arozos usergroup
			convertedInfo := ldap.convertGroup(ldapUser)
			//create user account and login
			ldap.ag.CreateUserAccount(username, password, convertedInfo.EquivGroup)
			ldap.ag.Logger.LogAuth(r, true)
			ldap.ag.LoginUserByRequest(w, r, username, false)
			utils.SendOK(w)
			return
		} else {
			//if exist then return error
			utils.SendErrorResponse(w, "User exists, please contact the system administrator if you believe this is an error.")
			return
		}
	} else {
		utils.SendErrorResponse(w, "Improper key detected")
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
		utils.SendErrorResponse(w, "Error occurred while marshalling JSON response")
	}
	utils.SendJSONResponse(w, string(json))
}
