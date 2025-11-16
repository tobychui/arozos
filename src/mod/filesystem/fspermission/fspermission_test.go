package fspermission

import (
	"testing"
)

func TestNewPermissionHandler(t *testing.T) {
	handler := NewPermissionHandler(nil)
	if handler == nil {
		t.Error("Handler should not be nil")
	}
}
