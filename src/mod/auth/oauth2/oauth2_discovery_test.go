package oauth2

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// ── BuildWellKnownURL ─────────────────────────────────────────────────────────

func TestBuildWellKnownURL_PlainIssuer(t *testing.T) {
	got := BuildWellKnownURL("https://accounts.google.com")
	want := "https://accounts.google.com/.well-known/openid-configuration"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestBuildWellKnownURL_TrailingSlash(t *testing.T) {
	got := BuildWellKnownURL("https://accounts.google.com/")
	want := "https://accounts.google.com/.well-known/openid-configuration"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestBuildWellKnownURL_AlreadyHasPath(t *testing.T) {
	full := "https://accounts.google.com/.well-known/openid-configuration"
	got := BuildWellKnownURL(full)
	if got != full {
		t.Errorf("got %q, want %q (should not double-append)", got, full)
	}
}

func TestBuildWellKnownURL_PathPrefix(t *testing.T) {
	// Some providers have a path prefix (e.g. Keycloak, Azure)
	got := BuildWellKnownURL("https://login.microsoftonline.com/tenant123/v2.0")
	want := "https://login.microsoftonline.com/tenant123/v2.0/.well-known/openid-configuration"
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

// ── FetchOIDCDiscovery ────────────────────────────────────────────────────────

// minimalDiscoveryDoc returns a valid OIDC discovery JSON body for a given base URL.
func minimalDiscoveryDoc(base string) []byte {
	doc := map[string]interface{}{
		"issuer":                   base,
		"authorization_endpoint":   base + "/oauth2/authorize",
		"token_endpoint":           base + "/oauth2/token",
		"userinfo_endpoint":        base + "/oauth2/userinfo",
		"jwks_uri":                 base + "/oauth2/jwks",
		"scopes_supported":         []string{"openid", "email", "profile"},
		"claims_supported":         []string{"sub", "email", "name", "preferred_username"},
		"response_types_supported": []string{"code"},
		"grant_types_supported":    []string{"authorization_code"},
	}
	b, _ := json.Marshal(doc)
	return b
}

func newDiscoveryServer(t *testing.T, handler http.HandlerFunc) (*httptest.Server, func()) {
	t.Helper()
	srv := httptest.NewServer(handler)
	return srv, srv.Close
}

// withMockClient temporarily replaces the package-level httpClient with one
// that talks to the given server. Restored by the returned cleanup func.
func withMockClient(srv *httptest.Server) func() {
	orig := httpClient
	httpClient = srv.Client()
	return func() { httpClient = orig }
}

func TestFetchOIDCDiscovery_Success(t *testing.T) {
	// Declare srv before the closure so the handler can reference it by the
	// time it is actually invoked (Go closures capture by reference).
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, "/.well-known/openid-configuration") {
			t.Errorf("unexpected path: %s", r.URL.Path)
		}
		w.Header().Set("Content-Type", "application/json")
		w.Write(minimalDiscoveryDoc(srv.URL))
	}))
	defer srv.Close()
	defer withMockClient(srv)()

	doc, err := FetchOIDCDiscovery(srv.URL)
	if err != nil {
		t.Fatalf("FetchOIDCDiscovery returned error: %v", err)
	}
	if doc.AuthorizationEndpoint == "" {
		t.Error("AuthorizationEndpoint is empty")
	}
	if doc.TokenEndpoint == "" {
		t.Error("TokenEndpoint is empty")
	}
	if doc.UserinfoEndpoint == "" {
		t.Error("UserinfoEndpoint is empty")
	}
	if len(doc.ScopesSupported) == 0 {
		t.Error("ScopesSupported is empty")
	}
}

func TestFetchOIDCDiscovery_AcceptsTrailingSlash(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(minimalDiscoveryDoc(srv.URL))
	}))
	defer srv.Close()
	defer withMockClient(srv)()

	_, err := FetchOIDCDiscovery(srv.URL + "/")
	if err != nil {
		t.Errorf("FetchOIDCDiscovery with trailing slash returned error: %v", err)
	}
}

func TestFetchOIDCDiscovery_AcceptsFullWellKnownPath(t *testing.T) {
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write(minimalDiscoveryDoc(srv.URL))
	}))
	defer srv.Close()
	defer withMockClient(srv)()

	_, err := FetchOIDCDiscovery(srv.URL + "/.well-known/openid-configuration")
	if err != nil {
		t.Errorf("FetchOIDCDiscovery with full path returned error: %v", err)
	}
}

func TestFetchOIDCDiscovery_HTTPError_404(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.NotFound(w, r)
	}))
	defer srv.Close()
	defer withMockClient(srv)()

	_, err := FetchOIDCDiscovery(srv.URL)
	if err == nil {
		t.Fatal("expected error for 404 response, got nil")
	}
	if !strings.Contains(err.Error(), "404") {
		t.Errorf("error should mention HTTP 404; got: %v", err)
	}
}

