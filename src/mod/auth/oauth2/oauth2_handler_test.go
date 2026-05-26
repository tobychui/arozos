package oauth2

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"

	db "imuslab.com/arozos/mod/database"
)

// ── helpers ──────────────────────────────────────────────────────────────────

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
	cleanup := func() { os.RemoveAll(dir) }
	return database, cleanup
}

// minimalOauthHandler creates an OauthHandler that only needs a live database
// (auth agent and register handler are nil because they are not exercised by
// the config handlers under test).
func minimalOauthHandler(coredb *db.Database) *OauthHandler {
	if err := coredb.NewTable("oauth"); err != nil {
		// Table may already exist – that is fine.
		_ = err
	}
	return &OauthHandler{
		googleOauthConfig: nil, // not needed for config-only tests
		coredb:            coredb,
	}
}

// postForm issues a POST to the given handler with form values and returns
// the recorder so callers can inspect the response.
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

// ── GetProviders ─────────────────────────────────────────────────────────────

func TestGetProviders_ContainsBuiltIn(t *testing.T) {
	providers := GetProviders()
	want := map[string]bool{
		"Google":    false,
		"Microsoft": false,
		"Github":    false,
		"Gitlab":    false,
		"Custom":    false,
	}
	for _, p := range providers {
		if _, ok := want[p]; ok {
			want[p] = true
		}
	}
	for name, found := range want {
		if !found {
			t.Errorf("GetProviders() missing expected provider %q", name)
		}
	}
}

func TestGetProviders_NoDuplicates(t *testing.T) {
	seen := map[string]int{}
	for _, p := range GetProviders() {
		seen[p]++
	}
	for name, count := range seen {
		if count > 1 {
			t.Errorf("GetProviders() returned %q %d times (expected 1)", name, count)
		}
	}
}

// ── ListProviders handler ─────────────────────────────────────────────────────

func TestListProviders_ReturnsJSON(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	w := getReq(t, oh.ListProviders)

	if w.Code != http.StatusOK {
		t.Fatalf("ListProviders returned %d, want 200", w.Code)
	}

	var providers []string
	if err := json.Unmarshal(w.Body.Bytes(), &providers); err != nil {
		t.Fatalf("response is not valid JSON array: %v\nbody: %s", err, w.Body.String())
	}
	if len(providers) == 0 {
		t.Error("ListProviders returned empty list")
	}
}

func TestListProviders_IncludesCustom(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	w := getReq(t, oh.ListProviders)
	var providers []string
	json.Unmarshal(w.Body.Bytes(), &providers) //nolint:errcheck

	found := false
	for _, p := range providers {
		if p == "Custom" {
			found = true
			break
		}
	}
	if !found {
		t.Errorf("ListProviders did not include 'Custom': %v", providers)
	}
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
		t.Fatalf("response is not valid JSON: %v\nbody: %s", err, w.Body.String())
	}
	if cfg.Enabled {
		t.Error("ReadConfig: expected Enabled=false for fresh DB, got true")
	}
}

func TestReadConfig_ReturnsAllFields(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	// Pre-seed a value so the response is non-trivial.
	coredb.Write("oauth", "idp", "Google")

	w := getReq(t, oh.ReadConfig)
	var cfg Config
	json.Unmarshal(w.Body.Bytes(), &cfg) //nolint:errcheck

	if cfg.IDP != "Google" {
		t.Errorf("ReadConfig IDP: got %q, want %q", cfg.IDP, "Google")
	}
}

// ── WriteConfig ───────────────────────────────────────────────────────────────

func TestWriteConfig_MissingEnabledField(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	// Post with no "enabled" field.
	values := url.Values{"idp": {"Google"}}
	w := postForm(t, oh.WriteConfig, values)

	if w.Code != http.StatusOK {
		t.Fatalf("WriteConfig returned %d, want 200", w.Code)
	}
	body := w.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("WriteConfig: expected error in response, got %q", body)
	}
}

func TestWriteConfig_DisabledAllowsEmptyFields(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	// When enabled=false, required provider fields should not be enforced.
	values := url.Values{
		"enabled":     {"false"},
		"autoredirect": {"false"},
	}
	w := postForm(t, oh.WriteConfig, values)

	if w.Code != http.StatusOK {
		t.Fatalf("WriteConfig returned %d, want 200", w.Code)
	}
	body := w.Body.String()
	if strings.Contains(body, `"error"`) {
		t.Errorf("WriteConfig: unexpected error when disabling OAuth: %q", body)
	}
}

