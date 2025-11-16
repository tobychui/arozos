package network

import (
	"net"
	"net/http/httptest"
	"testing"
)

func TestIsPublicIP(t *testing.T) {
	// Test case 1: Public IP (Google DNS)
	publicIP := net.ParseIP("8.8.8.8")
	if !IsPublicIP(publicIP) {
		t.Error("Test case 1 failed. 8.8.8.8 should be public")
	}

	// Test case 2: Private IP 10.0.0.1
	privateIP1 := net.ParseIP("10.0.0.1")
	if IsPublicIP(privateIP1) {
		t.Error("Test case 2 failed. 10.0.0.1 should be private")
	}

	// Test case 3: Private IP 192.168.1.1
	privateIP2 := net.ParseIP("192.168.1.1")
	if IsPublicIP(privateIP2) {
		t.Error("Test case 3 failed. 192.168.1.1 should be private")
	}

	// Test case 4: Private IP 172.16.0.1
	privateIP3 := net.ParseIP("172.16.0.1")
	if IsPublicIP(privateIP3) {
		t.Error("Test case 4 failed. 172.16.0.1 should be private")
	}

	// Test case 5: Loopback 127.0.0.1
	loopback := net.ParseIP("127.0.0.1")
	if IsPublicIP(loopback) {
		t.Error("Test case 5 failed. 127.0.0.1 should not be public")
	}

	// Test case 6: Private IP 172.31.255.255 (end of range)
	privateIP4 := net.ParseIP("172.31.255.255")
	if IsPublicIP(privateIP4) {
		t.Error("Test case 6 failed. 172.31.255.255 should be private")
	}

	// Test case 7: Public IP 172.32.0.1 (just outside private range)
	publicIP2 := net.ParseIP("172.32.0.1")
	if !IsPublicIP(publicIP2) {
		t.Error("Test case 7 failed. 172.32.0.1 should be public")
	}

	// Test case 8: Public IP 1.1.1.1 (Cloudflare DNS)
	publicIP3 := net.ParseIP("1.1.1.1")
	if !IsPublicIP(publicIP3) {
		t.Error("Test case 8 failed. 1.1.1.1 should be public")
	}

	// Test case 9: Private IP 10.255.255.255 (end of 10.x range)
	privateIP5 := net.ParseIP("10.255.255.255")
	if IsPublicIP(privateIP5) {
		t.Error("Test case 9 failed. 10.255.255.255 should be private")
	}

	// Test case 10: Private IP 192.168.0.1
	privateIP6 := net.ParseIP("192.168.0.1")
	if IsPublicIP(privateIP6) {
		t.Error("Test case 10 failed. 192.168.0.1 should be private")
	}

	// Test case 11: IPv6 loopback
	ipv6Loopback := net.ParseIP("::1")
	if IsPublicIP(ipv6Loopback) {
		t.Error("Test case 11 failed. IPv6 loopback should not be public")
	}

	// Test case 12: IPv6 address (general)
	ipv6 := net.ParseIP("2001:4860:4860::8888")
	result := IsPublicIP(ipv6)
	t.Logf("Test case 12: IPv6 address 2001:4860:4860::8888 is public: %v", result)

	// Test case 13: Boundary test - 172.15.255.255 (just before private range)
	publicIP4 := net.ParseIP("172.15.255.255")
	if !IsPublicIP(publicIP4) {
		t.Error("Test case 13 failed. 172.15.255.255 should be public")
	}
}