func TestFetchOIDCDiscovery_HTTPError_500(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	defer withMockClient(srv)()

	_, err := FetchOIDCDiscovery(srv.URL)
	if err == nil {
		t.Fatal("expected error for 500 response, got nil")
	}
}

func TestFetchOIDCDiscovery_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("this is not json {{{"))
	}))
	defer srv.Close()
	defer withMockClient(srv)()

	_, err := FetchOIDCDiscovery(srv.URL)
	if err == nil {
		t.Fatal("expected error for invalid JSON, got nil")
	}
	if !strings.Contains(err.Error(), "parse") {
		t.Errorf("error should mention parse failure; got: %v", err)
	}
}

func TestFetchOIDCDiscovery_MissingAuthorizationEndpoint(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		doc := map[string]string{
			// authorization_endpoint deliberately omitted
			"token_endpoint":    "https://example.com/token",
			"userinfo_endpoint": "https://example.com/userinfo",
		}
		json.NewEncoder(w).Encode(doc)
	}))
	defer srv.Close()
	defer withMockClient(srv)()

	_, err := FetchOIDCDiscovery(srv.URL)
	if err == nil {
		t.Fatal("expected error for missing authorization_endpoint, got nil")
	}
	if !strings.Contains(err.Error(), "authorization_endpoint") {
		t.Errorf("error should mention missing field; got: %v", err)
	}
}

func TestFetchOIDCDiscovery_MissingTokenEndpoint(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		doc := map[string]string{
			"authorization_endpoint": "https://example.com/auth",
			// token_endpoint deliberately omitted
		}
		json.NewEncoder(w).Encode(doc)
	}))
	defer srv.Close()
	defer withMockClient(srv)()

	_, err := FetchOIDCDiscovery(srv.URL)
	if err == nil {
		t.Fatal("expected error for missing token_endpoint, got nil")
	}
	if !strings.Contains(err.Error(), "token_endpoint") {
		t.Errorf("error should mention missing field; got: %v", err)
	}
}

func TestFetchOIDCDiscovery_EmptyIssuerURL(t *testing.T) {
	_, err := FetchOIDCDiscovery("")
	if err == nil {
		t.Fatal("expected error for empty issuer URL, got nil")
	}
}

func TestFetchOIDCDiscovery_NetworkUnreachable(t *testing.T) {
	// Use a client with a very short timeout so the test completes quickly.
	orig := httpClient
	httpClient = &http.Client{Timeout: 100 * time.Millisecond}
	defer func() { httpClient = orig }()

	// 192.0.2.1 is TEST-NET-1 (RFC 5737) — guaranteed to be unreachable.
	_, err := FetchOIDCDiscovery("http://192.0.2.1")
	if err == nil {
		t.Fatal("expected error for unreachable host, got nil")
	}
}

func TestFetchOIDCDiscovery_SetsAcceptHeader(t *testing.T) {
	var gotAccept string
	var srv *httptest.Server
	srv = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotAccept = r.Header.Get("Accept")
		w.Header().Set("Content-Type", "application/json")
		w.Write(minimalDiscoveryDoc(srv.URL))
	}))
	defer srv.Close()
	defer withMockClient(srv)()

	FetchOIDCDiscovery(srv.URL) //nolint:errcheck

	if !strings.Contains(gotAccept, "application/json") {
		t.Errorf("expected Accept: application/json, got %q", gotAccept)
	}
}

// ── getUserInfoFromEndpoint ───────────────────────────────────────────────────

func newUserInfoServer(t *testing.T, accessToken string, claims map[string]interface{}) (*httptest.Server, func()) {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		auth := r.Header.Get("Authorization")
		if auth != "Bearer "+accessToken {
			w.WriteHeader(http.StatusUnauthorized)
			fmt.Fprintf(w, `{"error":"invalid_token","got":%q}`, auth)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(claims)
	}))
	return srv, srv.Close
}

func TestGetUserInfoFromEndpoint_Success_EmailField(t *testing.T) {
	srv, close := newUserInfoServer(t, "tok-abc", map[string]interface{}{
		"sub":   "user-001",
		"email": "alice@example.com",
		"name":  "Alice",
	})
	defer close()
	defer withMockClient(srv)()

	username, err := getUserInfoFromEndpoint("tok-abc", srv.URL, "email")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if username != "alice@example.com" {
		t.Errorf("got %q, want %q", username, "alice@example.com")
	}
}

