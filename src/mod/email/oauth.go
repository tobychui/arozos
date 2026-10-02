package email

/*
	oauth.go

	OAuth 2.0 sign-in for Google and Microsoft mailboxes (XOAUTH2).

	Microsoft has retired password sign-in for Outlook.com / Hotmail / Microsoft
	365 IMAP and SMTP, and Google prefers OAuth over app passwords, so a mail
	client needs this. ArozOS is self-hosted, which means there is no shared
	client registration: the administrator registers an application with the
	provider and enters its client ID (and secret) on the Mail admin page.

	Three flows cover the ways ArozOS is reachable:

	  redirect  – the browser opens the provider in a popup and comes back to
	              /Mail/oauth.html. Needs the ArozOS address registered as a
	              redirect URI, which providers only accept over HTTPS (or
	              localhost).
	  device    – Microsoft only. The user types a short code at
	              microsoft.com/devicelogin; ArozOS polls for the result. Works
	              on a plain LAN address with no redirect registration.
	  loopback  – Google "Desktop app" clients. Google sends the browser to
	              http://127.0.0.1, which fails to load; the user copies that
	              address back into the wizard.

	Tokens never reach the browser. The authorization code is exchanged here
	(with PKCE), the refresh token is sealed into the account record and access
	tokens are kept in memory only.
*/

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"golang.org/x/oauth2"
	"imuslab.com/arozos/mod/info/logger"
)

const (
	pendingOAuthTTL  = 15 * time.Minute
	loopbackRedirect = "http://127.0.0.1:53682/"
)

// OAuthProviderInfo tells the wizard which sign-in buttons to offer.
type OAuthProviderInfo struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Enabled bool   `json:"enabled"`
	Flow    string `json:"flow"`
}

// OAuthStartResult is returned when a sign-in begins.
type OAuthStartResult struct {
	State           string `json:"state"`
	Flow            string `json:"flow"`
	AuthURL         string `json:"authUrl,omitempty"`
	UserCode        string `json:"userCode,omitempty"`
	VerificationURI string `json:"verificationUri,omitempty"`
	ExpiresIn       int    `json:"expiresIn,omitempty"`
}

// OAuthStatus reports the progress of a pending sign-in.
type OAuthStatus struct {
	Status string `json:"status"` //pending | done | error
	Email  string `json:"email,omitempty"`
	Error  string `json:"error,omitempty"`
}

type pendingOAuth struct {
	state       string
	owner       string
	provider    string
	flow        string
	email       string
	verifier    string
	redirectURI string
	created     time.Time

	status  string
	err     string
	token   *oauth2.Token
	idEmail string
	cancel  context.CancelFunc
}

type cachedToken struct {
	token   string
	expires time.Time
}

type oauthManager struct {
	manager *Manager
	mutex   sync.Mutex
	pending map[string]*pendingOAuth

	tokenMutex sync.Mutex
	tokens     map[string]cachedToken
	refreshing map[string]*sync.Mutex
}

func newOAuthManager(manager *Manager) *oauthManager {
	return &oauthManager{
		manager:    manager,
		pending:    map[string]*pendingOAuth{},
		tokens:     map[string]cachedToken{},
		refreshing: map[string]*sync.Mutex{},
	}
}

