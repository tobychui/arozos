package prouter

import (
	"net"
	"net/http/httptest"
	"testing"
)

func TestIsPrivateSubnet(t *testing.T) {
	// Test case 1: 10.x.x.x range
	ip := net.ParseIP("10.0.0.1")
	if !isPrivateSubnet(ip) {
		t.Error("Test case 1 failed. 10.0.0.1 should be private")
	}

	// Test case 2: 192.168.x.x range
	ip = net.ParseIP("192.168.1.1")
	if !isPrivateSubnet(ip) {
		t.Error("Test case 2 failed. 192.168.1.1 should be private")
	}

	// Test case 3: 172.16.x.x - 172.31.x.x range
	ip = net.ParseIP("172.16.0.1")
	if !isPrivateSubnet(ip) {
		t.Error("Test case 3 failed. 172.16.0.1 should be private")
	}

	ip = net.ParseIP("172.31.255.254")
	if !isPrivateSubnet(ip) {
		t.Error("Test case 3b failed. 172.31.255.254 should be private")
	}

	// Test case 4: Public IP
	ip = net.ParseIP("8.8.8.8")
	if isPrivateSubnet(ip) {
		t.Error("Test case 4 failed. 8.8.8.8 should not be private")
	}

	// Test case 5: Another public IP
	ip = net.ParseIP("1.1.1.1")
	if isPrivateSubnet(ip) {
		t.Error("Test case 5 failed. 1.1.1.1 should not be private")
	}

	// Test case 6: 100.64.x.x range (Carrier-grade NAT)
	ip = net.ParseIP("100.64.0.1")
	if !isPrivateSubnet(ip) {
		t.Error("Test case 6 failed. 100.64.0.1 should be private")
	}

	// Test case 7: 192.0.0.x range
	ip = net.ParseIP("192.0.0.1")
	if !isPrivateSubnet(ip) {
		t.Error("Test case 7 failed. 192.0.0.1 should be private")
	}

	// Test case 8: 198.18.x.x range
	ip = net.ParseIP("198.18.0.1")
	if !isPrivateSubnet(ip) {
		t.Error("Test case 8 failed. 198.18.0.1 should be private")
	}

	// Test case 9: IPv6 (should return false for now)
	ip = net.ParseIP("2001:0db8:85a3:0000:0000:8a2e:0370:7334")
	if isPrivateSubnet(ip) {
		t.Error("Test case 9 failed. IPv6 should return false")
	}

	// Test case 10: Edge of 10.x.x.x range
	ip = net.ParseIP("10.255.255.255")
	if !isPrivateSubnet(ip) {
		t.Error("Test case 10 failed. 10.255.255.255 should be private")
	}

	// Test case 11: Just outside 10.x.x.x range
	ip = net.ParseIP("11.0.0.1")
	if isPrivateSubnet(ip) {
		t.Error("Test case 11 failed. 11.0.0.1 should not be private")
	}

	// Test case 12: Edge of 192.168.x.x range
	ip = net.ParseIP("192.168.255.255")
	if !isPrivateSubnet(ip) {
		t.Error("Test case 12 failed. 192.168.255.255 should be private")
	}

	// Test case 13: Just outside 192.168.x.x range
	ip = net.ParseIP("192.169.0.1")
	if isPrivateSubnet(ip) {
		t.Error("Test case 13 failed. 192.169.0.1 should not be private")
	}
}

func TestInRange(t *testing.T) {
	// Test case 1: IP in range
	r := ipRange{
		start: net.ParseIP("192.168.0.0"),
		end:   net.ParseIP("192.168.255.255"),
	}
	ip := net.ParseIP("192.168.1.1")
	if !inRange(r, ip) {
		t.Error("Test case 1 failed. IP should be in range")
	}

	// Test case 2: IP at start of range
	ip = net.ParseIP("192.168.0.0")
	if !inRange(r, ip) {
		t.Error("Test case 2 failed. IP at start should be in range")
	}

	// Test case 3: IP at end of range (should be excluded)
	ip = net.ParseIP("192.168.255.255")
	if inRange(r, ip) {
		t.Error("Test case 3 failed. IP at end should not be in range")
	}

	// Test case 4: IP below range
	ip = net.ParseIP("192.167.255.255")
	if inRange(r, ip) {
		t.Error("Test case 4 failed. IP below range should not be in range")
	}

	// Test case 5: IP above range
	ip = net.ParseIP("192.169.0.0")
	if inRange(r, ip) {
		t.Error("Test case 5 failed. IP above range should not be in range")
	}

	// Test case 6: Different range (10.x.x.x)
	r2 := ipRange{
		start: net.ParseIP("10.0.0.0"),
		end:   net.ParseIP("10.255.255.255"),
	}
	ip = net.ParseIP("10.123.45.67")
	if !inRange(r2, ip) {
		t.Error("Test case 6 failed. IP should be in 10.x.x.x range")
	}
}

