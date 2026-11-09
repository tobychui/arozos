package register

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	auth "imuslab.com/arozos/mod/auth"
	db "imuslab.com/arozos/mod/database"
	permission "imuslab.com/arozos/mod/permission"
)

// newTestRegisterHandler builds an open public registration on a temp database
func newTestRegisterHandler(t *testing.T) (*RegisterHandler, *auth.AuthAgent) {
	t.Helper()
	database, err := db.NewDatabase(filepath.Join(t.TempDir(), "test.db"), false)
	if err != nil {
		t.Fatalf("NewDatabase: %v", err)
	}
	t.Cleanup(database.Close)
	if err := database.NewTable("auth"); err != nil {
		t.Fatalf("NewTable: %v", err)
	}
	ph, err := permission.NewPermissionHandler(database)
	if err != nil {
		t.Fatalf("NewPermissionHandler: %v", err)
	}
	ph.LoadPermissionGroupsFromDatabase()
	agent := &auth.AuthAgent{Database: database}
	h := NewRegisterHandler(database, agent, ph, RegisterOptions{Hostname: "test"})
	h.AllowRegistry = true
	return h, agent
}

func TestHandleRegisterRequestUsername(t *testing.T) {
	tests := []struct {
		name     string
		username string
		wantBody string
		created  bool
	}{
		{name: "valid", username: "alice", wantBody: "OK", created: true},
		{name: "path traversal", username: "../alice", wantBody: "start with a letter"},
		{name: "separator", username: "al/ice", wantBody: "cannot contain"},
		{name: "space", username: "alice smith", wantBody: "spaces"},
		{name: "windows device", username: "aux", wantBody: "reserved by Windows"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h, agent := newTestRegisterHandler(t)
			form := url.Values{"email": {"someone@example.com"}, "username": {tt.username}, "password": {"long-enough-pass"}}
			req := httptest.NewRequest(http.MethodPost, "/public/register/handleRegister.html", strings.NewReader(form.Encode()))
			req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			rec := httptest.NewRecorder()
			h.HandleRegisterRequest(rec, req)
			if !strings.Contains(rec.Body.String(), tt.wantBody) {
				t.Errorf("body = %s, want it to contain %s", rec.Body.String(), tt.wantBody)
			}
			if got := agent.UserExists(tt.username); got != tt.created {
				t.Errorf("UserExists(%q) = %v, want %v", tt.username, got, tt.created)
			}
		})
	}
}

func TestHandleRegisterRequestClosed(t *testing.T) {
	h, _ := newTestRegisterHandler(t)
	h.AllowRegistry = false
	rec := httptest.NewRecorder()
	h.HandleRegisterRequest(rec, httptest.NewRequest(http.MethodPost, "/public/register/handleRegister.html", nil))
	if !strings.Contains(rec.Body.String(), "closed") {
		t.Errorf("body = %s, want the registry to be closed", rec.Body.String())
	}
}
