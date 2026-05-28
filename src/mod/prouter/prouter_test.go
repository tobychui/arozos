package prouter

import (
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

// ── inRange ────────────────────────────────────────────────────────────────────

func TestInRange_Inside(t *testing.T) {
	r := ipRange{
		start: net.ParseIP("192.168.0.0"),
		end:   net.ParseIP("192.168.255.255"),
	}
	if !inRange(r, net.ParseIP("192.168.1.100")) {
		t.Error("expected 192.168.1.100 to be in range 192.168.0.0-192.168.255.255")
	}
}

func TestInRange_Outside(t *testing.T) {
	r := ipRange{
		start: net.ParseIP("192.168.0.0"),
		end:   net.ParseIP("192.168.255.255"),
	}
	if inRange(r, net.ParseIP("10.0.0.1")) {
		t.Error("expected 10.0.0.1 to be outside range 192.168.0.0-192.168.255.255")
	}
}

func TestInRange_StartBoundary(t *testing.T) {
	r := ipRange{
		start: net.ParseIP("10.0.0.0"),
		end:   net.ParseIP("10.255.255.255"),
	}
	if !inRange(r, net.ParseIP("10.0.0.0")) {
		t.Error("expected start of range to be included")
	}
}

// ── isPrivateSubnet ────────────────────────────────────────────────────────────

func TestIsPrivateSubnet_RFC1918_10(t *testing.T) {
	if !isPrivateSubnet(net.ParseIP("10.10.10.10")) {
		t.Error("10.10.10.10 should be private (10.0.0.0/8)")
	}
}

func TestIsPrivateSubnet_RFC1918_172(t *testing.T) {
	if !isPrivateSubnet(net.ParseIP("172.16.5.1")) {
		t.Error("172.16.5.1 should be private (172.16.0.0/12)")
	}
}

func TestIsPrivateSubnet_RFC1918_192_168(t *testing.T) {
	if !isPrivateSubnet(net.ParseIP("192.168.100.50")) {
		t.Error("192.168.100.50 should be private (192.168.0.0/16)")
	}
}

func TestIsPrivateSubnet_Public(t *testing.T) {
	if isPrivateSubnet(net.ParseIP("8.8.8.8")) {
		t.Error("8.8.8.8 should not be private")
	}
}

func TestIsPrivateSubnet_Public2(t *testing.T) {
	if isPrivateSubnet(net.ParseIP("1.1.1.1")) {
		t.Error("1.1.1.1 should not be private")
	}
}

// ── checkIfLAN ─────────────────────────────────────────────────────────────────

func TestCheckIfLAN_Loopback127(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "127.0.0.1:8080"
	if !checkIfLAN(req) {
		t.Error("expected 127.0.0.1 to be considered LAN")
	}
}

func TestCheckIfLAN_Loopback_IPv6(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "[::1]:8080"
	if !checkIfLAN(req) {
		t.Error("expected ::1 to be considered LAN")
	}
}

func TestCheckIfLAN_PrivateIP(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.168.1.50:12345"
	if !checkIfLAN(req) {
		t.Error("expected 192.168.1.50 to be considered LAN")
	}
}

func TestCheckIfLAN_PublicIP(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "8.8.8.8:12345"
	if checkIfLAN(req) {
		t.Error("expected 8.8.8.8 to NOT be considered LAN")
	}
}

func TestCheckIfLAN_XForwardedFor_Private(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-FORWARDED-FOR", "10.0.0.5")
	if !checkIfLAN(req) {
		t.Error("expected private X-Forwarded-For IP to be LAN")
	}
}

func TestCheckIfLAN_XForwardedFor_Public(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-FORWARDED-FOR", "203.0.113.1")
	if checkIfLAN(req) {
		t.Error("expected public X-Forwarded-For IP to NOT be LAN")
	}
}

func TestCheckIfLAN_XRealIP_Private(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("X-Real-Ip", "172.16.0.1")
	if !checkIfLAN(req) {
		t.Error("expected private X-Real-Ip to be LAN")
	}
}

// ── NewModuleRouter ────────────────────────────────────────────────────────────

func TestNewModuleRouter_Basic(t *testing.T) {
	option := RouterOption{
		ModuleName: "test-module",
		AdminOnly:  false,
		RequireLAN: false,
		// UserHandler and DeniedHandler left nil — not called in constructor
	}
	router := NewModuleRouter(option)
	if router == nil {
		t.Fatal("NewModuleRouter returned nil")
	}
	if router.moduleUUID != "test-module" {
		t.Errorf("expected moduleUUID='test-module', got %q", router.moduleUUID)
	}
	if router.adminOnly {
		t.Error("expected adminOnly=false")
	}
	if router.requireLAN {
		t.Error("expected requireLAN=false")
	}
	if router.endpoints == nil {
		t.Error("endpoints map should be initialized")
	}
	if len(router.endpoints) != 0 {
		t.Errorf("expected 0 endpoints initially, got %d", len(router.endpoints))
	}
}

func TestNewModuleRouter_AdminOnly(t *testing.T) {
	option := RouterOption{
		ModuleName: "admin-module",
		AdminOnly:  true,
	}
	router := NewModuleRouter(option)
	if !router.adminOnly {
		t.Error("expected adminOnly=true")
	}
}

func TestNewModuleRouter_RequireLAN(t *testing.T) {
	option := RouterOption{
		ModuleName: "lan-module",
		RequireLAN: true,
	}
	router := NewModuleRouter(option)
	if !router.requireLAN {
		t.Error("expected requireLAN=true")
	}
}

// ── RouterOption struct ────────────────────────────────────────────────────────

func TestRouterOption_Fields(t *testing.T) {
	option := RouterOption{
		ModuleName:   "my-module",
		AdminOnly:    true,
		RequireLAN:   true,
		RequireCSRFT: false,
	}
	if option.ModuleName != "my-module" {
		t.Errorf("unexpected ModuleName: %s", option.ModuleName)
	}
	if !option.AdminOnly {
		t.Error("expected AdminOnly=true")
	}
	if !option.RequireLAN {
		t.Error("expected RequireLAN=true")
	}
}

// ── privateRanges ──────────────────────────────────────────────────────────────

func TestPrivateRanges_NonEmpty(t *testing.T) {
	if len(privateRanges) == 0 {
		t.Error("privateRanges should not be empty")
	}
}

func TestPrivateRanges_Contains10Block(t *testing.T) {
	found := false
	for _, r := range privateRanges {
		if r.start.String() == "10.0.0.0" {
			found = true
			break
		}
	}
	if !found {
		t.Error("privateRanges should contain the 10.0.0.0/8 range")
	}
}

// TestHandleFunc_DuplicateEndpoint verifies that registering the same endpoint
// twice returns an error on the second call (before the UserHandler is accessed).
func TestHandleFunc_DuplicateEndpoint(t *testing.T) {
	router := NewModuleRouter(RouterOption{ModuleName: "dup-module"})
	// Pre-populate the endpoints map directly (we're in the same package).
	dummyHandler := func(w http.ResponseWriter, r *http.Request) {}
	router.endpoints["/test/dup"] = dummyHandler

	err := router.HandleFunc("/test/dup", dummyHandler)
	if err == nil {
		t.Error("expected error for duplicate endpoint registration, got nil")
	}
	if err.Error() != "Endpoint register duplicated" {
		t.Errorf("unexpected error message: %q", err.Error())
	}
}
