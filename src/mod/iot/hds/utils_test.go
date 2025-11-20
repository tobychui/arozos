package hds

import (
	"strings"
	"testing"
)

func TestIsJSON(t *testing.T) {
	// Test case 1: Valid JSON object
	validJSON := `{"name": "test", "value": 123}`
	if !isJSON(validJSON) {
		t.Error("Test case 1 failed. Valid JSON should return true")
	}

	// Test case 2: Valid empty JSON object
	emptyJSON := `{}`
	if !isJSON(emptyJSON) {
		t.Error("Test case 2 failed. Empty JSON object should return true")
	}

	// Test case 3: Valid nested JSON
	nestedJSON := `{"outer": {"inner": "value"}}`
	if !isJSON(nestedJSON) {
		t.Error("Test case 3 failed. Nested JSON should return true")
	}

	// Test case 4: Invalid JSON - missing closing brace
	invalidJSON1 := `{"name": "test"`
	if isJSON(invalidJSON1) {
		t.Error("Test case 4 failed. Invalid JSON should return false")
	}

	// Test case 5: Invalid JSON - plain string
	plainString := `not a json`
	if isJSON(plainString) {
		t.Error("Test case 5 failed. Plain string should return false")
	}

	// Test case 6: Empty string
	emptyString := ``
	if isJSON(emptyString) {
		t.Error("Test case 6 failed. Empty string should return false")
	}

	// Test case 7: Invalid JSON - single value (not an object)
	singleValue := `123`
	if isJSON(singleValue) {
		t.Error("Test case 7 failed. Single value should return false (expects object)")
	}

	// Test case 8: Valid JSON with array value
	jsonWithArray := `{"items": [1, 2, 3]}`
	if !isJSON(jsonWithArray) {
		t.Error("Test case 8 failed. JSON with array should return true")
	}

	// Test case 9: Valid JSON with null value
	jsonWithNull := `{"value": null}`
	if !isJSON(jsonWithNull) {
		t.Error("Test case 9 failed. JSON with null should return true")
	}

	// Test case 10: Valid JSON with boolean
	jsonWithBool := `{"enabled": true, "disabled": false}`
	if !isJSON(jsonWithBool) {
		t.Error("Test case 10 failed. JSON with boolean should return true")
	}

	// Test case 11: Invalid JSON - trailing comma
	jsonTrailingComma := `{"name": "test",}`
	if isJSON(jsonTrailingComma) {
		t.Error("Test case 11 failed. JSON with trailing comma should return false")
	}

	// Test case 12: Valid JSON with special characters
	jsonSpecialChars := `{"message": "Hello \"World\""}`
	if !isJSON(jsonSpecialChars) {
		t.Error("Test case 12 failed. JSON with escaped quotes should return true")
	}

	// Test case 13: Invalid JSON - single quotes
	jsonSingleQuotes := `{'name': 'test'}`
	if isJSON(jsonSingleQuotes) {
		t.Error("Test case 13 failed. JSON with single quotes should return false")
	}

	// Test case 14: Valid JSON with numbers
	jsonNumbers := `{"int": 42, "float": 3.14, "negative": -10}`
	if !isJSON(jsonNumbers) {
		t.Error("Test case 14 failed. JSON with various numbers should return true")
	}

	// Test case 15: Invalid JSON - unclosed string
	jsonUnclosedString := `{"name": "test}`
	if isJSON(jsonUnclosedString) {
		t.Error("Test case 15 failed. JSON with unclosed string should return false")
	}
}

func TestGetLocalIP(t *testing.T) {
	// Test case 1: Function should return a string
	ip := getLocalIP()

	// The function should return either:
	// - A valid IPv4 address (e.g., "192.168.1.1")
	// - An empty string if no non-loopback IPv4 address is found

	if ip != "" {
		// If an IP is returned, it should be a valid IPv4 format
		parts := strings.Split(ip, ".")
		if len(parts) != 4 {
			t.Errorf("Test case 1 failed. Invalid IPv4 format: %s", ip)
		}

		// Should not be loopback
		if strings.HasPrefix(ip, "127.") {
			t.Errorf("Test case 1 failed. Should not return loopback address: %s", ip)
		}

		t.Logf("Local IP detected: %s", ip)
	} else {
		// Empty string is acceptable if no suitable interface is found
		t.Log("No local IP address found (acceptable in some environments)")
	}

	// Test case 2: Function should be deterministic (calling twice should return same result)
	ip2 := getLocalIP()
	if ip != ip2 {
		t.Errorf("Test case 2 failed. Function should be deterministic. First call: %s, Second call: %s", ip, ip2)
	}
}
