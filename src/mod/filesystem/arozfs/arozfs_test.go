package arozfs

import (
	"testing"
)

func TestIsNetworkDrive(t *testing.T) {
	// Test case 1: webdav is network drive
	if !IsNetworkDrive("webdav") {
		t.Error("Test case 1 failed. webdav should be network drive")
	}

	// Test case 2: ftp is network drive
	if !IsNetworkDrive("ftp") {
		t.Error("Test case 2 failed. ftp should be network drive")
	}

	// Test case 3: smb is network drive
	if !IsNetworkDrive("smb") {
		t.Error("Test case 3 failed. smb should be network drive")
	}

	// Test case 4: sftp is network drive
	if !IsNetworkDrive("sftp") {
		t.Error("Test case 4 failed. sftp should be network drive")
	}

	// Test case 5: ext4 is not network drive
	if IsNetworkDrive("ext4") {
		t.Error("Test case 5 failed. ext4 should not be network drive")
	}

	// Test case 6: ntfs is not network drive
	if IsNetworkDrive("ntfs") {
		t.Error("Test case 6 failed. ntfs should not be network drive")
	}

	// Test case 7: empty string is not network drive
	if IsNetworkDrive("") {
		t.Error("Test case 7 failed. empty string should not be network drive")
	}

	// Test case 8: random string is not network drive
	if IsNetworkDrive("randomfs") {
		t.Error("Test case 8 failed. random filesystem should not be network drive")
	}

	// Test case 9: case sensitivity check
	if IsNetworkDrive("WEBDAV") {
		t.Error("Test case 9 failed. Should be case sensitive")
	}
}

func TestGetSupportedFileSystemTypes(t *testing.T) {
	// Test case 1: Returns a slice
	types := GetSupportedFileSystemTypes()
	if types == nil {
		t.Error("Test case 1 failed. Should return non-nil slice")
	}

	// Test case 2: Contains expected types
	expectedTypes := []string{"ext4", "ext2", "ext3", "fat", "vfat", "ntfs", "webdav", "ftp", "smb", "sftp"}
	if len(types) != len(expectedTypes) {
		t.Errorf("Test case 2 failed. Expected %d types, got %d", len(expectedTypes), len(types))
	}

	// Test case 3: Contains ext4
	found := false
	for _, fstype := range types {
		if fstype == "ext4" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Test case 3 failed. Should contain ext4")
	}

	// Test case 4: Contains webdav
	found = false
	for _, fstype := range types {
		if fstype == "webdav" {
			found = true
			break
		}
	}
	if !found {
		t.Error("Test case 4 failed. Should contain webdav")
	}
}

func TestGenericVirtualPathToRealPathTranslator(t *testing.T) {
	// Test case 1: Public hierarchy with simple path
	rpath, err := GenericVirtualPathToRealPathTranslator("storage1", "public", "/folder/file.txt", "testuser")
	if err != nil {
		t.Errorf("Test case 1 failed. Unexpected error: %v", err)
	}
	if rpath != "/folder/file.txt" {
		t.Errorf("Test case 1 failed. Expected '/folder/file.txt', got '%s'", rpath)
	}

	// Test case 2: User hierarchy with simple path
	rpath, err = GenericVirtualPathToRealPathTranslator("storage1", "user", "/folder/file.txt", "testuser")
	if err != nil {
		t.Errorf("Test case 2 failed. Unexpected error: %v", err)
	}
	if rpath != "users/testuser/folder/file.txt" {
		t.Errorf("Test case 2 failed. Expected 'users/testuser/folder/file.txt', got '%s'", rpath)
	}

	// Test case 3: Root path
	rpath, err = GenericVirtualPathToRealPathTranslator("storage1", "public", "/", "testuser")
	if err != nil {
		t.Errorf("Test case 3 failed. Unexpected error: %v", err)
	}
	if rpath != "/" {
		t.Errorf("Test case 3 failed. Expected '/', got '%s'", rpath)
	}

	// Test case 4: Empty path becomes root
	rpath, err = GenericVirtualPathToRealPathTranslator("storage1", "public", "", "testuser")
	if err != nil {
		t.Errorf("Test case 4 failed. Unexpected error: %v", err)
	}
	if rpath != "/" {
		t.Errorf("Test case 4 failed. Expected '/', got '%s'", rpath)
	}

	// Test case 5: Full virtual path with UUID prefix
	rpath, err = GenericVirtualPathToRealPathTranslator("storage1", "public", "storage1:/folder/file.txt", "testuser")
	if err != nil {
		t.Errorf("Test case 5 failed. Unexpected error: %v", err)
	}
	if rpath != "/folder/file.txt" {
		t.Errorf("Test case 5 failed. Expected '/folder/file.txt', got '%s'", rpath)
	}

	// Test case 6: Invalid hierarchy
	_, err = GenericVirtualPathToRealPathTranslator("storage1", "invalid", "/folder", "testuser")
	if err == nil {
		t.Error("Test case 6 failed. Should return error for invalid hierarchy")
	}

	// Test case 7: Path with dots
	rpath, err = GenericVirtualPathToRealPathTranslator("storage1", "public", "./folder/./file.txt", "testuser")
	if err != nil {
		t.Errorf("Test case 7 failed. Unexpected error: %v", err)
	}
	if rpath != "folder/file.txt" {
		t.Errorf("Test case 7 failed. Expected 'folder/file.txt', got '%s'", rpath)
	}

	// Test case 8: Path with backslashes
	rpath, err = GenericVirtualPathToRealPathTranslator("storage1", "public", "\\folder\\file.txt", "testuser")
	if err != nil {
		t.Errorf("Test case 8 failed. Unexpected error: %v", err)
	}
	t.Logf("Test case 8: Backslash path converted to: %s", rpath)
}

