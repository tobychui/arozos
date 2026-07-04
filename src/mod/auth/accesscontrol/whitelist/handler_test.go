package whitelist

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"path/filepath"
	"strings"
	"testing"

	"imuslab.com/arozos/mod/database"
)

// setupWLTest creates an isolated WhiteList backed by a temp database.
func setupWLTest(t *testing.T) (*WhiteList, func()) {
	t.Helper()
	tmpDir := t.TempDir()
	db, err := database.NewDatabase(filepath.Join(tmpDir, "test.db"), false)
	if err != nil {
		t.Fatalf("failed to create test database: %v", err)
	}
	wl := NewWhitelistManager(db)
	teardown := func() { db.Close() }
	return wl, teardown
}

// postReq builds a POST request with form-encoded body.
func postReq(uri string, params map[string]string) *http.Request {
	form := url.Values{}
	for k, v := range params {
		form.Set(k, v)
	}
	req := httptest.NewRequest(http.MethodPost, uri, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return req
}

// ── HandleAddWhitelistedIP ───────────────────────────────────────────────────

func TestHandleAddWhitelistedIP_MissingParam(t *testing.T) {
	wl, teardown := setupWLTest(t)
	defer teardown()

	req := httptest.NewRequest(http.MethodPost, "/whitelist/add", nil)
	rr := httptest.NewRecorder()
	wl.HandleAddWhitelistedIP(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error response, got: %s", body)
	}
}

func TestHandleAddWhitelistedIP_ValidIP(t *testing.T) {
	wl, teardown := setupWLTest(t)
	defer teardown()
	wl.SetWhitelistEnabled(true)

	req := postReq("/whitelist/add", map[string]string{"iprange": "192.168.50.5"})
	rr := httptest.NewRecorder()
	wl.HandleAddWhitelistedIP(rr, req)

	body := rr.Body.String()
	if strings.Contains(body, "error") {
		t.Errorf("unexpected error: %s", body)
	}
	if !wl.IsWhitelisted("192.168.50.5") {
		t.Error("IP should be whitelisted after HandleAddWhitelistedIP")
	}
}

func TestHandleAddWhitelistedIP_InvalidIP(t *testing.T) {
	wl, teardown := setupWLTest(t)
	defer teardown()

	req := postReq("/whitelist/add", map[string]string{"iprange": "not-an-ip"})
	rr := httptest.NewRecorder()
	wl.HandleAddWhitelistedIP(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error response for invalid IP, got: %s", body)
	}
}

// ── HandleRemoveWhitelistedIP ────────────────────────────────────────────────

func TestHandleRemoveWhitelistedIP_MissingParam(t *testing.T) {
	wl, teardown := setupWLTest(t)
	defer teardown()

	req := httptest.NewRequest(http.MethodPost, "/whitelist/remove", nil)
	rr := httptest.NewRecorder()
	wl.HandleRemoveWhitelistedIP(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error response, got: %s", body)
	}
}

func TestHandleRemoveWhitelistedIP_ValidIP(t *testing.T) {
	wl, teardown := setupWLTest(t)
	defer teardown()
	wl.SetWhitelistEnabled(true)
	wl.SetWhitelist("192.168.50.8")

	req := postReq("/whitelist/remove", map[string]string{"iprange": "192.168.50.8"})
	rr := httptest.NewRecorder()
	wl.HandleRemoveWhitelistedIP(rr, req)

	body := rr.Body.String()
	if strings.Contains(body, "error") {
		t.Errorf("unexpected error: %s", body)
	}
	if wl.IsWhitelisted("192.168.50.8") {
		t.Error("IP should not be whitelisted after HandleRemoveWhitelistedIP")
	}
}

// ── HandleSetWhitelistEnable ─────────────────────────────────────────────────

func TestHandleSetWhitelistEnable_GetStatus(t *testing.T) {
	wl, teardown := setupWLTest(t)
	defer teardown()

	// No 'enable' param --> return current status
	req := httptest.NewRequest(http.MethodPost, "/whitelist/enable", nil)
	rr := httptest.NewRecorder()
	wl.HandleSetWhitelistEnable(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected JSON status response, got empty")
	}
}

func TestHandleSetWhitelistEnable_SetTrue(t *testing.T) {
	wl, teardown := setupWLTest(t)
	defer teardown()
	wl.SetWhitelistEnabled(false)

	req := postReq("/whitelist/enable", map[string]string{"enable": "true"})
	rr := httptest.NewRecorder()
	wl.HandleSetWhitelistEnable(rr, req)

	if !wl.Enabled {
		t.Error("expected whitelist to be enabled")
	}
}

func TestHandleSetWhitelistEnable_SetFalse(t *testing.T) {
	wl, teardown := setupWLTest(t)
	defer teardown()
	wl.SetWhitelistEnabled(true)

	req := postReq("/whitelist/enable", map[string]string{"enable": "false"})
	rr := httptest.NewRecorder()
	wl.HandleSetWhitelistEnable(rr, req)

	if wl.Enabled {
		t.Error("expected whitelist to be disabled")
	}
}

func TestHandleSetWhitelistEnable_InvalidMode(t *testing.T) {
	wl, teardown := setupWLTest(t)
	defer teardown()

	req := postReq("/whitelist/enable", map[string]string{"enable": "maybe"})
	rr := httptest.NewRecorder()
	wl.HandleSetWhitelistEnable(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error response for invalid mode, got: %s", body)
	}
}

// ── HandleListWhitelistedIPs ─────────────────────────────────────────────────

func TestHandleListWhitelistedIPs_Empty(t *testing.T) {
	wl, teardown := setupWLTest(t)
	defer teardown()

	req := httptest.NewRequest(http.MethodGet, "/whitelist/list", nil)
	rr := httptest.NewRecorder()
	wl.HandleListWhitelistedIPs(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected JSON response, got empty body")
	}
}

func TestHandleListWhitelistedIPs_WithEntries(t *testing.T) {
	wl, teardown := setupWLTest(t)
	defer teardown()
	wl.SetWhitelistEnabled(true)
	wl.SetWhitelist("10.0.2.1")

	req := httptest.NewRequest(http.MethodGet, "/whitelist/list", nil)
	rr := httptest.NewRecorder()
	wl.HandleListWhitelistedIPs(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "10.0.2.1") {
		t.Errorf("expected whitelisted IP in list response, got: %s", body)
	}
}

// ── CheckIsWhitelistedByRequest ──────────────────────────────────────────────

func TestCheckIsWhitelistedByRequest_DisabledWhitelist(t *testing.T) {
	wl, teardown := setupWLTest(t)
	defer teardown()
	wl.SetWhitelistEnabled(false)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.50:1234"
	if !wl.CheckIsWhitelistedByRequest(req) {
		t.Error("expected whitelisted when whitelist is disabled")
	}
}

func TestCheckIsWhitelistedByRequest_WhitelistedIP(t *testing.T) {
	wl, teardown := setupWLTest(t)
	defer teardown()
	wl.SetWhitelistEnabled(true)
	wl.SetWhitelist("10.0.0.50")

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.50:1234"
	if !wl.CheckIsWhitelistedByRequest(req) {
		t.Error("expected whitelisted IP to be allowed")
	}
}

func TestCheckIsWhitelistedByRequest_NotWhitelistedIP(t *testing.T) {
	wl, teardown := setupWLTest(t)
	defer teardown()
	wl.SetWhitelistEnabled(true)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.9.99:1234"
	if wl.CheckIsWhitelistedByRequest(req) {
		t.Error("expected non-whitelisted IP to be rejected")
	}
}