// providerConfig builds the oauth2 configuration of a provider. publicClient
// drops the secret (Microsoft device-flow clients must not send one).
func (o *oauthManager) providerConfig(provider string, flow string, redirectURI string) (*oauth2.Config, error) {
	config := o.manager.store.getAdminConfig()

	var client OAuthClient
	var endpoint oauth2.Endpoint
	var scopes []string
	switch provider {
	case "google":
		client = config.Google
		endpoint = oauth2.Endpoint{
			AuthURL:   "https://accounts.google.com/o/oauth2/v2/auth",
			TokenURL:  "https://oauth2.googleapis.com/token",
			AuthStyle: oauth2.AuthStyleInParams,
		}
		scopes = []string{"https://mail.google.com/", "openid", "email"}
	case "microsoft":
		client = config.Microsoft
		tenant := url.PathEscape(client.Tenant)
		endpoint = oauth2.Endpoint{
			AuthURL:       "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/authorize",
			DeviceAuthURL: "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/devicecode",
			TokenURL:      "https://login.microsoftonline.com/" + tenant + "/oauth2/v2.0/token",
			AuthStyle:     oauth2.AuthStyleInParams,
		}
		scopes = []string{"offline_access", "https://outlook.office.com/IMAP.AccessAsUser.All",
			"https://outlook.office.com/SMTP.Send", "openid", "email"}
	default:
		return nil, errors.New("unknown OAuth provider " + provider)
	}

	if !client.Enabled || client.ClientID == "" {
		return nil, ErrOAuthDisabled
	}

	secret := ""
	if flow != FlowDevice {
		opened, err := o.manager.box.Open(client.ClientSecret)
		if err != nil {
			return nil, errors.New("the OAuth client secret cannot be decrypted, ask the administrator to enter it again")
		}
		secret = opened
	}

	return &oauth2.Config{
		ClientID:     client.ClientID,
		ClientSecret: secret,
		Endpoint:     endpoint,
		RedirectURL:  redirectURI,
		Scopes:       scopes,
	}, nil
}

// httpContext carries the HTTP client used for token requests.
func (o *oauthManager) httpContext(ctx context.Context) context.Context {
	client := o.manager.options.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 30 * time.Second}
	}
	return context.WithValue(ctx, oauth2.HTTPClient, client)
}

// OAuthProviders lists the OAuth providers and whether they are configured.
func (m *Manager) OAuthProviders() []OAuthProviderInfo {
	config := m.store.getAdminConfig()
	return []OAuthProviderInfo{
		{ID: "google", Name: "Google", Enabled: config.Google.Enabled && config.Google.ClientID != "", Flow: config.Google.Flow},
		{ID: "microsoft", Name: "Microsoft", Enabled: config.Microsoft.Enabled && config.Microsoft.ClientID != "", Flow: config.Microsoft.Flow},
	}
}

// OAuthStart begins a sign-in. redirectURI is the /Mail/oauth.html address
// as the browser sees it, used by the redirect flow only.
func (m *Manager) OAuthStart(ctx context.Context, p Principal, provider string, emailAddress string, redirectURI string) (*OAuthStartResult, error) {
	admin := m.store.getAdminConfig()
	flow := FlowRedirect
	switch provider {
	case "google":
		flow = admin.Google.Flow
	case "microsoft":
		flow = admin.Microsoft.Flow
	}

	switch flow {
	case FlowLoopback:
		redirectURI = loopbackRedirect
	case FlowRedirect:
		if err := validateRedirectURI(redirectURI); err != nil {
			return nil, err
		}
	case FlowDevice:
		redirectURI = ""
	}

	config, err := m.oauth.providerConfig(provider, flow, redirectURI)
	if err != nil {
		return nil, err
	}

	pending := &pendingOAuth{
		state:       randomID(16),
		owner:       p.Username,
		provider:    provider,
		flow:        flow,
		email:       strings.TrimSpace(emailAddress),
		redirectURI: redirectURI,
		created:     m.now(),
		status:      "pending",
	}
	result := &OAuthStartResult{State: pending.state, Flow: flow}

	if flow == FlowDevice {
		deviceCtx := m.oauth.httpContext(ctx)
		response, err := config.DeviceAuth(deviceCtx)
		if err != nil {
			return nil, describeOAuthError(err)
		}
		result.UserCode = response.UserCode
		result.VerificationURI = response.VerificationURI
		if !response.Expiry.IsZero() {
			result.ExpiresIn = int(time.Until(response.Expiry).Seconds())
		}

		pollCtx, cancel := context.WithTimeout(context.Background(), pendingOAuthTTL)
		pending.cancel = cancel
		m.oauth.put(pending)
		go m.oauth.pollDevice(m.oauth.httpContext(pollCtx), cancel, config, response, pending.state)
		return result, nil
	}

	pending.verifier = oauth2.GenerateVerifier()
	options := []oauth2.AuthCodeOption{oauth2.S256ChallengeOption(pending.verifier)}
	if pending.email != "" {
		options = append(options, oauth2.SetAuthURLParam("login_hint", pending.email))
	}
	if provider == "google" {
		//offline + consent guarantees a refresh token on every sign-in
		options = append(options, oauth2.AccessTypeOffline, oauth2.SetAuthURLParam("prompt", "consent"))
	} else {
		options = append(options, oauth2.SetAuthURLParam("prompt", "select_account"))
	}
	result.AuthURL = config.AuthCodeURL(pending.state, options...)
	m.oauth.put(pending)
	return result, nil
}

