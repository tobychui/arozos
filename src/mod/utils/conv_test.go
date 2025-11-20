package utils

import (
	"math"
	"testing"
)

func TestStringToInt64(t *testing.T) {
	// Test case 1: Valid positive integer
	result, err := StringToInt64("123")
	if err != nil {
		t.Errorf("Test case 1 failed. Unexpected error: %v", err)
	}
	if result != 123 {
		t.Errorf("Test case 1 failed. Expected 123, got %d", result)
	}

	// Test case 2: Valid negative integer
	result, err = StringToInt64("-456")
	if err != nil {
		t.Errorf("Test case 2 failed. Unexpected error: %v", err)
	}
	if result != -456 {
		t.Errorf("Test case 2 failed. Expected -456, got %d", result)
	}

	// Test case 3: Zero
	result, err = StringToInt64("0")
	if err != nil {
		t.Errorf("Test case 3 failed. Unexpected error: %v", err)
	}
	if result != 0 {
		t.Errorf("Test case 3 failed. Expected 0, got %d", result)
	}

	// Test case 4: Invalid string (non-numeric)
	result, err = StringToInt64("abc")
	if err == nil {
		t.Error("Test case 4 failed. Expected error for non-numeric string")
	}
	if result != -1 {
		t.Errorf("Test case 4 failed. Expected -1 on error, got %d", result)
	}

	// Test case 5: Empty string
	result, err = StringToInt64("")
	if err == nil {
		t.Error("Test case 5 failed. Expected error for empty string")
	}
	if result != -1 {
		t.Errorf("Test case 5 failed. Expected -1 on error, got %d", result)
	}

	// Test case 6: String with whitespace
	result, err = StringToInt64("  789  ")
	if err != nil {
		t.Logf("Test case 6: String with whitespace returned error (expected): %v", err)
	}

	// Test case 7: Maximum int64 value
	maxStr := "9223372036854775807"
	result, err = StringToInt64(maxStr)
	if err != nil {
		t.Errorf("Test case 7 failed. Unexpected error: %v", err)
	}
	if result != math.MaxInt64 {
		t.Errorf("Test case 7 failed. Expected MaxInt64, got %d", result)
	}

	// Test case 8: Minimum int64 value
	minStr := "-9223372036854775808"
	result, err = StringToInt64(minStr)
	if err != nil {
		t.Errorf("Test case 8 failed. Unexpected error: %v", err)
	}
	if result != math.MinInt64 {
		t.Errorf("Test case 8 failed. Expected MinInt64, got %d", result)
	}

	// Test case 9: Number too large for int64
	tooLarge := "99999999999999999999999999"
	result, err = StringToInt64(tooLarge)
	if err == nil {
		t.Error("Test case 9 failed. Expected error for number too large")
	}

	// Test case 10: Hexadecimal string
	result, err = StringToInt64("0xFF")
	if err == nil {
		t.Log("Test case 10: Hexadecimal parsed (unexpected)")
	} else {
		t.Log("Test case 10: Hexadecimal rejected (expected)")
	}

	// Test case 11: Floating point string
	result, err = StringToInt64("123.45")
	if err == nil {
		t.Error("Test case 11 failed. Expected error for floating point")
	}

	// Test case 12: String with plus sign
	result, err = StringToInt64("+999")
	if err != nil {
		t.Errorf("Test case 12 failed. Unexpected error: %v", err)
	}
	if result != 999 {
		t.Errorf("Test case 12 failed. Expected 999, got %d", result)
	}

	// Test case 13: Leading zeros
	result, err = StringToInt64("000123")
	if err != nil {
		t.Errorf("Test case 13 failed. Unexpected error: %v", err)
	}
	if result != 123 {
		t.Errorf("Test case 13 failed. Expected 123, got %d", result)
	}
}

func TestInt64ToString(t *testing.T) {
	// Test case 1: Positive integer
	result := Int64ToString(123)
	if result != "123" {
		t.Errorf("Test case 1 failed. Expected '123', got '%s'", result)
	}

	// Test case 2: Negative integer
	result = Int64ToString(-456)
	if result != "-456" {
		t.Errorf("Test case 2 failed. Expected '-456', got '%s'", result)
	}

	// Test case 3: Zero
	result = Int64ToString(0)
	if result != "0" {
		t.Errorf("Test case 3 failed. Expected '0', got '%s'", result)
	}

	// Test case 4: Maximum int64
	result = Int64ToString(math.MaxInt64)
	if result != "9223372036854775807" {
		t.Errorf("Test case 4 failed. Expected MaxInt64 string, got '%s'", result)
	}

	// Test case 5: Minimum int64
	result = Int64ToString(math.MinInt64)
	if result != "-9223372036854775808" {
		t.Errorf("Test case 5 failed. Expected MinInt64 string, got '%s'", result)
	}

	// Test case 6: Large positive number
	result = Int64ToString(1234567890123)
	if result != "1234567890123" {
		t.Errorf("Test case 6 failed. Expected '1234567890123', got '%s'", result)
	}

	// Test case 7: Large negative number
	result = Int64ToString(-9876543210987)
	if result != "-9876543210987" {
		t.Errorf("Test case 7 failed. Expected '-9876543210987', got '%s'", result)
	}

	// Test case 8: Roundtrip conversion
	original := int64(42)
	str := Int64ToString(original)
	back, err := StringToInt64(str)
	if err != nil {
		t.Errorf("Test case 8 failed. Roundtrip conversion error: %v", err)
	}
	if back != original {
		t.Errorf("Test case 8 failed. Roundtrip failed: original=%d, got=%d", original, back)
	}

	// Test case 9: Roundtrip with negative
	original = int64(-789)
	str = Int64ToString(original)
	back, err = StringToInt64(str)
	if err != nil {
		t.Errorf("Test case 9 failed. Roundtrip conversion error: %v", err)
	}
	if back != original {
		t.Errorf("Test case 9 failed. Roundtrip failed: original=%d, got=%d", original, back)
	}

	// Test case 10: One
	result = Int64ToString(1)
	if result != "1" {
		t.Errorf("Test case 10 failed. Expected '1', got '%s'", result)
	}

	// Test case 11: Negative one
	result = Int64ToString(-1)
	if result != "-1" {
		t.Errorf("Test case 11 failed. Expected '-1', got '%s'", result)
	}
}
