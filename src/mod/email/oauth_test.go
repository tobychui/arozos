package email

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"golang.org/x/oauth2"
)

// fakeProvider answers OAuth token and device-code requests in-process.
type fakeProvider struct {
	mutex       sync.Mutex
	requests    []url.Values
	paths       []string
	pendingLeft int
}

func (f *fakeProvider) RoundTrip(request *http.Request) (*http.Response, error) {
	body, _ := io.ReadAll(request.Body)
	form, _ := url.ParseQuery(string(body))
	f.mutex.Lock()
	f.requests = append(f.requests, form)
	f.paths = append(f.paths, request.URL.Host+request.URL.Path)
	pendingLeft := f.pendingLeft
	if f.pendingLeft > 0 && form.Get("grant_type") == "urn:ietf:params:oauth:grant-type:device_code" {
		f.pendingLeft--
	}
	f.mutex.Unlock()

	respond := func(status int, payload interface{}) (*http.Response, error) {
		encoded, _ := json.Marshal(payload)
		return &http.Response{
			StatusCode: status,
			Header:     http.Header{"Content-Type": []string{"application/json"}},
			Body:       io.NopCloser(strings.NewReader(string(encoded))),
			Request:    request,
		}, nil
	}

	switch {
	case strings.HasSuffix(request.URL.Path, "/devicecode"):
		return respond(200, map[string]interface{}{
			"device_code": "dev-123", "user_code": "ABCD-EFGH",
			"verification_uri": "https://microsoft.com/devicelogin", "expires_in": 900, "interval": 1,
		})
	case form.Get("grant_type") == "urn:ietf:params:oauth:grant-type:device_code" && pendingLeft > 0:
		return respond(400, map[string]string{"error": "authorization_pending"})
	case form.Get("grant_type") == "refresh_token" && form.Get("refresh_token") == "revoked":
		return respond(400, map[string]string{"error": "invalid_grant", "error_description": "AADSTS70008: expired"})
	}
	return respond(200, map[string]interface{}{
		"access_token": "access-1", "refresh_token": "refresh-1", "token_type": "Bearer", "expires_in": 3600,
		"id_token": fakeIDToken("alice@outlook.test"),
	})
}

func fakeIDToken(email string) string {
	header := base64.RawURLEncoding.EncodeToString([]byte(`{"alg":"none"}`))
	claims, _ := json.Marshal(map[string]string{"email": email})
	return header + "." + base64.RawURLEncoding.EncodeToString(claims) + ".sig"
}

func newOAuthTestManager(t *testing.T, provider *fakeProvider) *Manager {
	t.Helper()
	manager, err := NewManager(Options{DataDir: t.TempDir(), DisableBackground: true, HTTPClient: &http.Client{Transport: provider}})
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	t.Cleanup(manager.Close)
	err = manager.SetAdminConfig(testAdmin, AdminConfigInput{
		Google:             OAuthClient{Enabled: true, ClientID: "google-client", ClientSecret: "google-secret", Flow: FlowRedirect},
		GoogleSecretSet:    true,
		Microsoft:          OAuthClient{Enabled: true, ClientID: "ms-client", Flow: FlowDevice, Tenant: "consumers"},
		MicrosoftSecretSet: false,
	})
	if err != nil {
		t.Fatalf("SetAdminConfig: %v", err)
	}
	return manager
}

func TestOAuthRedirectFlow(t *testing.T) {
	provider := &fakeProvider{}
	manager := newOAuthTestManager(t, provider)
	user := Principal{Username: "alice"}

	if _, err := manager.OAuthStart(testContext(t), user, "google", "alice@gmail.com", "https://cloud.example.test/Mail/../evil"); err == nil {
		t.Errorf("a redirect outside the Mail sign-in page was accepted")
	}

	started, err := manager.OAuthStart(testContext(t), user, "google", "alice@gmail.com", "https://cloud.example.test/Mail/oauth.html")
	if err != nil {
		t.Fatalf("OAuthStart: %v", err)
	}
	authURL, _ := url.Parse(started.AuthURL)
	query := authURL.Query()
	for key, want := range map[string]string{
		"client_id": "google-client", "redirect_uri": "https://cloud.example.test/Mail/oauth.html",
		"code_challenge_method": "S256", "access_type": "offline", "login_hint": "alice@gmail.com", "state": started.State,
	} {
		if query.Get(key) != want {
			t.Errorf("auth URL %s = %q, want %q", key, query.Get(key), want)
		}
	}
	if !strings.Contains(query.Get("scope"), "https://mail.google.com/") {
		t.Errorf("scope = %q", query.Get("scope"))
	}

	//Another user cannot finish this sign-in
	if _, err := manager.OAuthComplete(testContext(t), Principal{Username: "mallory"}, started.State, "code-xyz"); err == nil {
		t.Errorf("another user completed the sign-in")
	}

	status, err := manager.OAuthComplete(testContext(t), user, "", "https://cloud.example.test/Mail/oauth.html?state="+started.State+"&code=code-xyz")
	if err != nil {
		t.Fatalf("OAuthComplete: %v", err)
	}
	if status.Status != "done" || status.Email != "alice@outlook.test" {
		t.Errorf("status = %+v", status)
	}
	exchange := provider.requests[len(provider.requests)-1]
	if exchange.Get("code") != "code-xyz" || exchange.Get("code_verifier") == "" || exchange.Get("client_secret") != "google-secret" {
		t.Errorf("token exchange form = %v", exchange)
	}

	pending, err := manager.oauth.take(started.State, user.Username)
	if err != nil || pending.token.RefreshToken != "refresh-1" {
		t.Fatalf("take = %+v, %v", pending, err)
	}
	if _, err := manager.oauth.take(started.State, user.Username); err == nil {
		t.Errorf("a sign-in result could be used twice")
	}
}

