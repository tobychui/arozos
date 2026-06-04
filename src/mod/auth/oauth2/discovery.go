package oauth2

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// OIDCDiscovery is the OpenID Connect Discovery document served at
// {issuer}/.well-known/openid-configuration (RFC 8414 / OIDC Core §4).
type OIDCDiscovery struct {
	Issuer                           string   `json:"issuer"`
	AuthorizationEndpoint            string   `json:"authorization_endpoint"`
	TokenEndpoint                    string   `json:"token_endpoint"`
	UserinfoEndpoint                 string   `json:"userinfo_endpoint"`
	JwksURI                          string   `json:"jwks_uri"`
	ScopesSupported                  []string `json:"scopes_supported"`
	ResponseTypesSupported           []string `json:"response_types_supported"`
	IDTokenSigningAlgValuesSupported []string `json:"id_token_signing_alg_values_supported"`
	SubjectTypesSupported            []string `json:"subject_types_supported"`
	ClaimsSupported                  []string `json:"claims_supported"`
	GrantTypesSupported              []string `json:"grant_types_supported"`
}

// DiscoveryResult is the trimmed view returned to the frontend via HandleDiscover.
type DiscoveryResult struct {
	AuthEndpoint     string   `json:"auth_endpoint"`
	TokenEndpoint    string   `json:"token_endpoint"`
	UserInfoEndpoint string   `json:"userinfo_endpoint"`
	ScopesSupported  []string `json:"scopes_supported"`
	ClaimsSupported  []string `json:"claims_supported"`
}

// httpClient is the HTTP client used for all outbound OIDC calls.
// Tests replace this to point requests at mock servers.
var httpClient = &http.Client{Timeout: 10 * time.Second}

// BuildWellKnownURL returns the standard OIDC discovery URL for issuerURL.
// It is safe to call with a URL that already ends with the well-known path.
func BuildWellKnownURL(issuerURL string) string {
	issuerURL = strings.TrimRight(issuerURL, "/")
	if strings.HasSuffix(issuerURL, ".well-known/openid-configuration") {
		return issuerURL
	}
	return issuerURL + "/.well-known/openid-configuration"
}

// FetchOIDCDiscovery retrieves and parses the OIDC discovery document for
// issuerURL. The URL may or may not include the /.well-known/openid-configuration
// suffix — both forms are handled transparently.
func FetchOIDCDiscovery(issuerURL string) (*OIDCDiscovery, error) {
	if strings.TrimSpace(issuerURL) == "" {
		return nil, fmt.Errorf("issuer URL must not be empty")
	}

	wellKnownURL := BuildWellKnownURL(issuerURL)

	req, err := http.NewRequest(http.MethodGet, wellKnownURL, nil)
	if err != nil {
		return nil, fmt.Errorf("failed to build discovery request: %w", err)
	}
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("OIDC discovery request to %s failed: %w", wellKnownURL, err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("OIDC discovery returned HTTP %d from %s", resp.StatusCode, wellKnownURL)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read OIDC discovery response: %w", err)
	}

	var doc OIDCDiscovery
	if err := json.Unmarshal(body, &doc); err != nil {
		return nil, fmt.Errorf("failed to parse OIDC discovery document from %s: %w", wellKnownURL, err)
	}

	if doc.AuthorizationEndpoint == "" {
		return nil, fmt.Errorf("OIDC discovery at %s is missing required field 'authorization_endpoint'", wellKnownURL)
	}
	if doc.TokenEndpoint == "" {
		return nil, fmt.Errorf("OIDC discovery at %s is missing required field 'token_endpoint'", wellKnownURL)
	}

	return &doc, nil
}

// getUserInfoFromEndpoint calls the OIDC userinfo endpoint with an access token
// and returns the value of usernameField from the JSON claims.
// If usernameField is empty, it defaults to "email".
func getUserInfoFromEndpoint(accessToken, userinfoURL, usernameField string) (string, error) {
	if userinfoURL == "" {
		return "", fmt.Errorf("userinfo endpoint URL is not configured")
	}
	if usernameField == "" {
		usernameField = "email"
	}

	req, err := http.NewRequest(http.MethodGet, userinfoURL, nil)
	if err != nil {
		return "", fmt.Errorf("failed to build userinfo request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+accessToken)
	req.Header.Set("Accept", "application/json")

	resp, err := httpClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("userinfo request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized {
		return "", fmt.Errorf("userinfo endpoint rejected the access token (HTTP 401)")
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("userinfo endpoint returned HTTP %d", resp.StatusCode)
	}

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("failed to read userinfo response: %w", err)
	}

	var claims map[string]interface{}
	if err := json.Unmarshal(body, &claims); err != nil {
		return "", fmt.Errorf("failed to parse userinfo response: %w", err)
	}

	val, ok := claims[usernameField]
	if !ok {
		return "", fmt.Errorf("userinfo response does not contain field %q (available: %v)", usernameField, claimKeys(claims))
	}
	username, ok := val.(string)
	if !ok {
		return "", fmt.Errorf("userinfo field %q is not a string (got %T)", usernameField, val)
	}
	if username == "" {
		return "", fmt.Errorf("userinfo field %q is empty", usernameField)
	}
	return username, nil
}

// claimKeys returns the sorted key names of a claims map for error messages.
func claimKeys(m map[string]interface{}) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	return keys
}
