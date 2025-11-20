package filesystem

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestGetIDFromVirtualPath(t *testing.T) {
	// Test case 1: Valid virtual path with colon
	id, subpath, err := GetIDFromVirtualPath("device1:/path/to/file.txt")
	if err != nil {
		t.Errorf("Test case 1 failed. Unexpected error: %v", err)
	}
	if id != "device1" {
		t.Errorf("Test case 1 failed. Expected 'device1', got '%s'", id)
	}
	if subpath != "/path/to/file.txt" {
		t.Errorf("Test case 1 failed. Expected '/path/to/file.txt', got '%s'", subpath)
	}

	// Test case 2: Virtual path without colon
	_, _, err = GetIDFromVirtualPath("/path/without/colon")
	if err == nil {
		t.Error("Test case 2 failed. Expected error for path without colon")
	}

	// Test case 3: Virtual path with multiple colons
	id, subpath, err = GetIDFromVirtualPath("device2:/path:/with:/colons")
	if err != nil {
		t.Errorf("Test case 3 failed. Unexpected error: %v", err)
	}
	if id != "device2" {
		t.Errorf("Test case 3 failed. Expected 'device2', got '%s'", id)
	}
	if subpath != "/path:/with:/colons" {
		t.Errorf("Test case 3 failed. Expected '/path:/with:/colons', got '%s'", subpath)
	}

	// Test case 4: Empty path after colon
	id, subpath, err = GetIDFromVirtualPath("device3:")
	if err != nil {
		t.Errorf("Test case 4 failed. Unexpected error: %v", err)
	}
	if id != "device3" {
		t.Errorf("Test case 4 failed. Expected 'device3', got '%s'", id)
	}

	// Test case 5: Path with ./  prefix
	id, subpath, err = GetIDFromVirtualPath("./device4:/some/path")
	if err != nil {
		t.Errorf("Test case 5 failed. Unexpected error: %v", err)
	}
	if id != "device4" {
		t.Errorf("Test case 5 failed. Expected 'device4', got '%s'", id)
	}

	// Test case 6: Root path
	id, subpath, err = GetIDFromVirtualPath("root:/")
	if err != nil {
		t.Errorf("Test case 6 failed. Unexpected error: %v", err)
	}
	if id != "root" {
		t.Errorf("Test case 6 failed. Expected 'root', got '%s'", id)
	}
}

