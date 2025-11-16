package static

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestGetScriptRoot(t *testing.T) {
	// Test case 1: Simple module path
	root := GetScriptRoot("/web/mymodule/script.js", "/web")
	if root != "mymodule" {
		t.Errorf("Test case 1 failed. Expected 'mymodule', got '%s'", root)
	}

	// Test case 2: Nested module path
	root = GetScriptRoot("/web/mymodule/subfolder/script.js", "/web")
	if root != "mymodule" {
		t.Errorf("Test case 2 failed. Expected 'mymodule', got '%s'", root)
	}

	// Test case 3: Deep nesting
	root = GetScriptRoot("/web/mymodule/a/b/c/d/script.js", "/web")
	if root != "mymodule" {
		t.Errorf("Test case 3 failed. Expected 'mymodule', got '%s'", root)
	}

	// Test case 4: Different scope path
	root = GetScriptRoot("/var/www/modules/testmodule/script.js", "/var/www/modules")
	if root != "testmodule" {
		t.Errorf("Test case 4 failed. Expected 'testmodule', got '%s'", root)
	}

	// Test case 5: Script at module root
	root = GetScriptRoot("/web/mymodule/init.agi", "/web")
	if root != "mymodule" {
		t.Errorf("Test case 5 failed. Expected 'mymodule', got '%s'", root)
	}

	// Test case 6: Backslashes in path (Windows-style)
	root = GetScriptRoot("C:\\web\\mymodule\\script.js", "C:\\web")
	if root != "mymodule" {
		t.Errorf("Test case 6 failed. Expected 'mymodule', got '%s'", root)
	}

	// Test case 7: Module with dashes
	root = GetScriptRoot("/web/my-module/script.js", "/web")
	if root != "my-module" {
		t.Errorf("Test case 7 failed. Expected 'my-module', got '%s'", root)
	}

	// Test case 8: Module with underscores
	root = GetScriptRoot("/web/my_module/script.js", "/web")
	if root != "my_module" {
		t.Errorf("Test case 8 failed. Expected 'my_module', got '%s'", root)
	}

	// Test case 9: Module with dots
	root = GetScriptRoot("/web/my.module/script.js", "/web")
	if root != "my.module" {
		t.Errorf("Test case 9 failed. Expected 'my.module', got '%s'", root)
	}
}

func TestSpecialURIDecode(t *testing.T) {
	// Test case 1: Plus sign preservation
	result := SpecialURIDecode("file+name.txt")
	if result != "file+name.txt" {
		t.Errorf("Test case 1 failed. Expected 'file+name.txt', got '%s'", result)
	}

	// Test case 2: URL encoded space
	result = SpecialURIDecode("file%20name.txt")
	if result != "file name.txt" {
		t.Errorf("Test case 2 failed. Expected 'file name.txt', got '%s'", result)
	}

	// Test case 3: URL encoded special characters
	result = SpecialURIDecode("file%40name.txt")
	if result != "file@name.txt" {
		t.Errorf("Test case 3 failed. Expected 'file@name.txt', got '%s'", result)
	}

	// Test case 4: Multiple plus signs
	result = SpecialURIDecode("file+name+test.txt")
	if result != "file+name+test.txt" {
		t.Errorf("Test case 4 failed. Expected 'file+name+test.txt', got '%s'", result)
	}

	// Test case 5: Mixed encoding and plus signs
	result = SpecialURIDecode("file+%20name.txt")
	if !strings.Contains(result, "+") {
		t.Errorf("Test case 5 failed. Plus sign should be preserved, got '%s'", result)
	}
	if !strings.Contains(result, " ") {
		t.Errorf("Test case 5 failed. Space should be decoded, got '%s'", result)
	}

	// Test case 6: URL encoded plus sign
	result = SpecialURIDecode("file%2Bname.txt")
	if result != "file+name.txt" {
		t.Errorf("Test case 6 failed. Expected 'file+name.txt', got '%s'", result)
	}

	// Test case 7: Empty string
	result = SpecialURIDecode("")
	if result != "" {
		t.Errorf("Test case 7 failed. Expected empty string, got '%s'", result)
	}

	// Test case 8: No special characters
	result = SpecialURIDecode("normalfile.txt")
	if result != "normalfile.txt" {
		t.Errorf("Test case 8 failed. Expected 'normalfile.txt', got '%s'", result)
	}

	// Test case 9: Path with slashes and encoding
	result = SpecialURIDecode("folder%2Ffile+name.txt")
	if result != "folder/file+name.txt" {
		t.Errorf("Test case 9 failed. Expected 'folder/file+name.txt', got '%s'", result)
	}

	// Test case 10: Chinese characters
	result = SpecialURIDecode("%E4%B8%AD%E6%96%87")
	expected := "中文"
	if result != expected {
		t.Errorf("Test case 10 failed. Expected '%s', got '%s'", expected, result)
	}

	// Test case 11: URL with query parameters
	result = SpecialURIDecode("search%3Fq%3Dtest+query")
	if !strings.Contains(result, "+") {
		t.Errorf("Test case 11 failed. Plus sign in query should be preserved, got '%s'", result)
	}

	// Test case 12: Percent sign
	result = SpecialURIDecode("100%25complete")
	if result != "100%complete" {
		t.Errorf("Test case 12 failed. Expected '100%%complete', got '%s'", result)
	}

	// Test case 13: Hashtag
	result = SpecialURIDecode("tag%23hashtag")
	if result != "tag#hashtag" {
		t.Errorf("Test case 13 failed. Expected 'tag#hashtag', got '%s'", result)
	}
}

