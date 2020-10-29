package register

/*
	Register Module 
	author: tobychui

	Register interface handler
*/

import (
	"net/http"
	"io/ioutil"
	"bufio"
	"os"
	"errors"
	"encoding/base64"
	"log"

	"github.com/valyala/fasttemplate"
	db "imuslab.com/aroz_online/mod/database"
	auth "imuslab.com/aroz_online/mod/auth"
	permission "imuslab.com/aroz_online/mod/permission"
)

type RegisterOptions struct{
	Hostname string
	VendorIcon string
}

type RegisterHandler struct{
	database *db.Database
	authAgent *auth.AuthAgent
	permissionHandler *permission.PermissionHandler
	options RegisterOptions
	DefaultUserGroup string
	AllowRegistry bool
}

func NewRegisterHandler(database *db.Database, authAgent *auth.AuthAgent, ph *permission.PermissionHandler, options RegisterOptions) *RegisterHandler{
	//Create the database for registration
	database.NewTable("register")

	//Check if the default group has been set. If not a new usergroup
	defaultUserGroup := ""
	if (database.KeyExists("register","defaultGroup")){
		//Use the configured default group
		database.Read("register","defaultGroup", &defaultUserGroup)

		//Check the group exists
		if !ph.GroupExists(defaultUserGroup){
			//Group not exists. Create default group.
			if !ph.GroupExists("default"){
				createDefaultGroup(ph);
			}
			defaultUserGroup = "default"
		}
	}else{
		//Default group not set or not exists. Create a new default group
		if !ph.GroupExists("default"){
			createDefaultGroup(ph);
		}
		defaultUserGroup = "default"
		
	}

	return &RegisterHandler{
		database: database,
		options: options,
		permissionHandler: ph,
		authAgent: authAgent,
		DefaultUserGroup: defaultUserGroup,
		AllowRegistry: true,
	}
}

//Create the default usergroup used by new users
func createDefaultGroup(ph *permission.PermissionHandler){
	//Default storage space: 15GB
	ph.NewPermissionGroup("default",false,15 << 30,[]string{},"Desktop");
}

func (h *RegisterHandler)HandleRegisterCheck(w http.ResponseWriter, r *http.Request){
	if h.AllowRegistry{
		sendJSONResponse(w, "true")
	}else{
		sendJSONResponse(w, "false")
	}
}

//Handle and serve the register itnerface
func (h *RegisterHandler)HandleRegisterInterface(w http.ResponseWriter, r *http.Request){
	//Serve the register interface
	if h.AllowRegistry{
		template, err := ioutil.ReadFile("system/auth/register.system")
		if err != nil{
			log.Println("Template not found: system/auth/register.system")
			http.NotFound(w,r);
			return
		}

		//Load the vendor icon as base64
		imagecontent, _ := readImageFileAsBase64(h.options.VendorIcon);

		//Apply templates
		t := fasttemplate.New(string(template), "{{", "}}")
		s := t.ExecuteString(map[string]interface{}{
			"host_name": h.options.Hostname,
			"vendor_logo": imagecontent,
		})

		w.Write([]byte(s));
	}else{
		//Registry is closed
		http.NotFound(w,r);
	}
}

func readImageFileAsBase64(src string) (string, error){
	f, err := os.Open(src)
	if err != nil{
		return "", err
	}

	reader := bufio.NewReader(f)
    content, err := ioutil.ReadAll(reader)
	if err != nil{
		return "", err
	}
    encoded := base64.StdEncoding.EncodeToString(content)
	return encoded, nil
}

//Get the default usergroup for this register handler
func (h *RegisterHandler)GetDefaultUserGroup()string{
	return h.DefaultUserGroup;
}

//Set the default usergroup for this register handler
func (h *RegisterHandler)SetDefaultUserGroup(groupname string) error{
	if !h.permissionHandler.GroupExists(groupname){
		return errors.New("Group not exists")
	}

	//Update the default registry in struct
	h.DefaultUserGroup = groupname

	//Write change to database
	h.database.Write("register","defaultGroup", groupname)

	return nil
}

//Toggle registry on the fly
func (h *RegisterHandler)SetAllowRegistry(allow bool){
	h.AllowRegistry = allow;
}

//Handle the request for creating a new user
func (h *RegisterHandler)HandleRegisterRequest(w http.ResponseWriter, r *http.Request){
	if h.AllowRegistry == false{
		sendErrorResponse(w, "Public account registry is currently closed")
		return
	}
	//Get input paramter
	email, err := mv(r, "email", true)
	if err != nil{
		sendErrorResponse(w, "Invalid Email");
		return
	}

	username, err := mv(r, "username", true)
	if username == "" || err != nil{
		sendErrorResponse(w, "Invalid Username");
		return
	}

	password, err := mv(r, "password", true)
	if password == "" || err != nil{
		sendErrorResponse(w, "Invalid Password");
		return
	}

	//Check if password too short
	if (len(password) < 8){
		sendErrorResponse(w, "Password too short. Must be at least 8 characters.");
		return
	}

	//Check if the user already exists
	if h.authAgent.UserExists(username){
		sendErrorResponse(w, "This username has already been used");
		return
	}

	//Get the default user group for public registration
	defaultGroup := h.DefaultUserGroup;
	if (h.permissionHandler.GroupExists(defaultGroup) == false){
		//Public registry user group not exists. Raise 500 Error
		log.Println("[CRITICAL] PUBLIC REGISTRY USER GROUP NOT FOUND! PLEASE RESTART YOUR SYSTEM!")
		sendErrorResponse(w, "Internal Server Error")
		return
	}

	//OK. Record this user to the system
	err = h.authAgent.CreateUserAccount(username, password, []string{defaultGroup});
	if err != nil{
		sendErrorResponse(w, err.Error())
		return
	}

	//Write email to database as well
	h.database.Write("register","user/email/" + username,email)

	sendOK(w);
	log.Println("New User Registered: ", email, username, password)

}





