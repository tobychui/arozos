package www

import (
	"os"
	"path/filepath"
	"testing"

	"imuslab.com/arozos/mod/database"
)

func setupTestHandler(t *testing.T) (*Handler, func()) {
	// Create a temporary directory for the test database
	tempDir, err := os.MkdirTemp("", "www_handler_test")
	if err != nil {
		t.Fatalf("Failed to create temp directory: %v", err)
	}

	// Create a test database
	db, err := database.NewDatabase(filepath.Join(tempDir, "test.db"), false)
	if err != nil {
		os.RemoveAll(tempDir)
		t.Fatalf("Failed to create test database: %v", err)
	}

	// Create handler with minimal options
	handler := &Handler{
		Options: Options{
			Database: db,
		},
	}

	// Create the www table
	handler.Options.Database.NewTable("www")

	// Cleanup function
	cleanup := func() {
		db.Close()
		os.RemoveAll(tempDir)
	}

	return handler, cleanup
}

func TestCheckUserHomePageEnabled(t *testing.T) {
	handler, cleanup := setupTestHandler(t)
	defer cleanup()

	username := "testuser"

	// Test case 1: User not exists (should return false)
	result := handler.CheckUserHomePageEnabled(username)
	if result {
		t.Error("Test case 1 failed. Expected false for non-existent user")
	}

	// Test case 2: User homepage explicitly enabled
	handler.Options.Database.Write("www", username+"_enable", "true")
	result = handler.CheckUserHomePageEnabled(username)
	if !result {
		t.Error("Test case 2 failed. Expected true when homepage is enabled")
	}

	// Test case 3: User homepage explicitly disabled
	handler.Options.Database.Write("www", username+"_enable", "false")
	result = handler.CheckUserHomePageEnabled(username)
	if result {
		t.Error("Test case 3 failed. Expected false when homepage is disabled")
	}

	// Test case 4: Different user
	username2 := "anotheruser"
	handler.Options.Database.Write("www", username2+"_enable", "true")
	result = handler.CheckUserHomePageEnabled(username2)
	if !result {
		t.Error("Test case 4 failed. Expected true for second user")
	}

	// First user should still be false
	result = handler.CheckUserHomePageEnabled(username)
	if result {
		t.Error("Test case 4 failed. First user should still be false")
	}

	// Test case 5: Invalid value (not "true" or "false")
	handler.Options.Database.Write("www", "invaliduser_enable", "invalid")
	result = handler.CheckUserHomePageEnabled("invaliduser")
	if result {
		t.Error("Test case 5 failed. Expected false for invalid value")
	}

	// Test case 6: Empty username
	result = handler.CheckUserHomePageEnabled("")
	if result {
		t.Error("Test case 6 failed. Expected false for empty username")
	}

	// Test case 7: Username with special characters
	specialUser := "user@domain.com"
	handler.Options.Database.Write("www", specialUser+"_enable", "true")
	result = handler.CheckUserHomePageEnabled(specialUser)
	if !result {
		t.Error("Test case 7 failed. Expected true for user with special characters")
	}

	// Test case 8: Case sensitivity
	upperUser := "UPPERCASE"
	lowerUser := "uppercase"
	handler.Options.Database.Write("www", upperUser+"_enable", "true")
	result1 := handler.CheckUserHomePageEnabled(upperUser)
	result2 := handler.CheckUserHomePageEnabled(lowerUser)
	if !result1 {
		t.Error("Test case 8 failed. Uppercase user should be enabled")
	}
	t.Logf("Test case 8: Case sensitivity check - upper: %v, lower: %v", result1, result2)

	// Test case 9: Toggle from true to false
	toggleUser := "toggleuser"
	handler.Options.Database.Write("www", toggleUser+"_enable", "true")
	if !handler.CheckUserHomePageEnabled(toggleUser) {
		t.Error("Test case 9 failed. Should be true initially")
	}
	handler.Options.Database.Write("www", toggleUser+"_enable", "false")
	if handler.CheckUserHomePageEnabled(toggleUser) {
		t.Error("Test case 9 failed. Should be false after toggle")
	}

	// Test case 10: Long username
	longUser := string(make([]byte, 1000))
	for i := range longUser {
		longUser = longUser[:i] + "a" + longUser[i+1:]
	}
	handler.Options.Database.Write("www", longUser+"_enable", "true")
	result = handler.CheckUserHomePageEnabled(longUser)
	if !result {
		t.Error("Test case 10 failed. Expected true for long username")
	}
}

