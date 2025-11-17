package sftpserver

import (
	"testing"
)

func TestNewSFTPServer(t *testing.T) {
	server, err := NewSFTPServer(nil)
	if err == nil && server != nil {
		t.Error("Expected error with nil config")
	}
	t.Logf("Server creation result: %v", err)
}
