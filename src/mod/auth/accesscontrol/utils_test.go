package accesscontrol

import (
	"testing"
)

func TestBreakdownIpRange(t *testing.T) {
	// Test case 1: Single IP
	result := BreakdownIpRange("192.168.1.1")
	if len(result) != 1 || result[0] != "192.168.1.1" {
		t.Error("Expected breakdown result: [192.168.1.1]")
	}

	// Test case 2: IP range
	result = BreakdownIpRange("192.168.1.1-192.168.1.5")
	expected := []string{"192.168.1.1", "192.168.1.2", "192.168.1.3", "192.168.1.4", "192.168.1.5"}
	if !isEqual(result, expected) {
		t.Error("Expected breakdown result:", expected)
	}

	// Test case 3: Invalid IP range
	result = BreakdownIpRange("invalid-ip-range")
	if len(result) != 0 {
		t.Error("Expected empty breakdown result")
	}

	// Test case 4: Range with spaces
	result = BreakdownIpRange("192.168.1.1 - 192.168.1.3")
	if len(result) != 3 {
		t.Errorf("Expected 3 IPs, got %d", len(result))
	}

	// Test case 5: Large range
	result = BreakdownIpRange("10.0.0.1-10.0.0.10")
	if len(result) != 10 {
		t.Errorf("Expected 10 IPs, got %d", len(result))
	}

	// Test case 6: Range ending at .254
	result = BreakdownIpRange("192.168.1.250-192.168.1.254")
	if len(result) != 5 {
		t.Errorf("Expected 5 IPs, got %d", len(result))
	}

	// Test case 7: Consecutive IPs
	result = BreakdownIpRange("172.16.0.1-172.16.0.2")
	if len(result) != 2 {
		t.Errorf("Expected 2 IPs, got %d", len(result))
	}

	// Test case 8: Empty string
	result = BreakdownIpRange("")
	if len(result) != 0 {
		t.Error("Expected empty for empty string")
	}

	// Test case 9: Range with same start and end (invalid)
	result = BreakdownIpRange("192.168.1.5-192.168.1.5")
	if len(result) != 0 {
		t.Error("Expected empty for invalid range (start == end)")
	}

	// Test case 10: Reversed range (invalid)
	result = BreakdownIpRange("192.168.1.10-192.168.1.1")
	if len(result) != 0 {
		t.Error("Expected empty for reversed range")
	}
}

func TestIpInRange(t *testing.T) {
	// Test case 1: IP in range
	result := IpInRange("192.168.1.3", "192.168.1.1-192.168.1.5")
	if !result {
		t.Error("Expected true for IP in range")
	}

	// Test case 2: IP not in range
	result = IpInRange("192.168.2.1", "192.168.1.1-192.168.1.5")
	if result {
		t.Error("Expected false for IP not in range")
	}

	// Test case 3: IP in single IP range
	result = IpInRange("192.168.1.1", "192.168.1.1")
	if !result {
		t.Error("Expected true for IP in single IP range")
	}

	// Test case 4: IP not in single IP range
	result = IpInRange("192.168.1.2", "192.168.1.1")
	if result {
		t.Error("Expected false for IP not in single IP range")
	}

	// Test case 5: IP at start of range
	result = IpInRange("192.168.1.1", "192.168.1.1-192.168.1.10")
	if !result {
		t.Error("Expected true for IP at start of range")
	}

	// Test case 6: IP at end of range
	result = IpInRange("192.168.1.10", "192.168.1.1-192.168.1.10")
	if !result {
		t.Error("Expected true for IP at end of range")
	}

	// Test case 7: IP below range
	result = IpInRange("192.168.1.0", "192.168.1.1-192.168.1.10")
	if result {
		t.Error("Expected false for IP below range")
	}

	// Test case 8: IP above range
	result = IpInRange("192.168.1.11", "192.168.1.1-192.168.1.10")
	if result {
		t.Error("Expected false for IP above range")
	}

	// Test case 9: IP with spaces
	result = IpInRange("  192.168.1.5  ", "192.168.1.1-192.168.1.10")
	if !result {
		t.Error("Expected true for IP with spaces")
	}

	// Test case 10: Range with spaces
	result = IpInRange("192.168.1.5", "192.168.1.1 - 192.168.1.10")
	if !result {
		t.Error("Expected true for range with spaces")
	}

	// Test case 11: Invalid IP format
	result = IpInRange("not-an-ip", "192.168.1.1-192.168.1.10")
	if result {
		t.Error("Expected false for invalid IP")
	}

	// Test case 12: Empty IP
	result = IpInRange("", "192.168.1.1-192.168.1.10")
	if result {
		t.Error("Expected false for empty IP")
	}

	// Test case 13: Localhost
	result = IpInRange("127.0.0.1", "127.0.0.1")
	if !result {
		t.Error("Expected true for localhost matching itself")
	}
}

