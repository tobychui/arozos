package auth

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"
	"time"

	"github.com/gorilla/sessions"
	db "imuslab.com/arozos/mod/database"
)

const testSessionName = "ao_auth_test"

// newSessionAgent builds an agent with a cookie store and a revoker backed by
// a temporary database, enough to sign in, refresh and log out sessions.
func newSessionAgent(t *testing.T, sysdb *db.Database) *AuthAgent {
	t.Helper()
	return &AuthAgent{
		SessionName:     testSessionName,
		SessionStore:    sessions.NewCookieStore([]byte("0123456789abcdef0123456789abcdef")),
		Database:        sysdb,
		revokedSessions: newSessionRevoker(sysdb),
	}
}

func newTestDB(t *testing.T) *db.Database {
	t.Helper()
	sysdb, err := db.NewDatabase(filepath.Join(t.TempDir(), "ao.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	t.Cleanup(sysdb.Close)
	return sysdb
}

// requestWith returns a request carrying the given session cookie (none when nil).
func requestWith(cookie *http.Cookie) *http.Request {
	r := httptest.NewRequest(http.MethodGet, "http://192.168.1.2:8080/desktop.html", nil)
	if cookie != nil {
		r.AddCookie(cookie)
	}
	return r
}

// sessionCookie returns the last session cookie a response set, like a browser keeps it.
func sessionCookie(t *testing.T, rec *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	var found *http.Cookie
	for _, c := range rec.Result().Cookies() {
		if c.Name == testSessionName {
			found = c
		}
	}
	if found == nil {
		t.Fatalf("response set no session cookie")
	}
	return found
}

func login(t *testing.T, a *AuthAgent, username string) *http.Cookie {
	t.Helper()
	rec := httptest.NewRecorder()
	a.LoginUserByRequest(rec, requestWith(nil), username, false)
	return sessionCookie(t, rec)
}

// refresh is any signed-in request: the router extends the session on each one.
func refresh(t *testing.T, a *AuthAgent, cookie *http.Cookie) *http.Cookie {
	t.Helper()
	rec := httptest.NewRecorder()
	if !a.UpdateSessionExpireTime(rec, requestWith(cookie)) {
		t.Fatalf("UpdateSessionExpireTime refused a signed-in session")
	}
	return sessionCookie(t, rec)
}

func logout(t *testing.T, a *AuthAgent, cookie *http.Cookie) *http.Cookie {
	t.Helper()
	rec := httptest.NewRecorder()
	if err := a.Logout(rec, requestWith(cookie)); err != nil {
		t.Fatalf("Logout: %v", err)
	}
	return sessionCookie(t, rec)
}

// Issue #314: a request sent just before logout answers with a refreshed
// signed-in cookie. When that answer reaches the browser after the logout
// answer, the browser must still be logged out.
func TestLogoutSurvivesLateRefreshedCookie(t *testing.T) {
	a := newSessionAgent(t, newTestDB(t))
	signedIn := login(t, a, "alice")
	if !a.CheckAuth(requestWith(signedIn)) {
		t.Fatalf("fresh login is not signed in")
	}

	inFlight := refresh(t, a, signedIn) //Desktop poll still on its way
	loggedOut := logout(t, a, signedIn)

	if a.CheckAuth(requestWith(loggedOut)) {
		t.Errorf("logout cookie is still signed in")
	}
	if a.CheckAuth(requestWith(inFlight)) {
		t.Errorf("cookie refreshed before the logout signs the browser back in")
	}
	if a.CheckAuth(requestWith(signedIn)) {
		t.Errorf("original cookie still works after logout")
	}
	rec := httptest.NewRecorder()
	if a.UpdateSessionExpireTime(rec, requestWith(inFlight)) {
		t.Errorf("a revoked session was refreshed")
	}
}

func TestLoginAfterLogoutStartsNewSession(t *testing.T) {
	a := newSessionAgent(t, newTestDB(t))
	first := login(t, a, "alice")
	logout(t, a, first)

	second := login(t, a, "alice")
	if !a.CheckAuth(requestWith(second)) {
		t.Fatalf("signing in again after logout failed")
	}
	if !a.CheckAuth(requestWith(refresh(t, a, second))) {
		t.Errorf("refreshed new session is not signed in")
	}
}

func TestLogoutKeepsOtherSessions(t *testing.T) {
	a := newSessionAgent(t, newTestDB(t))
	laptop := login(t, a, "alice")
	phone := login(t, a, "alice")
	logout(t, a, laptop)
	if !a.CheckAuth(requestWith(phone)) {
		t.Errorf("logging out one browser signed out another")
	}
}

// Sessions signed in before session ids existed get one on their next
// request, so they can be logged out like any other.
func TestLegacySessionGetsIDOnRefresh(t *testing.T) {
	a := newSessionAgent(t, newTestDB(t))
	rec := httptest.NewRecorder()
	r := requestWith(nil)
	session, _ := a.SessionStore.Get(r, a.SessionName)
	session.Values["authenticated"] = true
	session.Values["username"] = "alice"
	session.Values["rememberMe"] = true
	session.Save(r, rec)
	legacy := sessionCookie(t, rec)

	upgraded := refresh(t, a, legacy)
	inFlight := refresh(t, a, upgraded)
	logout(t, a, upgraded)
	if a.CheckAuth(requestWith(inFlight)) {
		t.Errorf("upgraded legacy session survived logout")
	}
}

func TestLogoutWithoutSession(t *testing.T) {
	a := newSessionAgent(t, newTestDB(t))
	if a.CheckAuth(requestWith(logout(t, a, nil))) {
		t.Errorf("logging out an empty session signed it in")
	}
}

func TestRevokedSessionsSurviveRestart(t *testing.T) {
	sysdb := newTestDB(t)
	a := newSessionAgent(t, sysdb)
	signedIn := login(t, a, "alice")
	inFlight := refresh(t, a, signedIn)
	logout(t, a, signedIn)

	restarted := newSessionAgent(t, sysdb)
	restarted.SessionStore = a.SessionStore
	if restarted.CheckAuth(requestWith(inFlight)) {
		t.Errorf("revoked session works again after a restart")
	}
}

func TestRevokerPrune(t *testing.T) {
	sysdb := newTestDB(t)
	r := newSessionRevoker(sysdb)
	r.Revoke("current")
	r.Revoke("old")
	r.revoked["old"] = time.Now().Unix() - 1

	r.Prune()

	tests := []struct {
		sid  string
		want bool
	}{
		{"current", true},
		{"old", false},
		{"", false},
		{"never", false},
	}
	for _, tc := range tests {
		if got := r.IsRevoked(tc.sid); got != tc.want {
			t.Errorf("IsRevoked(%q) = %v, want %v", tc.sid, got, tc.want)
		}
	}
	if sysdb.KeyExists(revokedSessionTable, "old") {
		t.Errorf("pruned id is still in the database")
	}
	if !newSessionRevoker(sysdb).IsRevoked("current") {
		t.Errorf("revoked id was not stored")
	}
}

func TestRevokerExpiredOnLoad(t *testing.T) {
	sysdb := newTestDB(t)
	if err := sysdb.NewTable(revokedSessionTable); err != nil {
		t.Fatalf("NewTable: %v", err)
	}
	sysdb.Write(revokedSessionTable, "stale", time.Now().Unix()-10)
	sysdb.Write(revokedSessionTable, "live", time.Now().Unix()+100)

	r := newSessionRevoker(sysdb)
	if r.IsRevoked("stale") {
		t.Errorf("expired id was loaded")
	}
	if !r.IsRevoked("live") {
		t.Errorf("live id was not loaded")
	}
	if sysdb.KeyExists(revokedSessionTable, "stale") {
		t.Errorf("expired id was left in the database")
	}
}

func TestNilRevoker(t *testing.T) {
	var r *sessionRevoker
	r.Revoke("x")
	r.Prune()
	if r.IsRevoked("x") {
		t.Errorf("nil revoker reported a revoked id")
	}
}

func TestNewSessionIDUnique(t *testing.T) {
	seen := map[string]bool{}
	for i := 0; i < 100; i++ {
		sid := newSessionID()
		if len(sid) != sessionIDBytes*2 {
			t.Fatalf("session id %q has length %d", sid, len(sid))
		}
		if seen[sid] {
			t.Fatalf("duplicate session id %q", sid)
		}
		seen[sid] = true
	}
}