func TestGetUserInfoFromEndpoint_Success_PreferredUsername(t *testing.T) {
	srv, close := newUserInfoServer(t, "tok-xyz", map[string]interface{}{
		"sub":                "usr123",
		"preferred_username": "bob",
		"email":              "bob@corp.com",
	})
	defer close()
	defer withMockClient(srv)()

	username, err := getUserInfoFromEndpoint("tok-xyz", srv.URL, "preferred_username")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if username != "bob" {
		t.Errorf("got %q, want %q", username, "bob")
	}
}

func TestGetUserInfoFromEndpoint_DefaultsToEmailField(t *testing.T) {
	srv, close := newUserInfoServer(t, "tok-def", map[string]interface{}{
		"email": "charlie@example.org",
	})
	defer close()
	defer withMockClient(srv)()

	// Pass empty usernameField → should default to "email"
	username, err := getUserInfoFromEndpoint("tok-def", srv.URL, "")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if username != "charlie@example.org" {
		t.Errorf("got %q, want %q", username, "charlie@example.org")
	}
}

func TestGetUserInfoFromEndpoint_BearerTokenSent(t *testing.T) {
	var capturedAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedAuth = r.Header.Get("Authorization")
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]string{"email": "d@e.com"})
	}))
	defer srv.Close()
	defer withMockClient(srv)()

	getUserInfoFromEndpoint("my-access-token", srv.URL, "email") //nolint:errcheck

	if capturedAuth != "Bearer my-access-token" {
		t.Errorf("Authorization header: got %q, want %q", capturedAuth, "Bearer my-access-token")
	}
}

func TestGetUserInfoFromEndpoint_InvalidToken(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"invalid_token"}`))
	}))
	defer srv.Close()
	defer withMockClient(srv)()

	_, err := getUserInfoFromEndpoint("bad-token", srv.URL, "email")
	if err == nil {
		t.Fatal("expected error for 401 response, got nil")
	}
	if !strings.Contains(err.Error(), "401") {
		t.Errorf("error should mention 401; got: %v", err)
	}
}

func TestGetUserInfoFromEndpoint_ServerError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()
	defer withMockClient(srv)()

	_, err := getUserInfoFromEndpoint("tok", srv.URL, "email")
	if err == nil {
		t.Fatal("expected error for 500, got nil")
	}
}

func TestGetUserInfoFromEndpoint_FieldNotFound(t *testing.T) {
	srv, close := newUserInfoServer(t, "tok", map[string]interface{}{
		"sub": "123",
		// "email" is absent
	})
	defer close()
	defer withMockClient(srv)()

	_, err := getUserInfoFromEndpoint("tok", srv.URL, "email")
	if err == nil {
		t.Fatal("expected error for missing field, got nil")
	}
	if !strings.Contains(err.Error(), "email") {
		t.Errorf("error should mention missing field name; got: %v", err)
	}
}

func TestGetUserInfoFromEndpoint_FieldNotString(t *testing.T) {
	srv, close := newUserInfoServer(t, "tok", map[string]interface{}{
		"email": 12345, // not a string
	})
	defer close()
	defer withMockClient(srv)()

	_, err := getUserInfoFromEndpoint("tok", srv.URL, "email")
	if err == nil {
		t.Fatal("expected error for non-string field, got nil")
	}
	if !strings.Contains(err.Error(), "not a string") {
		t.Errorf("error should mention 'not a string'; got: %v", err)
	}
}

func TestGetUserInfoFromEndpoint_EmptyFieldValue(t *testing.T) {
	srv, close := newUserInfoServer(t, "tok", map[string]interface{}{
		"email": "", // empty string
	})
	defer close()
	defer withMockClient(srv)()

	_, err := getUserInfoFromEndpoint("tok", srv.URL, "email")
	if err == nil {
		t.Fatal("expected error for empty field value, got nil")
	}
}

func TestGetUserInfoFromEndpoint_EmptyURL(t *testing.T) {
	_, err := getUserInfoFromEndpoint("tok", "", "email")
	if err == nil {
		t.Fatal("expected error for empty URL, got nil")
	}
}

func TestGetUserInfoFromEndpoint_InvalidJSON(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Write([]byte("not-json"))
	}))
	defer srv.Close()
	defer withMockClient(srv)()

	_, err := getUserInfoFromEndpoint("tok", srv.URL, "email")
	if err == nil {
		t.Fatal("expected error for invalid JSON userinfo, got nil")
	}
}

func TestGetUserInfoFromEndpoint_NetworkFailure(t *testing.T) {
	orig := httpClient
	httpClient = &http.Client{Timeout: 50 * time.Millisecond}
	defer func() { httpClient = orig }()

	_, err := getUserInfoFromEndpoint("tok", "http://192.0.2.1/userinfo", "email")
	if err == nil {
		t.Fatal("expected error for unreachable host, got nil")
	}
}
