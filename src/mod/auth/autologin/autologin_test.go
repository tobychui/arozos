package autologin

import (
	"testing"
)

func TestNewAutoLoginHandler(t *testing.T) {
	// Test case 1: Create with nil user handler
	handler := NewAutoLoginHandler(nil)
	if handler == nil {
		t.Error("Test case 1 failed. Handler should not be nil")
	}
	if handler.userHandler != nil {
		t.Error("Test case 1 failed. User handler should be nil")
	}

	// Test case 2: Verify struct fields
	if handler.userHandler != nil {
		t.Error("Test case 2 failed. Expected nil userHandler")
	}
}
