package oauth2

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"golang.org/x/oauth2"
	auth "imuslab.com/arozos/mod/auth"
	syncdb "imuslab.com/arozos/mod/auth/oauth2/syncdb"
	reg "imuslab.com/arozos/mod/auth/register"
	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/info/logger"
	"imuslab.com/arozos/mod/utils"
)

// OauthHandler manages OAuth2 / OIDC authentication for ArozOS.
// All provider configuration is discovery-driven: the administrator supplies
// an issuer URL and the handler fetches endpoints from the standard
// /.well-known/openid-configuration document.
type OauthHandler struct {
	syncDb *syncdb.SyncDB
	ag     *auth.AuthAgent
	reg    *reg.RegisterHandler
	coredb *db.Database
}

// Config holds the persisted OAuth2 / OIDC settings.
// Endpoints are normally auto-populated via OIDC Discovery but can be
// overridden manually for providers that do not publish a discovery document.
type Config struct {
	Enabled      bool `json:"enabled"`
	AutoRedirect bool `json:"auto_redirect"`

	// Provider identity (used to trigger discovery)
	IssuerURL string `json:"issuer_url"`

	// Application credentials
	ClientID     string `json:"client_id"`
	ClientSecret string `json:"client_secret"`

	// ArozOS server base URL (used to build the callback URL)
	RedirectURL string `json:"redirect_url"`

	// Space-separated OAuth2 scopes (default: "openid email profile")
	Scope string `json:"scope"`

	// JSON field in the userinfo response to use as the ArozOS username
	// (default: "email")
	UsernameField string `json:"username_field"`

	// OAuth2 endpoints — populated from OIDC discovery or set manually
	AuthEndpoint     string `json:"auth_endpoint"`
	TokenEndpoint    string `json:"token_endpoint"`
	UserInfoEndpoint string `json:"userinfo_endpoint"`
}

// NewOauthHandler creates and initialises the OAuth2 handler.
func NewOauthHandler(authAgent *auth.AuthAgent, register *reg.RegisterHandler, coreDb *db.Database) *OauthHandler {
	if err := coreDb.NewTable("oauth"); err != nil {
		logger.PrintAndLog("Oauth2", "Failed to create oauth database. Terminating.", nil)
		panic(err)
	}
	return &OauthHandler{
		ag:     authAgent,
		syncDb: syncdb.NewSyncDB(),
		reg:    register,
		coredb: coreDb,
	}
}

// buildOAuthConfig constructs a golang.org/x/oauth2.Config from the stored settings.
// Returns nil when the configuration is incomplete.
func (oh *OauthHandler) buildOAuthConfig() *oauth2.Config {
	authEndpoint := oh.readSingleConfig("authendpoint")
	tokenEndpoint := oh.readSingleConfig("tokenendpoint")
	clientID := oh.readSingleConfig("clientid")
	clientSecret := oh.readSingleConfig("clientsecret")
	redirectURL := oh.readSingleConfig("redirecturl")
	scope := oh.readSingleConfig("scope")
	if scope == "" {
		scope = "openid email profile"
	}

	if authEndpoint == "" || tokenEndpoint == "" || clientID == "" {
		return nil
	}

	return &oauth2.Config{
		RedirectURL:  redirectURL + "/system/auth/oauth/authorize",
		ClientID:     clientID,
		ClientSecret: clientSecret,
		Scopes:       strings.Fields(scope),
		Endpoint: oauth2.Endpoint{
			AuthURL:  authEndpoint,
			TokenURL: tokenEndpoint,
		},
	}
}

// ── Login / Authorize ─────────────────────────────────────────────────────────

// HandleLogin initiates the OAuth2 / OIDC login flow by redirecting the user
// to the provider's authorization endpoint.
func (oh *OauthHandler) HandleLogin(w http.ResponseWriter, r *http.Request) {
	if oh.readSingleConfig("enabled") != "true" {
		utils.SendTextResponse(w, "OAuth disabled")
		return
	}

	cfg := oh.buildOAuthConfig()
	if cfg == nil {
		utils.SendTextResponse(w, "OAuth is not properly configured (missing endpoints or client ID)")
		return
	}

	redirect, err := utils.GetPara(r, "redirect")
	var uuid string
	if err != nil {
		uuid = oh.syncDb.Store("/")
	} else {
		uuid = oh.syncDb.Store(redirect)
	}

	oh.addCookie(w, "uuid_login", uuid, 30*time.Minute)
	http.Redirect(w, r, cfg.AuthCodeURL(uuid), http.StatusTemporaryRedirect)
}

