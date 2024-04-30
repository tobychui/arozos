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