func TestGetFileSize(t *testing.T) {
	// Create temporary directory and files
	tempDir, err := os.MkdirTemp("", "filesize_test")
	if err != nil {
		t.Fatalf("Failed to create temp directory: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Test case 1: File with known size
	testFile := filepath.Join(tempDir, "test.txt")
	content := "Hello, World!"
	err = os.WriteFile(testFile, []byte(content), 0644)
	if err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	size := GetFileSize(testFile)
	if size != int64(len(content)) {
		t.Errorf("Test case 1 failed. Expected %d, got %d", len(content), size)
	}

	// Test case 2: Non-existent file
	size = GetFileSize("/non/existent/file.txt")
	if size != 0 {
		t.Errorf("Test case 2 failed. Expected 0 for non-existent file, got %d", size)
	}

	// Test case 3: Empty file
	emptyFile := filepath.Join(tempDir, "empty.txt")
	err = os.WriteFile(emptyFile, []byte(""), 0644)
	if err != nil {
		t.Fatalf("Failed to create empty file: %v", err)
	}

	size = GetFileSize(emptyFile)
	if size != 0 {
		t.Errorf("Test case 3 failed. Expected 0 for empty file, got %d", size)
	}
}

func TestIsInsideHiddenFolder(t *testing.T) {
	// Test case 1: Hidden folder (starts with dot)
	result := IsInsideHiddenFolder("/path/to/.hidden/file.txt")
	if !result {
		t.Error("Test case 1 failed. Should detect hidden folder")
	}

	// Test case 2: Regular path
	result = IsInsideHiddenFolder("/path/to/visible/file.txt")
	if result {
		t.Error("Test case 2 failed. Should not detect as hidden")
	}

	// Test case 3: Hidden file (but not folder)
	result = IsInsideHiddenFolder("/path/to/.hiddenfile.txt")
	if !result {
		t.Error("Test case 3 failed. Should detect hidden file")
	}

	// Test case 4: Nested hidden folder
	result = IsInsideHiddenFolder("/path/.to/nested/.hidden/file.txt")
	if !result {
		t.Error("Test case 4 failed. Should detect nested hidden folders")
	}

	// Test case 5: Root hidden folder
	result = IsInsideHiddenFolder("/.hidden/file.txt")
	if !result {
		t.Error("Test case 5 failed. Should detect root hidden folder")
	}

	// Test case 6: Empty path - filepath.Clean("") returns "." which is considered hidden
	result = IsInsideHiddenFolder("")
	if !result {
		t.Error("Test case 6 failed. Empty path (cleaned to '.') should be hidden")
	}

	// Test case 7: Current directory - "." starts with "." so it's hidden
	result = IsInsideHiddenFolder(".")
	if !result {
		t.Error("Test case 7 failed. Current directory '.' should be hidden")
	}
}

func TestGetFileDisplaySize(t *testing.T) {
	// Test case 1: Bytes
	result := GetFileDisplaySize(512, 2)
	if !strings.Contains(result, "Bytes") {
		t.Errorf("Test case 1 failed. Expected Bytes unit, got %s", result)
	}

	// Test case 2: Kilobytes
	result = GetFileDisplaySize(2048, 2)
	if !strings.Contains(result, "KB") {
		t.Errorf("Test case 2 failed. Expected KB unit, got %s", result)
	}

	// Test case 3: Megabytes
	result = GetFileDisplaySize(2*1024*1024, 2)
	if !strings.Contains(result, "MB") {
		t.Errorf("Test case 3 failed. Expected MB unit, got %s", result)
	}

	// Test case 4: Gigabytes
	result = GetFileDisplaySize(2*1024*1024*1024, 2)
	if !strings.Contains(result, "GB") {
		t.Errorf("Test case 4 failed. Expected GB unit, got %s", result)
	}

	// Test case 5: Terabytes
	result = GetFileDisplaySize(2*1024*1024*1024*1024, 2)
	if !strings.Contains(result, "TB") {
		t.Errorf("Test case 5 failed. Expected TB unit, got %s", result)
	}

	// Test case 6: Zero size
	result = GetFileDisplaySize(0, 2)
	if !strings.Contains(result, "Bytes") {
		t.Errorf("Test case 6 failed. Expected Bytes for zero size, got %s", result)
	}

	// Test case 7: Exact KB boundary
	result = GetFileDisplaySize(1024, 2)
	if !strings.Contains(result, "KB") {
		t.Errorf("Test case 7 failed. Expected KB for 1024 bytes, got %s", result)
	}

	// Test case 8: Different rounding precision
	result = GetFileDisplaySize(1536, 0)
	t.Logf("Test case 8: 1536 bytes with 0 rounding: %s", result)

	// Test case 9: Different rounding precision (high)
	result = GetFileDisplaySize(1536, 4)
	t.Logf("Test case 9: 1536 bytes with 4 rounding: %s", result)
}

func TestDecodeURI(t *testing.T) {
	// Test case 1: Plus sign preservation
	result := DecodeURI("test+file+name.txt")
	if result != "test+file+name.txt" {
		t.Errorf("Test case 1 failed. Plus signs not preserved, got %s", result)
	}

	// Test case 2: URL encoded spaces
	result = DecodeURI("test%20file.txt")
	if result != "test file.txt" {
		t.Errorf("Test case 2 failed. Spaces not decoded properly, got %s", result)
	}

	// Test case 3: URL encoded special characters
	result = DecodeURI("file%40name.txt")
	if result != "file@name.txt" {
		t.Errorf("Test case 3 failed. Special chars not decoded, got %s", result)
	}

	// Test case 4: Mixed plus and encoded
	result = DecodeURI("test+%20file.txt")
	if !strings.Contains(result, "+") {
		t.Errorf("Test case 4 failed. Plus sign not preserved in mixed encoding, got %s", result)
	}

	// Test case 5: No encoding
	result = DecodeURI("normalfile.txt")
	if result != "normalfile.txt" {
		t.Errorf("Test case 5 failed. Normal filename changed, got %s", result)
	}

	// Test case 6: Empty string
	result = DecodeURI("")
	if result != "" {
		t.Errorf("Test case 6 failed. Empty string changed, got %s", result)
	}
}

func TestGetPhysicalRootFromPath(t *testing.T) {
	// Test case 1: Unix-style path
	root, err := GetPhysicalRootFromPath("/home/user/documents/file.txt")
	if err != nil {
		t.Errorf("Test case 1 failed. Unexpected error: %v", err)
	}
	// On Windows, Unix paths get converted to Windows paths with drive letters
	if runtime.GOOS == "windows" {
		// On Windows, the root will be the drive letter (e.g., "C:")
		t.Logf("Test case 1 (Windows): Got root '%s'", root)
	} else {
		if root != "home" {
			t.Errorf("Test case 1 failed. Expected 'home', got '%s'", root)
		}
	}

	// Test case 2: Relative path
	root, err = GetPhysicalRootFromPath("documents/file.txt")
	if err != nil {
		t.Errorf("Test case 2 failed. Unexpected error: %v", err)
	}
	// Root should be first component (platform dependent for relative paths)
	t.Logf("Test case 2: Relative path root is '%s'", root)

	// Test case 3: Single component path
	root, err = GetPhysicalRootFromPath("/root")
	if err != nil {
		t.Errorf("Test case 3 failed. Unexpected error: %v", err)
	}
	// On Windows, Unix paths get converted to Windows paths
	if runtime.GOOS == "windows" {
		t.Logf("Test case 3 (Windows): Got root '%s'", root)
	} else {
		if root != "root" {
			t.Errorf("Test case 3 failed. Expected 'root', got '%s'", root)
		}
	}

	// Test case 4: Current directory
	root, err = GetPhysicalRootFromPath(".")
	if err != nil {
		t.Errorf("Test case 4 failed. Unexpected error: %v", err)
	}
	t.Logf("Test case 4: Current directory root is '%s'", root)
}

func TestGetFileSHA256Sum(t *testing.T) {
	// Create temporary directory and file
	tempDir, err := os.MkdirTemp("", "sha256_test")
	if err != nil {
		t.Fatalf("Failed to create temp directory: %v", err)
	}
	defer os.RemoveAll(tempDir)

	// Test case 1: File with known content
	testFile := filepath.Join(tempDir, "test.txt")
	content := "Hello, World!"
	err = os.WriteFile(testFile, []byte(content), 0644)
	if err != nil {
		t.Fatalf("Failed to create test file: %v", err)
	}

	hash, err := GetFileSHA256Sum(testFile)
	if err != nil {
		t.Errorf("Test case 1 failed. Unexpected error: %v", err)
	}
	if len(hash) != 64 {
		t.Errorf("Test case 1 failed. SHA256 hash should be 64 chars, got %d", len(hash))
	}
	// SHA256 of "Hello, World!" is known
	expectedHash := "dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f"
	if hash != expectedHash {
		t.Errorf("Test case 1 failed. Expected %s, got %s", expectedHash, hash)
	}

	// Test case 2: Non-existent file
	_, err = GetFileSHA256Sum("/non/existent/file.txt")
	if err == nil {
		t.Error("Test case 2 failed. Expected error for non-existent file")
	}

	// Test case 3: Empty file
	emptyFile := filepath.Join(tempDir, "empty.txt")
	err = os.WriteFile(emptyFile, []byte(""), 0644)
	if err != nil {
		t.Fatalf("Failed to create empty file: %v", err)
	}

	hash, err = GetFileSHA256Sum(emptyFile)
	if err != nil {
		t.Errorf("Test case 3 failed. Unexpected error: %v", err)
	}
	// SHA256 of empty string
	expectedEmptyHash := "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
	if hash != expectedEmptyHash {
		t.Errorf("Test case 3 failed. Expected %s, got %s", expectedEmptyHash, hash)
	}

	// Test case 4: Hash should be deterministic
	hash1, _ := GetFileSHA256Sum(testFile)
	hash2, _ := GetFileSHA256Sum(testFile)
	if hash1 != hash2 {
		t.Error("Test case 4 failed. Hash should be deterministic")
	}
}

func TestMatchingFileSystem(t *testing.T) {
	// Create two handlers with same filesystem
	handler1 := &FileSystemHandler{
		Filesystem: "ext4",
	}
	handler2 := &FileSystemHandler{
		Filesystem: "ext4",
	}
	handler3 := &FileSystemHandler{
		Filesystem: "ntfs",
	}

	// Test case 1: Same filesystem
	result := MatchingFileSystem(handler1, handler2)
	if !result {
		t.Error("Test case 1 failed. Should match same filesystem")
	}

	// Test case 2: Different filesystem
	result = MatchingFileSystem(handler1, handler3)
	if result {
		t.Error("Test case 2 failed. Should not match different filesystems")
	}

	// Test case 3: Same handler
	result = MatchingFileSystem(handler1, handler1)
	if !result {
		t.Error("Test case 3 failed. Should match same handler")
	}
}
