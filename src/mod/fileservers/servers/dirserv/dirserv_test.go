package dirserv

import (
	"testing"
)

func TestNewDirectoryServer(t *testing.T) {
	// Test that passing nil causes expected panic (constructor requires valid Option)
	defer func() {
		if r := recover(); r == nil {
			t.Error("Expected panic when passing nil to NewDirectoryServer")
		} else {
			t.Logf("Expected panic caught: %v", r)
		}
	}()

	// This should panic with nil pointer dereference
	_ = NewDirectoryServer(nil)
}
