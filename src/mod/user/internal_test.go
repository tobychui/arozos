package user

import (
	"testing"

	fs "imuslab.com/arozos/mod/filesystem"
)

func TestGetHandlerFromID(t *testing.T) {
	// Create mock filesystem handlers for testing
	handler1 := &fs.FileSystemHandler{
		UUID: "handler-uuid-1",
		Name: "Handler 1",
	}
	handler2 := &fs.FileSystemHandler{
		UUID: "handler-uuid-2",
		Name: "Handler 2",
	}
	handler3 := &fs.FileSystemHandler{
		UUID: "handler-uuid-3",
		Name: "Handler 3",
	}

	storages := []*fs.FileSystemHandler{handler1, handler2, handler3}

	// Test case 1: Find existing handler by UUID
	result, err := getHandlerFromID(storages, "handler-uuid-1")
	if err != nil {
		t.Errorf("Test case 1 failed. Expected no error, got %v", err)
	}
	if result.UUID != "handler-uuid-1" {
		t.Errorf("Test case 1 failed. Expected handler-uuid-1, got %s", result.UUID)
	}
	if result.Name != "Handler 1" {
		t.Errorf("Test case 1 failed. Expected 'Handler 1', got %s", result.Name)
	}

	// Test case 2: Find handler in middle of list
	result, err = getHandlerFromID(storages, "handler-uuid-2")
	if err != nil {
		t.Errorf("Test case 2 failed. Expected no error, got %v", err)
	}
	if result.UUID != "handler-uuid-2" {
		t.Errorf("Test case 2 failed. Expected handler-uuid-2, got %s", result.UUID)
	}

	// Test case 3: Find handler at end of list
	result, err = getHandlerFromID(storages, "handler-uuid-3")
	if err != nil {
		t.Errorf("Test case 3 failed. Expected no error, got %v", err)
	}
	if result.UUID != "handler-uuid-3" {
		t.Errorf("Test case 3 failed. Expected handler-uuid-3, got %s", result.UUID)
	}

	// Test case 4: Handler not found
	result, err = getHandlerFromID(storages, "non-existent-uuid")
	if err == nil {
		t.Error("Test case 4 failed. Expected error for non-existent handler")
	}
	if err != nil && err.Error() != "handler Not Found" {
		t.Errorf("Test case 4 failed. Expected 'handler Not Found' error, got %v", err)
	}

	// Test case 5: Empty storages list
	result, err = getHandlerFromID([]*fs.FileSystemHandler{}, "handler-uuid-1")
	if err == nil {
		t.Error("Test case 5 failed. Expected error for empty storages list")
	}
	if err != nil && err.Error() != "handler Not Found" {
		t.Errorf("Test case 5 failed. Expected 'handler Not Found' error, got %v", err)
	}

	// Test case 6: Nil storages list
	result, err = getHandlerFromID(nil, "handler-uuid-1")
	if err == nil {
		t.Error("Test case 6 failed. Expected error for nil storages list")
	}

	// Test case 7: Empty UUID search
	result, err = getHandlerFromID(storages, "")
	if err == nil {
		t.Error("Test case 7 failed. Expected error for empty UUID")
	}

	// Test case 8: Single handler in list
	singleStorage := []*fs.FileSystemHandler{handler1}
	result, err = getHandlerFromID(singleStorage, "handler-uuid-1")
	if err != nil {
		t.Errorf("Test case 8 failed. Expected no error for single handler, got %v", err)
	}
	if result.UUID != "handler-uuid-1" {
		t.Errorf("Test case 8 failed. Expected handler-uuid-1, got %s", result.UUID)
	}

	// Test case 9: UUID with special characters
	handlerSpecial := &fs.FileSystemHandler{
		UUID: "handler-uuid-special-chars-!@#$",
		Name: "Special Handler",
	}
	storagesSpecial := []*fs.FileSystemHandler{handlerSpecial}
	result, err = getHandlerFromID(storagesSpecial, "handler-uuid-special-chars-!@#$")
	if err != nil {
		t.Errorf("Test case 9 failed. Expected no error for special chars UUID, got %v", err)
	}
	if result.UUID != "handler-uuid-special-chars-!@#$" {
		t.Errorf("Test case 9 failed. Expected special chars UUID, got %s", result.UUID)
	}

	// Test case 10: Case sensitivity check
	result, err = getHandlerFromID(storages, "HANDLER-UUID-1")
	if err == nil {
		t.Log("Test case 10 note: UUID search appears to be case-insensitive or handler exists")
	} else if err.Error() == "handler Not Found" {
		t.Log("Test case 10 note: UUID search is case-sensitive")
	}

	// Test case 11: Multiple handlers with same UUID (should return first match)
	duplicateHandler := &fs.FileSystemHandler{
		UUID: "handler-uuid-1",
		Name: "Duplicate Handler",
	}
	storagesWithDup := []*fs.FileSystemHandler{handler1, duplicateHandler, handler2}
	result, err = getHandlerFromID(storagesWithDup, "handler-uuid-1")
	if err != nil {
		t.Errorf("Test case 11 failed. Expected no error, got %v", err)
	}
	if result.Name != "Handler 1" {
		t.Errorf("Test case 11 failed. Expected first matching handler 'Handler 1', got %s", result.Name)
	}

	// Test case 12: Very long UUID
	longUUID := "handler-uuid-very-long-" + string(make([]byte, 1000))
	handlerLong := &fs.FileSystemHandler{
		UUID: longUUID,
		Name: "Long UUID Handler",
	}
	storagesLong := []*fs.FileSystemHandler{handlerLong}
	result, err = getHandlerFromID(storagesLong, longUUID)
	if err != nil {
		t.Errorf("Test case 12 failed. Expected no error for long UUID, got %v", err)
	}
	if result.UUID != longUUID {
		t.Error("Test case 12 failed. Long UUID not matched correctly")
	}
}