func TestValidateIpRange(t *testing.T) {
	// Test case 1: Valid single IP
	err := ValidateIpRange("192.168.1.1")
	if err != nil {
		t.Error("Expected no error for valid single IP")
	}

	// Test case 2: Valid IP range
	err = ValidateIpRange("192.168.1.1-192.168.1.5")
	if err != nil {
		t.Error("Expected no error for valid IP range")
	}

	// Test case 3: Invalid IP range - Starting IP is larger or equal to ending IP
	err = ValidateIpRange("192.168.1.5-192.168.1.1")
	if err == nil {
		t.Error("Expected error for invalid IP range")
	}

	// Test case 4: Invalid IP range - Subnet mismatch
	err = ValidateIpRange("192.168.1.1-192.168.2.5")
	if err == nil {
		t.Error("Expected error for invalid IP range")
	}

	// Test case 5: Invalid single IP
	err = ValidateIpRange("invalid-ip")
	if err == nil {
		t.Error("Expected error for invalid single IP")
	}

	// Test case 6: Multiple dashes in range
	err = ValidateIpRange("192.168.1.1-192.168.1.5-192.168.1.10")
	if err == nil {
		t.Error("Expected error for multiple dashes")
	}

	// Test case 7: Invalid starting IP
	err = ValidateIpRange("999.999.999.999-192.168.1.10")
	if err == nil {
		t.Error("Expected error for invalid starting IP")
	}

	// Test case 8: Invalid ending IP
	err = ValidateIpRange("192.168.1.1-999.999.999.999")
	if err == nil {
		t.Error("Expected error for invalid ending IP")
	}

	// Test case 9: Empty string
	err = ValidateIpRange("")
	if err == nil {
		t.Error("Expected error for empty string")
	}

	// Test case 10: IP range with spaces (should be handled)
	err = ValidateIpRange("192.168.1.1 - 192.168.1.10")
	if err != nil {
		t.Errorf("Expected no error for IP range with spaces, got %v", err)
	}

	// Test case 11: Localhost
	err = ValidateIpRange("127.0.0.1")
	if err != nil {
		t.Error("Expected no error for localhost")
	}

	// Test case 12: Valid large range
	err = ValidateIpRange("10.0.0.1-10.0.0.254")
	if err != nil {
		t.Error("Expected no error for large valid range")
	}

	// Test case 13: Equal start and end IPs
	err = ValidateIpRange("192.168.1.5-192.168.1.5")
	if err == nil {
		t.Error("Expected error when start IP equals end IP")
	}

	// Test case 14: Range with whitespace around IP
	err = ValidateIpRange("  192.168.1.1-192.168.1.10  ")
	if err != nil {
		t.Error("Expected no error for range with surrounding whitespace")
	}

	// Test case 15: Range in 172.16.x.x subnet
	err = ValidateIpRange("172.16.0.1-172.16.0.100")
	if err != nil {
		t.Error("Expected no error for valid 172.16.x.x range")
	}
}

func isEqual(slice1, slice2 []string) bool {
	if len(slice1) != len(slice2) {
		return false
	}
	for i := range slice1 {
		if slice1[i] != slice2[i] {
			return false
		}
	}
	return true
}
