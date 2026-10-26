package auth

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"testing"

	"github.com/gorilla/sessions"

	db "imuslab.com/arozos/mod/database"
)

// newTestAuthAgent builds an AuthAgent on a temp database with a fake register
// policy: "administrator" and "admins" are admin groups, "user" is not, and
// callers listed in admins are administrators.
func newTestAuthAgent(t *testing.T, admins map[string]bool) *AuthAgent {
	t.Helper()
	sysdb, err := db.NewDatabase(filepath.Join(t.TempDir(), "test.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase returned error: %v", err)
	}
	t.Cleanup(sysdb.Close)
	if err := sysdb.NewTable("auth"); err != nil {
		t.Fatalf("NewTable returned error: %v", err)
	}

	a := &AuthAgent{
		SessionName:  "ao_auth",
		SessionStore: sessions.NewCookieStore([]byte("0123456789abcdef0123456789abcdef")),
		Database:     sysdb,
		mutex:        &sync.Mutex{},
	}
	groups := map[string]bool{"administrator": true, "admins": true, "user": false}
	a.RegisterAuthorizer = &RegisterAuthorizer{
		CallerIsAdmin: func(w http.ResponseWriter, r *http.Request) bool {
			username, err := a.GetUserName(w, r)
			return err == nil && admins[username]
		},
		GroupExists: func(group string) bool {
			_, ok := groups[group]
			return ok
		},
		GroupIsAdmin: func(group string) bool {
			return groups[group]
		},
	}
	return a
}

// sessionCookies returns the session cookies of a signed-in username.
func sessionCookies(t *testing.T, a *AuthAgent, username string) []*http.Cookie {
	t.Helper()
	rec := httptest.NewRecorder()
	a.LoginUserByRequest(rec, httptest.NewRequest(http.MethodPost, "/system/auth/login", nil), username, false)
	cookies := rec.Result().Cookies()
	if len(cookies) == 0 {
		t.Fatal("LoginUserByRequest set no session cookie")
	}
	return cookies
}

// postRegister calls HandleRegister and returns the response body.
func postRegister(a *AuthAgent, cookies []*http.Cookie, username, password, group string) string {
	form := url.Values{"username": {username}, "password": {password}, "group": {group}}
	req := httptest.NewRequest(http.MethodPost, "/system/auth/register", strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	for _, c := range cookies {
		req.AddCookie(c)
	}
	rec := httptest.NewRecorder()
	a.HandleRegister(rec, req)
	return rec.Body.String()
}

// TestHandleRegisterFirstRun covers creating the initial account with no users and no login.
func TestHandleRegisterFirstRun(t *testing.T) {
	tests := []struct {
		name    string
		group   string
		wantOK  bool
		wantErr string
	}{
		{"administrator group", "administrator", true, ""},
		{"other admin group", "admins", true, ""},
		{"non admin group", "user", false, "administrator group"},
		{"unknown group", "nosuchgroup", false, "administrator group"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			a := newTestAuthAgent(t, nil)
			body := postRegister(a, nil, "first", "secret", tc.group)
			if tc.wantOK {
				if body != "\"OK\"" {
					t.Fatalf("body = %s, want \"OK\"", body)
				}
				if !a.UserExists("first") {
					t.Error("first user was not created")
				}
				return
			}
			if !strings.Contains(body, tc.wantErr) {
				t.Errorf("body = %s, want it to contain %q", body, tc.wantErr)
			}
			if a.GetUserCounts() != 0 {
				t.Error("account was created despite the error")
			}
		})
	}
}

// TestHandleRegisterExistingUsers covers who may create accounts once users exist.
func TestHandleRegisterExistingUsers(t *testing.T) {
	tests := []struct {
		name     string
		caller   string //empty for an anonymous request
		username string
		group    string
		wantOK   bool
		wantErr  string
	}{
		{"anonymous", "", "eve", "user", false, "Login is needed"},
		{"non admin creates admin", "alice", "eve", "administrator", false, "Permission denied"},
		{"non admin creates user", "alice", "eve", "user", false, "Permission denied"},
		{"admin creates user", "admin", "bob", "user", true, ""},
		{"admin creates admin", "admin", "bob", "administrator", true, ""},
		{"admin with unknown group", "admin", "bob", "nosuchgroup", false, "group not exists"},
		{"admin overwrites existing user", "admin", "alice", "user", false, "already taken"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			a := newTestAuthAgent(t, map[string]bool{"admin": true})
			if err := a.CreateUserAccount("admin", "adminpass", []string{"administrator"}); err != nil {
				t.Fatalf("CreateUserAccount returned error: %v", err)
			}
			if err := a.CreateUserAccount("alice", "alicepass", []string{"user"}); err != nil {
				t.Fatalf("CreateUserAccount returned error: %v", err)
			}

			var cookies []*http.Cookie
			if tc.caller != "" {
				cookies = sessionCookies(t, a, tc.caller)
			}
			body := postRegister(a, cookies, tc.username, "newpass", tc.group)
			if tc.wantOK {
				if body != "\"OK\"" {
					t.Fatalf("body = %s, want \"OK\"", body)
				}
				if !a.UserExists(tc.username) {
					t.Errorf("user %s was not created", tc.username)
				}
				return
			}
			if !strings.Contains(body, tc.wantErr) {
				t.Errorf("body = %s, want it to contain %q", body, tc.wantErr)
			}
			if a.GetUserCounts() != 2 {
				t.Errorf("user count = %d, want 2", a.GetUserCounts())
			}
			passhash := ""
			a.Database.Read("auth", "passhash/alice", &passhash)
			if passhash != Hash("alicepass") {
				t.Error("existing user's password was changed")
			}
		})
	}
}

// TestHandleRegisterNoAuthorizer checks that registration fails closed when main did not wire a policy.
func TestHandleRegisterNoAuthorizer(t *testing.T) {
	tests := []struct {
		name          string
		existingUsers int
	}{
		{"first run", 0},
		{"with users", 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			a := newTestAuthAgent(t, map[string]bool{"admin": true})
			a.RegisterAuthorizer = nil
			var cookies []*http.Cookie
			if tc.existingUsers > 0 {
				if err := a.CreateUserAccount("admin", "adminpass", []string{"administrator"}); err != nil {
					t.Fatalf("CreateUserAccount returned error: %v", err)
				}
				cookies = sessionCookies(t, a, "admin")
			}
			body := postRegister(a, cookies, "bob", "newpass", "administrator")
			if !strings.Contains(body, "not available") {
				t.Errorf("body = %s, want registration to be unavailable", body)
			}
			if a.UserExists("bob") {
				t.Error("account was created without a register policy")
			}
		})
	}
}

// TestHandleRegisterMissingParams checks that each required POST field is enforced.
func TestHandleRegisterMissingParams(t *testing.T) {
	tests := []struct {
		name                      string
		username, password, group string
		wantErr                   string
	}{
		{"no username", "", "pass", "administrator", "'username'"},
		{"no password", "bob", "", "administrator", "'password'"},
		{"no group", "bob", "pass", "", "'group'"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			a := newTestAuthAgent(t, nil)
			body := postRegister(a, nil, tc.username, tc.password, tc.group)
			if !strings.Contains(body, tc.wantErr) {
				t.Errorf("body = %s, want it to contain %q", body, tc.wantErr)
			}
			if a.GetUserCounts() != 0 {
				t.Error("account was created despite the missing parameter")
			}
		})
	}
}
