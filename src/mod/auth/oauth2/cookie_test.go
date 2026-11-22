package oauth2

import (
	"net/http/httptest"
	"testing"
	"time"
)

// The login state cookie of the OAuth sign in is never readable from scripts
func TestAddCookieIsHttpOnly(t *testing.T) {
	tests := []struct {
		name  string
		value string
		ttl   time.Duration
	}{
		{"login state", "3f6c2a1e-uuid", 30 * time.Minute},
		{"cleared", "-invalid-", -1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := httptest.NewRecorder()
			(&OauthHandler{}).addCookie(rec, "uuid_login", tt.value, tt.ttl)
			cookies := rec.Result().Cookies()
			if len(cookies) != 1 {
				t.Fatalf("got %d cookies, want 1", len(cookies))
			}
			if !cookies[0].HttpOnly {
				t.Error("uuid_login is readable from scripts")
			}
		})
	}
}