// HandleAuthorize processes the OAuth2 callback, exchanges the code for a token,
// fetches the user identity, and logs the user into ArozOS.
func (oh *OauthHandler) HandleAuthorize(w http.ResponseWriter, r *http.Request) {
	if oh.readSingleConfig("enabled") != "true" {
		utils.SendTextResponse(w, "OAuth disabled")
		return
	}

	uuidCookie, err := r.Cookie("uuid_login")
	if err != nil {
		utils.SendTextResponse(w, "Invalid redirect URI.")
		return
	}

	state, err := utils.PostPara(r, "state")
	if err != nil {
		utils.SendTextResponse(w, "Invalid state parameter.")
		return
	}
	if state != uuidCookie.Value {
		utils.SendTextResponse(w, "Invalid oauth state.")
		return
	}

	code, err := utils.PostPara(r, "code")
	if err != nil {
		utils.SendTextResponse(w, "Authorization code missing.")
		return
	}

	username, err := oh.exchangeCodeForUsername(r.Context(), code)
	if err != nil {
		oh.ag.Logger.LogAuthByRequestInfo("", r.RemoteAddr, time.Now().Unix(), false, "web")
		utils.SendTextResponse(w, "Authentication failed: "+err.Error())
		return
	}

	if !oh.ag.UserExists(username) {
		if oh.reg.AllowRegistry {
			oh.ag.Logger.LogAuthByRequestInfo(username, r.RemoteAddr, time.Now().Unix(), false, "web")
			http.Redirect(w, r, "/public/register/register.html?user="+username, http.StatusFound)
		} else {
			oh.ag.Logger.LogAuthByRequestInfo(username, r.RemoteAddr, time.Now().Unix(), false, "web")
			w.Header().Set("Content-Type", "text/html")
			w.Write([]byte(`You are not registered in this system.&nbsp;<a href="/">Back</a>`))
		}
		return
	}

	logger.PrintAndLog("Oauth2", username+" logged in via OAuth.", nil)
	oh.ag.LoginUserByRequest(w, r, username, true)

	remoteIP := r.Header.Get("X-FORWARDED-FOR")
	if remoteIP != "" {
		parts := strings.Split(remoteIP, ", ")
		remoteIP = parts[len(parts)-1]
	} else {
		remoteIP = r.RemoteAddr
	}
	oh.ag.Logger.LogAuthByRequestInfo(username, remoteIP, time.Now().Unix(), true, "web")

	oh.addCookie(w, "uuid_login", "-invalid-", -1)
	redirectURL := oh.syncDb.Read(uuidCookie.Value)
	oh.syncDb.Delete(uuidCookie.Value)
	http.Redirect(w, r, redirectURL, http.StatusFound)
}

// exchangeCodeForUsername exchanges the OAuth2 authorization code for an access
// token and then fetches the username from the userinfo endpoint.
// This function is separated to make it independently testable.
func (oh *OauthHandler) exchangeCodeForUsername(ctx context.Context, code string) (string, error) {
	cfg := oh.buildOAuthConfig()
	if cfg == nil {
		return "", errors.New("oauth is not properly configured")
	}

	token, err := cfg.Exchange(ctx, code)
	if err != nil {
		return "", fmt.Errorf("token exchange failed: %w", err) //nolint:wrapcheck
	}

	userinfoURL := oh.readSingleConfig("userinfoendpoint")
	usernameField := oh.readSingleConfig("usernamefield")
	return getUserInfoFromEndpoint(token.AccessToken, userinfoURL, usernameField)
}

// CheckOAuth reports whether OAuth is enabled and whether auto-redirect is active.
// Used by the login page.
func (oh *OauthHandler) CheckOAuth(w http.ResponseWriter, r *http.Request) {
	type result struct {
		Enabled      bool `json:"enabled"`
		AutoRedirect bool `json:"auto_redirect"`
	}
	j, err := json.Marshal(result{
		Enabled:      oh.readSingleConfig("enabled") == "true",
		AutoRedirect: oh.readSingleConfig("autoredirect") == "true",
	})
	if err != nil {
		utils.SendErrorResponse(w, "Error marshalling response")
		return
	}
	utils.SendJSONResponse(w, string(j))
}

// ── Configuration ─────────────────────────────────────────────────────────────

// HandleDiscover fetches the OIDC discovery document for the given issuer URL
// and returns the discovered endpoints to the frontend.
// Query / POST parameter: issuerurl
func (oh *OauthHandler) HandleDiscover(w http.ResponseWriter, r *http.Request) {
	issuerURL, err := utils.GetPara(r, "issuerurl")
	if err != nil {
		issuerURL, err = utils.PostPara(r, "issuerurl")
		if err != nil {
			utils.SendErrorResponse(w, "issuerurl parameter is required")
			return
		}
	}

	doc, err := FetchOIDCDiscovery(issuerURL)
	if err != nil {
		utils.SendErrorResponse(w, err.Error())
		return
	}

	result := DiscoveryResult{
		AuthEndpoint:     doc.AuthorizationEndpoint,
		TokenEndpoint:    doc.TokenEndpoint,
		UserInfoEndpoint: doc.UserinfoEndpoint,
		ScopesSupported:  doc.ScopesSupported,
		ClaimsSupported:  doc.ClaimsSupported,
	}

	j, err := json.Marshal(result)
	if err != nil {
		utils.SendErrorResponse(w, "Error marshalling discovery result")
		return
	}
	utils.SendJSONResponse(w, string(j))
}

