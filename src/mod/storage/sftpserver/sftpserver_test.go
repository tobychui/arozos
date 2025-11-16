package sftpserver

import (
	"testing"
)

func TestNewSFTPServer(t *testing.T) {
	server := NewSFTPServer(nil, "", 0)
	if server == nil {
		t.Error("Server should not be nil")
	}
}
