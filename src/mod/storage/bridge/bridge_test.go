package bridge

import (
	"testing"
)

func TestNewBridge(t *testing.T) {
	bridge := NewBridge(nil, nil)
	if bridge == nil {
		t.Error("Bridge should not be nil")
	}
}
