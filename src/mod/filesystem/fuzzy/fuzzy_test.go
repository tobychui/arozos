package fuzzy

import (
	"testing"
)

func TestNewFuzzyMatcher(t *testing.T) {
	// Test case 1: Create matcher with simple query
	matcher := NewFuzzyMatcher("Hello World", false)
	if matcher == nil {
		t.Error("Test case 1 failed. Matcher should not be nil")
	}

	// Test case 2: Match exact filename
	if !matcher.Match("Hello World.txt") {
		t.Error("Test case 2 failed. Should match filename containing keywords")
	}

	// Test case 3: Non-matching filename
	if matcher.Match("Goodbye.txt") {
		t.Error("Test case 3 failed. Should not match filename without keywords")
	}

	// Test case 4: Exclude keywords
	excludeMatcher := NewFuzzyMatcher("Hello -World", false)
	if excludeMatcher.Match("Hello World.txt") {
		t.Error("Test case 4 failed. Should exclude files with excluded keyword")
	}
	if !excludeMatcher.Match("Hello.txt") {
		t.Error("Test case 5 failed. Should match files without excluded keyword")
	}
}