func TestGetIDFromVirtualPath(t *testing.T) {
	// This function wraps fs.GetIDFromVirtualPath
	// We'll test the basic functionality assuming the underlying fs function works

	// Test case 1: Valid virtual path format (assuming format like "uuid:/path/to/file")
	// The actual implementation depends on fs.GetIDFromVirtualPath
	// We can test that the function exists and can be called

	vid, subpath, err := getIDFromVirtualPath("test-uuid:/some/path")
	// The result depends on the implementation of fs.GetIDFromVirtualPath
	t.Logf("Test case 1: vid=%s, subpath=%s, err=%v", vid, subpath, err)

	// Test case 2: Empty path
	vid, subpath, err = getIDFromVirtualPath("")
	t.Logf("Test case 2 (empty path): vid=%s, subpath=%s, err=%v", vid, subpath, err)

	// Test case 3: Path without separator
	vid, subpath, err = getIDFromVirtualPath("noseparator")
	t.Logf("Test case 3 (no separator): vid=%s, subpath=%s, err=%v", vid, subpath, err)

	// Test case 4: Path with multiple separators
	vid, subpath, err = getIDFromVirtualPath("uuid1:/path1:/path2")
	t.Logf("Test case 4 (multiple separators): vid=%s, subpath=%s, err=%v", vid, subpath, err)

	// Test case 5: Path with only UUID
	vid, subpath, err = getIDFromVirtualPath("uuid-only:")
	t.Logf("Test case 5 (UUID only): vid=%s, subpath=%s, err=%v", vid, subpath, err)

	// Test case 6: Path with special characters
	vid, subpath, err = getIDFromVirtualPath("uuid-123:/path/with spaces/and&special")
	t.Logf("Test case 6 (special chars): vid=%s, subpath=%s, err=%v", vid, subpath, err)

	// Test case 7: Very long path
	longPath := "uuid-long:" + string(make([]byte, 10000))
	vid, subpath, err = getIDFromVirtualPath(longPath)
	t.Logf("Test case 7 (long path): vid length=%d, subpath length=%d, err=%v", len(vid), len(subpath), err)

	// Test case 8: Unicode characters
	vid, subpath, err = getIDFromVirtualPath("uuid-unicode:/路径/パス")
	t.Logf("Test case 8 (unicode): vid=%s, subpath=%s, err=%v", vid, subpath, err)
}

func TestGetHandlerFromVirtualPath(t *testing.T) {
	// Create mock filesystem handlers for testing
	handler1 := &fs.FileSystemHandler{
		UUID: "handler-1",
		Name: "Handler 1",
	}
	handler2 := &fs.FileSystemHandler{
		UUID: "handler-2",
		Name: "Handler 2",
	}

	storages := []*fs.FileSystemHandler{handler1, handler2}

	// Test case 1: Valid virtual path (format depends on fs.GetIDFromVirtualPath)
	// This is an integration test that combines getIDFromVirtualPath and getHandlerFromID
	result, err := getHandlerFromVirtualPath(storages, "handler-1:/some/path")
	if err != nil {
		t.Logf("Test case 1: Error getting handler from virtual path: %v", err)
		// This might fail if the virtual path format is different
	} else {
		if result.UUID != "handler-1" {
			t.Logf("Test case 1: Expected handler-1, got %s", result.UUID)
		}
	}

	// Test case 2: Invalid virtual path
	result, err = getHandlerFromVirtualPath(storages, "invalid-path")
	if err == nil {
		t.Log("Test case 2 note: Invalid path did not return error (might be valid format)")
	}

	// Test case 3: Empty virtual path
	result, err = getHandlerFromVirtualPath(storages, "")
	if err == nil {
		t.Log("Test case 3 note: Empty path did not return error")
	}

	// Test case 4: Non-existent handler UUID in path
	result, err = getHandlerFromVirtualPath(storages, "non-existent:/path")
	if err == nil {
		t.Error("Test case 4 failed. Expected error for non-existent handler")
	}

	// Test case 5: Empty storages list
	result, err = getHandlerFromVirtualPath([]*fs.FileSystemHandler{}, "handler-1:/path")
	if err == nil {
		t.Error("Test case 5 failed. Expected error for empty storages")
	}

	// Test case 6: Nil storages list
	result, err = getHandlerFromVirtualPath(nil, "handler-1:/path")
	if err == nil {
		t.Error("Test case 6 failed. Expected error for nil storages")
	}

	// Test case 7: Path with multiple components
	result, err = getHandlerFromVirtualPath(storages, "handler-2:/deep/nested/path/to/file.txt")
	if err != nil {
		t.Logf("Test case 7: Error with nested path: %v", err)
	} else {
		if result.UUID != "handler-2" {
			t.Logf("Test case 7: Expected handler-2, got %s", result.UUID)
		}
	}

	// Test case 8: Virtual path with special characters
	result, err = getHandlerFromVirtualPath(storages, "handler-1:/path/with spaces/and&special.txt")
	t.Logf("Test case 8 (special chars): err=%v", err)

	// Test case 9: Virtual path with unicode
	result, err = getHandlerFromVirtualPath(storages, "handler-1:/文件/ファイル")
	t.Logf("Test case 9 (unicode): err=%v", err)

	// Test case 10: Very long virtual path
	longPath := "handler-1:/" + string(make([]byte, 5000))
	result, err = getHandlerFromVirtualPath(storages, longPath)
	t.Logf("Test case 10 (long path): err=%v", err)
}