func TestWriteConfig_RoundTrip_BuiltInProvider(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	writeVals := url.Values{
		"enabled":      {"false"},
		"autoredirect": {"false"},
		"idp":          {"Github"},
		"redirecturl":  {"https://example.com"},
		"clientid":     {"my-client-id"},
		"clientsecret": {"my-secret"},
	}
	wWrite := postForm(t, oh.WriteConfig, writeVals)
	body := wWrite.Body.String()
	if strings.Contains(body, `"error"`) {
		t.Fatalf("WriteConfig returned error: %s", body)
	}

	wRead := getReq(t, oh.ReadConfig)
	var cfg Config
	if err := json.Unmarshal(wRead.Body.Bytes(), &cfg); err != nil {
		t.Fatalf("ReadConfig JSON parse error: %v", err)
	}

	if cfg.IDP != "Github" {
		t.Errorf("IDP: got %q, want %q", cfg.IDP, "Github")
	}
	if cfg.ClientID != "my-client-id" {
		t.Errorf("ClientID: got %q, want %q", cfg.ClientID, "my-client-id")
	}
	if cfg.RedirectURL != "https://example.com" {
		t.Errorf("RedirectURL: got %q, want %q", cfg.RedirectURL, "https://example.com")
	}
}

func TestWriteConfig_CustomProvider_MissingEndpoints(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	// Custom + enabled=true without authurl/tokenurl/userinfourl → should error.
	values := url.Values{
		"enabled":      {"true"},
		"autoredirect": {"false"},
		"idp":          {"Custom"},
		"redirecturl":  {"https://example.com"},
		"clientid":     {"id"},
		"clientsecret": {"secret"},
		// authurl, tokenurl, userinfourl intentionally omitted
	}
	w := postForm(t, oh.WriteConfig, values)
	body := w.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("WriteConfig Custom without endpoints: expected error, got %q", body)
	}
}

func TestWriteConfig_CustomProvider_RoundTrip(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	writeVals := url.Values{
		"enabled":      {"false"},
		"autoredirect": {"false"},
		"idp":          {"Custom"},
		"redirecturl":  {"https://my.server.com"},
		"clientid":     {"cid"},
		"clientsecret": {"csecret"},
		"authurl":      {"https://auth.example/authorize"},
		"tokenurl":     {"https://auth.example/token"},
		"userinfourl":  {"https://auth.example/userinfo"},
		"userfield":    {"preferred_username"},
		"customscope":  {"openid profile"},
	}
	wWrite := postForm(t, oh.WriteConfig, writeVals)
	if strings.Contains(wWrite.Body.String(), `"error"`) {
		t.Fatalf("WriteConfig Custom returned error: %s", wWrite.Body.String())
	}

	wRead := getReq(t, oh.ReadConfig)
	var cfg Config
	if err := json.Unmarshal(wRead.Body.Bytes(), &cfg); err != nil {
		t.Fatalf("ReadConfig JSON parse: %v", err)
	}

	checks := []struct{ field, got, want string }{
		{"IDP", cfg.IDP, "Custom"},
		{"AuthURL", cfg.AuthURL, "https://auth.example/authorize"},
		{"TokenURL", cfg.TokenURL, "https://auth.example/token"},
		{"UserInfoURL", cfg.UserInfoURL, "https://auth.example/userinfo"},
		{"UserField", cfg.UserField, "preferred_username"},
		{"CustomScope", cfg.CustomScope, "openid profile"},
	}
	for _, c := range checks {
		if c.got != c.want {
			t.Errorf("%s: got %q, want %q", c.field, c.got, c.want)
		}
	}
}

func TestWriteConfig_GitlabServerURL_Preserved(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	writeVals := url.Values{
		"enabled":      {"false"},
		"autoredirect": {"false"},
		"idp":          {"Gitlab"},
		"redirecturl":  {"https://aroz.example.com"},
		"serverurl":    {"https://gitlab.example.com"},
		"clientid":     {"id"},
		"clientsecret": {"s"},
	}
	postForm(t, oh.WriteConfig, writeVals)

	wRead := getReq(t, oh.ReadConfig)
	var cfg Config
	json.Unmarshal(wRead.Body.Bytes(), &cfg) //nolint:errcheck

	if cfg.ServerURL != "https://gitlab.example.com" {
		t.Errorf("ServerURL for Gitlab: got %q, want %q", cfg.ServerURL, "https://gitlab.example.com")
	}
}

