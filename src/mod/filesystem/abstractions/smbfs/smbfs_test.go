package smbfs

import (
	"testing"
)

func TestNewSMBFS(t *testing.T) {
	fs := NewSMBFS("", "", "", "")
	if fs == nil {
		t.Error("FS should not be nil")
	}
}
