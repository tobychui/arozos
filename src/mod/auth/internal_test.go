package auth

import (
	"testing"
)

func TestInSlice(t *testing.T) {
	// Test case 1: Element exists in slice
	list := []string{"apple", "banana", "orange"}
	if !inSlice(list, "banana") {
		t.Error("Test case 1 failed. 'banana' should be in slice")
	}

	// Test case 2: Element does not exist in slice
	if inSlice(list, "grape") {
		t.Error("Test case 2 failed. 'grape' should not be in slice")
	}

	// Test case 3: Empty slice
	emptyList := []string{}
	if inSlice(emptyList, "apple") {
		t.Error("Test case 3 failed. Should return false for empty slice")
	}

	// Test case 4: Single element slice - match
	singleList := []string{"only"}
	if !inSlice(singleList, "only") {
		t.Error("Test case 4 failed. Should find element in single element slice")
	}

	// Test case 5: Single element slice - no match
	if inSlice(singleList, "other") {
		t.Error("Test case 5 failed. Should not find non-existent element")
	}

	// Test case 6: Case sensitivity
	caseList := []string{"Apple", "Banana"}
	if inSlice(caseList, "apple") {
		t.Error("Test case 6 failed. Should be case sensitive")
	}

	// Test case 7: Empty string search
	if !inSlice([]string{"", "test"}, "") {
		t.Error("Test case 7 failed. Should find empty string in slice")
	}

	// Test case 8: Duplicate elements in slice
	dupList := []string{"a", "b", "a", "c"}
	if !inSlice(dupList, "a") {
		t.Error("Test case 8 failed. Should find element even with duplicates")
	}

	// Test case 9: Search for empty string in list without empty string
	if inSlice([]string{"a", "b", "c"}, "") {
		t.Error("Test case 9 failed. Should not find empty string when not present")
	}

	// Test case 10: Special characters
	specialList := []string{"test@example.com", "user-name", "file_name"}
	if !inSlice(specialList, "user-name") {
		t.Error("Test case 10 failed. Should find string with special characters")
	}

	// Test case 11: Numbers as strings
	numberList := []string{"1", "2", "3", "10"}
	if !inSlice(numberList, "10") {
		t.Error("Test case 11 failed. Should find numeric string")
	}

	// Test case 12: Whitespace strings
	whitespaceList := []string{"  ", " ", "test"}
	if !inSlice(whitespaceList, " ") {
		t.Error("Test case 12 failed. Should find whitespace string")
	}

	// Test case 13: First element
	if !inSlice(list, "apple") {
		t.Error("Test case 13 failed. Should find first element")
	}

	// Test case 14: Last element
	if !inSlice(list, "orange") {
		t.Error("Test case 14 failed. Should find last element")
	}

	// Test case 15: Middle element
	if !inSlice(list, "banana") {
		t.Error("Test case 15 failed. Should find middle element")
	}

	// Test case 16: Large slice performance
	largeList := make([]string, 1000)
	for i := 0; i < 1000; i++ {
		largeList[i] = string(rune('a' + i%26))
	}
	largeList[999] = "target"
	if !inSlice(largeList, "target") {
		t.Error("Test case 16 failed. Should find element in large slice")
	}
}