func TestWriteConfig_NonGitlab_ServerURLCleared(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	oh := minimalOauthHandler(coredb)

	// First write with Gitlab to set the server URL.
	postForm(t, oh.WriteConfig, url.Values{
		"enabled":      {"false"},
		"autoredirect": {"false"},
		"idp":          {"Gitlab"},
		"redirecturl":  {"https://aroz.example.com"},
		"serverurl":    {"https://gitlab.example.com"},
		"clientid":     {"id"},
		"clientsecret": {"s"},
	})

	// Now switch to Google – serverurl should be cleared.
	postForm(t, oh.WriteConfig, url.Values{
		"enabled":      {"false"},
		"autoredirect": {"false"},
		"idp":          {"Google"},
		"redirecturl":  {"https://aroz.example.com"},
		"serverurl":    {"https://gitlab.example.com"}, // submitted but should be ignored
		"clientid":     {"id"},
		"clientsecret": {"s"},
	})

	wRead := getReq(t, oh.ReadConfig)
	var cfg Config
	json.Unmarshal(wRead.Body.Bytes(), &cfg) //nolint:errcheck

	if cfg.ServerURL != "" {
		t.Errorf("ServerURL for non-Gitlab provider: got %q, want empty", cfg.ServerURL)
	}
}

// ── serviceSelector helpers ───────────────────────────────────────────────────

func TestGetScope_ReturnsNonEmptyForKnownProviders(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	if err := coredb.NewTable("oauth"); err != nil {
		t.Fatalf("NewTable: %v", err)
	}

	for _, idp := range []string{"Google", "Github", "Microsoft", "Gitlab"} {
		coredb.Write("oauth", "idp", idp)
		if idp == "Gitlab" {
			coredb.Write("oauth", "serverurl", "https://gitlab.com")
		}
		scopes := getScope(coredb)
		if len(scopes) == 0 {
			t.Errorf("getScope(%q) returned empty scopes", idp)
		}
	}
}

func TestGetScope_CustomUsesStoredScope(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	if err := coredb.NewTable("oauth"); err != nil {
		t.Fatalf("NewTable: %v", err)
	}

	coredb.Write("oauth", "idp", "Custom")
	coredb.Write("oauth", "customscope", "openid email")
	scopes := getScope(coredb)
	if len(scopes) == 0 {
		t.Fatal("getScope(Custom) returned empty scopes")
	}
	if scopes[0] != "openid email" {
		t.Errorf("getScope(Custom): got %q, want %q", scopes[0], "openid email")
	}
}

func TestGetScope_CustomDefaultsWhenScopeEmpty(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	if err := coredb.NewTable("oauth"); err != nil {
		t.Fatalf("NewTable: %v", err)
	}

	coredb.Write("oauth", "idp", "Custom")
	// customscope intentionally not set → should fall back to default
	scopes := getScope(coredb)
	if len(scopes) == 0 {
		t.Fatal("getScope(Custom) with empty scope returned empty list")
	}
	if !strings.Contains(scopes[0], "openid") {
		t.Errorf("getScope(Custom) default scope %q does not contain 'openid'", scopes[0])
	}
}

func TestGetEndpoint_CustomUsesStoredURLs(t *testing.T) {
	coredb, cleanup := newTestDB(t)
	defer cleanup()
	if err := coredb.NewTable("oauth"); err != nil {
		t.Fatalf("NewTable: %v", err)
	}

	coredb.Write("oauth", "idp", "Custom")
	coredb.Write("oauth", "authurl", "https://auth.example/authorize")
	coredb.Write("oauth", "tokenurl", "https://auth.example/token")

	ep := getEndpoint(coredb)
	if ep.AuthURL != "https://auth.example/authorize" {
		t.Errorf("AuthURL: got %q, want %q", ep.AuthURL, "https://auth.example/authorize")
	}
	if ep.TokenURL != "https://auth.example/token" {
		t.Errorf("TokenURL: got %q, want %q", ep.TokenURL, "https://auth.example/token")
	}
}