func TestOAuthDeviceFlow(t *testing.T) {
	provider := &fakeProvider{pendingLeft: 1}
	manager := newOAuthTestManager(t, provider)
	user := Principal{Username: "alice"}

	started, err := manager.OAuthStart(testContext(t), user, "microsoft", "alice@outlook.com", "")
	if err != nil {
		t.Fatalf("OAuthStart: %v", err)
	}
	if started.Flow != FlowDevice || started.UserCode != "ABCD-EFGH" || started.VerificationURI == "" {
		t.Fatalf("device start = %+v", started)
	}

	deadline := time.Now().Add(15 * time.Second)
	for {
		status, err := manager.OAuthStatusOf(user, started.State)
		if err != nil {
			t.Fatalf("OAuthStatusOf: %v", err)
		}
		if status.Status == "done" {
			break
		}
		if status.Status == "error" || time.Now().After(deadline) {
			t.Fatalf("device flow did not finish: %+v", status)
		}
		time.Sleep(200 * time.Millisecond)
	}
	for _, form := range provider.requests {
		if form.Get("client_secret") != "" {
			t.Errorf("a device-flow request carried a client secret")
		}
	}
	if !strings.Contains(strings.Join(provider.paths, " "), "login.microsoftonline.com/consumers/oauth2/v2.0/devicecode") {
		t.Errorf("tenant not used: %v", provider.paths)
	}
}

func TestOAuthRefreshRotatesAndExpires(t *testing.T) {
	provider := &fakeProvider{}
	manager := newOAuthTestManager(t, provider)

	sealed, _ := manager.box.Seal("refresh-0")
	account := &Account{ID: "acc1", Owner: "alice", Email: "alice@outlook.com", Auth: AuthOAuth2,
		OAuthProvider: "microsoft", OAuthFlow: FlowDevice, Secret: sealed}
	if err := manager.store.saveAccount(account); err != nil {
		t.Fatalf("saveAccount: %v", err)
	}

	token, err := manager.oauth.accessToken(testContext(t), account)
	if err != nil || token != "access-1" {
		t.Fatalf("accessToken = %q, %v", token, err)
	}
	stored, _ := manager.store.getAccount("alice", "acc1")
	if refresh, _ := manager.box.Open(stored.Secret); refresh != "refresh-1" {
		t.Errorf("rotated refresh token not stored, have %q", refresh)
	}

	requests := len(provider.requests)
	if _, err := manager.oauth.accessToken(testContext(t), account); err != nil || len(provider.requests) != requests {
		t.Errorf("a cached token should not trigger another refresh")
	}

	revoked, _ := manager.box.Seal("revoked")
	expired := &Account{ID: "acc2", Owner: "alice", Email: "alice@outlook.com", Auth: AuthOAuth2,
		OAuthProvider: "microsoft", OAuthFlow: FlowDevice, Secret: revoked}
	_, err = manager.oauth.accessToken(testContext(t), expired)
	if !IsAuthError(err) {
		t.Errorf("an invalid_grant should be an auth error, got %v", err)
	}
}

func TestOAuthDisabledProvider(t *testing.T) {
	manager := newTestManager(t)
	if _, err := manager.OAuthStart(testContext(t), testAdmin, "google", "a@gmail.com", "https://x.test/Mail/oauth.html"); !errors.Is(err, ErrOAuthDisabled) {
		t.Errorf("expected ErrOAuthDisabled, got %v", err)
	}
	providers := manager.OAuthProviders()
	if len(providers) != 2 || providers[0].Enabled || providers[1].Enabled {
		t.Errorf("providers = %+v", providers)
	}
}

func TestEmailFromIDToken(t *testing.T) {
	token := (&oauth2.Token{AccessToken: "x"}).WithExtra(map[string]interface{}{"id_token": fakeIDToken("Bob@Example.TEST")})
	if got := emailFromIDToken(token); got != "bob@example.test" {
		t.Errorf("emailFromIDToken = %q", got)
	}
	if got := emailFromIDToken(&oauth2.Token{}); got != "" {
		t.Errorf("missing id_token gave %q", got)
	}
}

func TestAdminConfigHidesSecrets(t *testing.T) {
	manager := newOAuthTestManager(t, &fakeProvider{})
	view := manager.AdminConfig()
	if !view.Google.HasSecret || view.Google.ClientID != "google-client" {
		t.Errorf("view = %+v", view.Google)
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "google-secret") {
		t.Errorf("client secret leaked into the admin view")
	}
	if err := manager.SetAdminConfig(Principal{Username: "bob"}, AdminConfigInput{}); err == nil {
		t.Errorf("a non-admin changed the mail configuration")
	}

	//Saving without a new secret keeps the stored one
	if err := manager.SetAdminConfig(testAdmin, AdminConfigInput{Google: OAuthClient{Enabled: true, ClientID: "google-client"}}); err != nil {
		t.Fatalf("SetAdminConfig: %v", err)
	}
	if !manager.AdminConfig().Google.HasSecret {
		t.Errorf("secret was dropped by an update that did not change it")
	}
}
