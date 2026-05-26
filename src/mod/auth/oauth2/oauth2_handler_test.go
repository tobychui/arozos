package oauth2

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	db "imuslab.com/arozos/mod/database"
	syncdb "imuslab.com/arozos/mod/auth/oauth2/syncdb"
)

// ── Test infrastructure ───────────────────────────────────────────────────────

func newTestDB(t *testing.T) (*db.Database, func()) {
	t.Helper()
	dir, err := os.MkdirTemp("", "arozos-oauth-test-*")
	if err != nil {
		t.Fatalf("MkdirTemp: %v", err)
	}
	database, err := db.NewDatabase(dir+"/test.db", false)
	if err != nil {
		os.RemoveAll(dir)
		t.Fatalf("NewDatabase: %v", err)
	}
	return database, func() { os.RemoveAll(dir) }
}

// minimalOauthHandler returns a handler with only a live database; ag and reg
// are nil because the config/discover handlers under test never touch them.
func minimalOauthHandler(coredb *db.Database) *OauthHandler {
	_ = coredb.NewTable("oauth") // ignore "already exists"
	return &OauthHandler{coredb: coredb}
}

func postForm(t *testing.T, h http.HandlerFunc, values url.Values) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(values.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	h(w, req)
	return w
}

func getReq(t *testing.T, h http.HandlerFunc) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	h(w, req)
	return w
}

func getReqWithParams(t *testing.T, h http.HandlerFunc, params url.Values) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(http.MethodGet, "/?"+params.Encode(), nil)
	w := httptest.NewRecorder()
	h(w, req)
	return w
}

// ── ReadConfig ────────────────────────────────────────────────────────────────

func TestReadConfig_DefaultsToDisabled(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	w := getReq(t, oh.ReadConfig)

	if w.Code != http.StatusOK {
		t.Fatalf("ReadConfig returned %d, want 200", w.Code)
	}
	var cfg Config
	if err := json.Unmarshal(w.Body.Bytes(), &cfg); err != nil {
		t.Fatalf("response is not valid JSON: %v; body: %s", err, w.Body)
	}
	if cfg.Enabled {
		t.Error("expected Enabled=false for fresh DB")
	}
}

func TestReadConfig_AllFieldsRoundTrip(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	// Seed values
	coredb.Write("oauth", "issuerurl", "https://idp.example.com")
	coredb.Write("oauth", "authendpoint", "https://idp.example.com/auth")
	coredb.Write("oauth", "tokenendpoint", "https://idp.example.com/token")
	coredb.Write("oauth", "userinfoendpoint", "https://idp.example.com/userinfo")
	coredb.Write("oauth", "usernamefield", "preferred_username")
	coredb.Write("oauth", "scope", "openid email")

	w := getReq(t, oh.ReadConfig)
	var cfg Config
	if err := json.Unmarshal(w.Body.Bytes(), &cfg); err != nil {
		t.Fatalf("JSON parse: %v", err)
	}

	checks := []struct{ f, got, want string }{
		{"IssuerURL", cfg.IssuerURL, "https://idp.example.com"},
		{"AuthEndpoint", cfg.AuthEndpoint, "https://idp.example.com/auth"},
		{"TokenEndpoint", cfg.TokenEndpoint, "https://idp.example.com/token"},
		{"UserInfoEndpoint", cfg.UserInfoEndpoint, "https://idp.example.com/userinfo"},
		{"UsernameField", cfg.UsernameField, "preferred_username"},
		{"Scope", cfg.Scope, "openid email"},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s: got %q, want %q", c.f, c.got, c.want)
		}
	}
}

// ── WriteConfig ───────────────────────────────────────────────────────────────

func TestWriteConfig_MissingEnabledField(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	w := postForm(t, oh.WriteConfig, url.Values{"clientid": {"x"}})
	if !strings.Contains(w.Body.String(), "error") {
		t.Errorf("expected error without enabled field, got %q", w.Body)
	}
}

