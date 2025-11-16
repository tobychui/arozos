package ftpfs

import (
	"testing"
)

func TestNewFTPFS(t *testing.T) {
	fs := NewFTPFS("", "", "", 0)
	if fs == nil {
		t.Error("FS should not be nil")
	}
}
