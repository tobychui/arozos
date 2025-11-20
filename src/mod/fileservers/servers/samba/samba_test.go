package samba

import (
	"testing"
)

func TestNewSambaShareManager(t *testing.T) {
	manager, err := NewSambaShareManager(nil)
	if err == nil && manager != nil {
		t.Error("Expected error with nil user handler")
	}
	t.Logf("Manager creation result: %v", err)
}