func TestWriteConfig_DisabledAllowsEmptyFields(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	w := postForm(t, oh.WriteConfig, url.Values{
		"enabled": {"false"}, "autoredirect": {"false"},
	})
	if strings.Contains(w.Body.String(), `"error"`) {
		t.Errorf("unexpected error when disabling: %q", w.Body)
	}
}

func TestWriteConfig_EnabledRequiresCredentials(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	// enabled=true but clientid missing
	w := postForm(t, oh.WriteConfig, url.Values{
		"enabled":          {"true"},
		"autoredirect":     {"false"},
		"clientsecret":     {"s"},
		"redirecturl":      {"https://aroz.example.com"},
		"authendpoint":     {"https://idp/auth"},
		"tokenendpoint":    {"https://idp/token"},
		"userinfoendpoint": {"https://idp/userinfo"},
	})
	if !strings.Contains(w.Body.String(), "error") {
		t.Errorf("expected error for missing clientid: %q", w.Body)
	}
}

func TestWriteConfig_EnabledRequiresEndpoints(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	// enabled=true but endpoints missing
	w := postForm(t, oh.WriteConfig, url.Values{
		"enabled":      {"true"},
		"autoredirect": {"false"},
		"clientid":     {"id"},
		"clientsecret": {"s"},
		"redirecturl":  {"https://aroz.example.com"},
		// authendpoint / tokenendpoint / userinfoendpoint all missing
	})
	if !strings.Contains(w.Body.String(), "error") {
		t.Errorf("expected error for missing endpoints: %q", w.Body)
	}
}

func TestWriteConfig_FullRoundTrip(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	in := url.Values{
		"enabled":          {"false"},
		"autoredirect":     {"false"},
		"issuerurl":        {"https://idp.example.com"},
		"clientid":         {"client-abc"},
		"clientsecret":     {"secret-xyz"},
		"redirecturl":      {"https://aroz.example.com"},
		"scope":            {"openid email profile"},
		"usernamefield":    {"preferred_username"},
		"authendpoint":     {"https://idp.example.com/auth"},
		"tokenendpoint":    {"https://idp.example.com/token"},
		"userinfoendpoint": {"https://idp.example.com/userinfo"},
	}
	wWrite := postForm(t, oh.WriteConfig, in)
	if strings.Contains(wWrite.Body.String(), `"error"`) {
		t.Fatalf("WriteConfig error: %s", wWrite.Body)
	}

	wRead := getReq(t, oh.ReadConfig)
	var cfg Config
	if err := json.Unmarshal(wRead.Body.Bytes(), &cfg); err != nil {
		t.Fatalf("ReadConfig JSON parse: %v", err)
	}

	checks := []struct{ f, got, want string }{
		{"IssuerURL", cfg.IssuerURL, "https://idp.example.com"},
		{"ClientID", cfg.ClientID, "client-abc"},
		{"ClientSecret", cfg.ClientSecret, "secret-xyz"},
		{"RedirectURL", cfg.RedirectURL, "https://aroz.example.com"},
		{"Scope", cfg.Scope, "openid email profile"},
		{"UsernameField", cfg.UsernameField, "preferred_username"},
		{"AuthEndpoint", cfg.AuthEndpoint, "https://idp.example.com/auth"},
		{"TokenEndpoint", cfg.TokenEndpoint, "https://idp.example.com/token"},
		{"UserInfoEndpoint", cfg.UserInfoEndpoint, "https://idp.example.com/userinfo"},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s: got %q, want %q", c.f, c.got, c.want)
		}
	}
	if cfg.Enabled {
		t.Error("Enabled: got true, want false")
	}
}