// OAuthComplete finishes a redirect or loopback sign-in. input is either the
// authorization code or the full URL the provider redirected to.
func (m *Manager) OAuthComplete(ctx context.Context, p Principal, state string, input string) (*OAuthStatus, error) {
	input = strings.TrimSpace(input)
	code := input
	if strings.Contains(input, "://") || strings.HasPrefix(input, "?") || strings.Contains(input, "code=") {
		query := input
		if parsed, err := url.Parse(input); err == nil && parsed.RawQuery != "" {
			query = parsed.RawQuery
		}
		query = strings.TrimPrefix(query, "?")
		values, err := url.ParseQuery(query)
		if err != nil {
			return nil, errors.New("the pasted address is not a valid sign-in result")
		}
		if providerError := values.Get("error"); providerError != "" {
			detail := values.Get("error_description")
			if detail == "" {
				detail = providerError
			}
			m.oauth.fail(state, p.Username, detail)
			return nil, errors.New("sign-in was cancelled or refused: " + detail)
		}
		code = values.Get("code")
		if returned := values.Get("state"); returned != "" && state == "" {
			state = returned
		} else if returned != "" && returned != state {
			return nil, errors.New("the sign-in result belongs to a different request, please start again")
		}
	}
	if code == "" {
		return nil, errors.New("no authorization code was returned")
	}

	pending, err := m.oauth.get(state, p.Username)
	if err != nil {
		return nil, err
	}
	if pending.flow == FlowDevice {
		return nil, errors.New("this sign-in completes on the provider's device page")
	}

	config, err := m.oauth.providerConfig(pending.provider, pending.flow, pending.redirectURI)
	if err != nil {
		return nil, err
	}
	exchangeCtx, cancel := context.WithTimeout(m.oauth.httpContext(ctx), 30*time.Second)
	defer cancel()
	token, err := config.Exchange(exchangeCtx, code, oauth2.VerifierOption(pending.verifier))
	if err != nil {
		message := describeOAuthError(err).Error()
		m.oauth.fail(state, p.Username, message)
		return nil, errors.New(message)
	}
	m.oauth.succeed(state, token)
	return m.OAuthStatusOf(p, state)
}

// OAuthStatusOf reports a pending sign-in to the wizard.
func (m *Manager) OAuthStatusOf(p Principal, state string) (*OAuthStatus, error) {
	pending, err := m.oauth.get(state, p.Username)
	if err != nil {
		return nil, err
	}
	m.oauth.mutex.Lock()
	defer m.oauth.mutex.Unlock()
	status := &OAuthStatus{Status: pending.status, Error: pending.err}
	if pending.status == "done" {
		status.Email = pending.idEmail
		if status.Email == "" {
			status.Email = pending.email
		}
	}
	return status, nil
}

// OAuthCancel abandons a pending sign-in.
func (m *Manager) OAuthCancel(p Principal, state string) {
	m.oauth.mutex.Lock()
	defer m.oauth.mutex.Unlock()
	if pending, ok := m.oauth.pending[state]; ok && pending.owner == p.Username {
		if pending.cancel != nil {
			pending.cancel()
		}
		delete(m.oauth.pending, state)
	}
}

func (o *oauthManager) put(pending *pendingOAuth) {
	o.mutex.Lock()
	o.pending[pending.state] = pending
	o.mutex.Unlock()
}

func (o *oauthManager) get(state string, owner string) (*pendingOAuth, error) {
	o.mutex.Lock()
	defer o.mutex.Unlock()
	pending, ok := o.pending[state]
	if !ok || pending.owner != owner {
		return nil, errors.New("this sign-in has expired, please start again")
	}
	return pending, nil
}