func TestGenericRealPathToVirtualPathTranslator(t *testing.T) {
	// Test case 1: Public hierarchy simple path
	vpath, err := GenericRealPathToVirtualPathTranslator("storage1", "public", "/folder/file.txt", "testuser")
	if err != nil {
		t.Errorf("Test case 1 failed. Unexpected error: %v", err)
	}
	if vpath != "storage1:/folder/file.txt" {
		t.Errorf("Test case 1 failed. Expected 'storage1:/folder/file.txt', got '%s'", vpath)
	}

	// Test case 2: User hierarchy with user prefix
	vpath, err = GenericRealPathToVirtualPathTranslator("storage1", "user", "/users/testuser/folder/file.txt", "testuser")
	if err != nil {
		t.Errorf("Test case 2 failed. Unexpected error: %v", err)
	}
	if vpath != "storage1:/folder/file.txt" {
		t.Errorf("Test case 2 failed. Expected 'storage1:/folder/file.txt', got '%s'", vpath)
	}

	// Test case 3: Root path
	vpath, err = GenericRealPathToVirtualPathTranslator("storage1", "public", "/", "testuser")
	if err != nil {
		t.Errorf("Test case 3 failed. Unexpected error: %v", err)
	}
	if vpath != "storage1:/" {
		t.Errorf("Test case 3 failed. Expected 'storage1:/', got '%s'", vpath)
	}

	// Test case 4: Empty path
	vpath, err = GenericRealPathToVirtualPathTranslator("storage1", "public", "", "testuser")
	if err != nil {
		t.Errorf("Test case 4 failed. Unexpected error: %v", err)
	}
	if vpath != "storage1:/" {
		t.Errorf("Test case 4 failed. Expected 'storage1:/', got '%s'", vpath)
	}

	// Test case 5: Path with backslashes
	vpath, err = GenericRealPathToVirtualPathTranslator("storage1", "public", "\\folder\\file.txt", "testuser")
	if err != nil {
		t.Errorf("Test case 5 failed. Unexpected error: %v", err)
	}
	t.Logf("Test case 5: Backslash path converted to: %s", vpath)

	// Test case 6: Relative path starting with ./
	vpath, err = GenericRealPathToVirtualPathTranslator("storage1", "public", "./folder/file.txt", "testuser")
	if err != nil {
		t.Errorf("Test case 6 failed. Unexpected error: %v", err)
	}
	if vpath != "storage1:/folder/file.txt" {
		t.Errorf("Test case 6 failed. Expected 'storage1:/folder/file.txt', got '%s'", vpath)
	}
}

func TestGenericPathFilter(t *testing.T) {
	// Test case 1: Simple path
	result := GenericPathFilter("/folder/file.txt")
	if result != "/folder/file.txt" {
		t.Errorf("Test case 1 failed. Expected '/folder/file.txt', got '%s'", result)
	}

	// Test case 2: Path starting with ./
	result = GenericPathFilter("./folder/file.txt")
	if result != "folder/file.txt" {
		t.Errorf("Test case 2 failed. Expected 'folder/file.txt', got '%s'", result)
	}

	// Test case 3: Empty path
	result = GenericPathFilter("")
	if result != "/" {
		t.Errorf("Test case 3 failed. Expected '/', got '%s'", result)
	}

	// Test case 4: Just dot
	result = GenericPathFilter(".")
	if result != "/" {
		t.Errorf("Test case 4 failed. Expected '/', got '%s'", result)
	}

	// Test case 5: Path with backslashes
	result = GenericPathFilter("\\folder\\file.txt")
	t.Logf("Test case 5: Backslash path filtered to: %s", result)

	// Test case 6: Path with spaces
	result = GenericPathFilter(" /folder/file.txt ")
	if result != "/folder/file.txt" {
		t.Errorf("Test case 6 failed. Expected '/folder/file.txt', got '%s'", result)
	}
}