func TestWriteConfig_OverwritesPreviousValues(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	postForm(t, oh.WriteConfig, url.Values{
		"enabled": {"false"}, "autoredirect": {"false"},
		"clientid": {"old-id"},
	})
	postForm(t, oh.WriteConfig, url.Values{
		"enabled": {"false"}, "autoredirect": {"false"},
		"clientid": {"new-id"},
	})

	wRead := getReq(t, oh.ReadConfig)
	var cfg Config
	json.Unmarshal(wRead.Body.Bytes(), &cfg) //nolint:errcheck
	if cfg.ClientID != "new-id" {
		t.Errorf("ClientID: got %q, want %q", cfg.ClientID, "new-id")
	}
}

// ── HandleDiscover ────────────────────────────────────────────────────────────

func TestHandleDiscover_Success(t *testing.T) {
	// Set up a mock OIDC provider. Declare first so the handler closure can
	// reference providerSrv.URL by the time it is actually invoked.
	var providerSrv *httptest.Server
	providerSrv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(minimalDiscoveryDoc(providerSrv.URL))
	}))
	defer providerSrv.Close()
	defer withMockClient(providerSrv)()

	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	w := getReqWithParams(t, oh.HandleDiscover, url.Values{"issuerurl": {providerSrv.URL}})
	if w.Code != http.StatusOK {
		t.Fatalf("HandleDiscover returned %d; body: %s", w.Code, w.Body)
	}

	var result DiscoveryResult
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("response is not valid JSON: %v; body: %s", err, w.Body)
	}
	if result.AuthEndpoint == "" {
		t.Error("AuthEndpoint is empty in discovery result")
	}
	if result.TokenEndpoint == "" {
		t.Error("TokenEndpoint is empty in discovery result")
	}
	if result.UserInfoEndpoint == "" {
		t.Error("UserInfoEndpoint is empty in discovery result")
	}
	if len(result.ScopesSupported) == 0 {
		t.Error("ScopesSupported is empty in discovery result")
	}
}

func TestHandleDiscover_MissingIssuerURL(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	w := getReq(t, oh.HandleDiscover)
	if w.Code != http.StatusOK {
		t.Fatalf("unexpected status %d", w.Code)
	}
	if !strings.Contains(w.Body.String(), "error") {
		t.Errorf("expected error for missing issuerurl, got %q", w.Body)
	}
}

func TestHandleDiscover_ProviderReturns404(t *testing.T) {
	providerSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer providerSrv.Close()
	defer withMockClient(providerSrv)()

	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	w := getReqWithParams(t, oh.HandleDiscover, url.Values{"issuerurl": {providerSrv.URL}})
	if !strings.Contains(w.Body.String(), "error") {
		t.Errorf("expected error for 404 provider, got %q", w.Body)
	}
}

func TestHandleDiscover_ScopesSuggested(t *testing.T) {
	var providerSrv *httptest.Server
	providerSrv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(minimalDiscoveryDoc(providerSrv.URL))
	}))
	defer providerSrv.Close()
	defer withMockClient(providerSrv)()

	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	w := getReqWithParams(t, oh.HandleDiscover, url.Values{"issuerurl": {providerSrv.URL}})
	var result DiscoveryResult
	json.Unmarshal(w.Body.Bytes(), &result) //nolint:errcheck
	if len(result.ScopesSupported) == 0 {
		t.Error("ScopesSupported should not be empty after discovery")
	}
}

func TestHandleDiscover_ClaimsReturned(t *testing.T) {
	var providerSrv *httptest.Server
	providerSrv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(minimalDiscoveryDoc(providerSrv.URL))
	}))
	defer providerSrv.Close()
	defer withMockClient(providerSrv)()

	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	w := getReqWithParams(t, oh.HandleDiscover, url.Values{"issuerurl": {providerSrv.URL}})
	var result DiscoveryResult
	json.Unmarshal(w.Body.Bytes(), &result) //nolint:errcheck
	if len(result.ClaimsSupported) == 0 {
		t.Error("ClaimsSupported should not be empty after discovery")
	}
}

// ── CheckOAuth ────────────────────────────────────────────────────────────────

