package fuzzy

import (
	"testing"
)

func TestComputeScore(t *testing.T) {
	// Test case 1: Exact match
	score := ComputeScore("test", "test")
	if score <= 0 {
		t.Error("Test case 1 failed. Exact match should have positive score")
	}

	// Test case 2: No match
	score = ComputeScore("abc", "xyz")
	t.Logf("Score for non-matching strings: %d", score)
	
	// Test case 3: Empty strings
	score = ComputeScore("", "")
	t.Logf("Score for empty strings: %d", score)
}
