package ftpserv

import (
	"testing"
)

func TestNewFTPManager(t *testing.T) {
	manager := NewFTPManager(nil)
	if manager == nil {
		t.Error("Manager should not be nil")
	}
}