// take removes a finished sign-in so its token can be stored in an account.
func (o *oauthManager) take(state string, owner string) (*pendingOAuth, error) {
	o.mutex.Lock()
	defer o.mutex.Unlock()
	pending, ok := o.pending[state]
	if !ok || pending.owner != owner {
		return nil, errors.New("this sign-in has expired, please sign in again")
	}
	if pending.status != "done" || pending.token == nil {
		return nil, errors.New("the sign-in has not finished yet")
	}
	delete(o.pending, state)
	return pending, nil
}

func (o *oauthManager) fail(state string, owner string, message string) {
	o.mutex.Lock()
	defer o.mutex.Unlock()
	if pending, ok := o.pending[state]; ok && (owner == "" || pending.owner == owner) {
		pending.status = "error"
		pending.err = message
	}
}

func (o *oauthManager) succeed(state string, token *oauth2.Token) {
	idEmail := emailFromIDToken(token)
	o.mutex.Lock()
	defer o.mutex.Unlock()
	if pending, ok := o.pending[state]; ok {
		pending.status = "done"
		pending.token = token
		pending.idEmail = idEmail
		pending.err = ""
	}
}

func (o *oauthManager) pollDevice(ctx context.Context, cancel context.CancelFunc, config *oauth2.Config, response *oauth2.DeviceAuthResponse, state string) {
	defer cancel()
	token, err := config.DeviceAccessToken(ctx, response)
	if err != nil {
		if errors.Is(err, context.Canceled) {
			return
		}
		o.fail(state, "", describeOAuthError(err).Error())
		return
	}
	o.succeed(state, token)
}

// cleanup forgets sign-ins nobody finished.
func (o *oauthManager) cleanup() {
	o.mutex.Lock()
	defer o.mutex.Unlock()
	for state, pending := range o.pending {
		if time.Since(pending.created) > pendingOAuthTTL {
			if pending.cancel != nil {
				pending.cancel()
			}
			delete(o.pending, state)
		}
	}
}

func (o *oauthManager) resetTokenCache() {
	o.tokenMutex.Lock()
	o.tokens = map[string]cachedToken{}
	o.tokenMutex.Unlock()
}

// seed caches the access token of a sign-in that just finished, saving a
// refresh round trip for the verification login that follows.
func (o *oauthManager) seed(account *Account) {
	if account.freshAccessToken == "" || account.ID == "" {
		return
	}
	expires := time.Now().Add(30 * time.Minute)
	if account.freshTokenExpiry > 0 {
		expires = time.Unix(account.freshTokenExpiry, 0)
	}
	o.tokenMutex.Lock()
	o.tokens[account.Owner+"/"+account.ID] = cachedToken{token: account.freshAccessToken, expires: expires}
	o.tokenMutex.Unlock()
}

func (o *oauthManager) forget(account *Account) {
	o.tokenMutex.Lock()
	delete(o.tokens, account.Owner+"/"+account.ID)
	o.tokenMutex.Unlock()
}

// accessToken returns a valid access token for an OAuth account, refreshing
// (and persisting a rotated refresh token) when needed.
func (o *oauthManager) accessToken(ctx context.Context, account *Account) (string, error) {
	key := account.Owner + "/" + account.ID

	o.tokenMutex.Lock()
	if cached, ok := o.tokens[key]; ok && time.Until(cached.expires) > time.Minute {
		o.tokenMutex.Unlock()
		return cached.token, nil
	}
	lock, ok := o.refreshing[key]
	if !ok {
		lock = &sync.Mutex{}
		o.refreshing[key] = lock
	}
	o.tokenMutex.Unlock()

	//One refresh per account at a time; the others reuse its result
	lock.Lock()
	defer lock.Unlock()
	o.tokenMutex.Lock()
	if cached, ok := o.tokens[key]; ok && time.Until(cached.expires) > time.Minute {
		o.tokenMutex.Unlock()
		return cached.token, nil
	}
	o.tokenMutex.Unlock()

	refreshToken, err := o.manager.box.Open(account.Secret)
	if err != nil || refreshToken == "" {
		return "", &AuthError{Server: "OAuth", Detail: "no stored sign-in", Hint: "Reconnect the account to sign in again."}
	}

	config, err := o.providerConfig(account.OAuthProvider, account.OAuthFlow, "")
	if err != nil {
		return "", err
	}
	refreshCtx, cancel := context.WithTimeout(o.httpContext(ctx), 30*time.Second)
	defer cancel()
	token, err := config.TokenSource(refreshCtx, &oauth2.Token{RefreshToken: refreshToken}).Token()
	if err != nil {
		var retrieveErr *oauth2.RetrieveError
		if errors.As(err, &retrieveErr) && (retrieveErr.ErrorCode == "invalid_grant" || retrieveErr.ErrorCode == "unauthorized_client" || retrieveErr.ErrorCode == "interaction_required") {
			return "", &AuthError{Server: "OAuth", Detail: describeOAuthError(err).Error(), Hint: "Your sign-in has expired or was revoked. Reconnect the account to sign in again."}
		}
		return "", describeOAuthError(err)
	}

	//Microsoft rotates refresh tokens; keep the newest one
	if token.RefreshToken != "" && token.RefreshToken != refreshToken {
		o.manager.persistRefreshToken(account, token.RefreshToken)
	}

	expires := token.Expiry
	if expires.IsZero() {
		expires = time.Now().Add(30 * time.Minute)
	}
	o.tokenMutex.Lock()
	o.tokens[key] = cachedToken{token: token.AccessToken, expires: expires}
	o.tokenMutex.Unlock()
	return token.AccessToken, nil
}

