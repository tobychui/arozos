package shareEntry

import (
	"testing"
)

func TestStringInSlice(t *testing.T) {
	// Test case 1: String exists in slice
	slice := []string{"apple", "banana", "orange"}
	result := stringInSlice("banana", slice)
	if !result {
		t.Error("Test case 1 failed. Expected true for existing string")
	}

	// Test case 2: String does not exist in slice
	result = stringInSlice("grape", slice)
	if result {
		t.Error("Test case 2 failed. Expected false for non-existing string")
	}

	// Test case 3: First element
	result = stringInSlice("apple", slice)
	if !result {
		t.Error("Test case 3 failed. Expected true for first element")
	}

	// Test case 4: Last element
	result = stringInSlice("orange", slice)
	if !result {
		t.Error("Test case 4 failed. Expected true for last element")
	}

	// Test case 5: Empty string in slice
	sliceWithEmpty := []string{"", "test", "value"}
	result = stringInSlice("", sliceWithEmpty)
	if !result {
		t.Error("Test case 5 failed. Expected true for empty string in slice")
	}

	// Test case 6: Empty string not in slice
	result = stringInSlice("", slice)
	if result {
		t.Error("Test case 6 failed. Expected false for empty string not in slice")
	}

	// Test case 7: Empty slice
	emptySlice := []string{}
	result = stringInSlice("test", emptySlice)
	if result {
		t.Error("Test case 7 failed. Expected false for empty slice")
	}

	// Test case 8: Nil slice
	var nilSlice []string
	result = stringInSlice("test", nilSlice)
	if result {
		t.Error("Test case 8 failed. Expected false for nil slice")
	}

	// Test case 9: Case sensitivity - exact match
	result = stringInSlice("Apple", []string{"apple", "banana"})
	if result {
		t.Error("Test case 9 failed. Expected false for case-sensitive mismatch")
	}

	// Test case 10: Duplicate elements in slice
	sliceWithDups := []string{"test", "value", "test", "another"}
	result = stringInSlice("test", sliceWithDups)
	if !result {
		t.Error("Test case 10 failed. Expected true for string in slice with duplicates")
	}

	// Test case 11: String with spaces
	sliceWithSpaces := []string{"hello world", "test", "value"}
	result = stringInSlice("hello world", sliceWithSpaces)
	if !result {
		t.Error("Test case 11 failed. Expected true for string with spaces")
	}

	// Test case 12: Special characters
	sliceWithSpecial := []string{"test@example.com", "user#123", "value$456"}
	result = stringInSlice("user#123", sliceWithSpecial)
	if !result {
		t.Error("Test case 12 failed. Expected true for string with special characters")
	}

	// Test case 13: Unicode characters
	sliceWithUnicode := []string{"hello", "世界", "тест"}
	result = stringInSlice("世界", sliceWithUnicode)
	if !result {
		t.Error("Test case 13 failed. Expected true for Unicode string")
	}

	// Test case 14: Very long string
	longString := string(make([]byte, 10000))
	for i := range longString {
		longString = longString[:i] + "a" + longString[i+1:]
	}
	sliceWithLong := []string{"short", longString, "another"}
	result = stringInSlice(longString, sliceWithLong)
	if !result {
		t.Error("Test case 14 failed. Expected true for very long string")
	}

	// Test case 15: Single element slice - match
	singleSlice := []string{"only"}
	result = stringInSlice("only", singleSlice)
	if !result {
		t.Error("Test case 15 failed. Expected true for single element match")
	}

	// Test case 16: Single element slice - no match
	result = stringInSlice("other", singleSlice)
	if result {
		t.Error("Test case 16 failed. Expected false for single element no match")
	}

	// Test case 17: Whitespace variations
	sliceWithWhitespace := []string{"  test  ", "value", "another"}
	result = stringInSlice("test", sliceWithWhitespace)
	if result {
		t.Error("Test case 17 failed. Expected false for whitespace variation (exact match required)")
	}

	// Test case 18: Exact match with whitespace
	result = stringInSlice("  test  ", sliceWithWhitespace)
	if !result {
		t.Error("Test case 18 failed. Expected true for exact whitespace match")
	}

	// Test case 19: Newline characters
	sliceWithNewline := []string{"test\n", "value", "another"}
	result = stringInSlice("test\n", sliceWithNewline)
	if !result {
		t.Error("Test case 19 failed. Expected true for string with newline")
	}

	// Test case 20: Large slice
	largeSlice := make([]string, 1000)
	for i := 0; i < 1000; i++ {
		largeSlice[i] = "value" + string(rune(i))
	}
	largeSlice[500] = "target"
	result = stringInSlice("target", largeSlice)
	if !result {
		t.Error("Test case 20 failed. Expected true for target in large slice")
	}
}