func TestCheckIfLAN(t *testing.T) {
	// Test case 1: Localhost IPv4
	req := httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "127.0.0.1:12345"
	if !checkIfLAN(req) {
		t.Error("Test case 1 failed. 127.0.0.1 should be LAN")
	}

	// Test case 2: Localhost IPv6
	req = httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "[::1]:12345"
	if !checkIfLAN(req) {
		t.Error("Test case 2 failed. ::1 should be LAN")
	}

	// Test case 3: Private IP (192.168.x.x)
	req = httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "192.168.1.100:12345"
	if !checkIfLAN(req) {
		t.Error("Test case 3 failed. 192.168.1.100 should be LAN")
	}

	// Test case 4: Private IP (10.x.x.x)
	req = httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "10.0.0.50:12345"
	if !checkIfLAN(req) {
		t.Error("Test case 4 failed. 10.0.0.50 should be LAN")
	}

	// Test case 5: Public IP
	req = httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "8.8.8.8:12345"
	if checkIfLAN(req) {
		t.Error("Test case 5 failed. 8.8.8.8 should not be LAN")
	}

	// Test case 6: X-Forwarded-For header with private IP
	req = httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-FORWARDED-FOR", "192.168.1.1")
	if !checkIfLAN(req) {
		t.Error("Test case 6 failed. X-Forwarded-For with 192.168.1.1 should be LAN")
	}

	// Test case 7: X-Forwarded-For header with public IP
	req = httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-FORWARDED-FOR", "1.1.1.1")
	if checkIfLAN(req) {
		t.Error("Test case 7 failed. X-Forwarded-For with 1.1.1.1 should not be LAN")
	}

	// Test case 8: X-Real-Ip header with private IP
	req = httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Real-Ip", "172.16.0.1")
	if !checkIfLAN(req) {
		t.Error("Test case 8 failed. X-Real-Ip with 172.16.0.1 should be LAN")
	}

	// Test case 9: X-Real-Ip header with public IP
	req = httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-Real-Ip", "8.8.4.4")
	if checkIfLAN(req) {
		t.Error("Test case 9 failed. X-Real-Ip with 8.8.4.4 should not be LAN")
	}

	// Test case 10: Multiple IPs in X-Forwarded-For, all private
	req = httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-FORWARDED-FOR", "192.168.1.1, 10.0.0.1")
	if !checkIfLAN(req) {
		t.Error("Test case 10 failed. All private IPs should be LAN")
	}

	// Test case 11: Multiple IPs in X-Forwarded-For, one public
	req = httptest.NewRequest("GET", "/", nil)
	req.Header.Set("X-FORWARDED-FOR", "192.168.1.1, 8.8.8.8")
	if checkIfLAN(req) {
		t.Error("Test case 11 failed. Mixed IPs with public IP should not be LAN")
	}

	// Test case 12: Edge case - 172.31.x.x (last of private range)
	req = httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "172.31.255.254:12345"
	if !checkIfLAN(req) {
		t.Error("Test case 12 failed. 172.31.255.254 should be LAN")
	}

	// Test case 13: Edge case - 172.32.x.x (just outside private range)
	req = httptest.NewRequest("GET", "/", nil)
	req.RemoteAddr = "172.32.0.1:12345"
	if checkIfLAN(req) {
		t.Error("Test case 13 failed. 172.32.0.1 should not be LAN")
	}
}
