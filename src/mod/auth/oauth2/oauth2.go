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

// Config holds the persisted OAuth2 settings.
// Extra fields (AuthURL, TokenURL, UserInfoURL, UserField, CustomScope) are only
// used when IDP == "Custom".
type Config struct {
	Enabled      bool   `json:"enabled"`
	AutoRedirect bool   `json:"auto_redirect"`
	IDP          string `json:"idp"`
	RedirectURL  string `json:"redirect_url"`
	ServerURL    string `json:"server_url"`
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`
	// Custom provider fields
	AuthURL     string `json:"auth_url"`
	TokenURL    string `json:"token_url"`
	UserInfoURL string `json:"userinfo_url"`
	UserField   string `json:"user_field"`
	CustomScope string `json:"custom_scope"`
}

// NewOauthHandler creates and initialises the OAuth2 handler.
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

// HandleLogin initiates the OAuth2 login flow.
func (oh *OauthHandler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	enabled := oh.readSingleConfig("enabled")
	if enabled == "" || enabled == "false" {
		utils.SendTextResponse(w, "OAuth disabled")
		return
	}
	redirect, err := utils.GetPara(r, "redirect")
	uuid := ""
	if err != nil {
		uuid = oh.syncDb.Store("/")
	} else {
		uuid = oh.syncDb.Store(redirect)
	}
	oh.addCookie(w, "uuid_login", uuid, 30*time.Minute)
	url := oh.googleOauthConfig.AuthCodeURL(uuid)
	http.Redirect(w, r, url, http.StatusTemporaryRedirect)
}

// HandleAuthorize processes the OAuth2 callback from the provider.
func (oh *OauthHandler) HandleAuthorize(w http.ResponseWriter, r *http.Request) {
	enabled := oh.readSingleConfig("enabled")
	if enabled == "" || enabled == "false" {
		utils.SendTextResponse(w, "OAuth disabled")
		return
	}

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

	token, err := oh.googleOauthConfig.Exchange(context.Background(), code)
	if err != nil {
		utils.SendTextResponse(w, "Code exchange failed.")
		return
	}

	username, err := getUserInfo(token.AccessToken, oh.coredb)
	if err != nil {
		oh.ag.Logger.LogAuthByRequestInfo(username, r.RemoteAddr, time.Now().Unix(), false, "web")
		utils.SendTextResponse(w, "Failed to obtain user info.")
		return
	}

	if !oh.ag.UserExists(username) {
		if oh.reg.AllowRegistry {
			oh.ag.Logger.LogAuthByRequestInfo(username, r.RemoteAddr, time.Now().Unix(), false, "web")
			http.Redirect(w, r, "/public/register/register.html?user="+username, http.StatusFound)
		} else {
			oh.ag.Logger.LogAuthByRequestInfo(username, r.RemoteAddr, time.Now().Unix(), false, "web")
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte("You are not allowed to register in this system.&nbsp;<a href=\"/\">Back</a>"))
		}
	} else {
		log.Println(username + " logged in via OAuth.")
		oh.ag.LoginUserByRequest(w, r, username, true)
		remoteIP := r.Header.Get("X-FORWARDED-FOR")
		if remoteIP != "" {
			remoteIPs := strings.Split(remoteIP, ", ")
			remoteIP = remoteIPs[len(remoteIPs)-1]
		} else {
			remoteIP = r.RemoteAddr
		}
		oh.ag.Logger.LogAuthByRequestInfo(username, remoteIP, time.Now().Unix(), true, "web")
		oh.addCookie(w, "uuid_login", "-invaild-", -1)
		url := oh.syncDb.Read(uuid.Value)
		oh.syncDb.Delete(uuid.Value)
		http.Redirect(w, r, url, http.StatusFound)
	}
}

// CheckOAuth reports whether OAuth is enabled and if auto-redirect is active.
func (oh *OauthHandler) CheckOAuth(w http.ResponseWriter, r *http.Request) {
	enabledB := false
	if oh.readSingleConfig("enabled") == "true" {
		enabledB = true
	}
	autoredirectB := false
	if oh.readSingleConfig("autoredirect") == "true" {
		autoredirectB = true
	}

	type returnFormat struct {
		Enabled      bool `json:"enabled"`
		AutoRedirect bool `json:"auto_redirect"`
	}
	j, err := json.Marshal(returnFormat{Enabled: enabledB, AutoRedirect: autoredirectB})
	if err != nil {
		utils.SendErrorResponse(w, "Error occurred while marshalling JSON response")
	}
	utils.SendJSONResponse(w, string(j))
}

// ListProviders returns the supported OAuth2 provider names as a JSON array.
func (oh *OauthHandler) ListProviders(w http.ResponseWriter, r *http.Request) {
	providers := GetProviders()
	j, err := json.Marshal(providers)
	if err != nil {
		utils.SendErrorResponse(w, "Error while marshalling providers list")
		return
	}
	utils.SendJSONResponse(w, string(j))
}

// ReadConfig returns the full OAuth2 configuration as JSON.
func (oh *OauthHandler) ReadConfig(w http.ResponseWriter, r *http.Request) {
	enabled, err := strconv.ParseBool(oh.readSingleConfig("enabled"))
	if err != nil {
		// Default to false when the key has never been written.
		enabled = false
	}
	autoredirect, err := strconv.ParseBool(oh.readSingleConfig("autoredirect"))
	if err != nil {
		autoredirect = false
	}

	config, err := json.Marshal(Config{
		Enabled:      enabled,
		AutoRedirect: autoredirect,
		IDP:          oh.readSingleConfig("idp"),
		ServerURL:    oh.readSingleConfig("serverurl"),
		RedirectURL:  oh.readSingleConfig("redirecturl"),
		ClientID:     oh.readSingleConfig("clientid"),
		ClientSecret: oh.readSingleConfig("clientsecret"),
		AuthURL:      oh.readSingleConfig("authurl"),
		TokenURL:     oh.readSingleConfig("tokenurl"),
		UserInfoURL:  oh.readSingleConfig("userinfourl"),
		UserField:    oh.readSingleConfig("userfield"),
		CustomScope:  oh.readSingleConfig("customscope"),
	})
	if err != nil {
		empty, _ := json.Marshal(Config{})
		utils.SendJSONResponse(w, string(empty))
		return
	}
	utils.SendJSONResponse(w, string(config))
}

// WriteConfig persists the OAuth2 configuration and re-initialises the handler.
func (oh *OauthHandler) WriteConfig(w http.ResponseWriter, r *http.Request) {
	enabled, err := utils.PostPara(r, "enabled")
	if err != nil {
		utils.SendErrorResponse(w, "enabled field can't be empty")
		return
	}
	autoredirect, err := utils.PostPara(r, "autoredirect")
	if err != nil {
		utils.SendErrorResponse(w, "autoredirect field can't be empty")
		return
	}

	// Only validate required fields when OAuth is being enabled.
	requireFields := enabled == "true"

	idp, err := utils.PostPara(r, "idp")
	if err != nil && requireFields {
		utils.SendErrorResponse(w, "idp field can't be empty")
		return
	}

	redirecturl, err := utils.PostPara(r, "redirecturl")
	if err != nil && requireFields {
		utils.SendErrorResponse(w, "redirecturl field can't be empty")
		return
	}

	clientid, err := utils.PostPara(r, "clientid")
	if err != nil && requireFields {
		utils.SendErrorResponse(w, "clientid field can't be empty")
		return
	}

	clientsecret, err := utils.PostPara(r, "clientsecret")
	if err != nil && requireFields {
		utils.SendErrorResponse(w, "clientsecret field can't be empty")
		return
	}

	// Provider-specific fields.
	serverurl, _ := utils.PostPara(r, "serverurl")
	if idp != "Gitlab" {
		serverurl = ""
	}

	// Custom-provider fields (ignored for built-in providers).
	authurl, _ := utils.PostPara(r, "authurl")
	tokenurl, _ := utils.PostPara(r, "tokenurl")
	userinfourl, _ := utils.PostPara(r, "userinfourl")
	userfield, _ := utils.PostPara(r, "userfield")
	customscope, _ := utils.PostPara(r, "customscope")

	if idp == "Custom" && requireFields {
		if authurl == "" {
			utils.SendErrorResponse(w, "authurl field can't be empty for Custom provider")
			return
		}
		if tokenurl == "" {
			utils.SendErrorResponse(w, "tokenurl field can't be empty for Custom provider")
			return
		}
		if userinfourl == "" {
			utils.SendErrorResponse(w, "userinfourl field can't be empty for Custom provider")
			return
		}
	}

	// Persist all fields.
	oh.coredb.Write("oauth", "enabled", enabled)
	oh.coredb.Write("oauth", "autoredirect", autoredirect)
	oh.coredb.Write("oauth", "idp", idp)
	oh.coredb.Write("oauth", "redirecturl", redirecturl)
	oh.coredb.Write("oauth", "serverurl", serverurl)
	oh.coredb.Write("oauth", "clientid", clientid)
	oh.coredb.Write("oauth", "clientsecret", clientsecret)
	oh.coredb.Write("oauth", "authurl", authurl)
	oh.coredb.Write("oauth", "tokenurl", tokenurl)
	oh.coredb.Write("oauth", "userinfourl", userinfourl)
	oh.coredb.Write("oauth", "userfield", userfield)
	oh.coredb.Write("oauth", "customscope", customscope)

	// Re-initialise the in-memory oauth2.Config with the new values.
	oh.googleOauthConfig = &oauth2.Config{
		RedirectURL:  oh.readSingleConfig("redirecturl") + "/system/auth/oauth/authorize",
		ClientID:     oh.readSingleConfig("clientid"),
		ClientSecret: oh.readSingleConfig("clientsecret"),
		Scopes:       getScope(oh.coredb),
		Endpoint:     getEndpoint(oh.coredb),
	}

	utils.SendOK(w)
}

// addCookie sets an HTTP cookie on the response.
func (oh *OauthHandler) addCookie(w http.ResponseWriter, name, value string, ttl time.Duration) {
	expire := time.Now().Add(ttl)
	cookie := http.Cookie{
		Name:    name,
		Value:   value,
		Expires: expire,
	}
	http.SetCookie(w, &cookie)
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
