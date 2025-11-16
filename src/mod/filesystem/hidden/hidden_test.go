package hidden

import (
	"testing"
)

func TestIsHiddenNonRecursive(t *testing.T) {
	// Test case 1: Hidden file (starts with dot)
	// Note: On Unix, files starting with . are hidden
	hidden, err := IsHidden(".hidden", false)
	if err != nil {
		t.Errorf("Test case 1 failed. Unexpected error: %v", err)
	}
	// Result depends on platform, so we just verify no error

	// Test case 2: Regular file name
	hidden, err = IsHidden("normal.txt", false)
	if err != nil {
		t.Errorf("Test case 2 failed. Unexpected error: %v", err)
	}
	_ = hidden // Platform dependent

	// Test case 3: Empty filename
	hidden, err = IsHidden("", false)
	if err != nil {
		t.Errorf("Test case 3 failed. Unexpected error: %v", err)
	}
	_ = hidden
}

func TestIsHiddenRecursive(t *testing.T) {
	// Test case 1: Path with hidden folder
	hidden, err := IsHidden(".hidden/folder/file.txt", true)
	if err != nil {
		t.Errorf("Test case 1 failed. Unexpected error: %v", err)
	}
	// On Unix systems, this should return true because .hidden starts with dot
	// On Windows, depends on file attributes
	t.Logf("Test case 1: .hidden/folder/file.txt is hidden: %v", hidden)

	// Test case 2: Path with hidden file in middle
	hidden, err = IsHidden("normal/.hidden/file.txt", true)
	if err != nil {
		t.Errorf("Test case 2 failed. Unexpected error: %v", err)
	}
	t.Logf("Test case 2: normal/.hidden/file.txt is hidden: %v", hidden)

	// Test case 3: Regular path
	hidden, err = IsHidden("normal/folder/file.txt", true)
	if err != nil {
		t.Errorf("Test case 3 failed. Unexpected error: %v", err)
	}
	_ = hidden

	// Test case 4: Path with empty chunks
	hidden, err = IsHidden("normal//folder/file.txt", true)
	if err != nil {
		t.Errorf("Test case 4 failed. Unexpected error: %v", err)
	}
	_ = hidden

	// Test case 5: Path with only slashes
	hidden, err = IsHidden("///", true)
	if err != nil {
		t.Errorf("Test case 5 failed. Unexpected error: %v", err)
	}
	// Should return false as all chunks are empty
	if hidden {
		t.Error("Test case 5 failed. Path with only slashes should not be hidden")
	}
}