// ReadConfig returns the full OAuth2 / OIDC configuration as JSON.
func (oh *OauthHandler) ReadConfig(w http.ResponseWriter, r *http.Request) {
	enabled, err := strconv.ParseBool(oh.readSingleConfig("enabled"))
	if err != nil {
		enabled = false
	}
	autoredirect, err := strconv.ParseBool(oh.readSingleConfig("autoredirect"))
	if err != nil {
		autoredirect = false
	}

	cfg := Config{
		Enabled:          enabled,
		AutoRedirect:     autoredirect,
		IssuerURL:        oh.readSingleConfig("issuerurl"),
		ClientID:         oh.readSingleConfig("clientid"),
		ClientSecret:     oh.readSingleConfig("clientsecret"),
		RedirectURL:      oh.readSingleConfig("redirecturl"),
		Scope:            oh.readSingleConfig("scope"),
		UsernameField:    oh.readSingleConfig("usernamefield"),
		AuthEndpoint:     oh.readSingleConfig("authendpoint"),
		TokenEndpoint:    oh.readSingleConfig("tokenendpoint"),
		UserInfoEndpoint: oh.readSingleConfig("userinfoendpoint"),
	}

	j, err := json.Marshal(cfg)
	if err != nil {
		empty, _ := json.Marshal(Config{})
		utils.SendJSONResponse(w, string(empty))
		return
	}
	utils.SendJSONResponse(w, string(j))
}

// WriteConfig persists the OAuth2 / OIDC configuration.
// All endpoint fields may either come from OIDC discovery (triggered by the
// frontend) or be provided manually.
func (oh *OauthHandler) WriteConfig(w http.ResponseWriter, r *http.Request) {
	enabled, err := utils.PostPara(r, "enabled")
	if err != nil {
		utils.SendErrorResponse(w, "enabled field is required")
		return
	}
	autoredirect, err := utils.PostPara(r, "autoredirect")
	if err != nil {
		utils.SendErrorResponse(w, "autoredirect field is required")
		return
	}

	requireFields := enabled == "true"

	issuerURL, _ := utils.PostPara(r, "issuerurl")
	clientID, err := utils.PostPara(r, "clientid")
	if err != nil && requireFields {
		utils.SendErrorResponse(w, "clientid is required when OAuth is enabled")
		return
	}
	clientSecret, err := utils.PostPara(r, "clientsecret")
	if err != nil && requireFields {
		utils.SendErrorResponse(w, "clientsecret is required when OAuth is enabled")
		return
	}
	redirectURL, err := utils.PostPara(r, "redirecturl")
	if err != nil && requireFields {
		utils.SendErrorResponse(w, "redirecturl is required when OAuth is enabled")
		return
	}

	scope, _ := utils.PostPara(r, "scope")
	usernameField, _ := utils.PostPara(r, "usernamefield")

	authEndpoint, err := utils.PostPara(r, "authendpoint")
	if err != nil && requireFields {
		utils.SendErrorResponse(w, "authendpoint is required when OAuth is enabled")
		return
	}
	tokenEndpoint, err := utils.PostPara(r, "tokenendpoint")
	if err != nil && requireFields {
		utils.SendErrorResponse(w, "tokenendpoint is required when OAuth is enabled")
		return
	}
	userinfoEndpoint, err := utils.PostPara(r, "userinfoendpoint")
	if err != nil && requireFields {
		utils.SendErrorResponse(w, "userinfoendpoint is required when OAuth is enabled")
		return
	}

	oh.coredb.Write("oauth", "enabled", enabled)
	oh.coredb.Write("oauth", "autoredirect", autoredirect)
	oh.coredb.Write("oauth", "issuerurl", issuerURL)
	oh.coredb.Write("oauth", "clientid", clientID)
	oh.coredb.Write("oauth", "clientsecret", clientSecret)
	oh.coredb.Write("oauth", "redirecturl", redirectURL)
	oh.coredb.Write("oauth", "scope", scope)
	oh.coredb.Write("oauth", "usernamefield", usernameField)
	oh.coredb.Write("oauth", "authendpoint", authEndpoint)
	oh.coredb.Write("oauth", "tokenendpoint", tokenEndpoint)
	oh.coredb.Write("oauth", "userinfoendpoint", userinfoEndpoint)

	utils.SendOK(w)
}

// ── Helpers ───────────────────────────────────────────────────────────────────

func (oh *OauthHandler) addCookie(w http.ResponseWriter, name, value string, ttl time.Duration) {
	http.SetCookie(w, &http.Cookie{
		Name:    name,
		Value:   value,
		Expires: time.Now().Add(ttl),
	})
}

func (oh *OauthHandler) readSingleConfig(key string) string {
	var v string
	oh.coredb.Read("oauth", key, &v)
	return v
}

func readSingleConfig(key string, coredb *db.Database) string {
	var v string
	coredb.Read("oauth", key, &v)
	return v
}
