package hdsv2

import (
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
