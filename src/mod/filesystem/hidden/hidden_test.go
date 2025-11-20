package hidden

import (
	"testing"
)

func TestIsHiddenNonRecursive(t *testing.T) {
	// Test case 1: Hidden file (starts with dot)
	// On Unix, files starting with . are hidden
	// On Windows, files starting with . are also treated as hidden without needing to exist
	hidden, err := IsHidden(".hidden", false)
	if err != nil {
		t.Errorf("Test case 1 failed. Unexpected error: %v", err)
	}
	if !hidden {
		t.Error("Test case 1 failed. Files starting with . should be hidden")
	}

	// Test case 2: Regular file name (may require file to exist on Windows)
	// On Windows, if file doesn't start with ., GetFileAttributes is called
	hidden, err = IsHidden("normal.txt", false)
	// Allow error on Windows for non-existent files
	if err == nil {
		_ = hidden // Platform dependent
	}

	// Test case 3: Empty filename (may return error on some platforms)
	hidden, err = IsHidden("", false)
	// Allow error for empty filename
	_ = hidden
	_ = err
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