func TestGetUserWebRoot(t *testing.T) {
	handler, cleanup := setupTestHandler(t)
	defer cleanup()

	username := "testuser"

	// Test case 1: User webroot not defined
	_, err := handler.GetUserWebRoot(username)
	if err == nil {
		t.Error("Test case 1 failed. Expected error when webroot not defined")
	}
	if err != nil && err.Error() != "Webroot not defined" {
		t.Errorf("Test case 1 failed. Expected 'Webroot not defined' error, got: %v", err)
	}

	// Test case 2: User webroot defined
	expectedPath := "user:/documents/www"
	handler.Options.Database.Write("www", username+"_webroot", expectedPath)
	webroot, err := handler.GetUserWebRoot(username)
	if err != nil {
		t.Errorf("Test case 2 failed. Expected no error, got: %v", err)
	}
	if webroot != expectedPath {
		t.Errorf("Test case 2 failed. Expected %s, got %s", expectedPath, webroot)
	}

	// Test case 3: Different user
	username2 := "anotheruser"
	expectedPath2 := "user2:/www"
	handler.Options.Database.Write("www", username2+"_webroot", expectedPath2)
	webroot, err = handler.GetUserWebRoot(username2)
	if err != nil {
		t.Errorf("Test case 3 failed. Expected no error, got: %v", err)
	}
	if webroot != expectedPath2 {
		t.Errorf("Test case 3 failed. Expected %s, got %s", expectedPath2, webroot)
	}

	// Test case 4: Empty webroot path
	handler.Options.Database.Write("www", "emptyuser_webroot", "")
	webroot, err = handler.GetUserWebRoot("emptyuser")
	if err != nil {
		t.Errorf("Test case 4 failed. Expected no error for empty path, got: %v", err)
	}
	if webroot != "" {
		t.Errorf("Test case 4 failed. Expected empty string, got %s", webroot)
	}

	// Test case 5: Webroot with special characters
	specialPath := "user:/path/with spaces/and&special.chars"
	handler.Options.Database.Write("www", username+"_webroot", specialPath)
	webroot, err = handler.GetUserWebRoot(username)
	if err != nil {
		t.Errorf("Test case 5 failed. Expected no error, got: %v", err)
	}
	if webroot != specialPath {
		t.Errorf("Test case 5 failed. Expected %s, got %s", specialPath, webroot)
	}

	// Test case 6: Webroot with Unicode
	unicodePath := "user:/文件/ファイル"
	handler.Options.Database.Write("www", username+"_webroot", unicodePath)
	webroot, err = handler.GetUserWebRoot(username)
	if err != nil {
		t.Errorf("Test case 6 failed. Expected no error, got: %v", err)
	}
	if webroot != unicodePath {
		t.Errorf("Test case 6 failed. Expected %s, got %s", unicodePath, webroot)
	}

	// Test case 7: Update webroot
	newPath := "user:/new/webroot"
	handler.Options.Database.Write("www", username+"_webroot", newPath)
	webroot, err = handler.GetUserWebRoot(username)
	if err != nil {
		t.Errorf("Test case 7 failed. Expected no error, got: %v", err)
	}
	if webroot != newPath {
		t.Errorf("Test case 7 failed. Expected %s, got %s", newPath, webroot)
	}

	// Test case 8: Empty username
	_, err = handler.GetUserWebRoot("")
	if err == nil {
		t.Error("Test case 8 failed. Expected error for empty username")
	}

	// Test case 9: Very long path
	longPath := "user:/" + string(make([]byte, 5000))
	for i := range longPath[6:] {
		longPath = longPath[:i+6] + "a" + longPath[i+7:]
	}
	handler.Options.Database.Write("www", username+"_webroot", longPath)
	webroot, err = handler.GetUserWebRoot(username)
	if err != nil {
		t.Errorf("Test case 9 failed. Expected no error for long path, got: %v", err)
	}

	// Test case 10: Absolute vs relative paths
	absolutePath := "/absolute/path/to/www"
	handler.Options.Database.Write("www", username+"_webroot", absolutePath)
	webroot, err = handler.GetUserWebRoot(username)
	if err != nil {
		t.Errorf("Test case 10 failed. Expected no error, got: %v", err)
	}
	if webroot != absolutePath {
		t.Errorf("Test case 10 failed. Expected %s, got %s", absolutePath, webroot)
	}
}
