package autologin

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	auth "imuslab.com/arozos/mod/auth"
	db "imuslab.com/arozos/mod/database"
	permission "imuslab.com/arozos/mod/permission"
	"imuslab.com/arozos/mod/share/shareEntry"
	storage "imuslab.com/arozos/mod/storage"
	user "imuslab.com/arozos/mod/user"
)

// newTestHandler builds a real AutoLoginHandler backed by an in-memory (temp
// dir) database for integration-style tests.
func newTestHandler(t *testing.T) (*AutoLoginHandler, *auth.AuthAgent) {
	t.Helper()
	dir := t.TempDir()
	database, err := db.NewDatabase(filepath.Join(dir, "test.db"), false)
	if err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}

	authAgent := auth.NewAuthenticationAgent(
		"testsession",
		[]byte("supersecretkey1234567890"),
		database,
		false,
		nil,
	)

	// Close the authlogger database when the test ends so the bolt file lock
	// is released before the next test tries to open the same file.
	t.Cleanup(func() {
		if authAgent.Logger != nil {
			authAgent.Logger.Close()
		}
		database.Close()
	})

	if err := authAgent.CreateUserAccount("testuser", "testpassword", []string{"user"}); err != nil {
		t.Fatalf("CreateUserAccount: %v", err)
	}

	ph, err := permission.NewPermissionHandler(database)
	if err != nil {
		t.Fatalf("NewPermissionHandler: %v", err)
	}

	sp, err := storage.NewStoragePool(nil, "system")
	if err != nil {
		t.Fatalf("NewStoragePool: %v", err)
	}

	set := shareEntry.NewShareEntryTable(database)

	uh, err := user.NewUserHandler(database, authAgent, ph, sp, &set)
	if err != nil {
		t.Fatalf("NewUserHandler: %v", err)
	}

	return NewAutoLoginHandler(uh), authAgent
}

// TestNewAutoLoginHandler verifies the constructor stores the (nil) handler
// without panicking.
func TestNewAutoLoginHandler(t *testing.T) {
	// We pass nil because constructing a real UserHandler requires a full
	// database and auth stack that is not available in a unit-test context.
	h := NewAutoLoginHandler(nil)
	if h == nil {
		t.Fatal("NewAutoLoginHandler returned nil")
	}
}

// TestHandleUserTokensListingMissingParam exercises the early-exit path when
// the "username" query parameter is absent.
func TestHandleUserTokensListingMissingParam(t *testing.T) {
	h := NewAutoLoginHandler(nil)

	req := httptest.NewRequest(http.MethodGet, "/autologin/list", nil)
	rr := httptest.NewRecorder()

	// Should not panic — userHandler is nil but we never reach the nil dereference
	// because the missing-parameter guard returns first.
	h.HandleUserTokensListing(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if body == "" {
		t.Error("expected non-empty response body")
	}
	// The handler writes an error JSON when the param is missing
	if body == "[]" {
		t.Error("expected an error response, not an empty token list")
	}
}

// TestHandleUserTokenCreationMissingParam exercises the early-exit path when
// the "username" query parameter is absent.
func TestHandleUserTokenCreationMissingParam(t *testing.T) {
	h := NewAutoLoginHandler(nil)

	req := httptest.NewRequest(http.MethodGet, "/autologin/create", nil)
	rr := httptest.NewRecorder()

	h.HandleUserTokenCreation(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if body == "" {
		t.Error("expected non-empty response body")
	}
}

// TestHandleUserTokenRemovalMissingParam exercises the early-exit path when
// the "token" query parameter is absent.
func TestHandleUserTokenRemovalMissingParam(t *testing.T) {
	h := NewAutoLoginHandler(nil)

	req := httptest.NewRequest(http.MethodGet, "/autologin/remove", nil)
	rr := httptest.NewRecorder()

	h.HandleUserTokenRemoval(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected status 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if body == "" {
		t.Error("expected non-empty response body")
	}
}

// TestHandleUserTokensListing_UserNotExists covers the "user not exists" branch.
func TestHandleUserTokensListing_UserNotExists(t *testing.T) {
	h, _ := newTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/autologin/list?username=nosuchuser", nil)
	rr := httptest.NewRecorder()
	h.HandleUserTokensListing(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "error") && !strings.Contains(body, "not exists") {
		t.Errorf("expected error about user not existing, got %q", body)
	}
}

// TestHandleUserTokensListing_Success covers the happy path: user exists, tokens returned.
func TestHandleUserTokensListing_Success(t *testing.T) {
	h, _ := newTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/autologin/list?username=testuser", nil)
	rr := httptest.NewRecorder()
	h.HandleUserTokensListing(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if body == "" {
		t.Error("expected non-empty response body")
	}
}

// TestHandleUserTokenCreation_UserNotExists covers the "user not exists" branch.
func TestHandleUserTokenCreation_UserNotExists(t *testing.T) {
	h, _ := newTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/autologin/create?username=nosuchuser", nil)
	rr := httptest.NewRecorder()
	h.HandleUserTokenCreation(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if !strings.Contains(body, "error") && !strings.Contains(body, "not exists") {
		t.Errorf("expected error response, got %q", body)
	}
}

// TestHandleUserTokenCreation_Success covers the happy path: user exists, token created.
func TestHandleUserTokenCreation_Success(t *testing.T) {
	h, _ := newTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/autologin/create?username=testuser", nil)
	rr := httptest.NewRecorder()
	h.HandleUserTokenCreation(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	if body == "" {
		t.Error("expected non-empty response body")
	}
	// Response should contain a token string (quoted JSON string)
	if !strings.HasPrefix(body, "\"") {
		t.Errorf("expected JSON string token in response, got %q", body)
	}
}

// TestHandleUserTokenRemoval_WithToken covers the token-present path of HandleUserTokenRemoval.
func TestHandleUserTokenRemoval_WithToken(t *testing.T) {
	h, authAgent := newTestHandler(t)

	// First create a token so we have one to remove.
	token := authAgent.NewAutologinToken("testuser")

	req := httptest.NewRequest(http.MethodGet, "/autologin/remove?token="+token, nil)
	rr := httptest.NewRecorder()
	h.HandleUserTokenRemoval(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

// TestHandleUserTokenRemoval_NonExistentToken covers removing a token that
// doesn't exist (RemoveAutologinToken is a no-op; handler still returns OK).
func TestHandleUserTokenRemoval_NonExistentToken(t *testing.T) {
	h, _ := newTestHandler(t)

	req := httptest.NewRequest(http.MethodGet, "/autologin/remove?token=nonexistenttoken123", nil)
	rr := httptest.NewRecorder()
	h.HandleUserTokenRemoval(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

// TestHandleUserTokensListing_AfterTokenCreation verifies listing shows the created token.
func TestHandleUserTokensListing_AfterTokenCreation(t *testing.T) {
	h, authAgent := newTestHandler(t)

	// Create a token for testuser
	authAgent.NewAutologinToken("testuser")

	req := httptest.NewRequest(http.MethodGet, "/autologin/list?username=testuser", nil)
	rr := httptest.NewRecorder()
	h.HandleUserTokensListing(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
	body := rr.Body.String()
	// Should return a non-empty JSON array
	if body == "[]" || body == "null" {
		t.Errorf("expected at least one token in list, got %q", body)
	}
}
