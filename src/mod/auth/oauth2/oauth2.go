package oauth2

import (
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
	oauthStateString  string
	DefaultUserGroup  string
	ag                *auth.AuthAgent
	reg               *reg.RegisterHandler
	coredb            *db.Database
	config            *Config
}

type Config struct {
	Enabled          bool   `json:"enabled"`
	IDP              string `json:"idp"`
	RedirectURL      string `json:"redirect_url"`
	ClientID         string `json:"client_id"`
	ClientSecret     string `json:"client_secret"`
	DefaultUserGroup string `json:"default_user_group"`
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
		DefaultUserGroup: readSingleConfig("defaultusergroup", coreDb),
		ag:               authAgent,
		syncDb:           syncdb.NewSyncDB(),
		reg:              register,
		coredb:           coreDb,
	}

	return &NewlyCreatedOauthHandler
}

//HandleOauthLogin xxx
func (oh *OauthHandler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	//add cookies
	redirect, e := r.URL.Query()["redirect"]
	uuid := ""
	if !e || len(redirect[0]) < 1 {
		uuid = oh.syncDb.Store("/")
	} else {
		uuid = oh.syncDb.Store(redirect[0])
	}
	oh.addCookie(w, "uuid_login", uuid, 30*time.Minute)
	//handle redirect
	url := oh.googleOauthConfig.AuthCodeURL(uuid)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

//OauthAuthorize xxx
func (oh *OauthHandler) HandleAuthorize(w http.ResponseWriter, r *http.Request) {
	//read the uuid(aka the state parameter)
	uuid, err := r.Cookie("uuid_login")
	if err != nil {
		sendTextResponse(w, "Invalid redirect URI.")
		return
	}

	state := r.FormValue("state")
	if state != uuid.Value {
		sendTextResponse(w, "Invalid oauth state.")
		return
	}

	code := r.FormValue("code")
	token, err := oh.googleOauthConfig.Exchange(oauth2.NoContext, code)
	if err != nil {
		sendTextResponse(w, "Code exchange failed.")
		return
	}

	username, err := getUserInfo(token.AccessToken, oh.coredb)
	if err != nil {
		sendTextResponse(w, "Failed to obtain user info.")
		return
	}

	if !oh.ag.UserExists(username) {
		//register user if not already exists
		//random pwd to prevent ppl bypassing the OAuth handler
		if oh.reg.AllowRegistry {
			http.Redirect(w, r, "/public/register/register.system?user="+username, 302)
		} else {
			sendHTMLResponse(w, "You are not allowed to register in this system.&nbsp;<a href=\"/\">Back</a>")
		}
	} else {
		log.Println(username + " logged in via OAuth.")
		oh.ag.LoginUserByRequest(w, r, username, true)
		//clear the cooke
		oh.addCookie(w, "uuid_login", "-invaild-", -1)
		//read the value from db and delete it from db
		url := oh.syncDb.Read(uuid.Value)
		oh.syncDb.Delete(uuid.Value)
		//redirect to the desired page
		http.Redirect(w, r, url, 302)
	}
}

func (oh *OauthHandler) CheckOAuth(w http.ResponseWriter, r *http.Request) {
	enabled := oh.readSingleConfig("enabled")
	if enabled == "" {
		enabled = "false"
	}
	sendJSONResponse(w, enabled)
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
	enabled, _ := strconv.ParseBool(oh.readSingleConfig("enabled"))
	idp := oh.readSingleConfig("idp")
	redirecturl := oh.readSingleConfig("redirecturl")
	clientid := oh.readSingleConfig("clientid")
	clientsecret := oh.readSingleConfig("clientsecret")
	defaultusergroup := oh.readSingleConfig("defaultusergroup")

	config, err := json.Marshal(Config{
		Enabled:          enabled,
		IDP:              idp,
		RedirectURL:      redirecturl,
		ClientID:         clientid,
		ClientSecret:     clientsecret,
		DefaultUserGroup: defaultusergroup,
	})
	if err != nil {
		empty, _ := json.Marshal(Config{})
		sendJSONResponse(w, string(empty))
	}
	sendJSONResponse(w, string(config))
}

func (oh *OauthHandler) WriteConfig(w http.ResponseWriter, r *http.Request) {
	enabled, err := mv(r, "enabled", true)
	if err != nil {
		sendErrorResponse(w, "enabled field can't be empty'")
		return
	}

	oh.coredb.Write("oauth", "enabled", enabled)

	showError := true
	if enabled != "true" {
		showError = false
	}

	idp, err := mv(r, "idp", true)
	if err != nil {
		if showError {
			sendErrorResponse(w, "idp field can't be empty'")
			return
		}
	}
	redirecturl, err := mv(r, "redirecturl", true)
	if err != nil {
		if showError {
			sendErrorResponse(w, "redirecturl field can't be empty'")
			return
		}
	}
	clientid, err := mv(r, "clientid", true)
	if err != nil {
		if showError {
			sendErrorResponse(w, "clientid field can't be empty'")
			return
		}
	}
	clientsecret, err := mv(r, "clientsecret", true)
	if err != nil {
		if showError {
			sendErrorResponse(w, "clientsecret field can't be empty'")
			return
		}
	}
	defaultusergroup, err := mv(r, "defaultusergroup", true)
	if err != nil {
		if showError {
			sendErrorResponse(w, "defaultusergroup field can't be empty'")
			return
		}
	}

	oh.coredb.Write("oauth", "idp", idp)
	oh.coredb.Write("oauth", "redirecturl", redirecturl)
	oh.coredb.Write("oauth", "clientid", clientid)
	oh.coredb.Write("oauth", "clientsecret", clientsecret)
	oh.coredb.Write("oauth", "defaultusergroup", defaultusergroup)

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
