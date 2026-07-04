package webdav

import (
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"imuslab.com/arozos/mod/auth"
	db "imuslab.com/arozos/mod/database"
	"imuslab.com/arozos/mod/permission"
	"imuslab.com/arozos/mod/share/shareEntry"
	"imuslab.com/arozos/mod/storage"
	"imuslab.com/arozos/mod/user"
)

// newTestServer builds a Server with nil userHandler – sufficient for testing
// the in-memory sync.Map and helper logic that does not call userHandler.
func newTestServer() *Server {
	return &Server{
		hostname:                  "testhost",
		userHandler:               nil,
		filesystems:               sync.Map{},
		prefix:                    "/webdav",
		tlsMode:                   false,
		Enabled:                   true,
		windowsClientNotLoggedIn:  sync.Map{},
		windowsClientLoggedIn:     sync.Map{},
		readOnlyFileSystemHandler: nil,
	}
}

// webdavTestEnv wires a Server to a real AuthAgent/UserHandler backed by a
// temp-dir database, so authentication (Basic Auth and access-token) paths
// can be exercised end-to-end. Two users are created: "alice"/"alicepw" and
// "bob"/"bobpw".
type webdavTestEnv struct {
	server    *Server
	authAgent *auth.AuthAgent
	cleanup   func()
}