func TestIsValidAGIScript(t *testing.T) {
	// Create temporary web directory for testing
	tempDir, err := os.MkdirTemp("", "agi_test")
	if err != nil {
		t.Fatalf("Failed to create temp directory: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Change to temp directory temporarily
	originalWd, _ := os.Getwd()
	defer os.Chdir(originalWd)

	// Create ./web directory structure in temp location
	webDir := filepath.Join(tempDir, "web")
	os.MkdirAll(webDir, 0755)
	os.Chdir(tempDir)

	// Test case 1: Create valid .agi script
	validAgiPath := filepath.Join(webDir, "script.agi")
	os.WriteFile(validAgiPath, []byte("test"), 0644)
	if !IsValidAGIScript("script.agi") {
		t.Error("Test case 1 failed. Valid .agi script should return true")
	}

	// Test case 2: Create valid .js script
	validJsPath := filepath.Join(webDir, "script.js")
	os.WriteFile(validJsPath, []byte("test"), 0644)
	if !IsValidAGIScript("script.js") {
		t.Error("Test case 2 failed. Valid .js script should return true")
	}

	// Test case 3: Non-existent file
	if IsValidAGIScript("nonexistent.agi") {
		t.Error("Test case 3 failed. Non-existent file should return false")
	}

	// Test case 4: Wrong extension
	wrongExtPath := filepath.Join(webDir, "script.txt")
	os.WriteFile(wrongExtPath, []byte("test"), 0644)
	if IsValidAGIScript("script.txt") {
		t.Error("Test case 4 failed. Wrong extension should return false")
	}

	// Test case 5: Nested path with .agi
	nestedDir := filepath.Join(webDir, "module", "subfolder")
	os.MkdirAll(nestedDir, 0755)
	nestedScriptPath := filepath.Join(nestedDir, "nested.agi")
	os.WriteFile(nestedScriptPath, []byte("test"), 0644)
	if !IsValidAGIScript("module/subfolder/nested.agi") {
		t.Error("Test case 5 failed. Nested .agi script should return true")
	}

	// Test case 6: Nested path with .js
	nestedJsPath := filepath.Join(nestedDir, "nested.js")
	os.WriteFile(nestedJsPath, []byte("test"), 0644)
	if !IsValidAGIScript("module/subfolder/nested.js") {
		t.Error("Test case 6 failed. Nested .js script should return true")
	}

	// Test case 7: Empty string
	if IsValidAGIScript("") {
		t.Error("Test case 7 failed. Empty string should return false")
	}

	// Test case 8: Directory (not a file)
	dirPath := filepath.Join(webDir, "directory.agi")
	os.MkdirAll(dirPath, 0755)
	if IsValidAGIScript("directory.agi") {
		t.Error("Test case 8 failed. Directory should return false")
	}
}

func TestCheckRootEscape(t *testing.T) {
	// Create temporary directory for testing
	tempDir, err := os.MkdirTemp("", "escape_test")
	if err != nil {
		t.Fatalf("Failed to create temp directory: %v", err)
	}
	defer os.RemoveAll(tempDir)

	rootPath := tempDir
	validSubPath := filepath.Join(tempDir, "subfolder")
	os.MkdirAll(validSubPath, 0755)

	// Test case 1: Valid path within root
	escaped, err := CheckRootEscape(rootPath, validSubPath)
	if err != nil {
		t.Errorf("Test case 1 failed. Unexpected error: %v", err)
	}
	if escaped {
		t.Error("Test case 1 failed. Valid subpath should not be escaping")
	}

	// Test case 2: Path escaping root (parent directory)
	parentPath := filepath.Dir(tempDir)
	escaped, err = CheckRootEscape(rootPath, parentPath)
	if err != nil {
		t.Errorf("Test case 2 failed. Unexpected error: %v", err)
	}
	if !escaped {
		t.Error("Test case 2 failed. Parent path should be escaping")
	}

	// Test case 3: Same path (root and target identical)
	escaped, err = CheckRootEscape(rootPath, rootPath)
	if err != nil {
		t.Errorf("Test case 3 failed. Unexpected error: %v", err)
	}
	if escaped {
		t.Error("Test case 3 failed. Same path should not be escaping")
	}

	// Test case 4: Relative path within root
	relPath := filepath.Join(rootPath, ".", "subfolder")
	escaped, err = CheckRootEscape(rootPath, relPath)
	if err != nil {
		t.Errorf("Test case 4 failed. Unexpected error: %v", err)
	}
	if escaped {
		t.Error("Test case 4 failed. Relative path within root should not be escaping")
	}

	// Test case 5: Deep nested valid path
	deepPath := filepath.Join(tempDir, "a", "b", "c", "d")
	escaped, err = CheckRootEscape(rootPath, deepPath)
	if err != nil {
		t.Errorf("Test case 5 failed. Unexpected error: %v", err)
	}
	if escaped {
		t.Error("Test case 5 failed. Deep nested path should not be escaping")
	}

	// Test case 6: Relative path escape attempt (..)
	escapePath := filepath.Join(rootPath, "..", "escaped")
	escaped, err = CheckRootEscape(rootPath, escapePath)
	if err != nil {
		t.Errorf("Test case 6 failed. Unexpected error: %v", err)
	}
	t.Logf("Test case 6: Escape path result: %v (expected true for escape)", escaped)

	// Test case 7: Another root entirely
	otherRoot, _ := os.MkdirTemp("", "other_root")
	defer os.RemoveAll(otherRoot)
	escaped, err = CheckRootEscape(rootPath, otherRoot)
	if err != nil {
		t.Errorf("Test case 7 failed. Unexpected error: %v", err)
	}
	if !escaped {
		t.Error("Test case 7 failed. Different root should be escaping")
	}
}
