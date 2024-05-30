package utils

import (
	"testing"
)

func TestStringToInt64(t *testing.T) {
	// Test case 1: Valid positive number string
	result, err := StringToInt64("123")
	if err != nil || result != 123 {
		t.Errorf("Test case 1 failed. Expected: 123, Got: %v, Error: %v", result, err)
	}

	// Test case 2: Valid negative number string
	result, err = StringToInt64("-456")
	if err != nil || result != -456 {
		t.Errorf("Test case 2 failed. Expected: -456, Got: %v, Error: %v", result, err)
	}

	// Test case 3: Invalid non-number string
	_, err = StringToInt64("abc")
	if err == nil {
		t.Errorf("Test case 3 failed. Expected an error for invalid input.")
	}

	// Test case 4: Valid zero string
	result, err = StringToInt64("0")
	if err != nil || result != 0 {
		t.Errorf("Test case 4 failed. Expected: 0, Got: %v, Error: %v", result, err)
	}

	// Test case 5: Valid large positive number string
	result, err = StringToInt64("9223372036854775807")
	if err != nil || result != 9223372036854775807 {
		t.Errorf("Test case 5 failed. Expected: 9223372036854775807, Got: %v, Error: %v", result, err)
	}
}

func TestInt64ToString(t *testing.T) {
	// Test case 1: Valid positive number
	result := Int64ToString(123)
	if result != "123" {
		t.Errorf("Test case 1 failed. Expected: '123', Got: '%s'", result)
	}

	// Test case 2: Valid negative number
	result = Int64ToString(-456)
	if result != "-456" {
		t.Errorf("Test case 2 failed. Expected: '-456', Got: '%s'", result)
	}

	// Test case 3: Valid zero
	result = Int64ToString(0)
	if result != "0" {
		t.Errorf("Test case 3 failed. Expected: '0', Got: '%s'", result)
	}

	// Test case 4: Valid large positive number
	result = Int64ToString(9223372036854775807)
	if result != "9223372036854775807" {
		t.Errorf("Test case 4 failed. Expected: '9223372036854775807', Got: '%s'", result)
	}

	// Test case 5: Valid large negative number
	result = Int64ToString(-9223372036854775808)
	if result != "-9223372036854775808" {
		t.Errorf("Test case 5 failed. Expected: '-9223372036854775808', Got: '%s'", result)
	}
}
