package auth

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/database"
)

// The session cookie must never be readable from page scripts: a script that
// gets onto the site (a user file shown inline, a personal site page) could
// otherwise carry the session away.

func cookieNamed(cookies []*http.Cookie, name string) *http.Cookie {
	for _, c := range cookies {
		if c.Name == name {
			return c
		}
	}
	return nil
}

func TestSessionCookieIsHttpOnly(t *testing.T) {
	tests := []struct {
		name       string
		rememberMe bool
	}{
		{"one hour session", false},
		{"remember me", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			a := newTestAuthAgent(t, nil)
			rec := httptest.NewRecorder()
			a.LoginUserByRequest(rec, httptest.NewRequest(http.MethodPost, "/system/auth/login", nil), "alice", tt.rememberMe)
			c := cookieNamed(rec.Result().Cookies(), "ao_auth")
			if c == nil {
				t.Fatal("login set no ao_auth cookie")
			}
			if !c.HttpOnly {
				t.Error("the ao_auth cookie set at login is readable from scripts")
			}
		})
	}
}

func TestSessionRefreshKeepsHttpOnly(t *testing.T) {
	for _, rememberMe := range []bool{false, true} {
		a := newTestAuthAgent(t, nil)
		login := httptest.NewRecorder()
		a.LoginUserByRequest(login, httptest.NewRequest(http.MethodPost, "/system/auth/login", nil), "alice", rememberMe)

		req := httptest.NewRequest(http.MethodGet, "/desktop.html", nil)
		for _, c := range login.Result().Cookies() {
			req.AddCookie(c)
		}
		rec := httptest.NewRecorder()
		if !a.UpdateSessionExpireTime(rec, req) {
			t.Fatalf("remember me %v: the signed in session was not refreshed", rememberMe)
		}
		c := cookieNamed(rec.Result().Cookies(), "ao_auth")
		if c == nil {
			t.Fatalf("remember me %v: the refresh set no ao_auth cookie", rememberMe)
		}
		if !c.HttpOnly {
			t.Errorf("remember me %v: the refreshed ao_auth cookie is readable from scripts", rememberMe)
		}
	}
}

func TestAccountSwitchStoreIsHttpOnly(t *testing.T) {
	sysdb, err := database.NewDatabase(filepath.Join(t.TempDir(), "acswitch.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase returned error: %v", err)
	}
	t.Cleanup(sysdb.Close)
	m := NewSwitchableAccountPoolManager(sysdb, newTestAuthAgent(t, nil), []byte("0123456789abcdef0123456789abcdef"))
	if !m.SessionStore.Options.HttpOnly {
		t.Error("the ao_acc cookie store lets scripts read its cookie")
	}
}