func TestIsIPv6Addr(t *testing.T) {
	// Test case 1: Valid IPv6 address
	isV6, err := IsIPv6Addr("2001:db8::1")
	if err != nil {
		t.Errorf("Test case 1 failed. Unexpected error: %v", err)
	}
	if !isV6 {
		t.Error("Test case 1 failed. Expected true for IPv6 address")
	}

	// Test case 2: Valid IPv4 address
	isV6, err = IsIPv6Addr("192.168.1.1")
	if err != nil {
		t.Errorf("Test case 2 failed. Unexpected error: %v", err)
	}
	if isV6 {
		t.Error("Test case 2 failed. Expected false for IPv4 address")
	}

	// Test case 3: Invalid IP address
	isV6, err = IsIPv6Addr("not-an-ip")
	if err == nil {
		t.Error("Test case 3 failed. Expected error for invalid IP")
	}
	if isV6 {
		t.Error("Test case 3 failed. Expected false for invalid IP")
	}

	// Test case 4: IPv6 loopback
	isV6, err = IsIPv6Addr("::1")
	if err != nil {
		t.Errorf("Test case 4 failed. Unexpected error: %v", err)
	}
	if !isV6 {
		t.Error("Test case 4 failed. Expected true for IPv6 loopback")
	}

	// Test case 5: IPv4 loopback
	isV6, err = IsIPv6Addr("127.0.0.1")
	if err != nil {
		t.Errorf("Test case 5 failed. Unexpected error: %v", err)
	}
	if isV6 {
		t.Error("Test case 5 failed. Expected false for IPv4 loopback")
	}

	// Test case 6: IPv6 address with :: notation
	isV6, err = IsIPv6Addr("fe80::1")
	if err != nil {
		t.Errorf("Test case 6 failed. Unexpected error: %v", err)
	}
	if !isV6 {
		t.Error("Test case 6 failed. Expected true for IPv6 link-local")
	}

	// Test case 7: Full IPv6 address
	isV6, err = IsIPv6Addr("2001:0db8:0000:0000:0000:0000:0000:0001")
	if err != nil {
		t.Errorf("Test case 7 failed. Unexpected error: %v", err)
	}
	if !isV6 {
		t.Error("Test case 7 failed. Expected true for full IPv6 address")
	}

	// Test case 8: Empty string
	isV6, err = IsIPv6Addr("")
	if err == nil {
		t.Error("Test case 8 failed. Expected error for empty string")
	}

	// Test case 9: IPv4-mapped IPv6 address
	isV6, err = IsIPv6Addr("::ffff:192.168.1.1")
	if err != nil {
		t.Errorf("Test case 9 failed. Unexpected error: %v", err)
	}
	if !isV6 {
		t.Error("Test case 9 failed. Expected true for IPv4-mapped IPv6")
	}

	// Test case 10: IPv6 all zeros
	isV6, err = IsIPv6Addr("::")
	if err != nil {
		t.Errorf("Test case 10 failed. Unexpected error: %v", err)
	}
	if !isV6 {
		t.Error("Test case 10 failed. Expected true for IPv6 all zeros")
	}
}