func TestCheckOAuth_DisabledByDefault(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	w := getReq(t, oh.CheckOAuth)

	var result struct {
		Enabled      bool `json:"enabled"`
		AutoRedirect bool `json:"auto_redirect"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil {
		t.Fatalf("JSON parse: %v", err)
	}
	if result.Enabled {
		t.Error("expected Enabled=false by default")
	}
}

func TestCheckOAuth_ReflectsStoredValues(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	coredb.Write("oauth", "enabled", "true")
	coredb.Write("oauth", "autoredirect", "true")

	w := getReq(t, oh.CheckOAuth)
	var result struct {
		Enabled      bool `json:"enabled"`
		AutoRedirect bool `json:"auto_redirect"`
	}
	json.Unmarshal(w.Body.Bytes(), &result) //nolint:errcheck

	if !result.Enabled {
		t.Error("expected Enabled=true")
	}
	if !result.AutoRedirect {
		t.Error("expected AutoRedirect=true")
	}
}

// ── HandleLogin guards ────────────────────────────────────────────────────────

func TestHandleLogin_DisabledReturnsText(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)
	// "enabled" not set → disabled

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	oh.HandleLogin(w, req)

	body := w.Body.String()
	if !strings.Contains(strings.ToLower(body), "disabled") {
		t.Errorf("expected 'disabled' in response, got %q", body)
	}
}

func TestHandleLogin_MisconfiguredNoEndpoints(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	coredb.Write("oauth", "enabled", "true")
	// no authendpoint / tokenendpoint / clientid

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	oh.HandleLogin(w, req)

	body := w.Body.String()
	if strings.Contains(body, "302") || w.Code == http.StatusTemporaryRedirect {
		t.Errorf("should not redirect when misconfigured; got code %d, body %q", w.Code, body)
	}
}

// ── HandleAuthorize guards ────────────────────────────────────────────────────

func TestHandleAuthorize_DisabledReturnsText(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("state=x&code=y"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	oh.HandleAuthorize(w, req)

	if !strings.Contains(strings.ToLower(w.Body.String()), "disabled") {
		t.Errorf("expected disabled message, got %q", w.Body)
	}
}

func TestHandleAuthorize_MissingCookie(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)
	coredb.Write("oauth", "enabled", "true")

	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader("state=x&code=y"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	w := httptest.NewRecorder()
	oh.HandleAuthorize(w, req)

	if !strings.Contains(w.Body.String(), "Invalid redirect URI") {
		t.Errorf("expected 'Invalid redirect URI', got %q", w.Body)
	}
}

func TestHandleAuthorize_StateMismatch(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)
	coredb.Write("oauth", "enabled", "true")
	oh.syncDb = syncdb.NewSyncDB()

	uuid := oh.syncDb.Store("/")

	req := httptest.NewRequest(http.MethodPost, "/",
		strings.NewReader("state=WRONG_STATE&code=x"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.AddCookie(&http.Cookie{Name: "uuid_login", Value: uuid})
	w := httptest.NewRecorder()
	oh.HandleAuthorize(w, req)

	if !strings.Contains(w.Body.String(), "Invalid oauth state") {
		t.Errorf("expected 'Invalid oauth state', got %q", w.Body)
	}
}

// ── exchangeCodeForUsername (connectivity) ────────────────────────────────────

// buildMockOIDCStack creates:
//   - a mock token endpoint server that accepts any code and returns accessToken
//   - a mock userinfo server that verifies the Bearer token and returns claims
//
// Both servers are plain HTTP so the default transport can reach them.
// The package-level httpClient is replaced for the userinfo call and is
// restored by the returned closeFn.
func buildMockOIDCStack(
	t *testing.T,
	accessToken string,
	claims map[string]interface{},
) (tokenURL, userinfoURL string, closeFn func()) {
	t.Helper()

	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"access_token": accessToken,
			"token_type":   "Bearer",
			"expires_in":   3600,
		})
	}))

	userinfoSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth != "Bearer "+accessToken {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(claims)
	}))

	// Both test servers are plain HTTP; a standard http.Client can reach both.
	// We replace httpClient so getUserInfoFromEndpoint uses the same plain transport.
	origClient := httpClient
	httpClient = &http.Client{}

	closeFn = func() {
		tokenSrv.Close()
		userinfoSrv.Close()
		httpClient = origClient
	}
	return tokenSrv.URL, userinfoSrv.URL, closeFn
}

// TestExchangeCodeForUsername_Success runs the token exchange → userinfo fetch
// pipeline against real mock HTTP servers.
func TestExchangeCodeForUsername_Success(t *testing.T) {
	const fakeToken = "exchange-tok-abc123"
	tokenURL, userinfoURL, closeFn := buildMockOIDCStack(t, fakeToken, map[string]interface{}{
		"sub":   "uid-999",
		"email": "testuser@example.com",
	})
	defer closeFn()

	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	coredb.Write("oauth", "authendpoint", "https://example.com/auth") // not called
	coredb.Write("oauth", "tokenendpoint", tokenURL)
	coredb.Write("oauth", "userinfoendpoint", userinfoURL)
	coredb.Write("oauth", "clientid", "test-client")
	coredb.Write("oauth", "clientsecret", "test-secret")
	coredb.Write("oauth", "redirecturl", "https://aroz.example.com")
	coredb.Write("oauth", "usernamefield", "email")

	username, err := oh.exchangeCodeForUsername(context.Background(), "some-auth-code")
	if err != nil {
		t.Fatalf("exchangeCodeForUsername returned error: %v", err)
	}
	if username != "testuser@example.com" {
		t.Errorf("username: got %q, want %q", username, "testuser@example.com")
	}
}

func TestExchangeCodeForUsername_PreferredUsername(t *testing.T) {
	const fakeToken = "pref-tok"
	tokenURL, userinfoURL, closeFn := buildMockOIDCStack(t, fakeToken, map[string]interface{}{
		"sub":                "uid-123",
		"preferred_username": "alice",
		"email":              "alice@corp.example",
	})
	defer closeFn()

	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	coredb.Write("oauth", "authendpoint", "https://x/auth")
	coredb.Write("oauth", "tokenendpoint", tokenURL)
	coredb.Write("oauth", "userinfoendpoint", userinfoURL)
	coredb.Write("oauth", "clientid", "cid")
	coredb.Write("oauth", "clientsecret", "cs")
	coredb.Write("oauth", "redirecturl", "https://aroz.example.com")
	coredb.Write("oauth", "usernamefield", "preferred_username")

	username, err := oh.exchangeCodeForUsername(context.Background(), "code")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if username != "alice" {
		t.Errorf("username: got %q, want %q", username, "alice")
	}
}

func TestExchangeCodeForUsername_TokenEndpointError(t *testing.T) {
	// Token server that always returns 400.
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		w.Write([]byte(`{"error":"invalid_grant"}`))
	}))
	defer tokenSrv.Close()

	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	coredb.Write("oauth", "authendpoint", "https://x/auth")
	coredb.Write("oauth", "tokenendpoint", tokenSrv.URL)
	coredb.Write("oauth", "userinfoendpoint", "https://x/userinfo")
	coredb.Write("oauth", "clientid", "cid")
	coredb.Write("oauth", "clientsecret", "cs")
	coredb.Write("oauth", "redirecturl", "https://aroz.example.com")

	_, err := oh.exchangeCodeForUsername(context.Background(), "bad-code")
	if err == nil {
		t.Fatal("expected error from failing token endpoint, got nil")
	}
	if !strings.Contains(err.Error(), "token exchange failed") {
		t.Errorf("expected 'token exchange failed' in error, got: %v", err)
	}
}

func TestExchangeCodeForUsername_UserInfoError(t *testing.T) {
	const fakeToken = "good-tok"
	// Token server succeeds; userinfo server fails.
	tokenSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"access_token": fakeToken, "token_type": "Bearer", "expires_in": 3600,
		})
	}))
	defer tokenSrv.Close()

	userinfoSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer userinfoSrv.Close()

	// Replace httpClient so getUserInfoFromEndpoint uses the same plain transport.
	origClient := httpClient
	httpClient = &http.Client{}
	defer func() { httpClient = origClient }()

	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	coredb.Write("oauth", "authendpoint", "https://x/auth")
	coredb.Write("oauth", "tokenendpoint", tokenSrv.URL)
	coredb.Write("oauth", "userinfoendpoint", userinfoSrv.URL)
	coredb.Write("oauth", "clientid", "cid")
	coredb.Write("oauth", "clientsecret", "cs")
	coredb.Write("oauth", "redirecturl", "https://aroz.example.com")
	coredb.Write("oauth", "usernamefield", "email")

	_, err := oh.exchangeCodeForUsername(context.Background(), "code")
	if err == nil {
		t.Fatal("expected error from failing userinfo endpoint, got nil")
	}
}

func TestExchangeCodeForUsername_MisconfiguredNoEndpoints(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)
	// No endpoints configured

	_, err := oh.exchangeCodeForUsername(context.Background(), "code")
	if err == nil {
		t.Fatal("expected error for unconfigured handler, got nil")
	}
}

// ── buildOAuthConfig ─────────────────────────────────────────────────────────

func TestBuildOAuthConfig_NilWhenMissing(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	if oh.buildOAuthConfig() != nil {
		t.Error("expected nil config when no endpoints are set")
	}
}

func TestBuildOAuthConfig_ScopeDefaults(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	coredb.Write("oauth", "authendpoint", "https://x/auth")
	coredb.Write("oauth", "tokenendpoint", "https://x/token")
	coredb.Write("oauth", "clientid", "cid")
	// scope intentionally not set

	cfg := oh.buildOAuthConfig()
	if cfg == nil {
		t.Fatal("buildOAuthConfig returned nil")
	}
	if len(cfg.Scopes) == 0 {
		t.Fatal("Scopes should not be empty when scope is not set (should use default)")
	}
	defaultScopes := strings.Join(cfg.Scopes, " ")
	if !strings.Contains(defaultScopes, "openid") {
		t.Errorf("default scope should contain 'openid', got: %q", defaultScopes)
	}
}

func TestBuildOAuthConfig_ScopeFromDB(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	coredb.Write("oauth", "authendpoint", "https://x/auth")
	coredb.Write("oauth", "tokenendpoint", "https://x/token")
	coredb.Write("oauth", "clientid", "cid")
	coredb.Write("oauth", "scope", "openid email custom-scope")

	cfg := oh.buildOAuthConfig()
	if cfg == nil {
		t.Fatal("buildOAuthConfig returned nil")
	}
	if len(cfg.Scopes) != 3 {
		t.Errorf("expected 3 scopes, got %d: %v", len(cfg.Scopes), cfg.Scopes)
	}
}

func TestBuildOAuthConfig_CallbackURL(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	coredb.Write("oauth", "authendpoint", "https://x/auth")
	coredb.Write("oauth", "tokenendpoint", "https://x/token")
	coredb.Write("oauth", "clientid", "cid")
	coredb.Write("oauth", "redirecturl", "https://aroz.my.domain")

	cfg := oh.buildOAuthConfig()
	if cfg == nil {
		t.Fatal("buildOAuthConfig returned nil")
	}
	if !strings.HasSuffix(cfg.RedirectURL, "/system/auth/oauth/authorize") {
		t.Errorf("RedirectURL should end with /system/auth/oauth/authorize, got: %q", cfg.RedirectURL)
	}
	if !strings.HasPrefix(cfg.RedirectURL, "https://aroz.my.domain") {
		t.Errorf("RedirectURL should start with stored base URL, got: %q", cfg.RedirectURL)
	}
}
