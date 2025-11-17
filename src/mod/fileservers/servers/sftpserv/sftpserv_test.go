package sftpserv

import (
	"testing"
)

func TestNewSFTPServer(t *testing.T) {
	manager := NewSFTPServer(nil)
	if manager == nil {
		t.Error("Manager should not be nil")
	}
}
