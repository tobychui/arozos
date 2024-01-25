package oauth2

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"
	auth "imuslab.com/arozos/mod/auth"
	syncdb "imuslab.com/arozos/mod/auth/oauth2/syncdb"
	reg "imuslab.com/arozos/mod/auth/register"
	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/utils"
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

// NewOauthHandler xxx
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

// HandleOauthLogin xxx
func (oh *OauthHandler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	enabled := oh.readSingleConfig("enabled")
	if enabled == "" || enabled == "false" {
		utils.SendTextResponse(w, "OAuth disabled")
		return
	}
	//add cookies
	redirect, err := utils.GetPara(r, "redirect")
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

// OauthAuthorize xxx
func (oh *OauthHandler) HandleAuthorize(w http.ResponseWriter, r *http.Request) {
	enabled := oh.readSingleConfig("enabled")
	if enabled == "" || enabled == "false" {
		utils.SendTextResponse(w, "OAuth disabled")
		return
	}
	//read the uuid(aka the state parameter)
	uuid, err := r.Cookie("uuid_login")
	if err != nil {
		utils.SendTextResponse(w, "Invalid redirect URI.")
		return
	}

	state, err := utils.PostPara(r, "state")
	if state != uuid.Value {
		utils.SendTextResponse(w, "Invalid oauth state.")
		return
	}
	if err != nil {
		utils.SendTextResponse(w, "Invalid state parameter.")
		return
	}

	code, err := utils.PostPara(r, "code")
	if err != nil {
		utils.SendTextResponse(w, "Invalid state parameter.")
		return
	}

	//exchange the infromation to get code
	token, err := oh.googleOauthConfig.Exchange(context.Background(), code)
	if err != nil {
		utils.SendTextResponse(w, "Code exchange failed.")
		return
	}

	//get user info
	username, err := getUserInfo(token.AccessToken, oh.coredb)
	if err != nil {
		oh.ag.Logger.LogAuthByRequestInfo(username, r.RemoteAddr, time.Now().Unix(), false, "web")
		utils.SendTextResponse(w, "Failed to obtain user info.")
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
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte("You are not allowed to register in this system.&nbsp;<a href=\"/\">Back</a>"))
		}
	} else {
		log.Println(username + " logged in via OAuth.")
		oh.ag.LoginUserByRequest(w, r, username, true)
		//handling the reverse proxy remote IP issue
		remoteIP := r.Header.Get("X-FORWARDED-FOR")
		if remoteIP != "" {
			//grab the last known remote IP from header
			remoteIPs := strings.Split(remoteIP, ", ")
			remoteIP = remoteIPs[len(remoteIPs)-1]
		} else {
			//if there is no X-FORWARDED-FOR, use default remote IP
			remoteIP = r.RemoteAddr
		}
		oh.ag.Logger.LogAuthByRequestInfo(username, remoteIP, time.Now().Unix(), true, "web")
		//clear the cooke
		oh.addCookie(w, "uuid_login", "-invaild-", -1)
		//read the value from db and delete it from db
		url := oh.syncDb.Read(uuid.Value)
		oh.syncDb.Delete(uuid.Value)
		//redirect to the desired page
		http.Redirect(w, r, url, http.StatusFound)
	}
}

// CheckOAuth check if oauth is enabled
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
		utils.SendErrorResponse(w, "Error occurred while marshalling JSON response")
	}
	utils.SendJSONResponse(w, string(json))
}

// https://golangcode.com/add-a-http-cookie/
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
		utils.SendTextResponse(w, "Invalid config value [key=enabled].")
		return
	}
	autoredirect, err := strconv.ParseBool(oh.readSingleConfig("autoredirect"))
	if err != nil {
		utils.SendTextResponse(w, "Invalid config value [key=autoredirect].")
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
			utils.SendErrorResponse(w, "Error while marshalling config")
			return
		}
		utils.SendJSONResponse(w, string(empty))
		return
	}
	utils.SendJSONResponse(w, string(config))
}

func (oh *OauthHandler) WriteConfig(w http.ResponseWriter, r *http.Request) {
	enabled, err := utils.PostPara(r, "enabled")
	if err != nil {
		utils.SendErrorResponse(w, "enabled field can't be empty")
		return
	}
	autoredirect, err := utils.PostPara(r, "autoredirect")
	if err != nil {
		utils.SendErrorResponse(w, "enabled field can't be empty")
		return
	}

	showError := true
	if enabled != "true" {
		showError = false
	}

	idp, err := utils.PostPara(r, "idp")
	if err != nil {
		if showError {
			utils.SendErrorResponse(w, "idp field can't be empty")
			return
		}
	}
	redirecturl, err := utils.PostPara(r, "redirecturl")
	if err != nil {
		if showError {
			utils.SendErrorResponse(w, "redirecturl field can't be empty")
			return
		}
	}
	serverurl, err := utils.PostPara(r, "serverurl")
	if err != nil {
		if showError {
			if idp != "Gitlab" {
				serverurl = ""
			} else {
				utils.SendErrorResponse(w, "serverurl field can't be empty")
				return
			}
		}
	}
	if idp != "Gitlab" {
		serverurl = ""
	}

	clientid, err := utils.PostPara(r, "clientid")
	if err != nil {
		if showError {
			utils.SendErrorResponse(w, "clientid field can't be empty")
			return
		}
	}
	clientsecret, err := utils.PostPara(r, "clientsecret")
	if err != nil {
		if showError {
			utils.SendErrorResponse(w, "clientsecret field can't be empty")
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

	utils.SendOK(w)
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