// persistRefreshToken stores a rotated refresh token.
func (m *Manager) persistRefreshToken(account *Account, refreshToken string) {
	sealed, err := m.box.Seal(refreshToken)
	if err != nil {
		return
	}
	m.store.mutex.Lock()
	defer m.store.mutex.Unlock()
	stored, err := m.store.getAccount(account.Owner, account.ID)
	if err != nil {
		return
	}
	stored.Secret = sealed
	if err := m.store.saveAccount(stored); err != nil {
		logger.PrintAndLog("Email", "Unable to store a rotated OAuth token for "+account.Email, err)
		return
	}
	account.Secret = sealed
}

// validateRedirectURI only accepts the Mail app's own landing page.
func validateRedirectURI(redirectURI string) error {
	parsed, err := url.Parse(strings.TrimSpace(redirectURI))
	if err != nil || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.Host == "" {
		return errors.New("invalid OAuth redirect address")
	}
	if parsed.Fragment != "" || parsed.RawQuery != "" || !strings.HasSuffix(parsed.Path, "/oauth.html") {
		return errors.New("the OAuth redirect address must point to the Mail sign-in page")
	}
	return nil
}

// describeOAuthError turns provider error responses into readable text.
func describeOAuthError(err error) error {
	var retrieveErr *oauth2.RetrieveError
	if errors.As(err, &retrieveErr) {
		detail := retrieveErr.ErrorDescription
		if detail == "" {
			detail = retrieveErr.ErrorCode
		}
		//Microsoft prefixes descriptions with an AADSTS code and appends trace ids
		if index := strings.Index(detail, "\r\n"); index > 0 {
			detail = detail[:index]
		}
		if detail == "" {
			detail = "the provider rejected the request"
		}
		return errors.New(detail)
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return errors.New("the sign-in timed out, please start again")
	}
	return err
}

// emailFromIDToken reads the address from an OpenID Connect id_token. The
// token came straight from the provider's token endpoint over TLS, so the
// signature does not need verifying for this purpose.
func emailFromIDToken(token *oauth2.Token) string {
	if token == nil {
		return ""
	}
	raw, ok := token.Extra("id_token").(string)
	if !ok || raw == "" {
		return ""
	}
	parts := strings.Split(raw, ".")
	if len(parts) < 2 {
		return ""
	}
	payload, err := base64.RawURLEncoding.DecodeString(strings.TrimRight(parts[1], "="))
	if err != nil {
		return ""
	}
	var claims struct {
		Email             string `json:"email"`
		PreferredUsername string `json:"preferred_username"`
		UPN               string `json:"upn"`
	}
	if err := json.Unmarshal(payload, &claims); err != nil {
		return ""
	}
	for _, candidate := range []string{claims.Email, claims.PreferredUsername, claims.UPN} {
		if strings.Contains(candidate, "@") {
			return strings.ToLower(strings.TrimSpace(candidate))
		}
	}
	return ""
}
