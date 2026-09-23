package auth

import (
	"path/filepath"
	"testing"

	db "imuslab.com/arozos/mod/database"
)

// newHashOnlyAgent builds a minimal agent backed by a temporary database,
// enough for the account primitives and login decision logic.
func newHashOnlyAgent(t *testing.T) *AuthAgent {
	t.Helper()
	sysdb, err := db.NewDatabase(filepath.Join(t.TempDir(), "ao.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	if err := sysdb.NewTable("auth"); err != nil {
		t.Fatalf("NewTable: %v", err)
	}
	t.Cleanup(sysdb.Close)
	return &AuthAgent{Database: sysdb}
}

func TestPasswordHashPrimitives(t *testing.T) {
	a := newHashOnlyAgent(t)
	if _, err := a.GetPasswordHash("nobody"); err == nil {
		t.Errorf("missing user should error")
	}
	if err := a.SetPasswordHash("", Hash("x")); err == nil {
		t.Errorf("empty username accepted")
	}
	if err := a.SetPasswordHash("toby", ""); err == nil {
		t.Errorf("empty hash accepted")
	}
	if err := a.SetPasswordHash("toby", Hash("secret")); err != nil {
		t.Fatalf("SetPasswordHash: %v", err)
	}
	got, err := a.GetPasswordHash("toby")
	if err != nil || got != Hash("secret") {
		t.Errorf("GetPasswordHash = %q, %v", got, err)
	}

	tests := []struct {
		name string
		user string
		hash string
		want bool
	}{
		{"correct", "toby", Hash("secret"), true},
		{"wrong", "toby", Hash("nope"), false},
		{"unknown user", "alice", Hash("secret"), false},
		{"empty hash", "toby", "", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := a.ValidateUsernameAndPasswordHash(tc.user, tc.hash); got != tc.want {
				t.Errorf("got %v want %v", got, tc.want)
			}
		})
	}
}

func TestUserGroupPrimitives(t *testing.T) {
	a := newHashOnlyAgent(t)
	if _, err := a.GetUserGroups("nobody"); err == nil {
		t.Errorf("missing user should error")
	}
	if err := a.SetUserGroups("", []string{"a"}); err == nil {
		t.Errorf("empty username accepted")
	}
	if err := a.SetUserGroups("toby", nil); err != nil {
		t.Fatalf("SetUserGroups(nil): %v", err)
	}
	groups, err := a.GetUserGroups("toby")
	if err != nil || len(groups) != 0 {
		t.Errorf("nil groups should read back empty, got %v %v", groups, err)
	}
	if err := a.SetUserGroups("toby", []string{"administrator", "photographers"}); err != nil {
		t.Fatalf("SetUserGroups: %v", err)
	}
	groups, _ = a.GetUserGroups("toby")
	if len(groups) != 2 || groups[0] != "administrator" {
		t.Errorf("groups not stored: %v", groups)
	}
}

func TestValidateLoginForwardAuth(t *testing.T) {
	a := newHashOnlyAgent(t)
	a.SetPasswordHash("toby", Hash("local-pw"))

	tests := []struct {
		name       string
		hook       ForwardAuthHandler
		password   string
		wantOK     bool
		wantReason string
	}{
		{"no hook, local ok", nil, "local-pw", true, ""},
		{"no hook, local wrong", nil, "bad", false, "Invalid username or password"},
		{"hook undecided falls back", func(u, h string) ForwardAuthResult { return ForwardAuthResult{} }, "local-pw", true, ""},
		{"hook accepts", func(u, h string) ForwardAuthResult {
			if u == "toby" && h == Hash("remote-pw") {
				return ForwardAuthResult{Decided: true, Accepted: true}
			}
			return ForwardAuthResult{Decided: true, Accepted: false, Reason: "denied"}
		}, "remote-pw", true, ""},
		{"hook rejects without fallback", func(u, h string) ForwardAuthResult {
			return ForwardAuthResult{Decided: true, Accepted: false, Reason: "denied by origin"}
		}, "local-pw", false, "denied by origin"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			a.ForwardAuth = tc.hook
			ok, reason := a.validateLogin("toby", tc.password)
			if ok != tc.wantOK || reason != tc.wantReason {
				t.Errorf("validateLogin = (%v, %q) want (%v, %q)", ok, reason, tc.wantOK, tc.wantReason)
			}
		})
	}
}

func TestForwardAuthHookReceivesHashNotPassword(t *testing.T) {
	a := newHashOnlyAgent(t)
	var seen string
	a.ForwardAuth = func(u, h string) ForwardAuthResult {
		seen = h
		return ForwardAuthResult{Decided: true, Accepted: true}
	}
	a.validateLogin("toby", "clear-text")
	if seen == "clear-text" || seen != Hash("clear-text") {
		t.Errorf("hook must receive the SHA-512 hash, got %q", seen)
	}
}
