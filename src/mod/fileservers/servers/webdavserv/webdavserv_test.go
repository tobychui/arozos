package webdavserv

import (
	"testing"
)

func TestNewWebDAVManager(t *testing.T) {
	// Test that passing nil causes expected panic (constructor requires valid Option)
	defer func() {
		if r := recover(); r == nil {
			t.Error("Expected panic when passing nil to NewWebDAVManager")
		} else {
			t.Logf("Expected panic caught: %v", r)
		}
	}()

	// This should panic with nil pointer dereference
	_ = NewWebDAVManager(nil)
}
