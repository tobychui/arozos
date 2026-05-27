package autologin

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

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
