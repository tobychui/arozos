package webdavfs

import (
	"testing"
)

func TestNewWebDAVMount(t *testing.T) {
	// Test that function with invalid parameters returns error
	_, err := NewWebDAVMount("test-uuid", "user", "http://invalid-url", "user", "pass")
	if err == nil {
		t.Error("Expected error with invalid WebDAV server")
	}
}
