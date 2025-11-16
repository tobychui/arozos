package main

import (
	"testing"
)

func TestGetRootEscapeFromCurrentPath(t *testing.T) {
	// Test case 1: Simple single level path
	result := getRootEscapeFromCurrentPath("/test")
	expected := "../"
	if result != expected {
		t.Errorf("Test case 1 failed. Expected '%s', got '%s'", expected, result)
	}

	// Test case 2: Two level path
	result = getRootEscapeFromCurrentPath("/test/path")
	expected = "../../"
	if result != expected {
		t.Errorf("Test case 2 failed. Expected '%s', got '%s'", expected, result)
	}

	// Test case 3: Three level path
	result = getRootEscapeFromCurrentPath("/test/path/deep")
	expected = "../../../"
	if result != expected {
		t.Errorf("Test case 3 failed. Expected '%s', got '%s'", expected, result)
	}

	// Test case 4: Root path
	result = getRootEscapeFromCurrentPath("/")
	expected = ""
	if result != expected {
		t.Errorf("Test case 4 failed. Expected '%s', got '%s'", expected, result)
	}

	// Test case 5: No slash (empty result)
	result = getRootEscapeFromCurrentPath("nopath")
	expected = ""
	if result != expected {
		t.Errorf("Test case 5 failed. Expected '%s', got '%s'", expected, result)
	}

	// Test case 6: Path with trailing slash
	result = getRootEscapeFromCurrentPath("/test/path/")
	expected = "../../"
	if result != expected {
		t.Errorf("Test case 6 failed. Expected '%s', got '%s'", expected, result)
	}

	// Test case 7: Deep nested path
	result = getRootEscapeFromCurrentPath("/level1/level2/level3/level4/level5")
	expected = "../../../../../"
	if result != expected {
		t.Errorf("Test case 7 failed. Expected '%s', got '%s'", expected, result)
	}

	// Test case 8: Path with file
	result = getRootEscapeFromCurrentPath("/folder/file.html")
	expected = "../../"
	if result != expected {
		t.Errorf("Test case 8 failed. Expected '%s', got '%s'", expected, result)
	}

	// Test case 9: Path with query parameters
	result = getRootEscapeFromCurrentPath("/api/endpoint?param=value")
	expected = "../../"
	if result != expected {
		t.Errorf("Test case 9 failed. Expected '%s', got '%s'", expected, result)
	}

	// Test case 10: Empty string
	result = getRootEscapeFromCurrentPath("")
	expected = ""
	if result != expected {
		t.Errorf("Test case 10 failed. Expected '%s', got '%s'", expected, result)
	}

	// Test case 11: Path with special characters
	result = getRootEscapeFromCurrentPath("/test-path/with_special.chars")
	expected = "../../"
	if result != expected {
		t.Errorf("Test case 11 failed. Expected '%s', got '%s'", expected, result)
	}

	// Test case 12: Very deep path (10 levels)
	result = getRootEscapeFromCurrentPath("/a/b/c/d/e/f/g/h/i/j")
	expected = "../../../../../../../../../../"
	if result != expected {
		t.Errorf("Test case 12 failed. Expected '%s', got '%s'", expected, result)
	}

	// Test case 13: Path with double slashes
	result = getRootEscapeFromCurrentPath("/test//double")
	// This should treat double slashes as separate levels (empty string counts as level)
	expected = "../../../../"
	if result != expected {
		t.Errorf("Test case 13 failed. Expected '%s', got '%s'", expected, result)
	}

	// Test case 14: Path starting without slash
	result = getRootEscapeFromCurrentPath("relative/path")
	expected = "../"
	if result != expected {
		t.Errorf("Test case 14 failed. Expected '%s', got '%s'", expected, result)
	}
}