func TestFilterIllegalCharInFilename(t *testing.T) {
	// Test case 1: Filename with brackets
	result := FilterIllegalCharInFilename("file[1].txt", "_")
	if result != "file_1_.txt" {
		t.Errorf("Test case 1 failed. Expected 'file_1_.txt', got '%s'", result)
	}

	// Test case 2: Filename with question mark
	result = FilterIllegalCharInFilename("file?.txt", "_")
	if result != "file_.txt" {
		t.Errorf("Test case 2 failed. Expected 'file_.txt', got '%s'", result)
	}

	// Test case 3: Filename with dollar sign
	result = FilterIllegalCharInFilename("file$100.txt", "_")
	if result != "file_100.txt" {
		t.Errorf("Test case 3 failed. Expected 'file_100.txt', got '%s'", result)
	}

	// Test case 4: Clean filename (no illegal chars)
	result = FilterIllegalCharInFilename("normalfile.txt", "_")
	if result != "normalfile.txt" {
		t.Errorf("Test case 4 failed. Expected 'normalfile.txt', got '%s'", result)
	}

	// Test case 5: Multiple illegal characters
	result = FilterIllegalCharInFilename("file<>:?|.txt", "_")
	if result != "file_____.txt" {
		t.Errorf("Test case 5 failed. Expected 'file_____.txt', got '%s'", result)
	}

	// Test case 6: Different replacement character
	result = FilterIllegalCharInFilename("file?.txt", "-")
	if result != "file-.txt" {
		t.Errorf("Test case 6 failed. Expected 'file-.txt', got '%s'", result)
	}

	// Test case 7: Empty replacement
	result = FilterIllegalCharInFilename("file?.txt", "")
	if result != "file.txt" {
		t.Errorf("Test case 7 failed. Expected 'file.txt', got '%s'", result)
	}

	// Test case 8: Backslash
	result = FilterIllegalCharInFilename("folder\\file.txt", "_")
	if result != "folder_file.txt" {
		t.Errorf("Test case 8 failed. Expected 'folder_file.txt', got '%s'", result)
	}

	// Test case 9: Curly braces
	result = FilterIllegalCharInFilename("file{1}.txt", "_")
	if result != "file_1_.txt" {
		t.Errorf("Test case 9 failed. Expected 'file_1_.txt', got '%s'", result)
	}

	// Test case 10: Quotes
	result = FilterIllegalCharInFilename("file\"name\".txt", "_")
	if result != "file_name_.txt" {
		t.Errorf("Test case 10 failed. Expected 'file_name_.txt', got '%s'", result)
	}
}

func TestToSlash(t *testing.T) {
	// Test case 1: Path with backslashes
	result := ToSlash("C:\\folder\\file.txt")
	if result != "C:/folder/file.txt" {
		t.Errorf("Test case 1 failed. Expected 'C:/folder/file.txt', got '%s'", result)
	}

	// Test case 2: Path already with forward slashes
	result = ToSlash("/folder/file.txt")
	if result != "/folder/file.txt" {
		t.Errorf("Test case 2 failed. Expected '/folder/file.txt', got '%s'", result)
	}

	// Test case 3: Mixed slashes
	result = ToSlash("C:\\folder/subfolder\\file.txt")
	if result != "C:/folder/subfolder/file.txt" {
		t.Errorf("Test case 3 failed. Expected 'C:/folder/subfolder/file.txt', got '%s'", result)
	}

	// Test case 4: Empty string
	result = ToSlash("")
	if result != "" {
		t.Errorf("Test case 4 failed. Expected '', got '%s'", result)
	}

	// Test case 5: No slashes
	result = ToSlash("filename.txt")
	if result != "filename.txt" {
		t.Errorf("Test case 5 failed. Expected 'filename.txt', got '%s'", result)
	}
}

func TestBase(t *testing.T) {
	// Test case 1: Simple path
	result := Base("/folder/file.txt")
	if result != "file.txt" {
		t.Errorf("Test case 1 failed. Expected 'file.txt', got '%s'", result)
	}

	// Test case 2: Root path
	result = Base("/")
	if result != "/" {
		t.Errorf("Test case 2 failed. Expected '/', got '%s'", result)
	}

	// Test case 3: Empty string
	result = Base("")
	if result != "." {
		t.Errorf("Test case 3 failed. Expected '.', got '%s'", result)
	}

	// Test case 4: Just filename
	result = Base("file.txt")
	if result != "file.txt" {
		t.Errorf("Test case 4 failed. Expected 'file.txt', got '%s'", result)
	}

	// Test case 5: Path with trailing slash
	result = Base("/folder/subfolder/")
	if result != "subfolder" {
		t.Errorf("Test case 5 failed. Expected 'subfolder', got '%s'", result)
	}

	// Test case 6: Multiple trailing slashes
	result = Base("/folder/file.txt///")
	if result != "file.txt" {
		t.Errorf("Test case 6 failed. Expected 'file.txt', got '%s'", result)
	}

	// Test case 7: Backslashes (converted to forward slashes)
	result = Base("C:\\folder\\file.txt")
	if result != "file.txt" {
		t.Errorf("Test case 7 failed. Expected 'file.txt', got '%s'", result)
	}

	// Test case 8: Deep path
	result = Base("/a/b/c/d/e/file.txt")
	if result != "file.txt" {
		t.Errorf("Test case 8 failed. Expected 'file.txt', got '%s'", result)
	}

	// Test case 9: Filename with dots
	result = Base("/folder/file.tar.gz")
	if result != "file.tar.gz" {
		t.Errorf("Test case 9 failed. Expected 'file.tar.gz', got '%s'", result)
	}
}
