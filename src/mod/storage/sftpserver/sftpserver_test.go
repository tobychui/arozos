package sftpserver

import (
	"testing"
)

func TestNewSFTPServer(t *testing.T) {
	// Test that passing nil causes expected panic (constructor requires valid SFTPConfig)
	defer func() {
		if r := recover(); r == nil {
			t.Error("Expected panic when passing nil to NewSFTPServer")
		} else {
			t.Logf("Expected panic caught: %v", r)
		}
	}()

	// This should panic with nil pointer dereference
	_, _ = NewSFTPServer(nil)
}
