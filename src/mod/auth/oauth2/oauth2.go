package oauth2

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"time"

	"golang.org/x/oauth2"
	auth "imuslab.com/arozos/mod/auth"
	syncdb "imuslab.com/arozos/mod/auth/oauth2/syncdb"
	reg "imuslab.com/arozos/mod/auth/register"
	db "imuslab.com/arozos/mod/database"
)

type OauthHandler struct {
	googleOauthConfig *oauth2.Config
	syncDb            *syncdb.SyncDB
	ag                *auth.AuthAgent
	reg               *reg.RegisterHandler
	coredb            *db.Database
}

type Config struct {
	Enabled      bool   `json:"enabled"`
	AutoRedirect bool   `json:"auto_redirect"`
	IDP          string `json:"idp"`
	RedirectURL  string `json:"redirect_url"`
	ServerURL    string `json:"server_url"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
}

//NewOauthHandler xxx
func NewOauthHandler(authAgent *auth.AuthAgent, register *reg.RegisterHandler, coreDb *db.Database) *OauthHandler {
	err := coreDb.NewTable("oauth")
	if err != nil {
		log.Println("Failed to create oauth database. Terminating.")
		panic(err)
	}

	NewlyCreatedOauthHandler := OauthHandler{
		googleOauthConfig: &oauth2.Config{
			RedirectURL:  readSingleConfig("redirecturl", coreDb) + "/system/auth/oauth/authorize",
			ClientID:     readSingleConfig("clientid", coreDb),
			ClientSecret: readSingleConfig("clientsecret", coreDb),
			Scopes:       getScope(coreDb),
			Endpoint:     getEndpoint(coreDb),
		},
		ag:     authAgent,
		syncDb: syncdb.NewSyncDB(),
		reg:    register,
		coredb: coreDb,
	}

	return &NewlyCreatedOauthHandler
}

//HandleOauthLogin xxx
func (oh *OauthHandler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	enabled := oh.readSingleConfig("enabled")
	if enabled == "" || enabled == "false" {
		sendTextResponse(w, "OAuth disabled")
		return
	}
	//add cookies
	redirect, err := mv(r, "redirect", false)
	//store the redirect url to the sync map
	uuid := ""
	if err != nil {
		uuid = oh.syncDb.Store("/")
	} else {
		uuid = oh.syncDb.Store(redirect)
	}
	//store the key to client
	oh.addCookie(w, "uuid_login", uuid, 30*time.Minute)
	//handle redirect
	url := oh.googleOauthConfig.AuthCodeURL(uuid)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

//OauthAuthorize xxx
func (oh *OauthHandler) HandleAuthorize(w http.ResponseWriter, r *http.Request) {
	enabled := oh.readSingleConfig("enabled")
	if enabled == "" || enabled == "false" {
		sendTextResponse(w, "OAuth disabled")
		return
	}
	//read the uuid(aka the state parameter)
	uuid, err := r.Cookie("uuid_login")
	if err != nil {
		sendTextResponse(w, "Invalid redirect URI.")
		return
	}

	state, err := mv(r, "state", true)
	if state != uuid.Value {
		sendTextResponse(w, "Invalid oauth state.")
		return
	}
	if err != nil {
		sendTextResponse(w, "Invalid state parameter.")
		return
	}

	code, err := mv(r, "code", true)
	if err != nil {
		sendTextResponse(w, "Invalid state parameter.")
		return
	}

	//exchange the infromation to get code
	token, err := oh.googleOauthConfig.Exchange(context.Background(), code)
	if err != nil {
		sendTextResponse(w, "Code exchange failed.")
		return
	}

	//get user info
	username, err := getUserInfo(token.AccessToken, oh.coredb)
	if err != nil {
		oh.ag.Logger.LogAuthByRequestInfo(username, r.RemoteAddr, time.Now().Unix(), false, "web")
		sendTextResponse(w, "Failed to obtain user info.")
		return
	}

	if !oh.ag.UserExists(username) {
		//register user if not already exists
		//if registration is closed, return error message.
		//also makr the login as fail.
		if oh.reg.AllowRegistry {
			oh.ag.Logger.LogAuthByRequestInfo(username, r.RemoteAddr, time.Now().Unix(), false, "web")
			http.Redirect(w, r, "/public/register/register.system?user="+username, http.StatusFound)
		} else {
			oh.ag.Logger.LogAuthByRequestInfo(username, r.RemoteAddr, time.Now().Unix(), false, "web")
			sendHTMLResponse(w, "You are not allowed to register in this system.&nbsp;<a href=\"/\">Back</a>")
		}
	} else {
		log.Println(username + " logged in via OAuth.")
		oh.ag.LoginUserByRequest(w, r, username, true)
		oh.ag.Logger.LogAuthByRequestInfo(username, r.RemoteAddr, time.Now().Unix(), true, "web")
		//clear the cooke
		oh.addCookie(w, "uuid_login", "-invaild-", -1)
		//read the value from db and delete it from db
		url := oh.syncDb.Read(uuid.Value)
		oh.syncDb.Delete(uuid.Value)
		//redirect to the desired page
		http.Redirect(w, r, url, http.StatusFound)
	}
}

//CheckOAuth check if oauth is enabled
func (oh *OauthHandler) CheckOAuth(w http.ResponseWriter, r *http.Request) {
	enabledB := false
	enabled := oh.readSingleConfig("enabled")
	if enabled == "true" {
		enabledB = true
	}

	autoredirectB := false
	autoredirect := oh.readSingleConfig("autoredirect")
	if autoredirect == "true" {
		autoredirectB = true
	}

	type returnFormat struct {
		Enabled      bool `json:"enabled"`
		AutoRedirect bool `json:"auto_redirect"`
	}
	json, err := json.Marshal(returnFormat{Enabled: enabledB, AutoRedirect: autoredirectB})
	if err != nil {
		sendErrorResponse(w, "Error occurred while marshalling JSON response")
	}
	sendJSONResponse(w, string(json))
}

//https://golangcode.com/add-a-http-cookie/
func (oh *OauthHandler) addCookie(w http.ResponseWriter, name, value string, ttl time.Duration) {
	expire := time.Now().Add(ttl)
	cookie := http.Cookie{
		Name:    name,
		Value:   value,
		Expires: expire,
	}
	http.SetCookie(w, &cookie)
}

func (oh *OauthHandler) ReadConfig(w http.ResponseWriter, r *http.Request) {
	enabled, err := strconv.ParseBool(oh.readSingleConfig("enabled"))
	if err != nil {
		sendTextResponse(w, "Invalid config value [key=enabled].")
		return
	}
	autoredirect, err := strconv.ParseBool(oh.readSingleConfig("autoredirect"))
	if err != nil {
		sendTextResponse(w, "Invalid config value [key=autoredirect].")
		return
	}
	idp := oh.readSingleConfig("idp")
	redirecturl := oh.readSingleConfig("redirecturl")
	serverurl := oh.readSingleConfig("serverurl")
	clientid := oh.readSingleConfig("clientid")
	clientsecret := oh.readSingleConfig("clientsecret")

	config, err := json.Marshal(Config{
		Enabled:      enabled,
		AutoRedirect: autoredirect,
		IDP:          idp,
		ServerURL:    serverurl,
		RedirectURL:  redirecturl,
		ClientID:     clientid,
		ClientSecret: clientsecret,
	})
	if err != nil {
		empty, err := json.Marshal(Config{})
		if err != nil {
			sendErrorResponse(w, "Error while marshalling config")
		}
		sendJSONResponse(w, string(empty))
	}
	sendJSONResponse(w, string(config))
}

func (oh *OauthHandler) WriteConfig(w http.ResponseWriter, r *http.Request) {
	enabled, err := mv(r, "enabled", true)
	if err != nil {
		sendErrorResponse(w, "enabled field can't be empty")
		return
	}
	autoredirect, err := mv(r, "autoredirect", true)
	if err != nil {
		sendErrorResponse(w, "enabled field can't be empty")
		return
	}

	showError := true
	if enabled != "true" {
		showError = false
	}

	idp, err := mv(r, "idp", true)
	if err != nil {
		if showError {
			sendErrorResponse(w, "idp field can't be empty")
			return
		}
	}
	redirecturl, err := mv(r, "redirecturl", true)
	if err != nil {
		if showError {
			sendErrorResponse(w, "redirecturl field can't be empty")
			return
		}
	}
	serverurl, err := mv(r, "serverurl", true)
	if err != nil {
		if showError {
			if idp != "Gitlab" {
				serverurl = ""
			} else {
				sendErrorResponse(w, "serverurl field can't be empty")
				return
			}
		}
	}
	if idp != "Gitlab" {
		serverurl = ""
	}

	clientid, err := mv(r, "clientid", true)
	if err != nil {
		if showError {
			sendErrorResponse(w, "clientid field can't be empty")
			return
		}
	}
	clientsecret, err := mv(r, "clientsecret", true)
	if err != nil {
		if showError {
			sendErrorResponse(w, "clientsecret field can't be empty")
			return
		}
	}

	oh.coredb.Write("oauth", "enabled", enabled)
	oh.coredb.Write("oauth", "autoredirect", autoredirect)
	oh.coredb.Write("oauth", "idp", idp)
	oh.coredb.Write("oauth", "redirecturl", redirecturl)
	oh.coredb.Write("oauth", "serverurl", serverurl)
	oh.coredb.Write("oauth", "clientid", clientid)
	oh.coredb.Write("oauth", "clientsecret", clientsecret)

	//update the information inside the oauth class
	oh.googleOauthConfig = &oauth2.Config{
		RedirectURL:  oh.readSingleConfig("redirecturl") + "/system/auth/oauth/authorize",
		ClientID:     oh.readSingleConfig("clientid"),
		ClientSecret: oh.readSingleConfig("clientsecret"),
		Scopes:       getScope(oh.coredb),
		Endpoint:     getEndpoint(oh.coredb),
	}

	sendOK(w)
}

func (oh *OauthHandler) readSingleConfig(key string) string {
	var value string
	err := oh.coredb.Read("oauth", key, &value)
	if err != nil {
		value = ""
	}
	return value
}

func readSingleConfig(key string, coredb *db.Database) string {
	var value string
	err := coredb.Read("oauth", key, &value)
	if err != nil {
		value = ""
	}
	return value
}