func TestGetIpFromRequest(t *testing.T) {
	// Test case 1: IP from X-REAL-IP header
	req := httptest.NewRequest("GET", "http://example.com", nil)
	req.Header.Set("X-REAL-IP", "1.2.3.4")
	ip, err := GetIpFromRequest(req)
	if err != nil {
		t.Errorf("Test case 1 failed. Unexpected error: %v", err)
	}
	if ip != "1.2.3.4" {
		t.Errorf("Test case 1 failed. Expected 1.2.3.4, got %s", ip)
	}

	// Test case 2: IP from X-FORWARDED-FOR header
	req = httptest.NewRequest("GET", "http://example.com", nil)
	req.Header.Set("X-FORWARDED-FOR", "5.6.7.8, 9.10.11.12")
	ip, err = GetIpFromRequest(req)
	if err != nil {
		t.Errorf("Test case 2 failed. Unexpected error: %v", err)
	}
	if ip != "5.6.7.8" {
		t.Errorf("Test case 2 failed. Expected first IP 5.6.7.8, got %s", ip)
	}

	// Test case 3: IP from RemoteAddr
	req = httptest.NewRequest("GET", "http://example.com", nil)
	req.RemoteAddr = "192.168.1.100:12345"
	ip, err = GetIpFromRequest(req)
	if err != nil {
		t.Errorf("Test case 3 failed. Unexpected error: %v", err)
	}
	if ip != "192.168.1.100" {
		t.Errorf("Test case 3 failed. Expected 192.168.1.100, got %s", ip)
	}

	// Test case 4: X-REAL-IP takes precedence over X-FORWARDED-FOR
	req = httptest.NewRequest("GET", "http://example.com", nil)
	req.Header.Set("X-REAL-IP", "1.1.1.1")
	req.Header.Set("X-FORWARDED-FOR", "2.2.2.2")
	ip, err = GetIpFromRequest(req)
	if err != nil {
		t.Errorf("Test case 4 failed. Unexpected error: %v", err)
	}
	if ip != "1.1.1.1" {
		t.Errorf("Test case 4 failed. Expected X-REAL-IP to take precedence, got %s", ip)
	}

	// Test case 5: Invalid X-REAL-IP, fallback to X-FORWARDED-FOR
	req = httptest.NewRequest("GET", "http://example.com", nil)
	req.Header.Set("X-REAL-IP", "invalid-ip")
	req.Header.Set("X-FORWARDED-FOR", "3.3.3.3")
	ip, err = GetIpFromRequest(req)
	if err != nil {
		t.Errorf("Test case 5 failed. Unexpected error: %v", err)
	}
	if ip != "3.3.3.3" {
		t.Errorf("Test case 5 failed. Expected fallback to X-FORWARDED-FOR, got %s", ip)
	}

	// Test case 6: IPv6 address in RemoteAddr
	req = httptest.NewRequest("GET", "http://example.com", nil)
	req.RemoteAddr = "[::1]:8080"
	ip, err = GetIpFromRequest(req)
	if err != nil {
		t.Errorf("Test case 6 failed. Unexpected error: %v", err)
	}
	if ip != "::1" {
		t.Errorf("Test case 6 failed. Expected ::1, got %s", ip)
	}

	// Test case 7: Multiple IPs in X-FORWARDED-FOR
	req = httptest.NewRequest("GET", "http://example.com", nil)
	req.Header.Set("X-FORWARDED-FOR", "4.4.4.4, 5.5.5.5, 6.6.6.6")
	ip, err = GetIpFromRequest(req)
	if err != nil {
		t.Errorf("Test case 7 failed. Unexpected error: %v", err)
	}
	if ip != "4.4.4.4" {
		t.Errorf("Test case 7 failed. Expected first IP in chain, got %s", ip)
	}

	// Test case 8: No headers, only RemoteAddr
	req = httptest.NewRequest("GET", "http://example.com", nil)
	req.RemoteAddr = "10.0.0.1:9999"
	ip, err = GetIpFromRequest(req)
	if err != nil {
		t.Errorf("Test case 8 failed. Unexpected error: %v", err)
	}
	if ip != "10.0.0.1" {
		t.Errorf("Test case 8 failed. Expected 10.0.0.1, got %s", ip)
	}

	// Test case 9: Invalid RemoteAddr format
	req = httptest.NewRequest("GET", "http://example.com", nil)
	req.RemoteAddr = "invalid-addr"
	_, err = GetIpFromRequest(req)
	if err == nil {
		t.Error("Test case 9 failed. Expected error for invalid RemoteAddr")
	}

	// Test case 10: Empty X-FORWARDED-FOR with invalid entries
	req = httptest.NewRequest("GET", "http://example.com", nil)
	req.Header.Set("X-FORWARDED-FOR", "not-ip, also-not-ip")
	req.RemoteAddr = "7.7.7.7:80"
	ip, err = GetIpFromRequest(req)
	if err != nil {
		t.Errorf("Test case 10 failed. Should fallback to RemoteAddr, got error: %v", err)
	}
	if ip != "7.7.7.7" {
		t.Errorf("Test case 10 failed. Expected fallback to RemoteAddr 7.7.7.7, got %s", ip)
	}
}

func TestGetOutboundIP(t *testing.T) {
	// Test case 1: GetOutboundIP should return valid IP
	ip, err := GetOutboundIP()
	if err != nil {
		t.Logf("Test case 1: GetOutboundIP returned error (may be expected in test environment): %v", err)
	} else {
		if ip == nil {
			t.Error("Test case 1 failed. IP should not be nil")
		}
		if ip.To4() == nil && ip.To16() == nil {
			t.Error("Test case 1 failed. IP should be either IPv4 or IPv6")
		}
		t.Logf("Test case 1: Outbound IP is %s", ip.String())
	}

	// Test case 2: Returned IP should not be nil if no error
	if err == nil && ip == nil {
		t.Error("Test case 2 failed. If no error, IP should not be nil")
	}

	// Test case 3: If successful, verify IP format
	if err == nil {
		ipStr := ip.String()
		if ipStr == "" {
			t.Error("Test case 3 failed. IP string should not be empty")
		}
	}
}
