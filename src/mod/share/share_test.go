package share

import (
	"testing"
)

func TestNewShareManager(t *testing.T) {
	manager := NewShareManager(Options{})
	if manager == nil {
		t.Error("Manager should not be nil")
	}
}