func newAuthedTestEnv(t *testing.T) *webdavTestEnv {
	t.Helper()
	tmpDir := t.TempDir()

	// The authlogger writes to ./system/auth/ relative to cwd; redirect to tmp.
	origDir, _ := os.Getwd()
	if err := os.Chdir(tmpDir); err != nil {
		t.Fatalf("os.Chdir: %v", err)
	}

	sysdb, err := db.NewDatabase(filepath.Join(tmpDir, "system.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}

	authAgent := auth.NewAuthenticationAgent("testsession", []byte("supersecretkey0123456789"), sysdb, false, nil)

	ph, err := permission.NewPermissionHandler(sysdb)
	if err != nil {
		t.Fatalf("NewPermissionHandler: %v", err)
	}
	ph.NewPermissionGroup("users", false, 0, []string{}, "")

	if err := authAgent.CreateUserAccount("alice", "alicepw", []string{"users"}); err != nil {
		t.Fatalf("CreateUserAccount (alice): %v", err)
	}
	if err := authAgent.CreateUserAccount("bob", "bobpw", []string{"users"}); err != nil {
		t.Fatalf("CreateUserAccount (bob): %v", err)
	}

	sp, err := storage.NewStoragePool(nil, "system")
	if err != nil {
		t.Fatalf("NewStoragePool: %v", err)
	}

	set := shareEntry.NewShareEntryTable(sysdb)
	uh, err := user.NewUserHandler(sysdb, authAgent, ph, sp, &set)
	if err != nil {
		t.Fatalf("NewUserHandler: %v", err)
	}

	s := &Server{
		hostname:    "testhost",
		userHandler: uh,
		filesystems: sync.Map{},
		prefix:      "/webdav",
		Enabled:     true,
	}

	cleanup := func() {
		authAgent.Close()
		sysdb.Close()
		os.Chdir(origDir)
	}

	return &webdavTestEnv{
		server:    s,
		authAgent: authAgent,
		cleanup:   cleanup,
	}
}

func TestServerFields(t *testing.T) {
	s := newTestServer()
	if s.hostname != "testhost" {
		t.Errorf("expected hostname='testhost', got %q", s.hostname)
	}
	if !s.Enabled {
		t.Error("expected Enabled=true")
	}
	if s.prefix != "/webdav" {
		t.Errorf("expected prefix='/webdav', got %q", s.prefix)
	}
}

func TestHandleRequest_Disabled(t *testing.T) {
	s := newTestServer()
	s.Enabled = false

	req := httptest.NewRequest(http.MethodGet, "/webdav/user/somefile", nil)
	w := httptest.NewRecorder()
	s.HandleRequest(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("disabled server: expected 404, got %d", w.Code)
	}
}

func TestHandleRequest_RootPath(t *testing.T) {
	s := newTestServer()

	req := httptest.NewRequest(http.MethodGet, "/webdav", nil)
	w := httptest.NewRecorder()
	s.HandleRequest(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("root-only path: expected 404, got %d", w.Code)
	}
}

func TestHandleClearAllPending(t *testing.T) {
	s := newTestServer()
	// Populate the pending map
	s.windowsClientNotLoggedIn.Store("uuid-1", &WindowClientInfo{UUID: "uuid-1"})
	s.windowsClientNotLoggedIn.Store("uuid-2", &WindowClientInfo{UUID: "uuid-2"})

	req := httptest.NewRequest(http.MethodPost, "/webdav/clear", nil)
	w := httptest.NewRecorder()
	s.HandleClearAllPending(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK, got %d", w.Code)
	}

	// All pending entries should be cleared
	count := 0
	s.windowsClientNotLoggedIn.Range(func(_, _ interface{}) bool { count++; return true })
	if count != 0 {
		t.Errorf("expected empty windowsClientNotLoggedIn after clear, got %d entries", count)
	}
}

func TestWindowClientInfo(t *testing.T) {
	wci := &WindowClientInfo{
		Agent:                   "TestAgent",
		LastConnectionTimestamp: time.Now().Unix(),
		UUID:                    "test-uuid",
		Username:                "testuser",
		ClientIP:                "127.0.0.1",
	}
	if wci.UUID != "test-uuid" {
		t.Errorf("expected UUID='test-uuid', got %q", wci.UUID)
	}
	if wci.Username != "testuser" {
		t.Errorf("expected Username='testuser', got %q", wci.Username)
	}
}

// --- common.go helpers ---

func TestStringInSlice(t *testing.T) {
	if !stringInSlice("b", []string{"a", "b", "c"}) {
		t.Error("expected true for existing element")
	}
	if stringInSlice("z", []string{"a", "b", "c"}) {
		t.Error("expected false for missing element")
	}
}

func TestInArray(t *testing.T) {
	if !inArray([]string{"x", "y"}, "x") {
		t.Error("expected true for 'x'")
	}
	if inArray([]string{"x", "y"}, "z") {
		t.Error("expected false for 'z'")
	}
}

func TestPushToSliceIfNotExist(t *testing.T) {
	s := []string{"a", "b"}
	s = pushToSliceIfNotExist(s, "c")
	if len(s) != 3 {
		t.Errorf("expected length 3, got %d", len(s))
	}
	// Pushing duplicate should be no-op
	s = pushToSliceIfNotExist(s, "c")
	if len(s) != 3 {
		t.Errorf("expected length 3 after duplicate push, got %d", len(s))
	}
}

func TestRemoveFromSliceIfExists(t *testing.T) {
	s := []string{"a", "b", "c"}
	s = removeFromSliceIfExists(s, "b")
	if len(s) != 2 {
		t.Errorf("expected length 2 after remove, got %d", len(s))
	}
	for _, v := range s {
		if v == "b" {
			t.Error("'b' should have been removed")
		}
	}
}

func TestTimeToString(t *testing.T) {
	// Just verify it doesn't panic and produces a non-empty string
	result := timeToString(time.Now())
	if result == "" {
		t.Error("timeToString returned empty string")
	}
}

func TestFileExists(t *testing.T) {
	// A known path that exists
	if !fileExists("/") {
		t.Error("expected '/' to exist")
	}
	if fileExists("/this/path/does/not/exist/12345") {
		t.Error("expected false for non-existent path")
	}
}

func TestIsDir(t *testing.T) {
	if !isDir("/") {
		t.Error("expected '/' to be a directory")
	}
	if isDir("/this/path/does/not/exist") {
		t.Error("expected false for non-existent path")
	}
}

func TestMv_GetMode(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/?foo=bar", nil)
	val, err := mv(req, "foo", false)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "bar" {
		t.Errorf("expected 'bar', got %q", val)
	}
}

func TestMv_MissingKey(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	_, err := mv(req, "missing", false)
	if err == nil {
		t.Error("expected error for missing GET parameter")
	}
}

func TestMv_PostMode(t *testing.T) {
	req, _ := http.NewRequest(http.MethodPost, "/", strings.NewReader("foo=bar"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	val, err := mv(req, "foo", true)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if val != "bar" {
		t.Errorf("expected 'bar', got %q", val)
	}
}

func TestMv_PostMode_MissingKey(t *testing.T) {
	req, _ := http.NewRequest(http.MethodPost, "/", strings.NewReader("other=value"))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	_, err := mv(req, "missing", true)
	if err == nil {
		t.Error("expected error for missing POST parameter")
	}
}

func TestSendTextResponse(t *testing.T) {
	w := httptest.NewRecorder()
	sendTextResponse(w, "hello world")
	if w.Body.String() != "hello world" {
		t.Errorf("expected 'hello world', got %q", w.Body.String())
	}
}

func TestSendJSONResponse(t *testing.T) {
	w := httptest.NewRecorder()
	sendJSONResponse(w, `{"key":"value"}`)
	if w.Header().Get("Content-Type") != "application/json" {
		t.Error("expected Content-Type: application/json")
	}
	if w.Body.String() != `{"key":"value"}` {
		t.Errorf("unexpected body: %q", w.Body.String())
	}
}

func TestSendErrorResponse(t *testing.T) {
	w := httptest.NewRecorder()
	sendErrorResponse(w, "something went wrong")
	if w.Header().Get("Content-Type") != "application/json" {
		t.Error("expected Content-Type: application/json")
	}
	body := w.Body.String()
	if !strings.Contains(body, "something went wrong") {
		t.Errorf("expected error message in body, got %q", body)
	}
	if !strings.Contains(body, "error") {
		t.Errorf("expected 'error' key in body, got %q", body)
	}
}

func TestSendOK(t *testing.T) {
	w := httptest.NewRecorder()
	sendOK(w)
	if w.Header().Get("Content-Type") != "application/json" {
		t.Error("expected Content-Type: application/json")
	}
	if w.Body.String() != `"OK"` {
		t.Errorf("expected '\"OK\"', got %q", w.Body.String())
	}
}

func TestLoadImageAsBase64_NotExists(t *testing.T) {
	_, err := loadImageAsBase64("/this/does/not/exist.png")
	if err == nil {
		t.Error("expected error for non-existent file")
	}
}

func TestLoadImageAsBase64_ValidFile(t *testing.T) {
	// Create a temp file with some content
	f, err := os.CreateTemp("", "testimg*.txt")
	if err != nil {
		t.Fatalf("failed to create temp file: %v", err)
	}
	defer os.Remove(f.Name())
	f.Write([]byte("test image data"))
	f.Close()

	encoded, err := loadImageAsBase64(f.Name())
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if encoded == "" {
		t.Error("expected non-empty base64 string")
	}
}

func TestGetIP_XRealIP(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-REAL-IP", "1.2.3.4")

	ip, err := getIP(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ip != "1.2.3.4" {
		t.Errorf("expected '1.2.3.4', got %q", ip)
	}
}

func TestGetIP_XForwardedFor(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-FORWARDED-FOR", "5.6.7.8, 9.10.11.12")

	ip, err := getIP(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ip != "5.6.7.8" {
		t.Errorf("expected '5.6.7.8', got %q", ip)
	}
}

func TestGetIP_RemoteAddr(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.1:1234"

	ip, err := getIP(req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if ip != "10.0.0.1" {
		t.Errorf("expected '10.0.0.1', got %q", ip)
	}
}

func TestGetIP_Invalid(t *testing.T) {
	req, _ := http.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "invalid-addr"

	_, err := getIP(req)
	if err == nil {
		t.Error("expected error for invalid RemoteAddr")
	}
}

func TestHandleRequest_NoBasicAuth(t *testing.T) {
	s := newTestServer()

	req := httptest.NewRequest(http.MethodGet, "/webdav/user/file.txt", nil)
	w := httptest.NewRecorder()
	s.HandleRequest(w, req)

	// Without basic auth, should get 401 Unauthorized
	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for no basic auth, got %d", w.Code)
	}
	wwwAuth := w.Header().Get("WWW-Authenticate")
	if wwwAuth == "" {
		t.Error("expected WWW-Authenticate header to be set")
	}
}

func TestHandleRequest_EmptyVroot(t *testing.T) {
	s := newTestServer()

	// Path like /webdav// has empty segment after stripping
	req := httptest.NewRequest(http.MethodGet, "/webdav//", nil)
	w := httptest.NewRecorder()
	s.HandleRequest(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for empty vroot, got %d", w.Code)
	}
}

// --- auto-login access token authentication (X-Access-Token / X-Aroz-User) ---

func TestAutoLoginTokenMatchesUsername(t *testing.T) {
	env := newAuthedTestEnv(t)
	defer env.cleanup()

	token := env.authAgent.NewAutologinToken("alice")

	tests := []struct {
		name            string
		accessToken     string
		claimedUsername string
		wantValid       bool
		wantUsername    string
	}{
		{"valid token and matching username", token, "alice", true, "alice"},
		{"valid token but wrong claimed username", token, "bob", false, ""},
		{"unknown token", "bogus-token", "alice", false, ""},
		{"empty token", "", "alice", false, ""},
		{"empty claimed username", token, "", false, ""},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			valid, username := autoLoginTokenMatchesUsername(env.authAgent, tc.accessToken, tc.claimedUsername)
			if valid != tc.wantValid {
				t.Errorf("valid: got %v, want %v", valid, tc.wantValid)
			}
			if username != tc.wantUsername {
				t.Errorf("username: got %q, want %q", username, tc.wantUsername)
			}
		})
	}
}

func TestHandleRequest_AccessToken_Valid(t *testing.T) {
	env := newAuthedTestEnv(t)
	defer env.cleanup()

	token := env.authAgent.NewAutologinToken("alice")

	req := httptest.NewRequest(http.MethodGet, "/webdav/user/file.txt", nil)
	req.Header.Set("X-Access-Token", token)
	req.Header.Set("X-Aroz-User", "alice")
	w := httptest.NewRecorder()
	env.server.HandleRequest(w, req)

	if w.Code == http.StatusUnauthorized {
		t.Errorf("expected access-token auth to pass the credential check (not 401), got 401: %s", w.Body.String())
	}
	if wwwAuth := w.Header().Get("WWW-Authenticate"); wwwAuth != "" {
		t.Errorf("did not expect a Basic Auth challenge for token auth, got WWW-Authenticate=%q", wwwAuth)
	}
}

func TestHandleRequest_AccessToken_InvalidToken(t *testing.T) {
	env := newAuthedTestEnv(t)
	defer env.cleanup()

	req := httptest.NewRequest(http.MethodGet, "/webdav/user/file.txt", nil)
	req.Header.Set("X-Access-Token", "not-a-real-token")
	req.Header.Set("X-Aroz-User", "alice")
	w := httptest.NewRecorder()
	env.server.HandleRequest(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for invalid access token, got %d", w.Code)
	}
	if wwwAuth := w.Header().Get("WWW-Authenticate"); wwwAuth != "" {
		t.Errorf("token auth failure should not trigger a Basic Auth challenge, got WWW-Authenticate=%q", wwwAuth)
	}
}

func TestHandleRequest_AccessToken_UsernameMismatch(t *testing.T) {
	env := newAuthedTestEnv(t)
	defer env.cleanup()

	// Token belongs to alice, but the request claims to be bob.
	token := env.authAgent.NewAutologinToken("alice")

	req := httptest.NewRequest(http.MethodGet, "/webdav/user/file.txt", nil)
	req.Header.Set("X-Access-Token", token)
	req.Header.Set("X-Aroz-User", "bob")
	w := httptest.NewRecorder()
	env.server.HandleRequest(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 when X-Aroz-User does not match the token owner, got %d", w.Code)
	}
}

func TestHandleRequest_AccessToken_MissingUserHeader(t *testing.T) {
	env := newAuthedTestEnv(t)
	defer env.cleanup()

	token := env.authAgent.NewAutologinToken("alice")

	req := httptest.NewRequest(http.MethodGet, "/webdav/user/file.txt", nil)
	req.Header.Set("X-Access-Token", token)
	// X-Aroz-User intentionally omitted
	w := httptest.NewRecorder()
	env.server.HandleRequest(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 when X-Aroz-User is missing, got %d", w.Code)
	}
}

func TestHandleRequest_BasicAuth_StillWorksAlongsideAccessToken(t *testing.T) {
	env := newAuthedTestEnv(t)
	defer env.cleanup()

	req := httptest.NewRequest(http.MethodGet, "/webdav/user/file.txt", nil)
	req.SetBasicAuth("alice", "alicepw")
	w := httptest.NewRecorder()
	env.server.HandleRequest(w, req)

	if w.Code == http.StatusUnauthorized {
		t.Errorf("expected valid Basic Auth to pass the credential check (not 401), got 401: %s", w.Body.String())
	}
}

func TestHandleRequest_BasicAuth_WrongPassword(t *testing.T) {
	env := newAuthedTestEnv(t)
	defer env.cleanup()

	req := httptest.NewRequest(http.MethodGet, "/webdav/user/file.txt", nil)
	req.SetBasicAuth("alice", "wrongpassword")
	w := httptest.NewRecorder()
	env.server.HandleRequest(w, req)

	if w.Code != http.StatusUnauthorized {
		t.Errorf("expected 401 for wrong password, got %d", w.Code)
	}
}

func TestHandleConnectionList_Empty(t *testing.T) {
	s := newTestServer()

	req := httptest.NewRequest(http.MethodGet, "/webdav/connections", nil)
	w := httptest.NewRecorder()
	s.HandleConnectionList(w, req)

	if w.Code != http.StatusOK {
		t.Errorf("expected 200 OK, got %d", w.Code)
	}
	body := w.Body.String()
	// Should return empty JSON array
	if !strings.Contains(body, "[") {
		t.Errorf("expected JSON array in response, got %q", body)
	}
}
