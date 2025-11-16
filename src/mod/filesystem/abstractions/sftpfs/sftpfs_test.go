package sftpfs

import (
	"testing"
)

func TestNewSFTPFS(t *testing.T) {
	fs := NewSFTPFS("", "", "", 0)
	if fs == nil {
		t.Error("FS should not be nil")
	}
}
