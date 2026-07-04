package blacklist

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
)

// newBLWithDB returns a BlackList instance backed by a temp database.
func newBLWithDB(t *testing.T) (*BlackList, func()) {
	t.Helper()
	bl, teardown := setupTest(t)
	return bl, teardown
}

// postRequest builds a POST request with form-encoded body.
func postRequest(uri string, params map[string]string) *http.Request {
	form := url.Values{}
	for k, v := range params {
		form.Set(k, v)
	}
	req := httptest.NewRequest(http.MethodPost, uri, strings.NewReader(form.Encode()))
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	return req
}

// ── HandleAddBannedIP ─────────────────────────────────────────────────────────

func TestHandleAddBannedIP_MissingParam(t *testing.T) {
	bl, teardown := newBLWithDB(t)
	defer teardown()

	req := httptest.NewRequest(http.MethodPost, "/blacklist/add", nil)
	rr := httptest.NewRecorder()
	bl.HandleAddBannedIP(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error response, got: %s", body)
	}
}

func TestHandleAddBannedIP_ValidIP(t *testing.T) {
	bl, teardown := newBLWithDB(t)
	defer teardown()

	req := postRequest("/blacklist/add", map[string]string{"iprange": "10.0.0.5"})
	rr := httptest.NewRecorder()
	bl.HandleAddBannedIP(rr, req)

	body := rr.Body.String()
	if strings.Contains(body, "error") {
		t.Errorf("unexpected error: %s", body)
	}
	if !bl.IsBanned("10.0.0.5") {
		t.Error("IP should be banned after HandleAddBannedIP")
	}
}

func TestHandleAddBannedIP_InvalidIP(t *testing.T) {
	bl, teardown := newBLWithDB(t)
	defer teardown()

	req := postRequest("/blacklist/add", map[string]string{"iprange": "not-an-ip"})
	rr := httptest.NewRecorder()
	bl.HandleAddBannedIP(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error response for invalid IP, got: %s", body)
	}
}

// ── HandleRemoveBannedIP ─────────────────────────────────────────────────────

func TestHandleRemoveBannedIP_MissingParam(t *testing.T) {
	bl, teardown := newBLWithDB(t)
	defer teardown()

	req := httptest.NewRequest(http.MethodPost, "/blacklist/remove", nil)
	rr := httptest.NewRecorder()
	bl.HandleRemoveBannedIP(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error response, got: %s", body)
	}
}

func TestHandleRemoveBannedIP_ValidIP(t *testing.T) {
	bl, teardown := newBLWithDB(t)
	defer teardown()

	// First ban an IP
	bl.Ban("10.0.0.7")

	req := postRequest("/blacklist/remove", map[string]string{"iprange": "10.0.0.7"})
	rr := httptest.NewRecorder()
	bl.HandleRemoveBannedIP(rr, req)

	body := rr.Body.String()
	if strings.Contains(body, "error") {
		t.Errorf("unexpected error: %s", body)
	}
	if bl.IsBanned("10.0.0.7") {
		t.Error("IP should be unbanned after HandleRemoveBannedIP")
	}
}

// ── HandleSetBlacklistEnable ─────────────────────────────────────────────────

func TestHandleSetBlacklistEnable_GetStatus(t *testing.T) {
	bl, teardown := newBLWithDB(t)
	defer teardown()

	// No 'enable' param --> return current status
	req := httptest.NewRequest(http.MethodPost, "/blacklist/enable", nil)
	rr := httptest.NewRecorder()
	bl.HandleSetBlacklistEnable(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected status JSON, got empty response")
	}
}

func TestHandleSetBlacklistEnable_EnableTrue(t *testing.T) {
	bl, teardown := newBLWithDB(t)
	defer teardown()
	bl.SetBlacklistEnabled(false)

	req := postRequest("/blacklist/enable", map[string]string{"enable": "true"})
	rr := httptest.NewRecorder()
	bl.HandleSetBlacklistEnable(rr, req)

	if !bl.Enabled {
		t.Error("expected blacklist to be enabled after HandleSetBlacklistEnable(true)")
	}
}

func TestHandleSetBlacklistEnable_EnableFalse(t *testing.T) {
	bl, teardown := newBLWithDB(t)
	defer teardown()
	bl.SetBlacklistEnabled(true)

	req := postRequest("/blacklist/enable", map[string]string{"enable": "false"})
	rr := httptest.NewRecorder()
	bl.HandleSetBlacklistEnable(rr, req)

	if bl.Enabled {
		t.Error("expected blacklist to be disabled after HandleSetBlacklistEnable(false)")
	}
}

func TestHandleSetBlacklistEnable_InvalidMode(t *testing.T) {
	bl, teardown := newBLWithDB(t)
	defer teardown()

	req := postRequest("/blacklist/enable", map[string]string{"enable": "maybe"})
	rr := httptest.NewRecorder()
	bl.HandleSetBlacklistEnable(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "error") {
		t.Errorf("expected error response for invalid mode, got: %s", body)
	}
}

// ── HandleListBannedIPs ──────────────────────────────────────────────────────

func TestHandleListBannedIPs_Empty(t *testing.T) {
	bl, teardown := newBLWithDB(t)
	defer teardown()

	req := httptest.NewRequest(http.MethodGet, "/blacklist/list", nil)
	rr := httptest.NewRecorder()
	bl.HandleListBannedIPs(rr, req)

	body := rr.Body.String()
	if body == "" {
		t.Error("expected JSON response, got empty body")
	}
}

func TestHandleListBannedIPs_WithEntries(t *testing.T) {
	bl, teardown := newBLWithDB(t)
	defer teardown()
	bl.Ban("10.0.1.1")
	bl.Ban("10.0.1.2")

	req := httptest.NewRequest(http.MethodGet, "/blacklist/list", nil)
	rr := httptest.NewRecorder()
	bl.HandleListBannedIPs(rr, req)

	body := rr.Body.String()
	if !strings.Contains(body, "10.0.1.1") {
		t.Errorf("expected banned IP in list response, got: %s", body)
	}
}

// ── CheckIsBannedByRequest ───────────────────────────────────────────────────

func TestCheckIsBannedByRequest_DisabledBlacklist(t *testing.T) {
	bl, teardown := newBLWithDB(t)
	defer teardown()
	bl.SetBlacklistEnabled(false)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.99:1234"
	if bl.CheckIsBannedByRequest(req) {
		t.Error("expected not banned when blacklist is disabled")
	}
}

func TestCheckIsBannedByRequest_BannedIP(t *testing.T) {
	bl, teardown := newBLWithDB(t)
	defer teardown()
	bl.SetBlacklistEnabled(true)
	bl.Ban("10.0.0.99")

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.99:1234"
	if !bl.CheckIsBannedByRequest(req) {
		t.Error("expected banned IP to be detected in request")
	}
}

func TestCheckIsBannedByRequest_NotBannedIP(t *testing.T) {
	bl, teardown := newBLWithDB(t)
	defer teardown()
	bl.SetBlacklistEnabled(true)

	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "10.0.0.55:1234"
	if bl.CheckIsBannedByRequest(req) {
		t.Error("expected non-banned IP to not be detected")
	}
}
